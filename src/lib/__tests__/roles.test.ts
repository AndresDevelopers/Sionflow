import {
  canManageSettings,
  hasLeadershipPrivileges,
  canViewSettings,
  normalizeRole,
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
  it('allows leadership roles to view settings', () => {
    expect(canViewSettings('secretary')).toBe(true);
    expect(canViewSettings('president')).toBe(true);
    expect(canViewSettings('counselor')).toBe(true);
  });

  it('denies non-leadership roles from viewing settings', () => {
    expect(canViewSettings('user')).toBe(false);
    expect(canViewSettings('other')).toBe(false);
  });
});
