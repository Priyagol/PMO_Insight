import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createUser, login, PASSWORD, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);

const cookieOf = (res: request.Response, prefix: string) =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(prefix));

describe('one sign-in per browser tab', () => {
  it('keeps each tab signed in as its own person, and a new tab starts signed out', async () => {
    const rohan = await createUser({ role: 'developer' });
    const sneha = await createUser({ role: 'team_lead' });
    const signIn = (email: string, tab: string) =>
      api()
        .post('/api/v1/auth/login')
        .set('X-Session-Tab', tab)
        .send({ email, password: PASSWORD });

    const a = await signIn(rohan.email, 'tab-aaaaaaaa');
    const b = await signIn(sneha.email, 'tab-bbbbbbbb');
    expect(a.status).toBe(200);
    const cookieA = cookieOf(a, 'aw_rt_tab-aaaaaaaa=')!;
    const cookieB = cookieOf(b, 'aw_rt_tab-bbbbbbbb=')!;
    // Browser-session cookies: no expiry date, so closing the browser ends them.
    expect(cookieA).not.toMatch(/Expires=/i);
    expect(cookieA).toMatch(/HttpOnly/);

    // The browser sends both cookies to every tab; each tab picks its own.
    const jar = [cookieA, cookieB].map((c) => c.split(';')[0]).join('; ');
    const refreshAs = (tab: string) =>
      api().post('/api/v1/auth/refresh').set('X-Session-Tab', tab).set('Cookie', jar);
    expect((await refreshAs('tab-aaaaaaaa')).body.data.user.email).toBe(rohan.email);
    expect((await refreshAs('tab-bbbbbbbb')).body.data.user.email).toBe(sneha.email);

    // A brand-new tab has no session of its own: it must sign in.
    expect((await refreshAs('tab-cccccccc')).status).toBe(401);
  });

  it('lets one tab take over a shared sign-in once (single sign-on or an older session)', async () => {
    const user = await createUser({ role: 'employee' });
    const shared = await login(h.app, user.email); // no tab header: shared cookie
    const first = await api()
      .post('/api/v1/auth/refresh')
      .set('X-Session-Tab', 'tab-first123')
      .set('Cookie', shared.cookie);
    expect(first.status).toBe(200);
    expect(cookieOf(first, 'aw_rt_tab-first123=')).toBeTruthy();
    // The shared cookie is removed, so the next new tab must sign in.
    expect(cookieOf(first, 'aw_rt=;')).toBeTruthy();
  });

  it('signs out only the tab that signed out', async () => {
    const one = await createUser({ role: 'developer' });
    const res = await api()
      .post('/api/v1/auth/login')
      .set('X-Session-Tab', 'tab-out12345')
      .send({ email: one.email, password: PASSWORD });
    const cookie = cookieOf(res, 'aw_rt_tab-out12345=')!.split(';')[0]!;
    const out = await api()
      .post('/api/v1/auth/logout')
      .set('X-Session-Tab', 'tab-out12345')
      .set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect(cookieOf(out, 'aw_rt_tab-out12345=;')).toBeTruthy();
    const again = await api()
      .post('/api/v1/auth/refresh')
      .set('X-Session-Tab', 'tab-out12345')
      .set('Cookie', cookie);
    expect(again.status).toBe(401);
  });

  it('ignores a malformed tab id and falls back to the shared cookie', async () => {
    const user = await createUser({ role: 'employee' });
    const res = await api()
      .post('/api/v1/auth/login')
      .set('X-Session-Tab', 'bad id;')
      .send({ email: user.email, password: PASSWORD });
    expect(cookieOf(res, 'aw_rt=')).toBeTruthy();
  });
});
