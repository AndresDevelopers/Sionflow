"use client";

import { useTheme } from "next-themes";
import { createContext, useContext, useState, ReactNode, useEffect, useCallback, useRef } from "react";
import { onAuthStateChanged, onIdTokenChanged, type User as FirebaseUser } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { usersCollection } from "@/lib/collections";
import { getAppStoragePrefix } from "@/lib/app-config";
import { isBrowserOnline } from "@/lib/network";
import { normalizeRole, normalizePermission, type UserRole, type UserPermission } from "@/lib/roles";
import { syncServerSession } from "@/lib/auth-session-client";

interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  initials: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /** True once the Firestore user profile has been loaded (or confirmed missing). */
  profileLoaded: boolean;
  firebaseUser: FirebaseUser | null;
  userRole: UserRole | null;
  userPermission: UserPermission | null;
  mainPage: string;
  visiblePages: string[];
  userTheme: string;
  barrio: string;
  organizacion: string;
  barrioOrg: string;
  /**
   * Admin general de la plataforma (isAppAdmin).
   * No debe usar la app principal — solo /app-admin.
   */
  isAppAdmin: boolean;
  refreshAuth: () => Promise<void>;
}

interface CachedAuthProfile {
  uid: string;
  role: UserRole;
  permission: UserPermission;
  mainPage: string;
  visiblePages: string[];
  theme: string;
  barrio: string;
  organizacion: string;
  barrioOrg: string;
  photoURL: string | null;
  email: string | null;
  displayName: string | null;
  isAppAdmin?: boolean;
  savedAt: number;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const formatUser = (user: FirebaseUser): User => ({
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    initials: user.displayName ? user.displayName.charAt(0).toUpperCase() : (user.email ? user.email.charAt(0).toUpperCase() : '?'),
});

function profileCacheKey(uid: string): string {
  return `${getAppStoragePrefix()}_auth_profile_${uid}`;
}

function lastSessionKey(): string {
  return `${getAppStoragePrefix()}_last_auth_uid`;
}

function loadCachedProfile(uid: string): CachedAuthProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(profileCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAuthProfile;
    if (!parsed || parsed.uid !== uid) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCachedProfile(profile: CachedAuthProfile): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(profileCacheKey(profile.uid), JSON.stringify(profile));
    localStorage.setItem(lastSessionKey(), profile.uid);
  } catch {
    // quota / private mode
  }
}

function loadLastSessionUid(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(lastSessionKey());
  } catch {
    return null;
  }
}

function clearLastSessionUid(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(lastSessionKey());
  } catch {
    // ignore
  }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [userPermission, setUserPermission] = useState<UserPermission | null>(null);
  const [mainPage, setMainPage] = useState<string>('/');
  const [visiblePages, setVisiblePages] = useState<string[]>([]);
  const [userTheme, setUserTheme] = useState<string>('system');
  const [barrio, setBarrio] = useState<string>('');
  const [organizacion, setOrganizacion] = useState<string>('');
  const [barrioOrg, setBarrioOrg] = useState<string>('');
  const [isAppAdmin, setIsAppAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const { setTheme } = useTheme();
  const profileAppliedFromCache = useRef(false);
  /** Sticky offline session: never wipe UI when auth flickers to null without network */
  const stickyUserRef = useRef<User | null>(null);
  const stickyFirebaseUserRef = useRef<FirebaseUser | null>(null);
  const intentionalSignOutRef = useRef(false);

  const applyProfile = useCallback(
    (data: {
      role?: unknown;
      permission?: unknown;
      mainPage?: string;
      visiblePages?: string[];
      barrio?: string;
      organizacion?: string;
      theme?: string;
      photoURL?: string | null;
      email?: string | null;
      displayName?: string | null;
      isAppAdmin?: boolean;
      barrioOrg?: string;
    }, options?: { persistUid?: string }) => {
      const role = normalizeRole(data.role);
      const permission = normalizePermission(data.permission);
      const nextMainPage = data.mainPage || '/';
      const nextVisible = Array.isArray(data.visiblePages) ? data.visiblePages : [];
      // Never invent a production ward (Libertad) for incomplete profiles
      const barrioVal =
        typeof data.barrio === "string" && data.barrio.trim().length > 0
          ? data.barrio.trim()
          : "";
      const orgVal =
        typeof data.organizacion === "string" && data.organizacion.trim().length > 0
          ? data.organizacion.trim()
          : "";
      const explicitBarrioOrg =
        typeof data.barrioOrg === "string" && data.barrioOrg.includes("|")
          ? data.barrioOrg.trim()
          : "";
      const nextBarrioOrg =
        explicitBarrioOrg ||
        (barrioVal && orgVal ? `${barrioVal}|${orgVal}` : "");
      const theme =
        data.theme === 'light' || data.theme === 'dark' || data.theme === 'system'
          ? data.theme
          : 'system';
      const nextIsAppAdmin =
        data.isAppAdmin === true || nextBarrioOrg === "__system__|__app_admin__";

      setUserRole(role);
      setUserPermission(permission);
      setMainPage(nextMainPage);
      setVisiblePages(nextVisible);
      setBarrio(barrioVal);
      setOrganizacion(orgVal);
      setBarrioOrg(nextBarrioOrg);
      setIsAppAdmin(nextIsAppAdmin);
      setUserTheme(theme);
      setTheme(theme);

      if (data.photoURL !== undefined) {
        setUser((prev) =>
          prev ? { ...prev, photoURL: data.photoURL ?? prev.photoURL } : prev
        );
      }

      if (options?.persistUid) {
        const existing = loadCachedProfile(options.persistUid);
        saveCachedProfile({
          uid: options.persistUid,
          role,
          permission,
          mainPage: nextMainPage,
          visiblePages: nextVisible,
          theme,
          barrio: barrioVal,
          organizacion: orgVal,
          barrioOrg: nextBarrioOrg,
          isAppAdmin: nextIsAppAdmin,
          photoURL: typeof data.photoURL === "string" ? data.photoURL : existing?.photoURL ?? null,
          email: data.email ?? existing?.email ?? null,
          displayName: data.displayName ?? existing?.displayName ?? null,
          savedAt: Date.now(),
        });
      }
    },
    [setTheme]
  );

  // Instant hydrate from last session while Firebase Auth boots (esp. offline cold start)
  useEffect(() => {
    const lastUid = loadLastSessionUid();
    if (!lastUid) return;
    const cached = loadCachedProfile(lastUid);
    if (!cached) return;

    const stickyUser: User = {
      uid: cached.uid,
      email: cached.email,
      displayName: cached.displayName,
      photoURL: cached.photoURL,
      initials: cached.displayName
        ? cached.displayName.charAt(0).toUpperCase()
        : cached.email
          ? cached.email.charAt(0).toUpperCase()
          : '?',
    };
    stickyUserRef.current = stickyUser;
    setUser(stickyUser);
    applyProfile({
      role: cached.role,
      permission: cached.permission,
      mainPage: cached.mainPage,
      visiblePages: cached.visiblePages,
      barrio: cached.barrio,
      organizacion: cached.organizacion,
      barrioOrg: cached.barrioOrg,
      theme: cached.theme,
      photoURL: cached.photoURL,
      isAppAdmin: cached.isAppAdmin === true,
    });
    profileAppliedFromCache.current = true;
    setProfileLoaded(true);
    // Keep loading=true until onAuthStateChanged confirms, unless offline
    if (!isBrowserOnline()) {
      setLoading(false);
    }
  }, [applyProfile]);

  // Keep Edge middleware session cookie in sync with Firebase ID token.
  useEffect(() => {
    if (!auth) return;
    const unsub = onIdTokenChanged(auth, async (currentUser) => {
      if (!currentUser) {
        if (intentionalSignOutRef.current || isBrowserOnline()) {
          await syncServerSession(null);
        }
        return;
      }
      try {
        const token = await currentUser.getIdToken();
        await syncServerSession(token);
      } catch {
        // non-fatal
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        intentionalSignOutRef.current = false;
        const formatted = formatUser(currentUser);
        stickyUserRef.current = formatted;
        stickyFirebaseUserRef.current = currentUser;
        setUser(formatted);
        setFirebaseUser(currentUser);

        // Only reset profileLoaded if we don't already have cache for this uid
        const cached = loadCachedProfile(currentUser.uid);
        if (cached) {
          applyProfile({
            role: cached.role,
            permission: cached.permission,
            mainPage: cached.mainPage,
            visiblePages: cached.visiblePages,
            barrio: cached.barrio,
            organizacion: cached.organizacion,
            barrioOrg: cached.barrioOrg,
            theme: cached.theme,
            photoURL: cached.photoURL,
            email: currentUser.email,
            displayName: currentUser.displayName,
            isAppAdmin: cached.isAppAdmin === true,
          });
          if (cached.photoURL || currentUser.photoURL) {
            setUser((prev) =>
              prev
                ? {
                    ...prev,
                    photoURL: cached.photoURL ?? currentUser.photoURL ?? prev.photoURL,
                  }
                : prev
            );
          }
          profileAppliedFromCache.current = true;
          setProfileLoaded(true);
          saveCachedProfile({
            ...cached,
            email: currentUser.email,
            displayName: currentUser.displayName,
            photoURL: cached.photoURL ?? currentUser.photoURL,
            savedAt: Date.now(),
          });
        } else {
          setProfileLoaded(false);
          profileAppliedFromCache.current = false;
          // Seed last session so offline reopen works even before profile loads
          try {
            localStorage.setItem(lastSessionKey(), currentUser.uid);
          } catch {
            // ignore
          }
        }
      } else {
        // CRITICAL: when the network drops, Firebase can briefly report null.
        // Do NOT wipe the session offline — that forces /login and kills the PWA shell.
        const offline = !isBrowserOnline();
        const hasSticky =
          stickyUserRef.current != null || loadLastSessionUid() != null;

        if (offline && hasSticky && !intentionalSignOutRef.current) {
          console.warn('[auth] offline: ignoring null auth event, keeping sticky session');
          if (stickyUserRef.current) {
            setUser(stickyUserRef.current);
          }
          if (stickyFirebaseUserRef.current) {
            setFirebaseUser(stickyFirebaseUserRef.current);
          }
          setProfileLoaded(true);
          setLoading(false);
          return;
        }

        stickyUserRef.current = null;
        stickyFirebaseUserRef.current = null;
        clearLastSessionUid();
        setUser(null);
        setFirebaseUser(null);
        setUserRole(null);
        setUserPermission(null);
        setMainPage('/');
        setVisiblePages([]);
        setBarrio('');
        setOrganizacion('');
        setBarrioOrg('');
        setIsAppAdmin(false);
        setProfileLoaded(true);
        profileAppliedFromCache.current = false;
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [applyProfile]);

  // Live subscription so admin changes to role/permission/visiblePages apply immediately.
  // Offline: Firestore persistentLocalCache + localStorage profile keep the shell usable.
  useEffect(() => {
    if (!firebaseUser) {
      return;
    }

    if (!profileAppliedFromCache.current) {
      setProfileLoaded(false);
    }

    const userDocRef = doc(usersCollection, firebaseUser.uid);
    let settled = false;

    const markLoaded = () => {
      settled = true;
      setProfileLoaded(true);
    };

    const offlineTimeout =
      !isBrowserOnline() && !profileAppliedFromCache.current
        ? window.setTimeout(() => {
            if (settled) return;
            const cached = loadCachedProfile(firebaseUser.uid);
            if (cached) {
              applyProfile({
                role: cached.role,
                permission: cached.permission,
                mainPage: cached.mainPage,
                visiblePages: cached.visiblePages,
                barrio: cached.barrio,
                organizacion: cached.organizacion,
                barrioOrg: cached.barrioOrg,
                theme: cached.theme,
                photoURL: cached.photoURL,
                isAppAdmin: cached.isAppAdmin === true,
              });
            } else {
              applyProfile({});
            }
            markLoaded();
          }, 800)
        : null;

    // Always ensure we don't hang forever even if online snapshot is slow on flaky mobile
    const hardTimeout = window.setTimeout(() => {
      if (settled) return;
      const cached = loadCachedProfile(firebaseUser.uid);
      if (cached) {
        applyProfile({
          role: cached.role,
          permission: cached.permission,
          mainPage: cached.mainPage,
          visiblePages: cached.visiblePages,
          barrio: cached.barrio,
          organizacion: cached.organizacion,
          barrioOrg: cached.barrioOrg,
          theme: cached.theme,
          photoURL: cached.photoURL,
          isAppAdmin: cached.isAppAdmin === true,
        });
      } else if (!profileAppliedFromCache.current) {
        applyProfile({});
      }
      markLoaded();
    }, 5000);

    const unsubscribe = onSnapshot(
      userDocRef,
      (userDoc) => {
        if (!userDoc.exists()) {
          applyProfile(
            {
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              isAppAdmin: false,
            },
            { persistUid: firebaseUser.uid }
          );
          markLoaded();
          return;
        }

        const data = userDoc.data();
        applyProfile(
          {
            role: data.role,
            permission: data.permission,
            mainPage: data.mainPage,
            visiblePages: data.visiblePages,
            barrio: data.barrio,
            organizacion: data.organizacion,
            barrioOrg: data.barrioOrg,
            theme: data.theme,
            photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            isAppAdmin: data.isAppAdmin === true,
          },
          { persistUid: firebaseUser.uid }
        );
        markLoaded();
      },
      () => {
        if (!profileAppliedFromCache.current) {
          const cached = loadCachedProfile(firebaseUser.uid);
          if (cached) {
            applyProfile({
              role: cached.role,
              permission: cached.permission,
              mainPage: cached.mainPage,
              visiblePages: cached.visiblePages,
              barrio: cached.barrio,
              organizacion: cached.organizacion,
              barrioOrg: cached.barrioOrg,
              theme: cached.theme,
              photoURL: cached.photoURL,
              isAppAdmin: cached.isAppAdmin === true,
            });
          } else {
            applyProfile({});
          }
        }
        markLoaded();
      }
    );

    return () => {
      unsubscribe();
      if (offlineTimeout != null) window.clearTimeout(offlineTimeout);
      window.clearTimeout(hardTimeout);
    };
  }, [firebaseUser, applyProfile]);
  
  const refreshAuth = useCallback(async () => {
    const currentUser = auth?.currentUser;
    if (!currentUser) return;
    // Never reload profile from network while offline — it fails and can wipe session
    if (!isBrowserOnline()) return;
    try {
      await currentUser.reload();
      const freshUser = auth.currentUser;
      if (freshUser) {
        setUser(formatUser(freshUser));
        setFirebaseUser(freshUser);
        stickyUserRef.current = formatUser(freshUser);
        stickyFirebaseUserRef.current = freshUser;
      }
    } catch (error) {
      console.warn('[auth] refreshAuth failed', error);
    }
  }, []);

  // Expose intentional sign-out for logout buttons (via custom event)
  useEffect(() => {
    const onSignOut = () => {
      intentionalSignOutRef.current = true;
      stickyUserRef.current = null;
      stickyFirebaseUserRef.current = null;
      clearLastSessionUid();
    };
    window.addEventListener('sionflow:intent-sign-out', onSignOut);
    return () => window.removeEventListener('sionflow:intent-sign-out', onSignOut);
  }, []);

  const value = {
    user,
    loading,
    profileLoaded,
    firebaseUser,
    userRole,
    userPermission,
    mainPage,
    visiblePages,
    userTheme,
    barrio,
    organizacion,
    barrioOrg,
    isAppAdmin,
    refreshAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
