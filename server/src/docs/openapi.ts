import { API_PREFIX, APP_VERSION } from '../config/app';

/**
 * OpenAPI 3.1 document. Each module registers its paths here as it is implemented,
 * so the documentation never lists endpoints that do not exist.
 */
const healthReport = {
  type: 'object',
  required: ['status', 'uptimeSeconds', 'version'],
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    uptimeSeconds: { type: 'integer' },
    version: { type: 'string' },
    checks: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          latencyMs: { type: 'integer' },
          error: { type: 'string' },
        },
      },
    },
  },
};

const envelope = (data: object) => ({
  type: 'object',
  required: ['success', 'data'],
  properties: { success: { type: 'boolean', const: true }, data },
});

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Arihant Workspace API',
    version: APP_VERSION,
    description:
      'Enterprise project, work and business-intelligence platform for Arihant Capitals. ' +
      'All responses use the `{ success, data, meta?, error? }` envelope.',
  },
  servers: [{ url: API_PREFIX }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      HealthReport: healthReport,
      ApiError: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { type: 'boolean', const: false },
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {},
              requestId: { type: 'string' },
            },
          },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Liveness probe',
        responses: {
          '200': {
            description: 'Process is running',
            content: {
              'application/json': {
                schema: envelope({ $ref: '#/components/schemas/HealthReport' }),
              },
            },
          },
        },
      },
    },
    '/ready': {
      get: {
        tags: ['System'],
        summary: 'Readiness probe (MongoDB, Redis, object storage)',
        responses: {
          '200': {
            description: 'All dependencies healthy',
            content: {
              'application/json': {
                schema: envelope({ $ref: '#/components/schemas/HealthReport' }),
              },
            },
          },
          '503': {
            description: 'One or more dependencies unavailable',
            content: {
              'application/json': {
                schema: envelope({ $ref: '#/components/schemas/HealthReport' }),
              },
            },
          },
        },
      },
    },
    ...documentedEndpoints(),
  },
};

/**
 * Phase 2 endpoints. Request/response shapes are defined by the Zod schemas and DTO types
 * in `packages/shared` (see docs/api-documentation.md); each route is listed here with its
 * purpose and required permission so the interactive docs reflect what exists.
 */
function documentedEndpoints(): Record<string, Record<string, unknown>> {
  type Op = [method: string, path: string, tag: string, summary: string, permission?: string];
  const ops: Op[] = [
    ['post', '/auth/login', 'Auth', 'Sign in; sets the HttpOnly refresh cookie'],
    ['post', '/auth/refresh', 'Auth', 'Rotate the refresh cookie and get a new access token'],
    ['post', '/auth/logout', 'Auth', 'Revoke the current session'],
    [
      'post',
      '/auth/logout-all',
      'Auth',
      'Revoke every session of the current user',
      'authenticated',
    ],
    ['get', '/auth/me', 'Auth', 'Current user and effective permissions', 'authenticated'],
    [
      'post',
      '/auth/change-password',
      'Auth',
      'Change password (signs out other sessions)',
      'authenticated',
    ],
    ['post', '/auth/forgot-password', 'Auth', 'E-mail a reset link (always 200)'],
    ['post', '/auth/reset-password', 'Auth', 'Complete an invite or password reset'],
    ['get', '/users', 'Employees', 'List employees within the caller scope', 'user:read'],
    ['post', '/users', 'Employees', 'Create an employee and e-mail an invite', 'user:manage (org)'],
    ['get', '/users/{id}', 'Employees', 'Employee details', 'user:read'],
    ['patch', '/users/{id}', 'Employees', 'Update employee profile', 'user:manage (org)'],
    [
      'patch',
      '/users/{id}/status',
      'Employees',
      'Activate / deactivate / terminate',
      'user:manage (org)',
    ],
    ['put', '/users/{id}/roles', 'Employees', 'Replace assigned roles', 'user:manage (org)'],
    [
      'post',
      '/users/{id}/resend-invite',
      'Employees',
      'Re-send the activation e-mail',
      'user:manage (org)',
    ],
    [
      'post',
      '/users/{id}/send-password-reset',
      'Employees',
      'E-mail a password reset link',
      'user:manage (org)',
    ],
    [
      'get',
      '/departments',
      'Departments',
      'List active departments with head counts',
      'authenticated',
    ],
    ['post', '/departments', 'Departments', 'Create a department', 'department:manage (org)'],
    ['get', '/departments/{id}', 'Departments', 'Department details', 'authenticated'],
    ['patch', '/departments/{id}', 'Departments', 'Update a department', 'department:manage (org)'],
    [
      'delete',
      '/departments/{id}',
      'Departments',
      'Archive an empty department',
      'department:manage (org)',
    ],
    [
      'get',
      '/roles',
      'Roles',
      'List roles with grants and user counts',
      'role:manage or user:manage',
    ],
    ['post', '/roles', 'Roles', 'Create a custom role', 'role:manage (org)'],
    ['get', '/roles/{id}', 'Roles', 'Role details', 'role:manage or user:manage'],
    ['patch', '/roles/{id}', 'Roles', 'Update a role (Super Admin is locked)', 'role:manage (org)'],
    ['delete', '/roles/{id}', 'Roles', 'Delete an unassigned custom role', 'role:manage (org)'],
    [
      'get',
      '/permissions',
      'Roles',
      'Permission catalogue for the role editor',
      'role:manage (org)',
    ],
    ['get', '/skills', 'Employees', 'Skill catalogue (autocomplete)', 'authenticated'],
    ['get', '/audit-logs', 'Audit', 'Search audit events', 'audit:read (org)'],
    ['get', '/audit-logs/logins', 'Audit', 'Sign-in history', 'audit:read (org)'],
    ['get', '/settings', 'Settings', 'Organisation settings', 'authenticated'],
    ['put', '/settings', 'Settings', 'Update organisation settings', 'settings:manage (org)'],
  ];
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [method, path, tag, summary, permission] of ops) {
    const entry = (paths[path] ??= {});
    entry[method] = {
      tags: [tag],
      summary,
      description: permission ? `Requires: ${permission}` : 'Public',
      ...(permission ? { security: [{ bearerAuth: [] }] } : {}),
      ...(path.includes('{id}')
        ? { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] }
        : {}),
      responses: {
        '200': { description: 'Success envelope' },
        '400': {
          description: 'Validation error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        ...(permission
          ? {
              '401': { description: 'Not signed in' },
              '403': { description: 'Missing permission' },
            }
          : {}),
      },
    };
  }
  return paths;
}
