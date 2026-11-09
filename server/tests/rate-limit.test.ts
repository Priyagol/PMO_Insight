import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// A low limit for this file only (other tests run with a very high one).
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '3';
});

const { loginLimiter, loginNetworkLimiter, refreshLimiter } =
  await import('../src/middleware/rate-limit');
const { AppError } = await import('../src/core/errors');

function app() {
  const a = express();
  a.use(express.json());
  const ok: express.RequestHandler = (_req, res) => {
    res.sendStatus(200);
  };
  a.post('/login', loginNetworkLimiter, loginLimiter, ok);
  a.post('/refresh', refreshLimiter, ok);
  a.use(((err, _req, res, _next) => {
    res.status(err instanceof AppError ? err.statusCode : 500).end();
  }) as express.ErrorRequestHandler);
  return a;
}

describe('sign-in limits', () => {
  it('counts sign-in attempts per person, so one person cannot lock out colleagues on the same network', async () => {
    const a = app();
    const login = (email: string) => request(a).post('/login').send({ email, password: 'x' });
    for (let i = 0; i < 3; i++) expect((await login('rohan@example.test')).status).toBe(200);
    expect((await login('ROHAN@example.test ')).status).toBe(429);
    // A colleague on the same address is unaffected.
    expect((await login('pooja@example.test')).status).toBe(200);
  });

  it('caps sign-in attempts from one address across all accounts', async () => {
    const a = app();
    let last = 0;
    for (let i = 0; i < 46; i++)
      last = (
        await request(a)
          .post('/login')
          .send({ email: `u${i}@example.test` })
      ).status;
    expect(last).toBe(429);
  });

  it('gives session refresh far more room than sign-in', async () => {
    const a = app();
    for (let i = 0; i < 20; i++) expect((await request(a).post('/refresh')).status).toBe(200);
  });
});
