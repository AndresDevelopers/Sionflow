"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { MainLayout } from "@/components/main-layout";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import { doc, getDoc } from "firebase/firestore";
import { usersCollection } from "@/lib/collections";
import { normalizeRole } from "@/lib/roles";

function PrivateRoute({ children }: { children: ReactNode }) {
  const { user, loading, mainPage } = useAuth();
  const router = useRouter();
  const [checkingRole, setCheckingRole] = useState(true);
  const [isRestricted, setIsRestricted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) {
      setCheckingRole(false);
      setIsRestricted(null);
      return;
    }

    let isMounted = true;
    const fetchRole = async () => {
      setCheckingRole(true);
      try {
        const userDocRef = doc(usersCollection, user.uid);
        const snapshot = await getDoc(userDocRef);
        if (!isMounted) return;

        if (snapshot.exists()) {
          const data = snapshot.data() as { role?: unknown };
          const normalizedRole = normalizeRole(data.role);

          setIsRestricted(normalizedRole === "user");
        } else {
          setIsRestricted(false);
        }
      } catch (error) {
        console.error("Error fetching user role", error);
        if (isMounted) {
          setIsRestricted(null);
        }
      } finally {
        if (isMounted) {
          setCheckingRole(false);
        }
      }
    };

    fetchRole();

    return () => {
      isMounted = false;
    };
  }, [user]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!loading && !checkingRole && user && isRestricted) {
      router.replace('/no-permission');
    }
  }, [checkingRole, isRestricted, loading, router, user]);

  // Redirect to user's main page if currently on the root path
  useEffect(() => {
    if (!loading && user && !checkingRole && window.location.pathname === '/') {
      // Check if user has access to their selected main page
      const checkMainPageAccess = async () => {
        try {
          const userDocRef = doc(usersCollection, user.uid);
          const snapshot = await getDoc(userDocRef);
          
          if (snapshot.exists()) {
            const data = snapshot.data() as { visiblePages?: string[] };
            const visiblePages = Array.isArray(data.visiblePages) ? data.visiblePages : [];
            const effectiveVisiblePages = Array.from(new Set([...visiblePages, '/church-chat']));
            
            // If main page is not in visible pages, redirect to first visible page or fallback to /members
            if (!effectiveVisiblePages.includes(mainPage) && effectiveVisiblePages.length > 0) {
              router.replace(effectiveVisiblePages[0]);
            } else if (effectiveVisiblePages.length === 0) {
              // If no pages are visible, redirect to members as fallback
              router.replace('/members');
            } else {
              // Main page is accessible, redirect to it
              router.replace(mainPage);
            }
          } else {
            // No user data, fallback to members
            router.replace('/members');
          }
        } catch (error) {
          console.error("Error checking main page access", error);
          // On error, fallback to members
          router.replace('/members');
        }
      };
      
      checkMainPageAccess();
    }
  }, [loading, user, checkingRole, mainPage, router]);

  if (loading || checkingRole) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-[250px]" />
            <Skeleton className="h-4 w-[200px]" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // or a loading spinner
  }

  if (!checkingRole && isRestricted) {
    return null;
  }

  return <>{children}</>;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <PrivateRoute>
        <SidebarProvider>
          <MainLayout>{children}</MainLayout>
        </SidebarProvider>
      </PrivateRoute>
    </AuthProvider>
  );
}
