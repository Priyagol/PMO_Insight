import { Bell, Menu, Moon, Search, Sun } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { useAppDispatch, useAppSelector } from '@/store';
import { setCommandPaletteOpen, setMobileNavOpen, setTheme } from '@/store/ui-slice';
import { Breadcrumbs } from './Breadcrumbs';
import { UserMenu } from './UserMenu';

// The timer (with its log-work form) loads in its own chunk, after the shell renders.
const TimerChip = lazy(() =>
  import('@/features/tracking/Timer').then((m) => ({ default: m.TimerChip })),
);
// The notification panel (list, settings, date formatting) loads in its own chunk.
const NotificationCenter = lazy(() =>
  import('./NotificationCenter').then((m) => ({ default: m.NotificationCenter })),
);

export function TopBar() {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((s) => s.ui.theme);
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="size-8 md:hidden"
        aria-label="Open navigation"
        onClick={() => dispatch(setMobileNavOpen(true))}
      >
        <Menu className="size-4" />
      </Button>

      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => dispatch(setCommandPaletteOpen(true))}
          className="flex h-8 items-center gap-2 rounded-md border bg-card px-2.5 text-sm text-muted-foreground shadow-xs transition-colors hover:text-foreground sm:w-64"
          aria-label="Search (Ctrl+K)"
        >
          <Search className="size-4" />
          <span className="hidden sm:inline">Search or jump to…</span>
          <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">
            Ctrl K
          </kbd>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => dispatch(setTheme(isDark ? 'light' : 'dark'))}
        >
          {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <Suspense fallback={null}>
          <TimerChip />
        </Suspense>
        <Suspense
          fallback={
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Notifications"
              disabled
            >
              <Bell className="size-4" />
            </Button>
          }
        >
          <NotificationCenter />
        </Suspense>
        <div className="ml-1">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
