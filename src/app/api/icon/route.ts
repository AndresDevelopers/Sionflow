import { NextResponse } from "next/server";
import { getAppIcon } from "@/lib/app-config";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = 86400;

let cachedBuffer: Buffer | null = null;
let cachedContentType = "image/png";

export async function GET(request: Request) {
  if (cachedBuffer) {
    return new NextResponse(cachedBuffer, {
      headers: {
        "Content-Type": cachedContentType,
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  }

  const iconUrl = getAppIcon();

  if (!iconUrl || iconUrl === "/logo.svg") {
    const url = new URL(request.url);
    return NextResponse.redirect(`${url.origin}/logo.svg`);
  }

  try {
    const res = await fetch(iconUrl);
    if (!res.ok) throw new Error(`Failed to fetch icon: ${res.status}`);

    cachedBuffer = Buffer.from(await res.arrayBuffer());
    cachedContentType = res.headers.get("content-type") || "image/png";

    return new NextResponse(cachedBuffer, {
      headers: {
        "Content-Type": cachedContentType,
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    const url = new URL(request.url);
    return NextResponse.redirect(`${url.origin}/logo.svg`);
  }
}
