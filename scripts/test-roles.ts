import test from 'node:test';
import assert from 'node:assert';
import {
  normalizeRole,
  canManageSettings,
  hasLeadershipPrivileges,
  canViewSettings,
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
  assert.strictEqual(canViewSettings('secretary'), true);
  assert.strictEqual(canViewSettings('president'), true);
  assert.strictEqual(canViewSettings('counselor'), true);
  assert.strictEqual(canViewSettings('user'), false);
  assert.strictEqual(canViewSettings('other'), false);
});
