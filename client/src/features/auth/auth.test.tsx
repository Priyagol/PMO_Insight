import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/routes/routes';
import { ApiClientError } from '@/services/api/client';
import { renderRoutes } from '@/test/render';
import { authenticatedStore, testUser } from '@/test/fixtures';
import { sessionEnded, sessionStarted, signOutStarted } from '@/store/session-slice';
import { safeNext } from '@/lib/redirect';

vi.mock('@/services/api/auth', () => ({
  login: vi.fn(),
  restoreSession: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  changePassword: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));
const authApi = await import('@/services/api/auth');

beforeEach(() => vi.clearAllMocks());

describe('route guards', () => {
  it('sends anonymous visitors to sign-in and remembers where they were going', () => {
    const { router } = renderRoutes(routes, { path: '/admin/employees' });
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Fadmin%2Femployees');
  });

  it('after signing out, the sign-in page does not carry the old page over', async () => {
    const store = authenticatedStore({ 'dashboard:view': 'own' });
    const { router } = renderRoutes(routes, { path: '/my-workspace', store });
    act(() => {
      store.dispatch(sessionEnded({ signedOut: true }));
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('');
  });

  it('a request failing during sign-out does not bring the old page back', async () => {
    const store = authenticatedStore({ 'dashboard:view': 'own' });
    const { router } = renderRoutes(routes, { path: '/my-workspace', store });
    act(() => {
      store.dispatch(signOutStarted());
      // A poll on the open page hits 401 after the server revoked the session.
      store.dispatch(sessionEnded());
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('');
  });

  it('signing in again clears the sign-out mark', () => {
    const store = authenticatedStore({ 'dashboard:view': 'own' });
    store.dispatch(signOutStarted());
    store.dispatch(sessionEnded());
    store.dispatch(sessionStarted({ user: testUser(), permissions: {} }));
    expect(store.getState().session.signedOut).toBe(false);
    store.dispatch(sessionEnded());
    expect(store.getState().session.signedOut).toBe(false);
  });

  it('an expired session still remembers the page for the same person', async () => {
    const store = authenticatedStore({ 'dashboard:view': 'own' });
    const { router } = renderRoutes(routes, { path: '/my-workspace', store });
    act(() => {
      store.dispatch(sessionEnded());
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('?next=%2Fmy-workspace');
  });

  it('only accepts same-app relative redirect targets', () => {
    expect(safeNext('/projects?x=1')).toBe('/projects?x=1');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});

describe('LoginPage', () => {
  it('validates before calling the API', async () => {
    const user = userEvent.setup();
    renderRoutes(routes, { path: '/login' });
    await user.click(await screen.findByRole('button', { name: 'Sign in' }, { timeout: 15_000 }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it('signs in, stores the session and continues to the requested page', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockResolvedValue({
      accessToken: 't',
      user: testUser({ name: 'Asha Rao' }),
      permissions: { 'dashboard:view': 'own', 'user:read': 'org' },
    });
    const { router, store } = renderRoutes(routes, { path: '/login?next=%2Fadmin%2Femployees' });
    await user.type(
      await screen.findByLabelText('Work e-mail', {}, { timeout: 15_000 }),
      'asha@example.test',
    );
    await user.type(screen.getByLabelText('Password'), 'Secret12345');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/employees'));
    expect(vi.mocked(authApi.login).mock.calls[0]![0]).toEqual({
      email: 'asha@example.test',
      password: 'Secret12345',
    });
    expect(store.getState().session).toMatchObject({
      status: 'authenticated',
      user: { name: 'Asha Rao' },
    });
  });

  it('shows the server error message', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiClientError(401, 'UNAUTHENTICATED', 'Invalid email or password'),
    );
    renderRoutes(routes, { path: '/login' });
    await user.type(
      await screen.findByLabelText('Work e-mail', {}, { timeout: 15_000 }),
      'asha@example.test',
    );
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});

describe('ResetPasswordPage', () => {
  it('enforces the password policy and matching confirmation', async () => {
    const user = userEvent.setup();
    renderRoutes(routes, { path: '/reset-password?token=abcdefghijklmnopqrstuvwxyz&mode=invite' });
    expect(
      await screen.findByRole('heading', { name: 'Activate your account' }, { timeout: 15_000 }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Activate account' }));
    expect(await screen.findByText('Use at least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(authApi.resetPassword).not.toHaveBeenCalled();
  });

  it('submits the token with the new password', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.resetPassword).mockResolvedValue({
      message: 'ok',
      email: 'asha@example.test',
    });
    renderRoutes(routes, { path: '/reset-password?token=abcdefghijklmnopqrstuvwxyz' });
    await user.type(
      await screen.findByLabelText('New password', {}, { timeout: 15_000 }),
      'GoodPassw0rd',
    );
    await user.type(screen.getByLabelText('Confirm password'), 'GoodPassw0rd');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText(/Sign in with asha@example.test/)).toBeInTheDocument();
    expect(vi.mocked(authApi.resetPassword).mock.calls[0]![0]).toEqual({
      token: 'abcdefghijklmnopqrstuvwxyz',
      password: 'GoodPassw0rd',
    });
  });
});
