import type { PermissionMap, UserDto } from '@arihant/shared';
import { makeStore } from '@/store';

/** Synthetic user for component tests. */
export function testUser(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'u1',
    employeeId: 'T-1',
    name: 'Test User',
    email: 'test.user@example.test',
    department: null,
    manager: null,
    roles: [{ id: 'r1', key: 'developer', name: 'Developer' }],
    skills: [],
    weeklyCapacityHours: 40,
    status: 'active',
    hasPassword: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function authenticatedStore(permissions: PermissionMap, user: UserDto = testUser()) {
  return makeStore({ session: { status: 'authenticated', user, permissions, signedOut: false } });
}
