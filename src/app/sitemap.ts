import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/app-config";

/**
 * Sitemap dinámico para crawlers e IA.
 * Lista todas las rutas indexables de la aplicación.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const lastModified = new Date();

  const staticRoutes = [
    { path: "", priority: 1.0, changeFrequency: "weekly" as const },
    // Public SEO locale landings (hreflang targets)
    { path: "/es", priority: 1.0, changeFrequency: "weekly" as const },
    { path: "/en", priority: 1.0, changeFrequency: "weekly" as const },
    { path: "/login", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/register", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/forgot-password", priority: 0.3, changeFrequency: "monthly" as const },
    { path: "/members", priority: 0.9, changeFrequency: "daily" as const },
    { path: "/converts", priority: 0.9, changeFrequency: "daily" as const },
    { path: "/ministering", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/ministering/urgent", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/missionary-work", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/reports/activities", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/service", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/birthdays", priority: 0.7, changeFrequency: "daily" as const },
    { path: "/church-chat", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/council", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/donate", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/family-search", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/observations", priority: 0.6, changeFrequency: "weekly" as const },
    { path: "/profile", priority: 0.5, changeFrequency: "monthly" as const },
    { path: "/settings", priority: 0.4, changeFrequency: "monthly" as const },
    { path: "/admin", priority: 0.3, changeFrequency: "monthly" as const },
  ];

  return staticRoutes.map((route) => ({
    url: `${siteUrl}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
