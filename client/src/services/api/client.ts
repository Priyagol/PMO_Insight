import axios, {
  AxiosError,
  type AxiosAdapter,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { ApiFailure, ApiSuccess, ErrorCode, PageMeta } from '@arihant/shared';

/** Normalised error thrown by every API call, so UI code handles one shape. */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/**
 * Access token lives in memory only (never localStorage) to limit XSS exposure.
 * The refresh token is an HttpOnly cookie the browser sends to /auth/refresh.
 */
let accessToken: string | null = null;
export const tokenStore = {
  get: () => accessToken,
  set: (token: string | null) => {
    accessToken = token;
  },
};

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

export interface ApiClientOptions {
  baseURL?: string;
  /** Called when the session cannot be refreshed (e.g. redirect to login). */
  onSessionExpired?: () => void;
  /** Test hook: custom transport. */
  adapter?: AxiosAdapter;
}

const NO_REFRESH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/change-password'];

/** App-wide handler for an unrecoverable session (set once by the session provider). */
let sessionExpiredHandler: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

function toClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  if (error instanceof AxiosError) {
    const body = error.response?.data as Partial<ApiFailure> | undefined;
    if (error.response && body?.error) {
      return new ApiClientError(
        error.response.status,
        body.error.code,
        body.error.message,
        body.error.details,
        body.error.requestId,
      );
    }
    if (error.response) {
      return new ApiClientError(
        error.response.status,
        'INTERNAL_ERROR',
        `Request failed (${error.response.status})`,
      );
    }
    return new ApiClientError(
      0,
      'NETWORK_ERROR',
      'Cannot reach the server. Check your connection and try again.',
    );
  }
  return new ApiClientError(
    0,
    'INTERNAL_ERROR',
    error instanceof Error ? error.message : 'Unexpected error',
  );
}

export function createApiClient(options: ApiClientOptions = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: options.baseURL ?? '/api/v1',
    withCredentials: true,
    timeout: 30_000,
    adapter: options.adapter,
  });

  instance.interceptors.request.use((config) => {
    const token = tokenStore.get();
    if (token) config.headers.set('Authorization', `Bearer ${token}`);
    return config;
  });

  // One refresh in flight at a time; concurrent 401s wait for the same promise.
  let refreshing: Promise<string> | null = null;
  const refresh = () => {
    refreshing ??= instance
      .post<ApiSuccess<{ accessToken: string }>>('/auth/refresh')
      .then((res) => {
        tokenStore.set(res.data.data.accessToken);
        return res.data.data.accessToken;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };

  instance.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      if (error instanceof AxiosError && error.response?.status === 401 && error.config) {
        const config = error.config as RetriableConfig;
        const path = config.url ?? '';
        if (!config._retried && !NO_REFRESH_PATHS.some((p) => path.endsWith(p))) {
          config._retried = true;
          try {
            const token = await refresh();
            config.headers.set('Authorization', `Bearer ${token}`);
            return await instance.request(config);
          } catch (refreshError) {
            tokenStore.set(null);
            (options.onSessionExpired ?? sessionExpiredHandler)?.();
            throw toClientError(refreshError);
          }
        }
      }
      throw toClientError(error);
    },
  );

  return instance;
}

export const api = createApiClient();

/** Typed helpers that unwrap the `{ success, data }` envelope. */
export async function apiGet<T>(
  url: string,
  config?: AxiosRequestConfig,
  client = api,
): Promise<T> {
  const res = await client.get<ApiSuccess<T>>(url, config);
  return res.data.data;
}

export async function apiGetPage<T>(
  url: string,
  config?: AxiosRequestConfig,
  client = api,
): Promise<{ items: T[]; meta: PageMeta }> {
  const res = await client.get<ApiSuccess<T[]>>(url, config);
  return {
    items: res.data.data,
    meta: res.data.meta ?? {
      page: 1,
      limit: res.data.data.length,
      total: res.data.data.length,
      totalPages: 1,
    },
  };
}

export async function apiPost<T, B = unknown>(url: string, body?: B, client = api): Promise<T> {
  const res = await client.post<ApiSuccess<T>>(url, body);
  return res.data.data;
}

export async function apiPatch<T, B = unknown>(url: string, body?: B, client = api): Promise<T> {
  const res = await client.patch<ApiSuccess<T>>(url, body);
  return res.data.data;
}

export async function apiDelete(url: string, client = api): Promise<void> {
  await client.delete(url);
}
