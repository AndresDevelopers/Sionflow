/**
 * Shared API auth helpers for Next.js route handlers.
 *
 * Token verification uses JWKS via jose (same as /api/auth/session and the
 * Edge proxy). This avoids depending on firebase-admin Auth for the hot path,
 * so a broken @google-cloud/storage / uuid ESM-only chain cannot brick login or
 * /api/app-admin/me.
 *
 * IMPORTANT: never default barrio/organizacion to a production ward.
 * Incomplete profiles must be rejected (403), not silently scoped to Libertad.
 */
import { firestoreAdmin } from '@/lib/firebase-admin';
import { verifyFirebaseIdTokenEdge } from '@/lib/firebase-token-edge';
import logger from '@/lib/logger';
import {
  canWrite,
  hasLeadershipPrivileges,
  normalizePermission,
  normalizeRole,
  type UserPermission,
  type UserRole,
} from '@/lib/roles';

export class AuthHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthHttpError';
    this.status = status;
  }
}

export type VerifiedAuth = {
  uid: string;
  email: string | null;
};

/**
 * Extract Bearer token, verify with Firebase JWKS (jose), return uid + email.
 * Throws AuthHttpError with status 401 on missing/invalid token.
 */
export async function requireAuth(request: Request): Promise<VerifiedAuth> {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new AuthHttpError('No autenticado. Inicia sesión de nuevo.', 401);
  }
  try {
    const decoded = await verifyFirebaseIdTokenEdge(match[1]);
    return {
      uid: decoded.sub,
      email: typeof decoded.email === 'string' ? decoded.email : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Config / JWKS infrastructure — not a bad user token.
    const isInfra =
      message.includes('not configured') ||
      message.includes('project id') ||
      message.includes('JWKS') ||
      message.includes('fetch');
    if (isInfra) {
      logger.error({ error, message: 'Token verification infrastructure failure' });
      throw new AuthHttpError(
        'Servicio de autenticación no disponible en el servidor. Intenta de nuevo en unos minutos.',
        503
      );
    }
    logger.warn({ error, message: 'Invalid ID token on API request' });
    throw new AuthHttpError('Token inválido o expirado. Cierra sesión y vuelve a entrar.', 401);
  }
}

/**
 * Extract Bearer token, verify with Firebase Admin, return uid.
 * Throws AuthHttpError with status 401 on missing/invalid token.
 */
export async function requireUid(request: Request): Promise<string> {
  const { uid } = await requireAuth(request);
  return uid;
}

/**
 * Build barrioOrg from c_users fields without any ward defaults.
 * Returns null if the profile has no usable barrio scope.
 */
export function buildBarrioOrgFromUserData(
  data: FirebaseFirestore.DocumentData | undefined | null
): string | null {
  if (!data) return null;

  if (typeof data.barrioOrg === 'string') {
    const explicit = data.barrioOrg.trim();
    if (explicit.includes('|') && !explicit.startsWith('|') && !explicit.endsWith('|')) {
      return explicit;
    }
  }

  const barrio = typeof data.barrio === 'string' ? data.barrio.trim() : '';
  const organizacion = typeof data.organizacion === 'string' ? data.organizacion.trim() : '';
  if (!barrio || !organizacion) return null;
  return `${barrio}|${organizacion}`;
}

/**
 * Resolve barrioOrg from c_users/{uid} as "barrio|organizacion".
 * Never defaults to a production ward — incomplete profiles are rejected.
 * Throws AuthHttpError 403 if the user document is missing or has no barrio/org.
 */
export async function getUserBarrioOrg(uid: string): Promise<string> {
  const userDoc = await firestoreAdmin.collection('c_users').doc(uid).get();
  if (!userDoc.exists) {
    throw new AuthHttpError('Usuario no encontrado.', 403);
  }
  const barrioOrg = buildBarrioOrgFromUserData(userDoc.data());
  if (!barrioOrg) {
    throw new AuthHttpError('Usuario sin barrio asignado.', 403);
  }
  return barrioOrg;
}

/** requireUid + getUserBarrioOrg in one call. */
export async function requireUidAndBarrioOrg(
  request: Request
): Promise<{ uid: string; barrioOrg: string; email: string | null }> {
  const { uid, email } = await requireAuth(request);
  const barrioOrg = await getUserBarrioOrg(uid);
  return { uid, barrioOrg, email };
}

export type UserAccessProfile = {
  uid: string;
  role: UserRole;
  permission: UserPermission;
  barrioOrg: string | null;
  email: string | null;
  name: string | null;
};

/**
 * Load role/permission from c_users for RBAC on Admin SDK routes.
 * Throws AuthHttpError 403 if the profile is missing.
 */
export async function getUserAccessProfile(uid: string): Promise<UserAccessProfile> {
  const userDoc = await firestoreAdmin.collection('c_users').doc(uid).get();
  if (!userDoc.exists) {
    throw new AuthHttpError('Usuario no encontrado.', 403);
  }
  const data = userDoc.data() ?? {};
  return {
    uid,
    role: normalizeRole(data.role),
    permission: normalizePermission(data.permission),
    barrioOrg: buildBarrioOrgFromUserData(data),
    email: typeof data.email === 'string' ? data.email : null,
    name: typeof data.name === 'string' ? data.name : null,
  };
}

/** Require Firestore `permission` that allows writes (`all` / legacy aliases). */
export async function requireCanWrite(uid: string): Promise<UserAccessProfile> {
  const profile = await getUserAccessProfile(uid);
  if (!canWrite(profile.permission)) {
    throw new AuthHttpError(
      'No tienes permiso de escritura para esta operación.',
      403
    );
  }
  return profile;
}

/** Require leadership role (secretary / president / counselor). */
export async function requireLeadership(uid: string): Promise<UserAccessProfile> {
  const profile = await getUserAccessProfile(uid);
  if (!hasLeadershipPrivileges(profile.role)) {
    throw new AuthHttpError(
      'Solo el liderazgo puede realizar esta operación.',
      403
    );
  }
  return profile;
}

// URL sanitizers: re-export from client-safe module (used by FCM route + helpers)
export {
  sanitizeAppRelativeUrl,
  sanitizeExternalHttpsUrl,
  sanitizeNotificationActionUrl,
} from '@/lib/url-safety';

export function getErrorStatus(error: unknown, fallback = 500): number {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    return (error as { status: number }).status;
  }
  return fallback;
}
