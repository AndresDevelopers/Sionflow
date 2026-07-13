import {
  canManageSettings,
  hasLeadershipPrivileges,
  canViewSettings,
  normalizeRole,
  normalizePermission,
  canWrite,
  getDefaultPermission,
  resolvePermissionForRoleChange,
  ROLE_LIMITS,
  countRoles,
  getRoleRemaining,
  isRoleAtCapacity,
  canAssignRole,
  canBulkAssignRole,
  projectedRoleCountAfterBulk,
} from '@/lib/roles';
import type { UserRole } from '@/lib/roles';

describe('normalizeRole', () => {
  it('normalizes roles correctly', () => {
    expect(normalizeRole('secretary')).toBe('secretary');
    expect(normalizeRole('admin')).toBe('secretary');
    expect(normalizeRole('president')).toBe('president');
    expect(normalizeRole('presidente')).toBe('president');
    expect(normalizeRole('counselor')).toBe('counselor');
    expect(normalizeRole('consejero')).toBe('counselor');
    expect(normalizeRole('consejera')).toBe('counselor');
    expect(normalizeRole('other')).toBe('other');
    expect(normalizeRole('otro')).toBe('other');
  });

  it('defaults to user for unknown roles', () => {
    expect(normalizeRole('unknown')).toBe('user');
    expect(normalizeRole('')).toBe('user');
    expect(normalizeRole(undefined)).toBe('user');
    expect(normalizeRole(null)).toBe('user');
  });
});

describe('normalizePermission', () => {
  it('maps write aliases to all', () => {
    expect(normalizePermission('all')).toBe('all');
    expect(normalizePermission('ALL')).toBe('all');
    expect(normalizePermission('todo')).toBe('all');
    expect(normalizePermission('todos')).toBe('all');
    expect(normalizePermission(' Todo ')).toBe('all');
  });

  it('maps read aliases to read', () => {
    expect(normalizePermission('read')).toBe('read');
    expect(normalizePermission('lectura')).toBe('read');
    expect(normalizePermission('LECTURA')).toBe('read');
  });

  it('defaults to read for missing or unknown values', () => {
    expect(normalizePermission(undefined)).toBe('read');
    expect(normalizePermission(null)).toBe('read');
    expect(normalizePermission('')).toBe('read');
    expect(normalizePermission('write')).toBe('read');
    expect(normalizePermission(123)).toBe('read');
  });
});

describe('canWrite', () => {
  it('allows only all permission', () => {
    expect(canWrite('all')).toBe(true);
    expect(canWrite('read')).toBe(false);
    expect(canWrite(null)).toBe(false);
    expect(canWrite(undefined)).toBe(false);
  });
});

describe('getDefaultPermission', () => {
  it('returns read for restricted roles and all for leadership', () => {
    expect(getDefaultPermission('user')).toBe('read');
    expect(getDefaultPermission('other')).toBe('read');
    expect(getDefaultPermission('counselor')).toBe('all');
    expect(getDefaultPermission('president')).toBe('all');
    expect(getDefaultPermission('secretary')).toBe('all');
  });
});

describe('resolvePermissionForRoleChange', () => {
  it('forces read when demoting to user or other', () => {
    expect(resolvePermissionForRoleChange('secretary', 'user', 'all')).toBe('read');
    expect(resolvePermissionForRoleChange('president', 'other', 'all')).toBe('read');
  });

  it('applies role default when promoting from restricted roles', () => {
    expect(resolvePermissionForRoleChange('user', 'counselor', 'read')).toBe('all');
    expect(resolvePermissionForRoleChange('other', 'president', 'read')).toBe('all');
    expect(resolvePermissionForRoleChange('user', 'other', 'read')).toBe('read');
  });

  it('preserves custom Lectura/Todo between leadership roles', () => {
    expect(resolvePermissionForRoleChange('counselor', 'president', 'read')).toBe('read');
    expect(resolvePermissionForRoleChange('president', 'secretary', 'all')).toBe('all');
    expect(resolvePermissionForRoleChange('secretary', 'counselor', 'read')).toBe('read');
  });
});

describe('canManageSettings', () => {
  it('allows secretary to manage settings', () => {
    expect(canManageSettings('secretary')).toBe(true);
  });

  it('denies other roles from managing settings', () => {
    expect(canManageSettings('president' as UserRole)).toBe(false);
    expect(canManageSettings('counselor' as UserRole)).toBe(false);
    expect(canManageSettings('user' as UserRole)).toBe(false);
    expect(canManageSettings('other' as UserRole)).toBe(false);
  });
});

describe('hasLeadershipPrivileges', () => {
  it('returns true for leadership roles', () => {
    expect(hasLeadershipPrivileges('secretary')).toBe(true);
    expect(hasLeadershipPrivileges('president')).toBe(true);
    expect(hasLeadershipPrivileges('counselor')).toBe(true);
  });

  it('returns false for non-leadership roles', () => {
    expect(hasLeadershipPrivileges('user')).toBe(false);
    expect(hasLeadershipPrivileges('other')).toBe(false);
  });
});

describe('canViewSettings', () => {
  it('allows all roles to view personal settings', () => {
    expect(canViewSettings('secretary')).toBe(true);
    expect(canViewSettings('president')).toBe(true);
    expect(canViewSettings('counselor')).toBe(true);
    expect(canViewSettings('user')).toBe(true);
    expect(canViewSettings('other')).toBe(true);
  });
});

describe('ROLE_LIMITS', () => {
  it('defines the expected seats per role', () => {
    expect(ROLE_LIMITS.president).toBe(2);
    expect(ROLE_LIMITS.counselor).toBe(3);
    expect(ROLE_LIMITS.secretary).toBe(3);
    expect(ROLE_LIMITS.other).toBe(8);
    expect(ROLE_LIMITS.user).toBe(6);
  });
});

describe('role capacity helpers', () => {
  it('counts roles and remaining seats', () => {
    const counts = countRoles([
      { role: 'president' },
      { role: 'president' },
      { role: 'user' },
      { role: 'counselor' },
    ]);
    expect(counts.president).toBe(2);
    expect(counts.user).toBe(1);
    expect(counts.counselor).toBe(1);
    expect(getRoleRemaining(counts, 'president')).toBe(0);
    expect(getRoleRemaining(counts, 'user')).toBe(5);
    expect(isRoleAtCapacity(counts, 'president')).toBe(true);
    expect(isRoleAtCapacity(counts, 'user')).toBe(false);
  });

  it('allows keeping the same role even at capacity', () => {
    const counts = countRoles([{ role: 'president' }, { role: 'president' }]);
    expect(canAssignRole(counts, 'president', 'president')).toBe(true);
    expect(canAssignRole(counts, 'president', 'user')).toBe(false);
    expect(canAssignRole(counts, 'counselor', 'user')).toBe(true);
  });

  it('validates bulk role assignment against limits', () => {
    const users = [
      { uid: 'a', role: 'user' as UserRole },
      { uid: 'b', role: 'user' as UserRole },
      { uid: 'c', role: 'user' as UserRole },
      { uid: 'p1', role: 'president' as UserRole },
      { uid: 'p2', role: 'president' as UserRole },
    ];
    expect(canBulkAssignRole(users, new Set(['a']), 'president')).toBe(false);
    expect(canBulkAssignRole(users, new Set(['p1']), 'president')).toBe(true);
    expect(projectedRoleCountAfterBulk(users, new Set(['a', 'b']), 'counselor')).toBe(2);
    expect(canBulkAssignRole(users, new Set(['a', 'b', 'c']), 'counselor')).toBe(true);
  });
});
