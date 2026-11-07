import { ChevronRight } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { findNavItem, findNavItemByPrefix, findNavSection } from '@/routes/nav-config';

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const exact = findNavItem(pathname);
  // Nested pages (e.g. /projects/:id) belong to the deepest matching navigation item.
  const item = exact ?? findNavItemByPrefix(pathname);
  const section = item ? findNavSection(item.id) : undefined;

  const crumbs: { label: string; to?: string }[] = [];
  if (section) crumbs.push({ label: section.label });
  if (item && !exact) {
    crumbs.push({ label: item.label, to: item.path });
    crumbs.push({ label: 'Details' });
  } else {
    crumbs.push({ label: item?.label ?? 'Page not found' });
  }

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center text-sm sm:flex">
      <ol className="flex min-w-0 items-center gap-1.5">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {c.to && !last ? (
                <Link to={c.to} className="truncate text-muted-foreground hover:text-foreground">
                  {c.label}
                </Link>
              ) : (
                <span
                  className={
                    last ? 'truncate font-medium text-foreground' : 'truncate text-muted-foreground'
                  }
                  aria-current={last ? 'page' : undefined}
                >
                  {c.label}
                </span>
              )}
              {!last ? (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
