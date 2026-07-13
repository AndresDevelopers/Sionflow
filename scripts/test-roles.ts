import test from 'node:test';
import assert from 'node:assert';
import {
  normalizeRole,
  normalizePermission,
  canWrite,
  getDefaultPermission,
  resolvePermissionForRoleChange,
  canManageSettings,
  hasLeadershipPrivileges,
  canViewSettings,
  ROLE_LIMITS,
  countRoles,
  getRoleRemaining,
  isRoleAtCapacity,
  canAssignRole,
  canBulkAssignRole,
  projectedRoleCountAfterBulk,
} from '../src/lib/roles';
import type { UserRole } from '../src/lib/roles';

test('normalizeRole', async (t) => {
  await t.test('normalizes roles correctly', () => {
    assert.strictEqual(normalizeRole('secretary'), 'secretary');
    assert.strictEqual(normalizeRole('admin'), 'secretary');
    assert.strictEqual(normalizeRole('president'), 'president');
    assert.strictEqual(normalizeRole('presidente'), 'president');
    assert.strictEqual(normalizeRole('counselor'), 'counselor');
    assert.strictEqual(normalizeRole('consejero'), 'counselor');
    assert.strictEqual(normalizeRole('consejera'), 'counselor');
    assert.strictEqual(normalizeRole('other'), 'other');
    assert.strictEqual(normalizeRole('otro'), 'other');
  });

  await t.test('handles whitespace and case', () => {
    assert.strictEqual(normalizeRole('  PRESIDENT  '), 'president');
    assert.strictEqual(normalizeRole('Secretary '), 'secretary');
  });

  await t.test('defaults to user for unknown roles', () => {
    assert.strictEqual(normalizeRole('unknown'), 'user');
    assert.strictEqual(normalizeRole(''), 'user');
    assert.strictEqual(normalizeRole(undefined), 'user');
    assert.strictEqual(normalizeRole(null), 'user');
    assert.strictEqual(normalizeRole(123), 'user');
  });
});

test('normalizePermission', async (t) => {
  await t.test('maps write aliases to all', () => {
    assert.strictEqual(normalizePermission('all'), 'all');
    assert.strictEqual(normalizePermission('ALL'), 'all');
    assert.strictEqual(normalizePermission('todo'), 'all');
    assert.strictEqual(normalizePermission('todos'), 'all');
    assert.strictEqual(normalizePermission(' Todo '), 'all');
  });

  await t.test('maps read aliases to read', () => {
    assert.strictEqual(normalizePermission('read'), 'read');
    assert.strictEqual(normalizePermission('lectura'), 'read');
    assert.strictEqual(normalizePermission('LECTURA'), 'read');
  });

  await t.test('defaults to read for missing or unknown values', () => {
    assert.strictEqual(normalizePermission(undefined), 'read');
    assert.strictEqual(normalizePermission(null), 'read');
    assert.strictEqual(normalizePermission(''), 'read');
    assert.strictEqual(normalizePermission('write'), 'read');
    assert.strictEqual(normalizePermission(123), 'read');
  });
});

test('canWrite', () => {
  assert.strictEqual(canWrite('all'), true);
  assert.strictEqual(canWrite('read'), false);
  assert.strictEqual(canWrite(null), false);
  assert.strictEqual(canWrite(undefined), false);
});

test('getDefaultPermission', () => {
  assert.strictEqual(getDefaultPermission('user'), 'read');
  assert.strictEqual(getDefaultPermission('other'), 'read');
  assert.strictEqual(getDefaultPermission('counselor'), 'all');
  assert.strictEqual(getDefaultPermission('president'), 'all');
  assert.strictEqual(getDefaultPermission('secretary'), 'all');
});

test('resolvePermissionForRoleChange', async (t) => {
  await t.test('forces read when demoting to user or other', () => {
    assert.strictEqual(resolvePermissionForRoleChange('secretary', 'user', 'all'), 'read');
    assert.strictEqual(resolvePermissionForRoleChange('president', 'other', 'all'), 'read');
  });

  await t.test('applies role default when promoting from restricted roles', () => {
    assert.strictEqual(resolvePermissionForRoleChange('user', 'counselor', 'read'), 'all');
    assert.strictEqual(resolvePermissionForRoleChange('other', 'president', 'read'), 'all');
    assert.strictEqual(resolvePermissionForRoleChange('user', 'other', 'read'), 'read');
  });

  await t.test('preserves custom Lectura/Todo between leadership roles', () => {
    assert.strictEqual(resolvePermissionForRoleChange('counselor', 'president', 'read'), 'read');
    assert.strictEqual(resolvePermissionForRoleChange('president', 'secretary', 'all'), 'all');
    assert.strictEqual(resolvePermissionForRoleChange('secretary', 'counselor', 'read'), 'read');
  });
});

test('canManageSettings', () => {
  assert.strictEqual(canManageSettings('secretary'), true);
  assert.strictEqual(canManageSettings('president' as UserRole), false);
  assert.strictEqual(canManageSettings('counselor' as UserRole), false);
  assert.strictEqual(canManageSettings('user' as UserRole), false);
  assert.strictEqual(canManageSettings('other' as UserRole), false);
});

test('hasLeadershipPrivileges', () => {
  assert.strictEqual(hasLeadershipPrivileges('secretary'), true);
  assert.strictEqual(hasLeadershipPrivileges('president'), true);
  assert.strictEqual(hasLeadershipPrivileges('counselor'), true);
  assert.strictEqual(hasLeadershipPrivileges('user'), false);
  assert.strictEqual(hasLeadershipPrivileges('other'), false);
});

test('canViewSettings', () => {
  // Personal settings (profile, theme, notifications) are available to every role
  assert.strictEqual(canViewSettings('secretary'), true);
  assert.strictEqual(canViewSettings('president'), true);
  assert.strictEqual(canViewSettings('counselor'), true);
  assert.strictEqual(canViewSettings('user'), true);
  assert.strictEqual(canViewSettings('other'), true);
});

test('ROLE_LIMITS', () => {
  assert.strictEqual(ROLE_LIMITS.president, 2);
  assert.strictEqual(ROLE_LIMITS.counselor, 3);
  assert.strictEqual(ROLE_LIMITS.secretary, 3);
  assert.strictEqual(ROLE_LIMITS.other, 8);
  assert.strictEqual(ROLE_LIMITS.user, 6);
});

test('role capacity helpers', async (t) => {
  await t.test('counts roles and remaining seats', () => {
    const counts = countRoles([
      { role: 'president' },
      { role: 'president' },
      { role: 'user' },
      { role: 'counselor' },
    ]);
    assert.strictEqual(counts.president, 2);
    assert.strictEqual(counts.user, 1);
    assert.strictEqual(counts.counselor, 1);
    assert.strictEqual(getRoleRemaining(counts, 'president'), 0);
    assert.strictEqual(getRoleRemaining(counts, 'user'), 5);
    assert.strictEqual(isRoleAtCapacity(counts, 'president'), true);
    assert.strictEqual(isRoleAtCapacity(counts, 'user'), false);
  });

  await t.test('allows keeping the same role even at capacity', () => {
    const counts = countRoles([{ role: 'president' }, { role: 'president' }]);
    assert.strictEqual(canAssignRole(counts, 'president', 'president'), true);
    assert.strictEqual(canAssignRole(counts, 'president', 'user'), false);
    assert.strictEqual(canAssignRole(counts, 'counselor', 'user'), true);
  });

  await t.test('validates bulk role assignment against limits', () => {
    const users = [
      { uid: 'a', role: 'user' as UserRole },
      { uid: 'b', role: 'user' as UserRole },
      { uid: 'c', role: 'user' as UserRole },
      { uid: 'p1', role: 'president' as UserRole },
      { uid: 'p2', role: 'president' as UserRole },
    ];
    assert.strictEqual(canBulkAssignRole(users, new Set(['a']), 'president'), false);
    assert.strictEqual(canBulkAssignRole(users, new Set(['p1']), 'president'), true);
    assert.strictEqual(projectedRoleCountAfterBulk(users, new Set(['a', 'b']), 'counselor'), 2);
    assert.strictEqual(canBulkAssignRole(users, new Set(['a', 'b', 'c']), 'counselor'), true);
  });
});
