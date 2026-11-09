import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import type { PermissionMap } from '@arihant/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { makeStore, type AppStore } from '@/store';
import { authenticatedStore } from './fixtures';

/** Renders route objects inside every app provider, with an in-memory router. */
export function renderRoutes(
  routes: RouteObject[],
  {
    path = '/',
    permissions,
    store,
  }: { path?: string; permissions?: PermissionMap; store?: AppStore } = {},
) {
  const appStore =
    store ??
    (permissions
      ? authenticatedStore(permissions)
      : makeStore({ session: { status: 'anonymous', user: null, permissions: {}, signedOut: false } }));
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <Provider store={appStore}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </Provider>,
  );
  return { router, store: appStore, queryClient };
}
