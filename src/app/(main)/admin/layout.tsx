"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { doc, getDoc } from "firebase/firestore";
import { usersCollection } from "@/lib/collections";
import { isAdmin, normalizeRole, type UserRole } from "@/lib/roles";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ShieldAlert } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading, userRole } = useAuth();
  const router = useRouter();
  const [checkingRole, setCheckingRole] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);

  useEffect(() => {
    let isMounted = true;

    const check = async () => {
      if (!user) {
        setCheckingRole(false);
        return;
      }

      try {
        const snap = await getDoc(doc(usersCollection, user.uid));
        if (!isMounted) return;
        if (snap.exists()) {
          setRole(normalizeRole(snap.data().role));
        } else {
          setRole(userRole);
        }
      } catch {
        if (isMounted) setRole(userRole);
      } finally {
        if (isMounted) setCheckingRole(false);
      }
    };

    check();

    return () => {
      isMounted = false;
    };
  }, [user, userRole]);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading || checkingRole) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-[220px]" />
            <Skeleton className="h-4 w-[160px]" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  if (!isAdmin(role)) {
    return (
      <div className="page-section">
        <Card className="border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-rose-900 dark:text-rose-100">
              <ShieldAlert className="h-5 w-5" />
              Acceso restringido al panel de administración
            </CardTitle>
            <CardDescription className="text-rose-800 dark:text-rose-200">
              Esta sección está reservada para el secretario del quórum.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-rose-800 dark:text-rose-200">
              Tu rol actual no tiene permisos para administrar usuarios, miembros o
              configuraciones avanzadas. Si necesitas acceso, contacta al secretario.
            </p>
            <div className="flex gap-2">
              <Button asChild variant="outline">
                <Link href="/">Volver al inicio</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/settings">Ir a Ajustes</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
