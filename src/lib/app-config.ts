/**
 * Configuración centralizada de la aplicación.
 * Todas las referencias al nombre, logo e identidad de la app se derivan de aquí.
 *
 * Variables de entorno:
 * - NEXT_PUBLIC_APP_NAME: Nombre de la app (fallback: "LuzViva")
 * - NEXT_PUBLIC_APP_LOGO: Ruta del logo en /public (fallback: "" → solo texto)
 * - NEXT_PUBLIC_APP_ICON: URL completa de un icono (PNG/SVG) para PWA y pestaña del navegador
 *
 * Si APP_LOGO está vacío o no definido, la app se muestra solo con el nombre.
 */

export function getAppName(): string {
  if (typeof window !== "undefined") {
    return (
      (process.env as Record<string, string>).NEXT_PUBLIC_APP_NAME || "LuzViva"
    );
  }
  return process.env.NEXT_PUBLIC_APP_NAME || "LuzViva";
}

export function getAppLogo(): string {
  if (typeof window !== "undefined") {
    return (process.env as Record<string, string>).NEXT_PUBLIC_APP_LOGO || "";
  }
  return process.env.NEXT_PUBLIC_APP_LOGO || "";
}

/** Returns true if a custom logo is configured */
export function hasAppLogo(): boolean {
  return getAppLogo().length > 0;
}

/**
 * Icono para PWA y pestaña del navegador.
 * Debe ser una URL completa (https://...) a un PNG o SVG.
 * Si no se define, se usa /logo.svg como fallback.
 */
export function getAppIcon(): string {
  if (typeof window !== "undefined") {
    return (
      (process.env as Record<string, string>).NEXT_PUBLIC_APP_ICON ||
      "/logo.svg"
    );
  }
  return process.env.NEXT_PUBLIC_APP_ICON || "/logo.svg";
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
