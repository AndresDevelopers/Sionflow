import { NextResponse } from "next/server";
import { getAppName, hasAppLogo, getAppLogo, getAppIcon } from "@/lib/app-config";

const appName = getAppName();
const shortName = appName.length > 12 ? appName.slice(0, 12) : appName;
const appLogo = getAppLogo();
const hasLogo = hasAppLogo();
const appIcon = getAppIcon();

function getIconType(src: string): string {
  const path = src.split("?")[0];
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".ico")) return "image/x-icon";
  return "image/svg+xml";
}

// Siempre incluir logo.svg como fallback confiable
const FALLBACK_ICON = "/logo.svg";

export async function GET() {
  const primaryIcon = hasLogo ? appLogo : FALLBACK_ICON;

  const iconType = getIconType(appIcon);

  const icons = [
    {
      src: appIcon,
      sizes: "512x512",
      type: iconType,
      purpose: "any",
    },
    {
      src: appIcon,
      sizes: "512x512",
      type: iconType,
      purpose: "maskable",
    },
  ];

  const manifest = {
    name: appName,
    short_name: shortName,
    description: "Sistema completo de gestión para la presidencia del quórum.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#ffffff",
    theme_color: "#5B21B6",
    categories: ["productivity", "utilities"],
    lang: "es",
    scope: "/",
    icons,
    // Screenshots solo si hay un logo personalizado (el fallback no sirve como screenshot)
    screenshots: hasLogo
      ? [
          {
            src: appLogo,
            sizes: "540x720",
            type: "image/svg+xml",
            form_factor: "narrow",
          },
        ]
      : [],
    shortcuts: [
      {
        name: "Dashboard",
        short_name: "Dashboard",
        description: "Panel principal",
        url: "/dashboard",
        icons: [{ src: primaryIcon, sizes: "96x96" }],
      },
      {
        name: "Miembros",
        short_name: "Miembros",
        description: "Gestionar miembros del quórum",
        url: "/members",
        icons: [{ src: primaryIcon, sizes: "96x96" }],
      },
      {
        name: "Consejo",
        short_name: "Consejo",
        description: "Ver elementos del consejo",
        url: "/council",
        icons: [{ src: primaryIcon, sizes: "96x96" }],
      },
    ],
    prefer_related_applications: false,
    related_applications: [],
    edge_side_panel: {
      preferred_width: 400,
    },
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
