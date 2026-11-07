import { Construction } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import type { NavItem } from '@/routes/nav-config';

/**
 * Route target for modules that are scheduled for a later roadmap phase. It states plainly
 * that the module is not built yet instead of rendering inert controls.
 */
export function ModulePendingPage({ item }: { item: NavItem }) {
  return (
    <div className="space-y-6">
      <PageHeader title={item.label} description={item.description} />
      <div className="rounded-xl border bg-card shadow-xs">
        <EmptyState
          icon={Construction}
          title={`Scheduled for Phase ${item.phase}`}
          description={`The ${item.label} module is part of roadmap Phase ${item.phase} and is not available yet.`}
        />
      </div>
    </div>
  );
}
