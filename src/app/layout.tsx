import type { Metadata } from "next";
import { PT_Sans } from "next/font/google";
import "./globals.css";
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { I18nProvider } from "@/contexts/i18n-context";

const isDevelopment = process.env.NODE_ENV === "development";

const ptSans = PT_Sans({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "QuorumFlow",
  description: "Management tool for the Elders Quorum secretary.",
  manifest: "/manifest.json",
  other: {
    "google": "notranslate",
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
