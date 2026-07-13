"use client";

import { useTheme } from "next-themes";
import { createContext, useContext, useState, ReactNode, useEffect, useCallback, useRef } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { usersCollection } from "@/lib/collections";
import { getAppStoragePrefix } from "@/lib/app-config";
import { isBrowserOnline } from "@/lib/network";
import { normalizeRole, normalizePermission, type UserRole, type UserPermission } from "@/lib/roles";

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
  } catch {
    // quota / private mode
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
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const { setTheme } = useTheme();
  const profileAppliedFromCache = useRef(false);

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
    }, options?: { persistUid?: string }) => {
      const role = normalizeRole(data.role);
      const permission = normalizePermission(data.permission);
      const nextMainPage = data.mainPage || '/';
      const nextVisible = Array.isArray(data.visiblePages) ? data.visiblePages : [];
      const barrioVal =
        typeof data.barrio === "string" && data.barrio.trim().length > 0
          ? data.barrio.trim()
          : "Libertad";
      const orgVal =
        typeof data.organizacion === "string" && data.organizacion.trim().length > 0
          ? data.organizacion.trim()
          : "Quórum de Élderes";
      const nextBarrioOrg = `${barrioVal}|${orgVal}`;
      const theme =
        data.theme === 'light' || data.theme === 'dark' || data.theme === 'system'
          ? data.theme
          : 'system';

      setUserRole(role);
      setUserPermission(permission);
      setMainPage(nextMainPage);
      setVisiblePages(nextVisible);
      setBarrio(barrioVal);
      setOrganizacion(orgVal);
      setBarrioOrg(nextBarrioOrg);
      setUserTheme(theme);
      setTheme(theme);

      if (data.photoURL !== undefined) {
        setUser((prev) =>
          prev ? { ...prev, photoURL: data.photoURL ?? prev.photoURL } : prev
        );
      }

      if (options?.persistUid) {
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
          photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
          savedAt: Date.now(),
        });
      }
    },
    [setTheme]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(formatUser(currentUser));
        setFirebaseUser(currentUser);
        setProfileLoaded(false);
        profileAppliedFromCache.current = false;

        // Hydrate instantly from last known profile (critical for offline cold start)
        const cached = loadCachedProfile(currentUser.uid);
        if (cached) {
          applyProfile({
            role: cached.role,
            permission: cached.permission,
            mainPage: cached.mainPage,
            visiblePages: cached.visiblePages,
            barrio: cached.barrio,
            organizacion: cached.organizacion,
            theme: cached.theme,
            photoURL: cached.photoURL,
          });
          if (cached.photoURL) {
            setUser((prev) =>
              prev ? { ...prev, photoURL: cached.photoURL ?? prev.photoURL } : prev
            );
          }
          profileAppliedFromCache.current = true;
          setProfileLoaded(true);
        }
      } else {
        // Keep localStorage profile for the next session on this device (offline reopen).
        setUser(null);
        setFirebaseUser(null);
        setUserRole(null);
        setUserPermission(null);
        setMainPage('/');
        setVisiblePages([]);
        setBarrio('');
        setOrganizacion('');
        setBarrioOrg('');
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

    // If we already have a cached profile, stay usable; still try live updates when possible
    if (!profileAppliedFromCache.current) {
      setProfileLoaded(false);
    }

    const userDocRef = doc(usersCollection, firebaseUser.uid);
    let settled = false;

    const markLoaded = () => {
      settled = true;
      setProfileLoaded(true);
    };

    // Offline safety net: if snapshot never arrives, don't block the app forever
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
                theme: cached.theme,
                photoURL: cached.photoURL,
              });
            } else {
              // Defaults so PrivateRoute can still render (same as missing doc online)
              applyProfile({});
            }
            markLoaded();
          }, 1500)
        : null;

    const unsubscribe = onSnapshot(
      userDocRef,
      (userDoc) => {
        if (!userDoc.exists()) {
          applyProfile({}, { persistUid: firebaseUser.uid });
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
            theme: data.theme,
            photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
          },
          { persistUid: firebaseUser.uid }
        );
        markLoaded();
      },
      () => {
        // Network/Firestore error: keep cache if present, else safe defaults
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
              theme: cached.theme,
              photoURL: cached.photoURL,
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
    };
  }, [firebaseUser, applyProfile]);
  
  const refreshAuth = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (currentUser) {
      await currentUser.reload();
      const freshUser = auth.currentUser;
      if (freshUser) {
        // Auth profile fields only; role/permission stay live via onSnapshot
        setUser(formatUser(freshUser));
        setFirebaseUser(freshUser);
      }
    }
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
