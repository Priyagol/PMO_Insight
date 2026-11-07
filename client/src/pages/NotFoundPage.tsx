import { Compass, ShieldX } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="rounded-xl border bg-card shadow-xs">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you are looking for does not exist or has moved."
        action={
          <Button asChild size="sm">
            <Link to="/">Go to Overview</Link>
          </Button>
        }
      />
    </div>
  );
}

export function ForbiddenPage() {
  return (
    <div className="rounded-xl border bg-card shadow-xs">
      <EmptyState
        icon={ShieldX}
        title="You don't have access to this page"
        description="Ask your administrator if you need access to this module."
        action={
          <Button asChild size="sm" variant="outline">
            <Link to="/">Go to Overview</Link>
          </Button>
        }
      />
    </div>
  );
}
