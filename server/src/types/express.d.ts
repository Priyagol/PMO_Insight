import 'express-serve-static-core';
import type { AuthContext } from '../core/rbac/context';

declare module 'express-serve-static-core' {
  interface Request {
    /** Correlation id set by the requestId middleware. */
    id: string;
    /** Zod-validated input set by the validate() middleware. */
    valid?: {
      body?: unknown;
      query?: unknown;
      params?: unknown;
    };
    /** Authenticated principal set by the authenticate middleware. */
    auth?: AuthContext;
    /** Set when the request was authenticated with a personal API token. */
    apiTokenScope?: 'read' | 'write';
  }
}
