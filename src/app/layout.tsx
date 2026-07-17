import type { Metadata } from "next";
import { PT_Sans } from "next/font/google";
import "./globals.css";
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { I18nProvider } from "@/contexts/i18n-context";
import { JsonLd } from "@/components/seo/json-ld";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { getAppName, getAppDescription, getSiteUrl, getAppIcon } from "@/lib/app-config";

const isDevelopment = process.env.NODE_ENV === "development";
const appName = getAppName();
const appDescription = getAppDescription();
const siteUrl = getSiteUrl();
const appIcon = getAppIcon();
const localIcon = "/api/icon";

const ptSans = PT_Sans({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a2e" },
  ],
};

export const metadata: Metadata = {
  // ── Título & Descripción ───────────────────────────────────────────
  title: {
    template: `%s | ${appName}`,
    default: appName,
  },
  description: appDescription,
  keywords: [
    "gestión de quórum",
    "gestión de sociedad de socorro",
    "presidencia de quórum",
    "presidencia de sociedad de socorro",
    "quorum de elderes",
    "sociedad de socorro",
    "relief society",
    "ministerio",
    "obra misional",
    "conversos",
    "miembros",
    "informes de iglesia",
    "consejo de barrio",
    "administración eclesiástica",
  ],
  category: "productivity",
  generator: "Next.js",

  // ── Metadata Base ───────────────────────────────────────────────────
  metadataBase: new URL(siteUrl),

  // ── Canonical & Alternates (hreflang for SEO locales) ──────────────
  alternates: {
    canonical: siteUrl,
    languages: {
      es: `${siteUrl}/es`,
      en: `${siteUrl}/en`,
      "x-default": siteUrl,
    },
  },

  // ── Robots ──────────────────────────────────────────────────────────
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },

  // ── Icons ───────────────────────────────────────────────────────────
  // Prefer sized assets under /icons (small, real 192/512). The legacy
  // /icono-app.png is multi‑MB and breaks/hangs PWA install on mobile Chrome.
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: localIcon, sizes: "any" },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    other: [
      {
        rel: "mask-icon",
        url: "/icons/icon-192.png",
      },
    ],
  },

  // ── PWA / Apple ─────────────────────────────────────────────────────
  manifest: "/manifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: appName,
    startupImage: ["/icons/apple-touch-icon.png"],
  },

  // ── Verificaciones de Webmaster ─────────────────────────────────────
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
  },

  // ── Otros meta tags ─────────────────────────────────────────────────
  other: {
    "google": "notranslate",
    "rating": "General",
    "referrer": "origin-when-cross-origin",
  },

  // ── Open Graph ─────────────────────────────────────────────────────
  openGraph: {
    title: {
      template: `%s | ${appName}`,
      default: appName,
    },
    description: appDescription,
    url: siteUrl,
    siteName: appName,
    type: "website",
    locale: "es_EC",
    images: [
      {
        url: appIcon,
        width: 512,
        height: 512,
        alt: appName,
        type: "image/png",
      },
      {
        url: localIcon,
        width: 512,
        height: 512,
        alt: appName,
      },
    ],
  },

  // ── Twitter Cards ──────────────────────────────────────────────────
  twitter: {
    card: "summary",
    title: appName,
    description: appDescription,
    images: [appIcon, localIcon],
    creator: "@sionflow",
    site: "@sionflow",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning translate="no">
      <body className={`${ptSans.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <I18nProvider>
            <JsonLd />
            {/* SW early: so shell/routes/images can cache even before login.
                In development, ServiceWorkerRegistration also unregisters SW/caches
                (do not inject a raw <script> here — React 19 never executes it on the client). */}
            <ServiceWorkerRegistration />
            {children}
            <Toaster />
            {!isDevelopment && <Analytics />}
            {!isDevelopment && <SpeedInsights />}
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
