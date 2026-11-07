import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Outlet } from 'react-router';
import { BrandMark, Sidebar, SidebarNav } from '@/components/layout/Sidebar';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { TopBar } from '@/components/layout/TopBar';
import { RealtimeProvider } from '@/features/collaboration/RealtimeProvider';
import { useTaskDrawer } from '@/features/work/tasks/use-task-drawer';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useModHotkey } from '@/hooks/use-hotkey';
import { filterNav, NAV_SECTIONS } from '@/routes/nav-config';
import { useAppDispatch, useAppSelector } from '@/store';
import { setCommandPaletteOpen, setMobileNavOpen, toggleSidebar } from '@/store/ui-slice';

const TaskDrawerHost = lazy(() =>
  import('@/features/work/tasks/TaskDrawer').then((m) => ({ default: m.TaskDrawerHost })),
);

/** The task drawer's code downloads the first time a task is opened, then stays mounted. */
function LazyTaskDrawer() {
  const { openTaskId } = useTaskDrawer();
  const [used, setUsed] = useState(false);
  if (openTaskId && !used) setUsed(true);
  return used ? (
    <Suspense fallback={null}>
      <TaskDrawerHost />
    </Suspense>
  ) : null;
}

export function AppShell() {
  const dispatch = useAppDispatch();
  const { sidebarCollapsed, mobileNavOpen, commandPaletteOpen } = useAppSelector((s) => s.ui);
  const permissions = useAppSelector((s) => s.session.permissions);

  const sections = useMemo(() => filterNav(NAV_SECTIONS, permissions), [permissions]);
  const togglePalette = useCallback(
    () => dispatch(setCommandPaletteOpen(!commandPaletteOpen)),
    [dispatch, commandPaletteOpen],
  );
  useModHotkey('k', togglePalette);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <Sidebar
        sections={sections}
        collapsed={sidebarCollapsed}
        onToggle={() => dispatch(toggleSidebar())}
      />

      <Sheet open={mobileNavOpen} onOpenChange={(open) => dispatch(setMobileNavOpen(open))}>
        <SheetContent
          side="left"
          className="w-64 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main navigation menu</SheetDescription>
          <div className="flex h-full flex-col">
            <BrandMark collapsed={false} />
            <SidebarNav
              sections={sections}
              collapsed={false}
              onNavigate={() => dispatch(setMobileNavOpen(false))}
            />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] p-4 lg:p-6">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Opens for ?task=<id> on any page. */}
      <LazyTaskDrawer />
      <RealtimeProvider />
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={(open) => dispatch(setCommandPaletteOpen(open))}
        sections={sections}
      />
    </div>
  );
}
