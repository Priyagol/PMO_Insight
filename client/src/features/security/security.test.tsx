import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/routes/routes';
import { renderRoutes } from '@/test/render';
import { testUser } from '@/test/fixtures';
import { AccountSecurityDialog } from './AccountSecurityDialog';
import { SecuritySettingsPanel } from './SecuritySettingsPanel';

vi.mock('@/services/api/auth', () => ({
  login: vi.fn(),
  loginWithCode: vi.fn(),
  enrollDuringLogin: vi.fn(),
  restoreSession: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  changePassword: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));
vi.mock('@/services/api/security', () => ({
  fetchAuthConfig: vi.fn(),
  ssoStartUrl: '/api/v1/auth/sso/start',
  fetchMfaStatus: vi.fn(),
  startMfaSetup: vi.fn(),
  enableMfa: vi.fn(),
  disableMfa: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  fetchSecuritySettings: vi.fn(),
  saveSecuritySettings: vi.fn(),
  fetchMyApiTokens: vi.fn(),
  fetchAllApiTokens: vi.fn(),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
  resetUserMfa: vi.fn(),
  setTaskRestriction: vi.fn(),
  setProjectConfidential: vi.fn(),
}));
const authApi = await import('@/services/api/auth');
const sec = await import('@/services/api/security');

const FIRST = { timeout: 20_000 };
const session = {
  accessToken: 't',
  user: testUser({ name: 'Asha Rao' }),
  permissions: { 'dashboard:view': 'own' } as const,
};
const setup = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUrl: 'otpauth://totp/Arihant%20Workspace:a@example.test?secret=JBSWY3DPEHPK3PXP',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sec.fetchAuthConfig).mockResolvedValue({
    sso: { enabled: false, providerName: null, enforced: false },
  });
});

async function signIn(path = '/login') {
  const user = userEvent.setup();
  const r = renderRoutes(routes, { path });
  await user.type(await screen.findByLabelText('Work e-mail', {}, FIRST), 'asha@example.test');
  await user.type(screen.getByLabelText('Password'), 'Secret12345');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  return { user, ...r };
}

describe('Sign-in with two-step verification', () => {
  it('asks for the authenticator code before starting the session', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      mfaRequired: 'verify',
      mfaToken: 'm'.repeat(30),
      expiresInSeconds: 300,
    });
    vi.mocked(authApi.loginWithCode).mockResolvedValue(session);
    const { user, store } = await signIn();
    expect(
      await screen.findByRole('heading', { name: 'Two-step verification' }),
    ).toBeInTheDocument();
    expect(store.getState().session.status).not.toBe('authenticated');
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(store.getState().session.status).toBe('authenticated'));
    expect(authApi.loginWithCode).toHaveBeenCalledWith('m'.repeat(30), '123456');
  });

  it('makes people set it up when their role requires it, and shows recovery codes', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      mfaRequired: 'enroll',
      mfaToken: 'e'.repeat(30),
      expiresInSeconds: 300,
    });
    vi.mocked(sec.startMfaSetup).mockResolvedValue(setup);
    vi.mocked(authApi.enrollDuringLogin).mockResolvedValue({
      recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'],
      session,
    });
    const { user, store } = await signIn();
    await user.click(await screen.findByRole('button', { name: /Set up two-step verification/ }));
    expect(await screen.findByLabelText('Setup key')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');
    await user.type(screen.getByLabelText('Code from the app'), '654321');
    await user.click(screen.getByRole('button', { name: 'Turn on and sign in' }));
    expect(await screen.findByRole('region', { name: 'Recovery codes' })).toHaveTextContent(
      'aaaa-bbbb',
    );
    expect(store.getState().session.status).not.toBe('authenticated');
    await user.click(screen.getByRole('button', { name: /I have saved them/ }));
    await waitFor(() => expect(store.getState().session.status).toBe('authenticated'));
  });

  it('offers single sign-on and shows its errors', async () => {
    vi.mocked(sec.fetchAuthConfig).mockResolvedValue({
      sso: { enabled: true, providerName: 'Microsoft', enforced: false },
    });
    renderRoutes(routes, { path: '/login?sso_error=There%20is%20no%20active%20account' });
    const link = await screen.findByRole('link', { name: /Sign in with Microsoft/ }, FIRST);
    expect(link).toHaveAttribute('href', '/api/v1/auth/sso/start');
    expect(screen.getByRole('alert')).toHaveTextContent('There is no active account');
  });
});

describe('Account security', () => {
  it('sets up two-step verification and creates an API token shown once', async () => {
    vi.mocked(sec.fetchMfaStatus).mockResolvedValue({
      enabled: false,
      enabledAt: null,
      recoveryCodesLeft: 0,
      required: false,
    });
    vi.mocked(sec.startMfaSetup).mockResolvedValue(setup);
    vi.mocked(sec.enableMfa).mockResolvedValue({ recoveryCodes: ['1111-2222'] });
    vi.mocked(sec.fetchMyApiTokens).mockResolvedValue([]);
    vi.mocked(sec.createApiToken).mockResolvedValue({
      id: 'k1',
      name: 'Reports',
      prefix: 'awt_abcdef',
      scope: 'read',
      expiresAt: '2026-12-07T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: '2026-11-07T00:00:00.000Z',
      token: 'awt_abcdef_full_secret_value',
    });
    const user = userEvent.setup();
    renderRoutes([{ path: '/', element: <AccountSecurityDialog onClose={vi.fn()} /> }], {
      permissions: { 'dashboard:view': 'own' },
    });
    await user.click(
      await screen.findByRole('button', { name: /Set up two-step verification/ }, FIRST),
    );
    await user.type(await screen.findByLabelText('Code from the app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByRole('region', { name: 'Recovery codes' })).toHaveTextContent(
      '1111-2222',
    );
    expect(sec.enableMfa).toHaveBeenCalledWith('123456');

    await user.click(screen.getByRole('tab', { name: 'API tokens' }));
    await user.type(await screen.findByLabelText('Token name'), 'Reports');
    await user.click(screen.getByRole('button', { name: /Create token/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('awt_abcdef_full_secret_value');
    expect(sec.createApiToken).toHaveBeenCalledWith({
      name: 'Reports',
      scope: 'read',
      expiresInDays: 30,
    });
  });
});

describe('Security settings', () => {
  it('saves required roles and token settings, and explains missing SSO configuration', async () => {
    const data = {
      mfaRequiredRoles: [],
      apiTokensEnabled: false,
      apiTokenMaxDays: 90,
      ssoEnabled: false,
      ssoEnforced: false,
      ssoConfigured: false,
      ssoProviderName: null,
      canEdit: true,
    };
    vi.mocked(sec.fetchSecuritySettings).mockResolvedValue(data);
    vi.mocked(sec.saveSecuritySettings).mockResolvedValue(data);
    vi.mocked(sec.fetchAllApiTokens).mockResolvedValue([]);
    const user = userEvent.setup();
    renderRoutes([{ path: '/', element: <SecuritySettingsPanel /> }], {
      permissions: { 'settings:manage': 'org' },
    });
    const panel = await screen.findByRole('region', { name: 'Security' }, FIRST);
    expect(await within(panel).findByRole('status')).toHaveTextContent('OIDC_ISSUER');
    await user.click(within(panel).getByRole('button', { name: 'Director / Management' }));
    await user.click(
      within(panel).getByRole('checkbox', { name: /Allow people to create API tokens/ }),
    );
    await user.click(within(panel).getByRole('button', { name: 'Save security settings' }));
    await waitFor(() =>
      expect(sec.saveSecuritySettings).toHaveBeenCalledWith({
        mfaRequiredRoles: ['director'],
        apiTokensEnabled: true,
        apiTokenMaxDays: 90,
        ssoEnabled: false,
        ssoEnforced: false,
      }),
    );
  });
});
