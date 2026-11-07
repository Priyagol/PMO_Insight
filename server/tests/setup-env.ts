// Test environment. Values are synthetic; no real services or secrets are used.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:1/unused-in-unit-tests';
process.env.REDIS_URL ??= 'redis://127.0.0.1:1';
process.env.JWT_ACCESS_SECRET = 'test-only-access-secret-0123456789abcdef';
process.env.ORG_TIMEZONE = 'Asia/Kolkata';
process.env.APP_ORIGIN = 'http://localhost:5173';
// Auth rate limits are exercised separately; integration tests perform many logins.
process.env.AUTH_RATE_LIMIT_MAX = '10000';
process.env.PUBLIC_APP_URL = 'http://localhost:5173';
// Synthetic webhook secret for the git integration tests.
process.env.GITHUB_WEBHOOK_SECRET = 'test-only-github-webhook-secret';
process.env.GITLAB_WEBHOOK_SECRET = 'test-only-gitlab-webhook-secret';
process.env.BITBUCKET_WEBHOOK_SECRET = 'test-only-bitbucket-webhook-secret';
