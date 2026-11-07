import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, LifeBuoy } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { REQUEST_KIND_LABELS, type RequestTypeDto } from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import * as sd from '@/services/api/servicedesk';
import { RequestDetail, RequestForm, SlaBadge, deskKeys } from './request-ui';

/** Help centre: raise a request with any service desk, and follow your requests. */
export function HelpCenterPage() {
  const [params, setParams] = useSearchParams();
  const openId = params.get('request');
  const [tab, setTab] = useState(openId ? 'mine' : 'raise');
  const [type, setType] = useState<RequestTypeDto | null>(null);
  const portal = useQuery({ queryKey: deskKeys.portal, queryFn: sd.fetchPortal });
  const mine = useQuery({ queryKey: deskKeys.mine, queryFn: sd.fetchMyRequests });
  const open = (id: string | null) =>
    setParams((p) => {
      if (id) p.set('request', id);
      else p.delete('request');
      return p;
    });
  const byProject = new Map<string, RequestTypeDto[]>();
  for (const t of portal.data ?? [])
    byProject.set(t.project.name, [...(byProject.get(t.project.name) ?? []), t]);

  return (
    <div className="space-y-5">
      <PageHeader title="Help Center" description="Ask a team for help and follow your requests." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="raise">Raise a request</TabsTrigger>
          <TabsTrigger value="mine">
            My requests{mine.data?.length ? ` (${mine.data.length})` : ''}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="raise" className="mt-4">
          {type ? (
            <div className="max-w-xl space-y-4 rounded-xl border bg-card p-4">
              <Button variant="ghost" size="sm" onClick={() => setType(null)}>
                <ArrowLeft /> All request types
              </Button>
              <div>
                <h2 className="font-semibold">{type.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {type.project.name} · {REQUEST_KIND_LABELS[type.kind]}
                  {type.sla ? ` · first response within ${type.sla.responseHours} h` : ''}
                </p>
                {type.description ? <p className="mt-1 text-sm">{type.description}</p> : null}
              </div>
              <RequestForm
                type={type}
                onDone={(r) => {
                  setType(null);
                  setTab('mine');
                  open(r.id);
                }}
              />
            </div>
          ) : byProject.size ? (
            <div className="space-y-5">
              {[...byProject.entries()].map(([project, types]) => (
                <section key={project} aria-label={project} className="space-y-2">
                  <h2 className="text-sm font-semibold">{project}</h2>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {types.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setType(t)}
                        className="rounded-xl border bg-card p-3 text-left hover:border-primary"
                      >
                        <p className="font-medium">{t.name}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {t.description ?? REQUEST_KIND_LABELS[t.kind]}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : !portal.isLoading ? (
            <EmptyState
              icon={LifeBuoy}
              title="No service desks yet"
              description="When a team opens a service desk, its request types appear here."
            />
          ) : null}
        </TabsContent>
        <TabsContent value="mine" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
            <ul className="divide-y rounded-xl border bg-card text-sm" aria-label="My requests">
              {(mine.data ?? []).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => open(r.id)}
                    className={`w-full space-y-1 px-3 py-2 text-left hover:bg-muted ${openId === r.id ? 'bg-muted' : ''}`}
                  >
                    <p className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{r.key}</span>
                      <span className="min-w-0 flex-1 truncate">{r.summary}</span>
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={r.status} label={r.statusLabel} />
                      <SlaBadge label="Resolution" clock={r.sla.resolution} />
                    </div>
                  </button>
                </li>
              ))}
              {mine.data && !mine.data.length ? (
                <li className="px-3 py-2 text-muted-foreground">
                  You have not raised any requests.
                </li>
              ) : null}
            </ul>
            <div className="rounded-xl border bg-card p-4">
              {openId ? (
                <RequestDetail id={openId} />
              ) : (
                <p className="text-sm text-muted-foreground">Choose a request.</p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
