import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { NavLink } from 'react-router';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { NavSection } from '@/routes/nav-config';

interface SidebarNavProps {
  sections: NavSection[];
  collapsed: boolean;
  onNavigate?: () => void;
}

export function BrandMark({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex h-14 items-center gap-2.5 px-4">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sidebar-primary to-violet font-bold text-white shadow-sm">
        A
      </div>
      {!collapsed ? (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">
            Arihant Workspace
          </p>
          <p className="truncate text-[11px] text-sidebar-muted">Arihant Capitals</p>
        </div>
      ) : null}
    </div>
  );
}

/** Permission-filtered navigation. Used by the desktop sidebar and the mobile drawer. */
export function SidebarNav({ sections, collapsed, onNavigate }: SidebarNavProps) {
  return (
    <nav aria-label="Main navigation" className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
      {sections.map((section) => (
        <div key={section.id}>
          {!collapsed ? (
            <p className="mb-1.5 px-2 text-[10.5px] font-semibold tracking-wider text-sidebar-muted uppercase">
              {section.label}
            </p>
          ) : (
            <div className="mx-2 mb-2 h-px bg-sidebar-border" aria-hidden />
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const link = (
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors',
                      'focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
                      collapsed && 'justify-center px-0',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        className={cn(
                          'size-4 shrink-0',
                          isActive ? 'text-sidebar-primary' : 'opacity-80',
                        )}
                        aria-hidden
                      />
                      {collapsed ? (
                        <span className="sr-only">{item.label}</span>
                      ) : (
                        <span className="truncate">{item.label}</span>
                      )}
                    </>
                  )}
                </NavLink>
              );
              return (
                <li key={item.id}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

interface SidebarProps {
  sections: NavSection[];
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ sections, collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out md:flex',
        collapsed ? 'w-[60px]' : 'w-60',
      )}
    >
      <BrandMark collapsed={collapsed} />
      <SidebarNav sections={sections} collapsed={collapsed} />
      <div className="border-t border-sidebar-border p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
            collapsed && 'justify-center',
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed ? 'Collapse' : null}
        </button>
      </div>
    </aside>
  );
}
