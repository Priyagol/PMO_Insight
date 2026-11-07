import {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiGet, createApiClient, tokenStore } from './client';

type Handler = (config: InternalAxiosRequestConfig) => { status: number; data: unknown };

/** Fake transport: routes requests to a handler and rejects non-2xx like axios does. */
function fakeAdapter(handler: Handler): AxiosAdapter & { calls: InternalAxiosRequestConfig[] } {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter = (async (config: InternalAxiosRequestConfig) => {
    calls.push(config);
    const { status, data } = handler(config);
    const response = { status, data, statusText: String(status), headers: {}, config };
    if (status >= 200 && status < 300) return response;
    throw new AxiosError(`HTTP ${status}`, 'ERR_BAD_RESPONSE', config, null, response);
  }) as AxiosAdapter & { calls: InternalAxiosRequestConfig[] };
  adapter.calls = calls;
  return adapter;
}

const authHeader = (c: InternalAxiosRequestConfig) =>
  AxiosHeaders.from(c.headers).get('Authorization');

afterEach(() => tokenStore.set(null));

describe('api client', () => {
  it('unwraps the success envelope and sends the bearer token', async () => {
    tokenStore.set('token-1');
    const adapter = fakeAdapter(() => ({
      status: 200,
      data: { success: true, data: { hello: 'world' } },
    }));
    const client = createApiClient({ adapter });
    await expect(apiGet('/thing', undefined, client)).resolves.toEqual({ hello: 'world' });
    expect(authHeader(adapter.calls[0]!)).toBe('Bearer token-1');
  });

  it('normalises API errors into ApiClientError', async () => {
    const adapter = fakeAdapter(() => ({
      status: 403,
      data: {
        success: false,
        error: { code: 'FORBIDDEN', message: 'No access', requestId: 'req-9' },
      },
    }));
    const client = createApiClient({ adapter });
    const error = await apiGet('/secret', undefined, client).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: 'No access',
      requestId: 'req-9',
    });
  });

  it('refreshes once on 401 and replays concurrent requests with the new token', async () => {
    tokenStore.set('expired');
    let refreshCalls = 0;
    const adapter = fakeAdapter((config) => {
      if (config.url === '/auth/refresh') {
        refreshCalls += 1;
        return { status: 200, data: { success: true, data: { accessToken: 'fresh' } } };
      }
      return authHeader(config) === 'Bearer fresh'
        ? { status: 200, data: { success: true, data: config.url } }
        : {
            status: 401,
            data: { success: false, error: { code: 'UNAUTHENTICATED', message: 'expired' } },
          };
    });
    const client = createApiClient({ adapter });

    const results = await Promise.all([
      apiGet('/a', undefined, client),
      apiGet('/b', undefined, client),
    ]);
    expect(results).toEqual(['/a', '/b']);
    expect(refreshCalls).toBe(1);
    expect(tokenStore.get()).toBe('fresh');
  });

  it('clears the session when refresh fails', async () => {
    tokenStore.set('expired');
    const onSessionExpired = vi.fn();
    const adapter = fakeAdapter(() => ({
      status: 401,
      data: { success: false, error: { code: 'UNAUTHENTICATED', message: 'Session expired' } },
    }));
    const client = createApiClient({ adapter, onSessionExpired });
    await expect(apiGet('/a', undefined, client)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(onSessionExpired).toHaveBeenCalledOnce();
    expect(tokenStore.get()).toBeNull();
  });

  it('reports network failures distinctly', async () => {
    const adapter = (async (config: InternalAxiosRequestConfig) => {
      throw new AxiosError('Network Error', 'ERR_NETWORK', config);
    }) as AxiosAdapter;
    const client = createApiClient({ adapter });
    await expect(apiGet('/a', undefined, client)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });
});
