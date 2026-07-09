import { NextResponse } from "next/server";
import { getAppName } from "@/lib/app-config";

const appName = getAppName();
const shortName = appName.length > 12 ? appName.slice(0, 12) : appName;

const LOCAL_ICON = "/api/icon";

export const revalidate = 86400;

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
  ];

  const manifest = {
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
        name: "Dashboard",
        short_name: "Dashboard",
        description: "Panel principal",
        url: "/dashboard",
        icons: [{ src: LOCAL_ICON, sizes: "96x96" }],
      },
      {
        name: "Miembros",
        short_name: "Miembros",
        description: "Gestionar miembros del quórum y sociedad de socorro",
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
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
