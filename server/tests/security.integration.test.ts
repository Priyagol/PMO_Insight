import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentStep, totpAt } from '../src/core/auth/totp';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { setOidcConfig } from '../src/modules/security/oidc-config';
import { User } from '../src/modules/users/user.model';
import { createDepartment, createUser, loginAs, PASSWORD, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);

const enableSecurity = async (
  admin: { auth: Record<string, string> },
  body: Record<string, unknown>,
) => api().put('/api/v1/security/settings').set(admin.auth).send(body).expect(200);

describe('Personal API tokens', () => {
  it('are off by default, act as their owner, respect read-only and can be revoked', async () => {
    const admin = await loginAs(h.app, 'super_admin');
    const dev = await loginAs(h.app, 'developer');
    expect(
      (await api().post('/api/v1/security/api-tokens').set(dev.auth).send({ name: 'CI' })).status,
    ).toBe(403);

    await enableSecurity(admin, { apiTokensEnabled: true, apiTokenMaxDays: 30 });
    expect(
      (
        await api()
          .post('/api/v1/security/api-tokens')
          .set(dev.auth)
          .send({ name: 'Long', expiresInDays: 90 })
      ).status,
    ).toBe(422);
    const created = await api()
      .post('/api/v1/security/api-tokens')
      .set(dev.auth)
      .send({ name: 'Report script' });
    expect(created.status).toBe(201);
    const token = created.body.data.token as string;
    expect(token.startsWith('awt_')).toBe(true);
    expect(created.body.data).toMatchObject({ scope: 'read', prefix: token.slice(0, 10) });
    const bearer = { Authorization: `Bearer ${token}` };

    // Reads work as the owner; writes and account settings are refused.
    expect((await api().get('/api/v1/tasks').set(bearer)).status).toBe(200);
    const write = await api()
      .post('/api/v1/projects')
      .set(bearer)
      .send({ key: 'NOPE', name: 'No' });
    expect(write.status).toBe(403);
    expect(write.body.error.message).toContain('only read');
    expect((await api().get('/api/v1/auth/me').set(bearer)).status).toBe(403);
    expect(
      (await api().post('/api/v1/security/api-tokens').set(bearer).send({ name: 'x' })).status,
    ).toBe(403);

    const list = await api().get('/api/v1/security/api-tokens').set(dev.auth);
    expect(list.body.data[0]).toMatchObject({
      name: 'Report script',
      lastUsedAt: expect.any(String),
    });
    expect(JSON.stringify(list.body.data)).not.toContain(token);
    const all = await api().get('/api/v1/security/api-tokens/all').set(admin.auth);
    expect(all.body.data[0].owner.id).toBe(dev.user._id.toString());

    await api()
      .delete(`/api/v1/security/api-tokens/${created.body.data.id}`)
      .set(dev.auth)
      .expect(204);
    expect((await api().get('/api/v1/tasks').set(bearer)).status).toBe(401);
    expect(
      await AuditLog.countDocuments({
        action: { $in: ['auth.api_token_created', 'auth.api_token_revoked'] },
      }),
    ).toBe(2);

    // Switching tokens off stops every token at once.
    const second = await api()
      .post('/api/v1/security/api-tokens')
      .set(dev.auth)
      .send({ name: 'Writer', scope: 'write' });
    await enableSecurity(admin, { apiTokensEnabled: false });
    expect(
      (
        await api()
          .get('/api/v1/tasks')
          .set({ Authorization: `Bearer ${second.body.data.token}` })
      ).status,
    ).toBe(401);
  });
});

/** A code for the next 30-second step, so it is never a replay of the enrolment code. */
const codeFor = (secret: string, offset = 0) => totpAt(secret, currentStep() + offset);

describe('Two-step verification', () => {
  it('enrols, asks for a code at sign-in, refuses replays and accepts a recovery code once', async () => {
    const dev = await loginAs(h.app, 'developer');
    const setup = await api().post('/api/v1/auth/mfa/setup').set(dev.auth).send({});
    expect(setup.body.data.otpauthUrl).toContain('otpauth://totp/');
    const secret = setup.body.data.secret as string;
    expect(
      (await api().post('/api/v1/auth/mfa/enable').set(dev.auth).send({ code: '000000' })).status,
    ).toBe(422);
    const enabled = await api()
      .post('/api/v1/auth/mfa/enable')
      .set(dev.auth)
      .send({ code: codeFor(secret) });
    expect(enabled.status).toBe(200);
    const recovery = enabled.body.data.recoveryCodes as string[];
    expect(recovery).toHaveLength(10);
    const stored = await User.findById(dev.user._id).select('+mfa').lean();
    expect(stored!.mfa!.secretEnc).not.toContain(secret);

    const first = await api()
      .post('/api/v1/auth/login')
      .send({ email: dev.user.email, password: PASSWORD });
    expect(first.body.data).toMatchObject({ mfaRequired: 'verify', mfaToken: expect.any(String) });
    expect(first.body.data.accessToken).toBeUndefined();
    expect(first.headers['set-cookie']).toBeUndefined();
    const mfaToken = first.body.data.mfaToken as string;
    // The step token is not an access token.
    expect(
      (
        await api()
          .get('/api/v1/auth/me')
          .set({ Authorization: `Bearer ${mfaToken}` })
      ).status,
    ).toBe(401);

    expect(
      (await api().post('/api/v1/auth/login/mfa').send({ mfaToken, code: '123456' })).status,
    ).toBe(401);
    const code = codeFor(secret, 1);
    const ok = await api().post('/api/v1/auth/login/mfa').send({ mfaToken, code });
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toEqual(expect.any(String));
    expect((await api().post('/api/v1/auth/login/mfa').send({ mfaToken, code })).status).toBe(401);

    const viaRecovery = await api()
      .post('/api/v1/auth/login/mfa')
      .send({ mfaToken, code: recovery[0] });
    expect(viaRecovery.status).toBe(200);
    expect(
      (await api().post('/api/v1/auth/login/mfa').send({ mfaToken, code: recovery[0] })).status,
    ).toBe(401);
    const status = await api().get('/api/v1/auth/mfa').set(dev.auth);
    expect(status.body.data).toMatchObject({ enabled: true, recoveryCodesLeft: 9 });

    // Turning it off needs the password and a code.
    expect(
      (
        await api()
          .post('/api/v1/auth/mfa/disable')
          .set(dev.auth)
          .send({ password: 'wrong', code: recovery[1] })
      ).status,
    ).toBe(401);
    await api()
      .post('/api/v1/auth/mfa/disable')
      .set(dev.auth)
      .send({ password: PASSWORD, code: recovery[1] })
      .expect(204);
    expect(
      (await api().post('/api/v1/auth/login').send({ email: dev.user.email, password: PASSWORD }))
        .body.data.accessToken,
    ).toEqual(expect.any(String));
  });

  it('makes people in required roles enrol during sign-in, and lets administrators reset it', async () => {
    const admin = await loginAs(h.app, 'super_admin');
    const lead = await createUser({ role: 'team_lead' });
    await enableSecurity(admin, { mfaRequiredRoles: ['team_lead'] });

    const step = await api()
      .post('/api/v1/auth/login')
      .send({ email: lead.email, password: PASSWORD });
    expect(step.body.data.mfaRequired).toBe('enroll');
    const mfaToken = step.body.data.mfaToken as string;
    const setup = await api().post('/api/v1/auth/mfa/setup').send({ mfaToken });
    expect(setup.status).toBe(200);
    const done = await api()
      .post('/api/v1/auth/mfa/enable')
      .send({ mfaToken, code: codeFor(setup.body.data.secret as string) });
    expect(done.status).toBe(200);
    expect(done.body.data.recoveryCodes).toHaveLength(10);
    expect(done.body.data.session.accessToken).toEqual(expect.any(String));
    expect(
      ([] as string[]).concat(done.headers['set-cookie'] ?? []).some((c) => c.startsWith('aw_rt=')),
    ).toBe(true);

    // Required: it cannot be turned off by the person.
    const leadAuth = { Authorization: `Bearer ${done.body.data.session.accessToken}` };
    expect(
      (
        await api()
          .post('/api/v1/auth/mfa/disable')
          .set(leadAuth)
          .send({ password: PASSWORD, code: done.body.data.recoveryCodes[0] })
      ).status,
    ).toBe(403);

    await api()
      .post(`/api/v1/security/users/${lead._id.toString()}/mfa-reset`)
      .set(admin.auth)
      .expect(204);
    expect((await api().get('/api/v1/auth/me').set(leadAuth)).status).toBe(401); // signed out everywhere
    const again = await api()
      .post('/api/v1/auth/login')
      .send({ email: lead.email, password: PASSWORD });
    expect(again.body.data.mfaRequired).toBe('enroll');
    expect(await AuditLog.countDocuments({ action: 'auth.mfa_reset_by_admin' })).toBe(1);
  });
});

describe('Restricted tasks and confidential projects', () => {
  it('hides restricted tasks from other project members and confidential projects from wider scopes', async () => {
    const dept = await createDepartment('SEC1');
    const admin = await loginAs(h.app, 'super_admin');
    const director = await loginAs(h.app, 'director');
    const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
    const dev = await loginAs(h.app, 'developer', { departmentId: dept._id });
    const qa = await loginAs(h.app, 'qa_tester', { departmentId: dept._id });
    const p = await api()
      .post('/api/v1/projects')
      .set(pm.auth)
      .send({
        key: 'SEC',
        name: 'Security Project',
        managerId: pm.user._id.toString(),
        memberIds: [dev.user._id.toString(), qa.user._id.toString()],
      });
    const t = (
      await api()
        .post('/api/v1/tasks')
        .set(pm.auth)
        .send({ projectId: p.body.data.id, title: 'Payroll export fix' })
    ).body.data as { id: string; key: string };

    expect((await api().get(`/api/v1/tasks/${t.id}`).set(dev.auth)).status).toBe(200);
    // Developers cannot restrict tasks they did not report.
    expect(
      (
        await api()
          .put(`/api/v1/tasks/${t.id}/restriction`)
          .set(dev.auth)
          .send({ restricted: true })
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .put(`/api/v1/tasks/${t.id}/restriction`)
          .set(pm.auth)
          .send({ restricted: true, allowedUserIds: [director.user._id.toString()] })
      ).status,
    ).toBe(422); // not on the project
    await api()
      .put(`/api/v1/tasks/${t.id}/restriction`)
      .set(pm.auth)
      .send({ restricted: true, allowedUserIds: [qa.user._id.toString()] })
      .expect(200);

    expect((await api().get(`/api/v1/tasks/${t.id}`).set(dev.auth)).status).toBe(404);
    expect(
      (await api().get(`/api/v1/tasks?projectId=${p.body.data.id}`).set(dev.auth)).body.data,
    ).toEqual([]);
    expect((await api().get(`/api/v1/search?q=Payroll`).set(dev.auth)).body.data.tasks).toEqual([]);
    const feed = await api().get(`/api/v1/projects/${p.body.data.id}/activity`).set(dev.auth);
    expect(JSON.stringify(feed.body.data)).not.toContain('Payroll');
    expect((await api().get(`/api/v1/tasks/${t.id}`).set(qa.auth)).body.data).toMatchObject({
      restricted: true,
    });
    expect((await api().get(`/api/v1/tasks/${t.id}`).set(pm.auth)).status).toBe(200);
    expect((await api().get(`/api/v1/tasks/${t.id}`).set(admin.auth)).status).toBe(200);

    // Confidential project: directors (organisation scope) no longer see it; members still do.
    expect((await api().get(`/api/v1/projects/${p.body.data.id}`).set(director.auth)).status).toBe(
      200,
    );
    expect(
      (
        await api()
          .put(`/api/v1/projects/${p.body.data.id}/confidential`)
          .set(dev.auth)
          .send({ confidential: true })
      ).status,
    ).toBe(403);
    await api()
      .put(`/api/v1/projects/${p.body.data.id}/confidential`)
      .set(pm.auth)
      .send({ confidential: true })
      .expect(200);
    expect((await api().get(`/api/v1/projects/${p.body.data.id}`).set(director.auth)).status).toBe(
      404,
    );
    const dirList = await api().get('/api/v1/projects').set(director.auth);
    expect((dirList.body.data as { key: string }[]).map((x) => x.key)).not.toContain('SEC');
    expect(
      (await api().get(`/api/v1/projects/${p.body.data.id}`).set(dev.auth)).body.data.confidential,
    ).toBe(true);
    expect((await api().get(`/api/v1/projects/${p.body.data.id}`).set(admin.auth)).status).toBe(
      200,
    );
    expect(
      await AuditLog.countDocuments({
        action: { $in: ['task.restriction_changed', 'project.confidentiality_changed'] },
      }),
    ).toBe(2);
  });
});

describe('Single sign-on (OpenID Connect)', () => {
  // A minimal local identity provider standing in for Entra ID / Google, with its own key pair.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
  let issuer = '';
  let server: ReturnType<express.Express['listen']>;
  const codes = new Map<string, { email: string; nonce: string; challenge: string }>();
  let nextLogin = { email: '', nonce: '', challenge: '' };

  beforeAll(async () => {
    const idp = express();
    idp.use(express.urlencoded({ extended: false }));
    idp.get('/.well-known/openid-configuration', (_req, res) => {
      res.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      });
    });
    idp.get('/jwks', (_req, res) => res.json({ keys: [jwk] }));
    idp.post('/token', (req, res) => {
      const body = req.body as Record<string, string>;
      const entry = codes.get(body.code!);
      const challenge = createHash('sha256')
        .update(body.code_verifier ?? '')
        .digest('base64url');
      if (!entry || body.client_secret !== 'test-client-secret' || challenge !== entry.challenge) {
        res.status(400).json({ error: 'invalid_grant' });
        return;
      }
      codes.delete(body.code!);
      res.json({
        id_token: jwt.sign(
          {
            email: entry.email,
            email_verified: true,
            nonce: entry.nonce,
            sub: `sub-${entry.email}`,
          },
          privateKey,
          {
            algorithm: 'RS256',
            keyid: 'test-key',
            issuer,
            audience: 'test-client',
            expiresIn: 300,
          },
        ),
      });
    });
    await new Promise<void>((resolve) => {
      server = idp.listen(0, '127.0.0.1', () => resolve());
    });
    issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    setOidcConfig({
      issuer,
      clientId: 'test-client',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:5173/api/v1/auth/sso/callback',
    });
  });
  afterAll(() => {
    setOidcConfig(null);
    server.close();
  });

  /** Starts SSO, "signs in" at the provider as `email`, and returns the callback response. */
  async function roundTrip(email: string) {
    const start = await api().get('/api/v1/auth/sso/start');
    expect(start.status).toBe(302);
    const url = new URL(start.headers.location as string);
    expect(url.origin + url.pathname).toBe(`${issuer}/authorize`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    nextLogin = {
      email,
      nonce: url.searchParams.get('nonce')!,
      challenge: url.searchParams.get('code_challenge')!,
    };
    const code = randomUUID();
    codes.set(code, nextLogin);
    const state = url.searchParams.get('state')!;
    return { cb: await api().get(`/api/v1/auth/sso/callback?code=${code}&state=${state}`), state };
  }

  it('signs in an existing person, links their identity and can be enforced', async () => {
    const admin = await loginAs(h.app, 'super_admin');
    const settings = await api().get('/api/v1/security/settings').set(admin.auth);
    expect(settings.body.data).toMatchObject({ ssoConfigured: true, ssoEnabled: false });
    const off = await api().get('/api/v1/auth/sso/start');
    expect(off.headers.location).toContain('sso_error=');
    await enableSecurity(admin, { ssoEnabled: true });
    expect((await api().get('/api/v1/auth/config')).body.data.sso).toMatchObject({ enabled: true });

    const person = await createUser({ role: 'developer' });
    const { cb, state } = await roundTrip(person.email);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toContain('/login?sso=done');
    const cookie = ([] as string[])
      .concat(cb.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('aw_rt='))!
      .split(';')[0]!;
    const session = await api().post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(session.status).toBe(200);
    expect(session.body.data.user.email).toBe(person.email);
    expect((await User.findById(person._id).lean())!.ssoSubject).toContain('sub-');

    // The same state cannot be used twice.
    const replay = await api().get(`/api/v1/auth/sso/callback?code=x&state=${state}`);
    expect(replay.headers.location).toContain('sso_error=');

    // Unknown people are not created automatically.
    const stranger = await roundTrip('nobody@example.invalid');
    expect(decodeURIComponent(stranger.cb.headers.location as string)).toContain(
      'no active account',
    );

    // Enforced: people who use SSO can no longer sign in with a password.
    await enableSecurity(admin, { ssoEnabled: true, ssoEnforced: true });
    const pw = await api()
      .post('/api/v1/auth/login')
      .send({ email: person.email, password: PASSWORD });
    expect(pw.status).toBe(401);
    expect(pw.body.error.message).toContain('single sign-on');
    // Super administrators keep password access for emergencies.
    expect(
      (await api().post('/api/v1/auth/login').send({ email: admin.user.email, password: PASSWORD }))
        .status,
    ).toBe(200);
  });
});
