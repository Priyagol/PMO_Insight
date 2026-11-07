import { hasPermission, type Permission, type Scope } from '@arihant/shared';
import { useAppSelector } from '@/store';

/** UI-level permission check (controls visibility only; the API enforces access). */
export function useCan(permission: Permission, minScope: Scope = 'own'): boolean {
  const permissions = useAppSelector((s) => s.session.permissions);
  return hasPermission(permissions, permission, minScope);
}
