"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAppLogo, getAppName } from "@/lib/app-config";
import {
  ensureServerSession,
  hardNavigate,
} from "@/lib/auth-session-client";
import type { SeoLandingCopy, SeoLocale } from "@/lib/seo-locales";
import { setDateFnsLocale } from "@/lib/i18n-date";
import { CheckCircle2 } from "lucide-react";

type Props = {
  locale: SeoLocale;
  copy: SeoLandingCopy;
};

/**
 * Public SEO landing for /es and /en.
 * Sets UI language for returning users and, if already signed in with a valid
 * proxy cookie, sends them to the app shell.
 */
export function LocaleLanding({ locale, copy }: Props) {
  const router = useRouter();
  const appName = getAppName();

  useEffect(() => {
    try {
      localStorage.setItem("language", locale);
      setDateFnsLocale(locale);
    } catch {
      // private mode
    }
  }, [locale]);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      try {
        const ok = await ensureServerSession((force) => user.getIdToken(force));
        if (ok) {
          hardNavigate("/");
        }
      } catch {
        // stay on landing; user can use login CTA
      }
    });
    return () => unsub();
  }, []);

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-background p-4">
      <div className="absolute right-4 top-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={copy.switchLangHref} hrefLang={locale === "es" ? "en" : "es"}>
            {copy.switchLangLabel}
          </Link>
        </Button>
      </div>

      <div className="w-full max-w-2xl space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Image
              src={getAppLogo()}
              alt={appName}
              width={40}
              height={40}
              className="h-10 w-10"
              priority
            />
            <span className="text-2xl">{appName}</span>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {copy.headline}
          </h1>
          <p className="max-w-xl text-muted-foreground">{copy.subheadline}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{copy.featuresTitle}</CardTitle>
            <CardDescription>{copy.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ul className="space-y-3">
              {copy.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button className="flex-1" asChild>
                <Link href={`/login?next=/`}>{copy.ctaLogin}</Link>
              </Button>
              <Button className="flex-1" variant="outline" asChild>
                <Link href="/register">{copy.ctaRegister}</Link>
              </Button>
            </div>

            <p className="text-center text-sm text-muted-foreground">
              {copy.alreadyHaveAccount}{" "}
              <button
                type="button"
                className="underline"
                onClick={() => router.push("/login")}
              >
                {copy.ctaLogin}
              </button>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
