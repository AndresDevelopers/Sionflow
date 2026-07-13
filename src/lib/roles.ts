export type UserRole = 'user' | 'counselor' | 'president' | 'secretary' | 'other';

export type UserPermission = 'read' | 'all';

/**
 * Canonical permission values accepted in Firestore and the UI.
 * Aliases cover Spanish labels and legacy typos that may exist in older docs.
 */
const WRITE_PERMISSION_ALIASES = new Set(['all', 'todo', 'todos']);
const READ_PERMISSION_ALIASES = new Set(['read', 'lectura']);

export const normalizePermission = (permission?: unknown): UserPermission => {
  if (typeof permission !== 'string') return 'read';
  const normalized = permission.trim().toLowerCase();
  if (WRITE_PERMISSION_ALIASES.has(normalized)) return 'all';
  if (READ_PERMISSION_ALIASES.has(normalized)) return 'read';
  return 'read';
};

export const canWrite = (permission: UserPermission | null | undefined): boolean =>
  permission === 'all';

export const getDefaultPermission = (role: UserRole): UserPermission =>
  role === 'user' || role === 'other' ? 'read' : 'all';

/**
 * Resolve the permission to store when an admin changes a user's role.
 * - Demote to `user` / `other` → force `read` (restricted roles).
 * - Promote from restricted role → apply the new role default (`all` for leadership).
 * - Move between leadership roles → keep the custom permission (Lectura/Todo).
 */
export const resolvePermissionForRoleChange = (
  previousRole: UserRole,
  newRole: UserRole,
  previousPermission?: UserPermission | null
): UserPermission => {
  if (newRole === 'user' || newRole === 'other') {
    return 'read';
  }

  const wasRestricted = previousRole === 'user' || previousRole === 'other';
  if (wasRestricted) {
    return getDefaultPermission(newRole);
  }

  // Leadership → leadership: preserve admin-assigned Lectura/Todo
  return previousPermission === 'all' || previousPermission === 'read'
    ? previousPermission
    : getDefaultPermission(newRole);
};

export const PERMISSION_META: Record<UserPermission, { i18nKey: string }> = {
  read: { i18nKey: 'permission.read' },
  all:  { i18nKey: 'permission.all' },
};

export const normalizeRole = (role?: unknown): UserRole => {
  if (typeof role !== 'string') {
    return 'user';
  }

  const normalized = role.trim().toLowerCase();

  if (normalized === 'secretary' || normalized === 'admin') {
    return 'secretary';
  }

  if (normalized === 'president' || normalized === 'presidente') {
    return 'president';
  }

  if (
    normalized === 'counselor' ||
    normalized === 'consejero' ||
    normalized === 'consejera'
  ) {
    return 'counselor';
  }

  if (normalized === 'other' || normalized === 'otro') {
    return 'other';
  }

  return 'user';
};

export const assignableRoles: readonly UserRole[] = [
  'user',
  'counselor',
  'president',
  'secretary',
  'other',
];

export const leadershipRoles: readonly UserRole[] = [
  'secretary',
  'president',
  'counselor',
];

export const settingsAdminRole: UserRole = 'secretary';

export const roleVisibilityDocId = 'role_visibility';

export const canManageSettings = (role: UserRole): boolean =>
  role === settingsAdminRole;

export const hasLeadershipPrivileges = (role: UserRole): boolean =>
  leadershipRoles.includes(role);

/**
 * Settings is a personal page (profile, security, theme, notifications).
 * Every authenticated role may view and edit their own settings.
 */
export const canViewSettings = (_role: UserRole): boolean => true;

export const isAdmin = (role: UserRole | null | undefined): boolean =>
  role === settingsAdminRole || role === 'president';

/**
 * Maximum seats per role within a single barrio + organization (barrioOrg).
 * New self-registrations always receive the `user` (miembro) role.
 */
export const ROLE_LIMITS: Readonly<Record<UserRole, number>> = {
  president: 2,
  counselor: 3,
  secretary: 3,
  other: 8,
  user: 6,
};

export type RoleCounts = Record<UserRole, number>;

export const emptyRoleCounts = (): RoleCounts => ({
  user: 0,
  counselor: 0,
  president: 0,
  secretary: 0,
  other: 0,
});

export const countRoles = (
  users: ReadonlyArray<{ role: UserRole }>
): RoleCounts => {
  const counts = emptyRoleCounts();
  for (const u of users) {
    const role = normalizeRole(u.role);
    counts[role] += 1;
  }
  return counts;
};

export const getRoleLimit = (role: UserRole): number => ROLE_LIMITS[role];

export const getRoleRemaining = (counts: RoleCounts, role: UserRole): number =>
  Math.max(0, ROLE_LIMITS[role] - (counts[role] ?? 0));

export const isRoleAtCapacity = (counts: RoleCounts, role: UserRole): boolean =>
  (counts[role] ?? 0) >= ROLE_LIMITS[role];

/**
 * Whether a user may be assigned `newRole`.
 * Keeping the same role is always allowed (no extra seat consumed).
 */
export const canAssignRole = (
  counts: RoleCounts,
  newRole: UserRole,
  currentRole?: UserRole
): boolean => {
  if (currentRole !== undefined && currentRole === newRole) return true;
  return !isRoleAtCapacity(counts, newRole);
};

/**
 * Projected occupancy after assigning `newRole` to every selected uid.
 * Non-selected users keep their current roles.
 */
export const projectedRoleCountAfterBulk = (
  users: ReadonlyArray<{ uid: string; role: UserRole }>,
  selectedUids: ReadonlySet<string>,
  newRole: UserRole
): number => {
  let count = 0;
  for (const u of users) {
    if (selectedUids.has(u.uid) || u.role === newRole) {
      count += 1;
    }
  }
  return count;
};

export const canBulkAssignRole = (
  users: ReadonlyArray<{ uid: string; role: UserRole }>,
  selectedUids: ReadonlySet<string>,
  newRole: UserRole
): boolean =>
  projectedRoleCountAfterBulk(users, selectedUids, newRole) <= ROLE_LIMITS[newRole];
