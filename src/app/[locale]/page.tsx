import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LocaleLanding } from "@/components/seo/locale-landing";
import { getAppName, getAppIcon, getSiteUrl } from "@/lib/app-config";
import {
  getSeoLandingCopy,
  isSeoLocale,
  SEO_LOCALES,
  type SeoLocale,
} from "@/lib/seo-locales";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return SEO_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  if (!isSeoLocale(raw)) {
    return {};
  }
  const locale = raw as SeoLocale;
  const copy = getSeoLandingCopy(locale);
  const siteUrl = getSiteUrl();
  const appName = getAppName();
  const appIcon = getAppIcon();
  const path = `/${locale}`;

  return {
    title: copy.title,
    description: copy.description,
    alternates: {
      canonical: `${siteUrl}${path}`,
      languages: {
        es: `${siteUrl}/es`,
        en: `${siteUrl}/en`,
        "x-default": siteUrl,
      },
    },
    openGraph: {
      title: `${copy.title} | ${appName}`,
      description: copy.description,
      url: `${siteUrl}${path}`,
      locale: copy.openGraphLocale,
      alternateLocale: locale === "es" ? ["en_US"] : ["es_EC"],
      siteName: appName,
      type: "website",
      images: [
        {
          url: appIcon,
          width: 512,
          height: 512,
          alt: appName,
        },
      ],
    },
    twitter: {
      card: "summary",
      title: `${copy.title} | ${appName}`,
      description: copy.description,
      images: [appIcon],
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function SeoLocalePage({ params }: PageProps) {
  const { locale: raw } = await params;
  if (!isSeoLocale(raw)) {
    notFound();
  }
  const locale = raw as SeoLocale;
  const copy = getSeoLandingCopy(locale);

  return (
    <main lang={copy.htmlLang}>
      <LocaleLanding locale={locale} copy={copy} />
    </main>
  );
}
