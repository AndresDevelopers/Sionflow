/**
 * Configuración centralizada de la aplicación.
 * Todas las referencias al nombre, logo e identidad de la app se derivan de aquí.
 *
 * Variables de entorno:
 * - NEXT_PUBLIC_APP_NAME: Nombre de la app (fallback: "sionflow")
 * - NEXT_PUBLIC_APP_LOGO: Ruta del logo en /public (fallback: "/logo.png")
 * - NEXT_PUBLIC_APP_ICON: URL completa de un icono (PNG/SVG) para PWA y pestaña del navegador (fallback: "/icono-app.png")
 */

export function getAppName(): string {
  if (typeof window !== "undefined") {
    return (
      (process.env as Record<string, string>).NEXT_PUBLIC_APP_NAME || "sionflow"
    );
  }
  return process.env.NEXT_PUBLIC_APP_NAME || "sionflow";
}

export function getAppLogo(): string {
  if (typeof window !== "undefined") {
    return (process.env as Record<string, string>).NEXT_PUBLIC_APP_LOGO || "/logo.png";
  }
  return process.env.NEXT_PUBLIC_APP_LOGO || "/logo.png";
}

/** Returns true if a custom logo is configured (different from the default) */
export function hasAppLogo(): boolean {
  const logo = getAppLogo();
  return logo.length > 0 && logo !== "/logo.png";
}

/**
 * Icono para PWA y pestaña del navegador.
 * Debe ser una URL completa (https://...) a un PNG o SVG.
 * Si no se define, se usa /icono-app.png como fallback.
 */
export function getAppIcon(): string {
  if (typeof window !== "undefined") {
    return (
      (process.env as Record<string, string>).NEXT_PUBLIC_APP_ICON ||
      "/icono-app.png"
    );
  }
  return process.env.NEXT_PUBLIC_APP_ICON || "/icono-app.png";
}

/**
 * Nombre normalizado para keys de storage (localStorage, IndexedDB, etc.).
 * Convierte el nombre de la app a un slug seguro (lowercase, sin espacios).
 */
export function getAppStoragePrefix(): string {
  return getAppName().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Tag base para notificaciones push y FCM analytics.
 */
export function getAppNotificationTag(): string {
  return `${getAppStoragePrefix()}-notification`;
}

/** Descripción de la app para SEO, OG y metadata. */
export function getAppDescription(): string {
  if (typeof window !== "undefined") {
    return (
      (process.env as Record<string, string>).NEXT_PUBLIC_APP_DESCRIPTION ||
      "Sistema de gestión para presidencias de Quorum de Elderes y Sociedad de Socorro. Administración de miembros, conversos, ministerio, obra misional, informes y consejo con IA integrada."
    );
  }
  return (
    process.env.NEXT_PUBLIC_APP_DESCRIPTION ||
    "Sistema de gestión para presidencias de Quorum de Elderes y Sociedad de Socorro. Administración de miembros, conversos, ministerio, obra misional, informes y consejo con IA integrada."
  );
}

/** URL canónica del sitio para SEO, sitemaps y OG. */
export function getSiteUrl(): string {
  if (typeof window !== "undefined") {
    return (
      (process.env as Record<string, string>).NEXT_PUBLIC_SITE_URL ||
      "https://sionflow.dev"
    );
  }
  return process.env.NEXT_PUBLIC_SITE_URL || "https://sionflow.dev";
}
