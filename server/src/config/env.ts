import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  /** Number of reverse proxies in front of the API (Nginx = 1; Vercel rewrite + Render = 2). Used for client IPs and rate limits. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  ORG_TIMEZONE: z.string().default('Asia/Kolkata'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  MONGO_URI: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  /** Secure cookies require HTTPS; defaults to true outside development/test. */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  /** Public URL of the web app, used in e-mailed links. Defaults to the first APP_ORIGIN. */
  PUBLIC_APP_URL: z.string().url().optional(),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  INVITE_TTL_HOURS: z.coerce.number().int().positive().default(72),

  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('arihant-workspace'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanString,

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: booleanString,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Arihant Workspace <no-reply@arihant.local>'),

  AI_PROVIDER: z.enum(['anthropic', 'none']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Claude model used by the AI assistant (Phase 7). */
  AI_MODEL: z.string().default('claude-opus-5-5'),

  /** Shared secret of the GitHub webhook (Settings → Webhooks in GitHub). Unset = git integration off. */
  GITHUB_WEBHOOK_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(16, 'GITHUB_WEBHOOK_SECRET must be at least 16 characters').optional(),
  ),

  /** Secret token of the GitLab webhook (sent in X-Gitlab-Token). Unset = GitLab off. */
  GITLAB_WEBHOOK_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(16, 'GITLAB_WEBHOOK_SECRET must be at least 16 characters').optional(),
  ),
  /** Secret of the Bitbucket webhook (HMAC signature). Unset = Bitbucket off. */
  BITBUCKET_WEBHOOK_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(16, 'BITBUCKET_WEBHOOK_SECRET must be at least 16 characters').optional(),
  ),

  /** 32 random bytes, base64. Encrypts stored secrets (two-step verification). Derived from JWT_ACCESS_SECRET when unset. */
  DATA_ENCRYPTION_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .refine(
        (s) => Buffer.from(s, 'base64').length === 32,
        'DATA_ENCRYPTION_KEY must be 32 bytes in base64',
      )
      .optional(),
  ),

  /** Single sign-on with any OpenID Connect provider (Microsoft Entra ID, Google Workspace, Okta…). */
  OIDC_ISSUER: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  OIDC_CLIENT_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  OIDC_CLIENT_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  OIDC_PROVIDER_NAME: z.string().default('Single sign-on'),
  /** Defaults to <public app URL>/api/v1/auth/sso/callback. */
  OIDC_REDIRECT_URI: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    // Fail fast at boot: misconfiguration must never reach request handling.
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET.startsWith('change-me')) {
    throw new Error('JWT_ACCESS_SECRET still has the development placeholder value');
  }
  return env;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDevelopment = env.NODE_ENV === 'development';
export const cookieSecure =
  env.COOKIE_SECURE !== undefined ? env.COOKIE_SECURE === 'true' : !(isDevelopment || isTest);
export const publicAppUrl = (
  env.PUBLIC_APP_URL ??
  env.APP_ORIGIN[0] ??
  'http://localhost:5173'
).replace(/\/$/, '');
