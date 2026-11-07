import type { ReactNode } from 'react';

/** Split-screen layout for sign-in and password pages. */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-sidebar-primary to-violet font-bold text-white">
            A
          </div>
          <div className="leading-tight">
            <p className="font-semibold text-white">Arihant Workspace</p>
            <p className="text-xs text-sidebar-muted">Arihant Capitals</p>
          </div>
        </div>
        <div className="mt-auto max-w-md space-y-4">
          <h2 className="text-3xl leading-tight font-semibold text-white">
            One Platform. Every Project. Every Task. Every Hour.
          </h2>
          <p className="text-sm text-sidebar-foreground/80">
            Plan work, distribute it intelligently, track every hour and see delivery health across
            the whole organisation.
          </p>
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -bottom-32 size-[420px] rounded-full bg-gradient-to-tr from-sidebar-primary/30 to-violet/30 blur-3xl"
        />
      </aside>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
