import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { errorHandler } from '../src/middleware/error-handler';
import { requestId } from '../src/middleware/request-context';
import { sanitizeBody } from '../src/middleware/sanitize';
import { validate } from '../src/middleware/validate';

const healthyApp = () =>
  createApp({ readinessChecks: { mongo: async () => {}, redis: async () => {} } });

describe('system endpoints', () => {
  it('GET /api/v1/health returns the liveness envelope', async () => {
    const res = await request(healthyApp()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ status: 'ok', version: expect.any(String) });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /api/v1/ready is 200 when all dependencies respond', async () => {
    const res = await request(healthyApp()).get('/api/v1/ready');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.checks.mongo.ok).toBe(true);
    expect(res.body.data.checks.redis.ok).toBe(true);
  });

  it('GET /api/v1/ready is 503 and names the failing dependency', async () => {
    const app = createApp({
      readinessChecks: {
        mongo: async () => {},
        redis: async () => {
          throw new Error('connection refused');
        },
      },
    });
    const res = await request(app).get('/api/v1/ready');
    expect(res.status).toBe(503);
    expect(res.body.data.status).toBe('degraded');
    expect(res.body.data.checks.redis).toEqual({ ok: false, error: 'connection refused' });
  });

  it('honours a well-formed inbound X-Request-Id and rejects malformed ones', async () => {
    const good = await request(healthyApp())
      .get('/api/v1/health')
      .set('X-Request-Id', 'nginx-abc-12345');
    expect(good.headers['x-request-id']).toBe('nginx-abc-12345');
    const bad = await request(healthyApp()).get('/api/v1/health').set('X-Request-Id', '<script>');
    expect(bad.headers['x-request-id']).not.toBe('<script>');
  });

  it('unknown routes return the 404 error envelope', async () => {
    const res = await request(healthyApp()).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('malformed JSON returns 400 BAD_REQUEST, not 500', async () => {
    const res = await request(healthyApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(healthyApp()).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves the OpenAPI document outside production', async () => {
    const res = await request(healthyApp()).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.paths['/health']).toBeDefined();
  });
});

describe('validate() + sanitizeBody', () => {
  const buildApp = () => {
    const app = express();
    app.use(requestId);
    app.use(express.json());
    app.use(sanitizeBody);
    app.post(
      '/items/:id',
      validate({
        params: z.object({ id: z.string().regex(/^\d+$/) }),
        query: z.object({ dryRun: z.enum(['true', 'false']).optional() }).strict(),
        body: z.object({ name: z.string().min(2), email: z.string().email().optional() }).strict(),
      }),
      (req, res) => {
        res.json({ success: true, data: req.valid });
      },
    );
    app.use(errorHandler);
    return app;
  };

  it('passes parsed input through req.valid', async () => {
    const res = await request(buildApp()).post('/items/7?dryRun=true').send({ name: 'Alpha' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      params: { id: '7' },
      query: { dryRun: 'true' },
      body: { name: 'Alpha' },
    });
  });

  it('collects issues from every location into one 400 response', async () => {
    const res = await request(buildApp()).post('/items/abc?extra=1').send({ name: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const locations = (res.body.error.details as { location: string }[])
      .map((d) => d.location)
      .sort();
    expect(locations).toEqual(['body', 'params', 'query']);
  });

  it('strips Mongo operators so injection payloads fail validation', async () => {
    const res = await request(buildApp())
      .post('/items/1')
      .send({ name: 'Alpha', email: { $gt: '' } });
    // `$gt` is removed, leaving `email: {}` which is rejected as a non-string.
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('$gt');
  });
});
