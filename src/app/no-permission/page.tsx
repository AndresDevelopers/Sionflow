"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { signOut } from "firebase/auth";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/i18n-context";

export default function NoPermissionPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      const { auth } = await import("@/lib/firebase");
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("Error signing out", error);
      setIsSigningOut(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted px-6 py-12">
      <div className="w-full max-w-md space-y-6 rounded-2xl bg-background p-8 text-center shadow-lg">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-10 w-10" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 className="text-balance text-fluid-title font-semibold">{t("noPermission.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("noPermission.description")}</p>
          <p className="text-sm text-muted-foreground">{t("noPermission.support")}</p>
        </div>
        <Button
          onClick={handleSignOut}
          size="lg"
          className="w-full"
          disabled={isSigningOut}
        >
          {isSigningOut ? t("noPermission.logoutLoading") : t("noPermission.logout")}
        </Button>
      </div>
    </div>
  );
}
