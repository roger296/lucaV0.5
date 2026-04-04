import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// middleware/authorise.ts — role-based access control
// ---------------------------------------------------------------------------

export type Permission =
  | 'transaction:post'
  | 'transaction:view'
  | 'transaction:approve'
  | 'transaction:reject'
  | 'account:create'
  | 'account:update'
  | 'account:view'
  | 'period:soft_close'
  | 'period:hard_close'
  | 'period:view'
  | 'report:view'
  | 'user:manage'
  | 'system:configure'
  | 'bank:manage'
  | 'bank:reconcile'
  | 'inbox:manage'
  | 'batch:run';

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  ADMIN: [
    'transaction:post', 'transaction:view', 'transaction:approve', 'transaction:reject',
    'account:create', 'account:update', 'account:view',
    'period:soft_close', 'period:hard_close', 'period:view',
    'report:view', 'user:manage', 'system:configure',
    'bank:manage', 'bank:reconcile', 'inbox:manage', 'batch:run',
  ],
  FINANCE_MANAGER: [
    'transaction:post', 'transaction:view', 'transaction:approve', 'transaction:reject',
    'account:create', 'account:update', 'account:view',
    'period:soft_close', 'period:hard_close', 'period:view',
    'report:view', 'bank:manage', 'bank:reconcile', 'inbox:manage', 'batch:run',
  ],
  APPROVER: [
    'transaction:view', 'transaction:approve', 'transaction:reject',
    'account:view', 'period:view', 'report:view',
  ],
  VIEWER: [
    'transaction:view', 'account:view', 'period:view', 'report:view',
  ],
};

export function getUserPermissions(roles: string[]): Set<Permission> {
  const permissions = new Set<Permission>();
  for (const role of roles) {
    const perms = ROLE_PERMISSIONS[role];
    if (perms) perms.forEach((p) => permissions.add(p));
  }
  return permissions;
}

export function requirePermission(...required: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userPerms = getUserPermissions(req.userRoles ?? []);
    const missing = required.filter((p) => !userPerms.has(p));
    if (missing.length > 0) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `You do not have permission to perform this action. Required: ${missing.join(', ')}`,
        },
      });
      return;
    }
    next();
  };
}
