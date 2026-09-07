import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// middleware.ts was renamed to proxy.ts in Next.js 16 — same behavior, new
// file/export name. See node_modules/next/dist/docs/.../proxy.md.
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) return NextResponse.next();

  const url = new URL("/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Everything except: the login page itself, auth API routes (needed to
    // log in at all), Next internals, and static files in public/.
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico|samples/).*)",
  ],
};
