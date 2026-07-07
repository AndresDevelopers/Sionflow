import { NextResponse } from "next/server";
import { getAppName, hasAppLogo } from "@/lib/app-config";

const appName = getAppName();
const shortName = appName.length > 12 ? appName.slice(0, 12) : appName;
const hasLogo = hasAppLogo();

const LOCAL_ICON = "/api/icon";

export async function GET() {

  const icons = [
    {
      src: LOCAL_ICON,
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: LOCAL_ICON,
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: LOCAL_ICON,
      sizes: "512x512",
      type: "image/png",
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
    screenshots: hasLogo
      ? [
          {
            src: LOCAL_ICON,
            sizes: "540x720",
            type: "image/png",
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
        icons: [{ src: LOCAL_ICON, sizes: "96x96" }],
      },
      {
        name: "Miembros",
        short_name: "Miembros",
        description: "Gestionar miembros del quórum",
        url: "/members",
        icons: [{ src: LOCAL_ICON, sizes: "96x96" }],
      },
      {
        name: "Consejo",
        short_name: "Consejo",
        description: "Ver elementos del consejo",
        url: "/council",
        icons: [{ src: LOCAL_ICON, sizes: "96x96" }],
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
