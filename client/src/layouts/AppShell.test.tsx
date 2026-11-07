import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { PermissionMap } from '@arihant/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { routes } from '@/routes/routes';
import { authenticatedStore } from '@/test/fixtures';

function renderShell(path: string, permissions: PermissionMap) {
  const store = authenticatedStore(permissions);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  // Queries never resolve in these tests (no network); retries are off so nothing lingers.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </Provider>,
  );
  return { store, router };
}

describe('AppShell', () => {
  it('renders only permitted navigation and the current breadcrumb', () => {
    renderShell('/projects', { 'project:read': 'project', 'task:read': 'own' });
    const nav = screen.getAllByRole('navigation', { name: 'Main navigation' })[0]!;
    expect(within(nav).getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).queryByRole('link', { name: 'Employees' })).not.toBeInTheDocument();
    expect(within(nav).queryByText('Administration')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Workspace');
  });

  it('renders the real Documents module instead of the scheduled placeholder', async () => {
    renderShell('/documents', { 'document:read': 'project' });
    expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.queryByText(/Scheduled for Phase/)).not.toBeInTheDocument();
  });

  it('blocks routes the user lacks permission for', () => {
    renderShell('/admin/employees', { 'project:read': 'project' });
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it('shows a not-found page for unknown routes', () => {
    renderShell('/no-such-page', { 'project:read': 'project' });
    expect(screen.getByText('Page not found', { selector: 'h3' })).toBeInTheDocument();
  });

  it('opens the command palette with Ctrl+K and navigates to the chosen page', async () => {
    const user = userEvent.setup();
    const { router } = renderShell('/projects', { 'project:read': 'project', 'task:read': 'own' });
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByPlaceholderText('Search tasks, projects, people, pages…');
    await user.type(input, 'My Tasks');
    await user.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/tasks/mine');
  });

  it('collapses the sidebar and toggles the theme', async () => {
    const user = userEvent.setup();
    const { store } = renderShell('/projects', { 'project:read': 'project' });
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(store.getState().ui.sidebarCollapsed).toBe(true);
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(store.getState().ui.theme).toBe('dark');
  });
});
