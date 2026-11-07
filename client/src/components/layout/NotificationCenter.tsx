import { formatDistanceToNow } from 'date-fns';
import { Bell, BellOff, CheckCheck, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  NOTIFICATION_CATALOGUE,
  NOTIFICATION_TYPES,
  type NotificationDto,
  type NotificationPrefs,
} from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCollabMutation,
  useNotificationPrefs,
  useNotifications,
  useUnreadCount,
} from '@/features/collaboration/hooks';
import { cn } from '@/lib/utils';
import * as api from '@/services/api/collaboration';

/** Bell with unread badge; notifications come from real events only. */
export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const navigate = useNavigate();
  const unread = useUnreadCount();
  const list = useNotifications(open);
  const markRead = useCollabMutation((id: string) => api.markNotificationRead(id));
  const markAll = useCollabMutation(() => api.markAllNotificationsRead(), {
    success: 'All caught up',
  });
  const count = unread.data?.unread ?? 0;

  const openItem = (n: NotificationDto) => {
    if (!n.read) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) void navigate(n.link);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
            className="relative size-8"
          >
            <Bell className="size-4" />
            {count ? (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white tabular"
                aria-hidden
              >
                {count > 99 ? '99+' : count}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 p-0">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={!count || markAll.isPending}
                onClick={() => markAll.mutate(undefined)}
              >
                <CheckCheck /> Mark all read
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Notification settings"
                onClick={() => {
                  setOpen(false);
                  setSettings(true);
                }}
              >
                <Settings2 />
              </Button>
            </div>
          </div>
          {list.isLoading ? (
            <Skeleton className="m-4 h-32" />
          ) : !list.data?.items.length ? (
            <EmptyState
              compact
              icon={BellOff}
              title="No notifications"
              description="Assignments, mentions, approvals and meeting updates appear here."
            />
          ) : (
            <ul className="max-h-[420px] divide-y overflow-y-auto" aria-label="Notification list">
              {list.data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className={cn(
                      'flex w-full gap-3 px-4 py-3 text-left text-sm hover:bg-muted/60',
                      !n.read && 'bg-primary/5',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        n.read ? 'bg-transparent' : 'bg-primary',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block', !n.read && 'font-medium')}>
                        {n.title}
                        {!n.read ? <span className="sr-only"> (unread)</span> : null}
                      </span>
                      {n.body ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {n.body}
                        </span>
                      ) : null}
                      <span className="block text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        {n.actor ? ` · ${n.actor.name}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      {settings ? <NotificationSettingsDialog onClose={() => setSettings(false)} /> : null}
    </>
  );
}

/** Per-type e-mail switches; in-app notifications are always kept. Mounted only while open. */
function NotificationSettingsDialog({ onClose }: { onClose: () => void }) {
  const prefs = useNotificationPrefs(true);
  const [draft, setDraft] = useState<NotificationPrefs | null>(null);
  const value = draft ?? prefs.data ?? null;
  const save = useCollabMutation((p: NotificationPrefs) => api.saveNotificationPrefs(p), {
    success: 'Notification settings saved',
  });
  const groups = [...new Set(NOTIFICATION_TYPES.map((t) => NOTIFICATION_CATALOGUE[t].group))];

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Notification settings</DialogTitle>
          <DialogDescription>
            Everything always appears in the bell. Choose what is also sent by e-mail.
          </DialogDescription>
        </DialogHeader>
        {!value ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={value.emailEnabled}
                onCheckedChange={(c) => setDraft({ ...value, emailEnabled: c === true })}
              />
              Send e-mail notifications
            </label>
            {groups.map((g) => (
              <fieldset key={g} className="space-y-1.5" disabled={!value.emailEnabled}>
                <legend className="mb-1 text-xs font-semibold text-muted-foreground">{g}</legend>
                {NOTIFICATION_TYPES.filter((t) => NOTIFICATION_CATALOGUE[t].group === g).map(
                  (t) => (
                    <label
                      key={t}
                      className={cn(
                        'flex items-center gap-2 text-sm',
                        !value.emailEnabled && 'opacity-50',
                      )}
                    >
                      <Checkbox
                        checked={value.email[t] ?? false}
                        disabled={!value.emailEnabled}
                        onCheckedChange={(c) =>
                          setDraft({ ...value, email: { ...value.email, [t]: c === true } })
                        }
                      />
                      {NOTIFICATION_CATALOGUE[t].label}
                    </label>
                  ),
                )}
              </fieldset>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!draft || save.isPending}
            onClick={() => draft && save.mutate(draft, { onSuccess: onClose })}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
