"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { doc } from 'firebase/firestore';
import { getDoc } from '@/lib/firestore-query';
import { usersCollection } from "@/lib/collections";
import { useI18n } from "@/contexts/i18n-context";
import { isAdmin, normalizeRole, type UserRole } from "@/lib/roles";
import { isBrowserOnline } from "@/lib/network";
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

/** Upper bound for the background role re-check so a stuck read never lingers. */
const ROLE_CHECK_TIMEOUT_MS = 2_500;

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading, userRole } = useAuth();
  const router = useRouter();
  const { t } = useI18n();

  /**
   * The Firestore read below only CONFIRMS the role in the background. Until it
   * resolves (or if it fails) we already have AuthProvider's cached/live role,
   * so the guard never blocks navigation on a network read.
   */
  const [verification, setVerification] = useState<{ uid: string; role: UserRole } | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    const timeout = new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), ROLE_CHECK_TIMEOUT_MS);
    });

    void Promise.race([getDoc(doc(usersCollection, user.uid)), timeout])
      .then((snap) => {
        if (!isMounted || !snap || !snap.exists()) return;
        setVerification({ uid: user.uid, role: normalizeRole(snap.data().role) });
      })
      .catch(() => {
        // Offline / backend down: keep the cached role, never block the shell.
      });

    return () => {
      isMounted = false;
    };
  }, [user]);

  // Fresh read wins for the same uid; otherwise use the cached/live role.
  const role =
    verification && user && verification.uid === user.uid ? verification.role : userRole;

  useEffect(() => {
    // Offline: never hard-navigate (a full page load dies without network).
    if (!loading && !user && isBrowserOnline()) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (!user) return null;

  // Only restrict when the role is KNOWN to be insufficient. An unknown role
  // keeps the cached shell usable while the background scan resolves.
  if (role != null && !isAdmin(role)) {
    return (
      <div className="page-section">
        <Card className="border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-rose-900 dark:text-rose-100">
              <ShieldAlert className="h-5 w-5" />
              {t("admin.layout.restrictedTitle")}
            </CardTitle>
            <CardDescription className="text-rose-800 dark:text-rose-200">
              {t("admin.layout.restrictedDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-rose-800 dark:text-rose-200">
              {t("admin.layout.restrictedText")}
            </p>
            <div className="flex gap-2">
              <Button asChild variant="outline">
                <Link href="/">{t("admin.layout.backHome")}</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/settings">{t("admin.layout.goSettings")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
