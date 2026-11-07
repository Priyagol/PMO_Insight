import type { ReactNode } from 'react';
import { hasPermission, type Permission } from '@arihant/shared';
import { ForbiddenPage } from '@/pages/NotFoundPage';
import { useAppSelector } from '@/store';

/**
 * Hides routes the user cannot use. This is a UX guard only: the API enforces the same
 * permissions server-side on every request.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const permissions = useAppSelector((s) => s.session.permissions);
  return hasPermission(permissions, permission) ? <>{children}</> : <ForbiddenPage />;
}
