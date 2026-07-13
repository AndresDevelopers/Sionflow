"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { MainLayout } from "@/components/main-layout";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { MembersProvider } from "@/contexts/members-context";
import { RefreshProvider } from "@/contexts/refresh-context";
import { Skeleton } from "@/components/ui/skeleton";

function PrivateRoute({ children }: { children: ReactNode }) {
  const { user, loading, profileLoaded, userRole, mainPage, visiblePages } = useAuth();
  const router = useRouter();

  const isRestricted = userRole === "user";

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!loading && profileLoaded && user && isRestricted) {
      router.replace('/no-permission');
    }
  }, [profileLoaded, isRestricted, loading, router, user]);

  // Redirect to user's main page if currently on the root path — uses auth context (no extra Firestore read)
  useEffect(() => {
    if (!loading && profileLoaded && user && !isRestricted && window.location.pathname === '/') {
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
        </div>
      </div>
    );
  }

  if (!user) {
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
