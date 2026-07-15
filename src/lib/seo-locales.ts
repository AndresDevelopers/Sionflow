/**
 * Public SEO locale landings (/es, /en).
 * These routes are intentionally unauthenticated so crawlers can index them.
 */

export const SEO_LOCALES = ["es", "en"] as const;
export type SeoLocale = (typeof SEO_LOCALES)[number];

export function isSeoLocale(value: string): value is SeoLocale {
  return (SEO_LOCALES as readonly string[]).includes(value);
}

export function seoLocalePath(locale: SeoLocale): string {
  return `/${locale}`;
}

export type SeoLandingCopy = {
  locale: SeoLocale;
  htmlLang: string;
  openGraphLocale: string;
  title: string;
  description: string;
  headline: string;
  subheadline: string;
  featuresTitle: string;
  features: string[];
  ctaLogin: string;
  ctaRegister: string;
  ctaDashboard: string;
  alreadyHaveAccount: string;
  switchLangLabel: string;
  switchLangHref: string;
};

const COPY: Record<SeoLocale, SeoLandingCopy> = {
  es: {
    locale: "es",
    htmlLang: "es",
    openGraphLocale: "es_EC",
    title: "Gestión para Quórum de Élderes y Sociedad de Socorro",
    description:
      "SionFlow es un sistema de gestión integral para presidencias del Quórum de Élderes y la Sociedad de Socorro: miembros, conversos, ministerio, obra misional, informes y consejo con IA.",
    headline: "Gestión integral para tu presidencia",
    subheadline:
      "Administra miembros, conversos, ministerio, obra misional, informes y el consejo de barrio en un solo lugar, con soporte multiidioma y app instalable.",
    featuresTitle: "Qué puedes hacer",
    features: [
      "Seguimiento de miembros, conversos y futuros miembros",
      "Compañerismos de ministerio y visitas urgentes",
      "Obra misional, amistades e informes de actividad",
      "Consejo de barrio, observaciones y cumpleaños",
      "Chat con IA para consultas doctrinales y administrativas",
      "PWA con notificaciones y uso parcial sin conexión",
    ],
    ctaLogin: "Iniciar sesión",
    ctaRegister: "Crear cuenta",
    ctaDashboard: "Ir al panel",
    alreadyHaveAccount: "¿Ya tienes cuenta?",
    switchLangLabel: "English",
    switchLangHref: "/en",
  },
  en: {
    locale: "en",
    htmlLang: "en",
    openGraphLocale: "en_US",
    title: "Elders Quorum & Relief Society Leadership Tools",
    description:
      "SionFlow is an all-in-one management system for Elders Quorum and Relief Society presidencies: members, converts, ministering, missionary work, reports, and AI-assisted council tools.",
    headline: "Complete tools for your presidency",
    subheadline:
      "Manage members, converts, ministering, missionary work, reports, and ward council in one place — multilingual and installable as a PWA.",
    featuresTitle: "What you can do",
    features: [
      "Track members, converts, and future members",
      "Ministering companionships and urgent visits",
      "Missionary work, friendships, and activity reports",
      "Ward council, observations, and birthdays",
      "AI chat for doctrinal and administrative questions",
      "Installable PWA with push and partial offline use",
    ],
    ctaLogin: "Log in",
    ctaRegister: "Create account",
    ctaDashboard: "Open dashboard",
    alreadyHaveAccount: "Already have an account?",
    switchLangLabel: "Español",
    switchLangHref: "/es",
  },
};

export function getSeoLandingCopy(locale: SeoLocale): SeoLandingCopy {
  return COPY[locale];
}
