import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  fetchSafeRemoteImage,
  UnsafeUrlError,
} from "@/lib/safe-remote-url";

/**
 * Proxy download for the donation QR image.
 * SSRF-hardened: https only, host allowlist (Firebase Storage / GCS / site),
 * no redirects, image content-type, size cap.
 *
 * Note: used via <a href> from the donate page, so Bearer auth is not required;
 * safety relies on the allowlist rather than an open proxy.
 */
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "api");
  if (limited) return limited;

  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  try {
    const { buffer, contentType } = await fetchSafeRemoteImage(url, {
      timeoutMs: 10_000,
      maxBytes: 5 * 1024 * 1024,
    });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="qr-donacion.png"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Failed to download image" },
      { status: 500 }
    );
  }
}
