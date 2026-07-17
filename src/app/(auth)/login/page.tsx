
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/contexts/i18n-context";
import { InstallPrompt } from "@/components/install-prompt";
import {
  canAttemptAuthRedirect,
  ensureServerSession,
  hardNavigate,
} from "@/lib/auth-session-client";

const loginSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
  password: z
    .string()
    .min(1, { message: "Password is required." }),
});

/**
 * Safe post-login destination.
 * /es and /en are public SEO landings — after auth go to the app shell (/)
 * and persist the language preference for the UI.
 */
function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  const pathOnly = next.split("?")[0]?.split("#")[0] || "/";

  if (pathOnly === "/es" || pathOnly === "/en") {
    try {
      localStorage.setItem("language", pathOnly.slice(1));
    } catch {
      // ignore
    }
    return "/";
  }

  if (
    pathOnly === "/login" ||
    pathOnly === "/register" ||
    pathOnly === "/forgot-password" ||
    pathOnly.startsWith("/api") ||
    pathOnly.startsWith("/_next") ||
    // Platform admin is only for isAppAdmin; that branch hard-navigates separately.
    // Never dump a ward user into /app-admin/* via ?next=.
    pathOnly === "/app-admin" ||
    pathOnly.startsWith("/app-admin/")
  ) {
    return "/";
  }
  return next;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { t } = useI18n();
  /** Prevent race: onAuthStateChanged and onSubmit both try to navigate. */
  const navigatingRef = useRef(false);
  const [restoringSession, setRestoringSession] = useState(true);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  // If Firebase already has a session but the Edge cookie is missing/expired,
  // re-mint the cookie and continue (avoids forcing a second password entry).
  // Only hard-navigate after the cookie is confirmed — never change the URL
  // optimistically (that left production stuck on a protected route without cookie).
  useEffect(() => {
    if (!auth) {
      setRestoringSession(false);
      return;
    }

    let cancelled = false;
    // Don't leave the form blocked forever if Auth is slow.
    const restoreTimeout = window.setTimeout(() => {
      if (!cancelled && !navigatingRef.current) {
        setRestoringSession(false);
      }
    }, 6000);

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (cancelled) return;

      if (!user) {
        setRestoringSession(false);
        return;
      }

      if (navigatingRef.current) return;

      if (!canAttemptAuthRedirect()) {
        // Break /login ↔ / loops when cookie mint works but Edge verify fails.
        setRestoringSession(false);
        toast({
          title: t("login.toastErrorTitle"),
          description: t("login.toastErrorSessionCookie"),
          variant: "destructive",
        });
        return;
      }

      navigatingRef.current = true;
      try {
        const ok = await ensureServerSession((force) => user.getIdToken(force));
        if (cancelled) return;

        if (!ok) {
          navigatingRef.current = false;
          setRestoringSession(false);
          return;
        }

        // Super admin → platform panel
        try {
          const token = await user.getIdToken();
          const meRes = await fetch("/api/app-admin/me", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (meRes.ok) {
            const me = (await meRes.json()) as { ok?: boolean };
            if (me.ok) {
              hardNavigate("/app-admin/panel");
              return;
            }
          }
        } catch {
          // continue to normal app
        }

        hardNavigate(safeNextPath(searchParams.get("next")));
      } catch {
        if (!cancelled) {
          navigatingRef.current = false;
          setRestoringSession(false);
        }
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(restoreTimeout);
      unsub();
    };
  }, [searchParams, t, toast]);

  const onSubmit = async (values: z.infer<typeof loginSchema>) => {
    // Prevent double submission + race with onAuthStateChanged
    if (navigatingRef.current) return;
    navigatingRef.current = true;

    try {
      const cred = await signInWithEmailAndPassword(
        auth,
        values.email,
        values.password
      );

      // Proxy session cookie is REQUIRED for full document navigations in prod.
      const sessionOk = await ensureServerSession((force) =>
        cred.user.getIdToken(force)
      );
      if (!sessionOk) {
        navigatingRef.current = false;
        toast({
          title: t("login.toastErrorTitle"),
          description: t("login.toastErrorSessionCookie"),
          variant: "destructive",
        });
        return;
      }

      // Super admin solo usa el panel /app-admin
      try {
        const token = await cred.user.getIdToken();
        const meRes = await fetch("/api/app-admin/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (meRes.ok) {
          const me = (await meRes.json()) as { ok?: boolean };
          if (me.ok) {
            toast({
              title: t("login.toastSuccessTitle"),
              description: "Redirigiendo al panel de admin general…",
            });
            hardNavigate("/app-admin/panel");
            return;
          }
        }
      } catch {
        // si falla la comprobación, continúa al flujo normal de la app
      }

      toast({
        title: t("login.toastSuccessTitle"),
        description: t("login.toastSuccessDescription"),
      });
      hardNavigate(safeNextPath(searchParams.get("next")));
    } catch (error: any) {
      navigatingRef.current = false;
      console.error("Login Error:", error);

      let description = t("login.toastErrorUnexpected");

      // Manejo específico de errores de Firebase
      switch (error.code) {
        case "auth/invalid-credential":
        case "auth/user-not-found":
        case "auth/wrong-password":
          description = t("login.toastErrorInvalidCredentials");
          break;
        case "auth/user-disabled":
          description = t("login.toastErrorUserDisabled");
          break;
        case "auth/too-many-requests":
          description = t("login.toastErrorTooManyRequests");
          break;
        case "auth/network-request-failed":
          description = t("login.toastErrorNetwork");
          break;
        case "auth/invalid-email":
          description = t("login.toastErrorInvalidEmail");
          break;
        default:
          description = t("login.toastErrorUnexpected");
      }

      toast({
        title: t("login.toastErrorTitle"),
        description: description,
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <p className="mb-6 text-center text-sm text-muted-foreground">
        {t("login.subtitle")}
      </p>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t("login.title")}</CardTitle>
          <CardDescription>{t("login.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {restoringSession ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("login.restoringSession")}
            </p>
          ) : (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("login.emailLabel")}</FormLabel>
                      <FormControl>
                        <Input placeholder="m@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center">
                        <FormLabel>{t("login.passwordLabel")}</FormLabel>
                        <Link
                          href="/forgot-password"
                          className="ml-auto inline-block text-sm underline"
                        >
                          {t("login.forgotPassword")}
                        </Link>
                      </div>
                      <FormControl>
                        <Input type="password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting
                    ? t("login.submitButtonLoading")
                    : t("login.submitButton")}
                </Button>
              </form>
            </Form>
          )}
          <div className="mt-4 text-center text-sm">
            {t("login.noAccount")}{" "}
            <Link href="/register" className="underline">
              {t("login.registerLink")}
            </Link>
          </div>
        </CardContent>
      </Card>
      <InstallPrompt />
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">…</CardTitle>
            <CardDescription>Loading…</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="h-10 rounded-md bg-muted animate-pulse" />
              <div className="h-10 rounded-md bg-muted animate-pulse" />
              <div className="h-10 rounded-md bg-muted animate-pulse" />
            </div>
          </CardContent>
        </Card>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
