/** Central TanStack Query key factory so invalidation stays consistent across features. */
export const queryKeys = {
  users: {
    all: ['users'] as const,
    list: (params: object) => ['users', 'list', params] as const,
    detail: (id: string) => ['users', 'detail', id] as const,
  },
  skills: (q: string) => ['skills', q] as const,
  departments: ['departments'] as const,
  roles: ['roles'] as const,
  permissions: ['permissions'] as const,
  audit: {
    all: ['audit'] as const,
    list: (params: object) => ['audit', 'list', params] as const,
    logins: (params: object) => ['audit', 'logins', params] as const,
  },
  settings: ['settings'] as const,
};
