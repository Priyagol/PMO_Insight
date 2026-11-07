import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { RefreshToken } from '../src/modules/auth/auth.models';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { User } from '../src/modules/users/user.model';
import { createUser, login, PASSWORD, tokenFromEmail, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);

describe('POST /auth/login', () => {
  it('returns an access token, the session and an HttpOnly refresh cookie', async () => {
    const user = await createUser({ role: 'developer', email: 'dev@example.test' });
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'DEV@example.test', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({
      id: user._id.toString(),
      email: 'dev@example.test',
      hasPassword: true,
    });
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.permissions['task:read']).toBe('project');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/aw_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(await AuditLog.countDocuments({ action: 'auth.login' })).toBe(1);
  });

  it('gives the same generic error for wrong password and unknown e-mail', async () => {
    await createUser({ role: 'developer', email: 'dev@example.test' });
    const wrong = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'dev@example.test', password: 'WrongPass123' });
    const unknown = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.test', password: 'WrongPass123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe('Invalid email or password');
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('locks the account after 5 failed attempts, even for the correct password', async () => {
    await createUser({ role: 'developer', email: 'dev@example.test' });
    for (let i = 0; i < 5; i += 1) {
      await api()
        .post('/api/v1/auth/login')
        .send({ email: 'dev@example.test', password: 'WrongPass123' });
    }
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'dev@example.test', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/Too many failed sign-in attempts/);
    expect(await AuditLog.countDocuments({ action: 'auth.account_locked' })).toBe(1);
  });

  it('rejects inactive users and users who have not activated their account', async () => {
    await createUser({ role: 'developer', email: 'off@example.test', status: 'inactive' });
    await createUser({ role: 'developer', email: 'new@example.test', password: null });
    for (const email of ['off@example.test', 'new@example.test']) {
      const res = await api().post('/api/v1/auth/login').send({ email, password: PASSWORD });
      expect(res.status).toBe(401);
    }
  });

  it('validates the payload and rejects operator injection', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: { $gt: '' }, password: { $gt: '' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('sessions', () => {
  it('GET /auth/me requires a valid bearer token', async () => {
    expect((await api().get('/api/v1/auth/me')).status).toBe(401);
    expect(
      (await api().get('/api/v1/auth/me').set('Authorization', 'Bearer nonsense')).status,
    ).toBe(401);
    const user = await createUser({ role: 'employee' });
    const { token } = await login(h.app, user.email);
    const res = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(user.email);
  });

  it('rotates the refresh token on every refresh', async () => {
    const user = await createUser({ role: 'employee' });
    const { cookie } = await login(h.app, user.email);
    const res = await api().post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const next = String(res.headers['set-cookie']).split(';')[0];
    expect(next).not.toBe(cookie);
    expect(await RefreshToken.countDocuments({ revokedReason: 'rotated' })).toBe(1);
  });

  it('detects reuse of a rotated refresh token and revokes the whole family', async () => {
    const user = await createUser({ role: 'employee' });
    const { cookie } = await login(h.app, user.email);
    const first = await api().post('/api/v1/auth/refresh').set('Cookie', cookie);
    const newCookie = String(first.headers['set-cookie']).split(';')[0]!;
    // Move the rotation outside the benign-race grace window.
    await RefreshToken.updateMany(
      { revokedReason: 'rotated' },
      { $set: { revokedAt: new Date(Date.now() - 60_000) } },
    );

    const replay = await api().post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(replay.status).toBe(401);
    // The legitimate newest token is now dead too.
    const legit = await api().post('/api/v1/auth/refresh').set('Cookie', newCookie);
    expect(legit.status).toBe(401);
    expect(await AuditLog.countDocuments({ action: 'auth.refresh_reuse_detected' })).toBe(1);
  });

  it('logout revokes the refresh token and clears the cookie', async () => {
    const user = await createUser({ role: 'employee' });
    const { cookie } = await login(h.app, user.email);
    const out = await api().post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/aw_rt=;/);
    expect((await api().post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });

  it('logout-all invalidates outstanding access tokens immediately', async () => {
    const user = await createUser({ role: 'employee' });
    const a = await login(h.app, user.email);
    const b = await login(h.app, user.email);
    expect(
      (await api().post('/api/v1/auth/logout-all').set('Authorization', `Bearer ${a.token}`))
        .status,
    ).toBe(204);
    expect(
      (await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${b.token}`)).status,
    ).toBe(401);
    expect((await api().post('/api/v1/auth/refresh').set('Cookie', b.cookie)).status).toBe(401);
  });

  it('deactivating a user cuts off their existing session', async () => {
    const user = await createUser({ role: 'employee' });
    const { token } = await login(h.app, user.email);
    await User.updateOne({ _id: user._id }, { $set: { status: 'inactive' } });
    expect(
      (await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)).status,
    ).toBe(401);
  });
});

describe('passwords', () => {
  it('changes the password, signs out other sessions and keeps this one', async () => {
    const user = await createUser({ role: 'employee' });
    const other = await login(h.app, user.email);
    const mine = await login(h.app, user.email);
    const res = await api()
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${mine.token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'An0therGoodOne' });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(
      (await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${other.token}`)).status,
    ).toBe(401);
    expect(
      (
        await api()
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${res.body.data.accessToken}`)
      ).status,
    ).toBe(200);
    await login(h.app, user.email, 'An0therGoodOne');
    expect(h.emails.at(-1)?.subject).toBe('Your password was changed');
  });

  it('rejects a wrong current password and weak new passwords', async () => {
    const user = await createUser({ role: 'employee' });
    const { token } = await login(h.app, user.email);
    const wrong = await api()
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'nope-nope-1', newPassword: 'An0therGoodOne' });
    expect(wrong.status).toBe(400);
    const weak = await api()
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(400);
  });

  it('forgot → reset works once, and does not reveal unknown e-mails', async () => {
    const user = await createUser({ role: 'employee', email: 'reset@example.test' });
    const unknown = await api()
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@example.test' });
    expect(unknown.status).toBe(200);
    expect(h.emails).toHaveLength(0);

    const known = await api()
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'reset@example.test' });
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(h.emails[0]?.to).toBe('reset@example.test');
    const token = tokenFromEmail(h.emails);

    const reset = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'BrandNewPass9' });
    expect(reset.status).toBe(200);
    await login(h.app, user.email, 'BrandNewPass9');
    const again = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'OtherNewPass9' });
    expect(again.status).toBe(422);
  });

  it('a newer reset link invalidates older ones', async () => {
    await createUser({ role: 'employee', email: 'twice@example.test' });
    await api().post('/api/v1/auth/forgot-password').send({ email: 'twice@example.test' });
    const oldToken = tokenFromEmail(h.emails);
    await api().post('/api/v1/auth/forgot-password').send({ email: 'twice@example.test' });
    const res = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token: oldToken, password: 'BrandNewPass9' });
    expect(res.status).toBe(422);
  });
});
