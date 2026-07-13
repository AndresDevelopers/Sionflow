"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { MainLayout } from "@/components/main-layout";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { MembersProvider } from "@/contexts/members-context";
import { RefreshProvider } from "@/contexts/refresh-context";
import { Skeleton } from "@/components/ui/skeleton";
import { isBrowserOnline } from "@/lib/network";
import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAppName } from "@/lib/app-config";

function PrivateRoute({ children }: { children: ReactNode }) {
  const { user, loading, profileLoaded, userRole, mainPage, visiblePages } = useAuth();
  const router = useRouter();
  const [offlineAuthGaveUp, setOfflineAuthGaveUp] = useState(false);

  const isRestricted = userRole === "user";

  useEffect(() => {
    if (loading || user) {
      setOfflineAuthGaveUp(false);
      return;
    }

    // Offline: NEVER hard-navigate to /login — that full page load dies without network
    // and the phone shows the native "sin internet" screen. Wait for sticky auth restore.
    if (!isBrowserOnline()) {
      const t = window.setTimeout(() => {
        setOfflineAuthGaveUp(true);
      }, 4000);
      return () => window.clearTimeout(t);
    }

    router.push('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!loading && profileLoaded && user && isRestricted) {
      router.replace('/no-permission');
    }
  }, [profileLoaded, isRestricted, loading, router, user]);

  // Redirect to user's main page if currently on the root path — uses auth context (no extra Firestore read).
  // Skip while offline: client navigations need RSC network and can blank the shell on mobile.
  useEffect(() => {
    if (!loading && profileLoaded && user && !isRestricted && window.location.pathname === '/') {
      if (!isBrowserOnline()) return;

      const normalizedVisible = visiblePages.map((p) =>
        p === '/future-members' ? '/missionary-work' : p
      );
      const effectiveVisiblePages = Array.from(new Set([...normalizedVisible, '/church-chat']));
      const savedMainPage =
        mainPage === '/future-members' ? '/missionary-work' : mainPage || '/';

      if (effectiveVisiblePages.length === 0) {
        router.replace('/members');
      } else if (!effectiveVisiblePages.includes(savedMainPage) && savedMainPage !== '/') {
        router.replace(effectiveVisiblePages[0]);
      } else {
        router.replace(savedMainPage === '/' ? savedMainPage : savedMainPage);
      }
    }
  }, [loading, user, profileLoaded, isRestricted, router, mainPage, visiblePages]);

  if (loading || (user && !profileLoaded)) {
    return (
      <div className="flex h-svh w-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 px-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="space-y-2 w-full max-w-[250px]">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
          {!isBrowserOnline() && (
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              Sin conexión — restaurando sesión y datos en cache…
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!user) {
    if (!isBrowserOnline() && offlineAuthGaveUp) {
      return (
        <div className="flex h-svh w-full flex-col items-center justify-center gap-4 px-6 text-center">
          <WifiOff className="h-10 w-10 text-red-600" />
          <div className="space-y-2 max-w-sm">
            <h1 className="text-lg font-semibold">Sin sesión offline</h1>
            <p className="text-sm text-muted-foreground">
              {getAppName()} no encontró una sesión guardada en este dispositivo.
              Conéctate a internet e inicia sesión una vez; después podrás usar la app sin red.
            </p>
          </div>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reintentar
          </Button>
        </div>
      );
    }
    return null;
  }

  if (isRestricted) {
    return null;
  }

  return <>{children}</>;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <PrivateRoute>
        <RefreshProvider>
          <MembersProvider>
            <SidebarProvider>
              <MainLayout>{children}</MainLayout>
            </SidebarProvider>
          </MembersProvider>
        </RefreshProvider>
      </PrivateRoute>
    </AuthProvider>
  );
}
