import { NextResponse } from "next/server";
import { getAppName } from "@/lib/app-config";

const appName = getAppName();
const shortName = appName.length > 12 ? appName.slice(0, 12) : appName;

/**
 * Sized icons under /public/icons — real 192/512 PNGs (not a multi‑MB source
 * mislabeled as 192/512). Chrome Android often hangs or fails the first
 * install attempt when the manifest icon is multi‑MB.
 */
const ICON_192 = "/icons/icon-192.png";
const ICON_512 = "/icons/icon-512.png";
const ICON_MASKABLE_192 = "/icons/icon-maskable-192.png";
const ICON_MASKABLE_512 = "/icons/icon-maskable-512.png";

export const revalidate = 86400;

export async function GET() {
  const icons = [
    {
      src: ICON_192,
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: ICON_512,
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: ICON_MASKABLE_192,
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: ICON_MASKABLE_512,
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ];

  const manifest = {
    id: "/",
    name: appName,
    short_name: shortName,
    description: "Sistema de gestión integral para presidencias del Quorum de Elderes y Sociedad de Socorro.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#ffffff",
    theme_color: "#5B21B6",
    categories: ["productivity", "utilities"],
    lang: "es",
    scope: "/",
    icons,
    shortcuts: [
      {
        name: "Inicio",
        short_name: "Inicio",
        description: "Panel principal",
        url: "/",
        icons: [{ src: ICON_192, sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Miembros",
        short_name: "Miembros",
        description: "Gestionar miembros del quórum y sociedad de socorro",
        url: "/members",
        icons: [{ src: ICON_192, sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Consejo",
        short_name: "Consejo",
        description: "Ver elementos del consejo",
        url: "/council",
        icons: [{ src: ICON_192, sizes: "192x192", type: "image/png" }],
      },
    ],
    prefer_related_applications: false,
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      // Short browser cache so icon path fixes deploy quickly on mobile.
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
