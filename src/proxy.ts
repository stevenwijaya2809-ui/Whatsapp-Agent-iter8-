import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isAuthEnabled, isValidSession } from "@/lib/auth";

/**
 * Runs on everything except Meta's webhook (which must stay public), the login
 * page and its routes, and Next.js' own assets.
 */
export const config = {
  matcher: ["/((?!api/webhook|api/auth|login|_next/static|_next/image|favicon.ico).*)"],
};

export function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname.startsWith("/api/");

  if (!isAuthEnabled()) {
    // Locked rather than public, so a missing password can't expose conversations
    if (process.env.NODE_ENV === "production") {
      const message = "DASHBOARD_PASSWORD is not set, so the dashboard is locked. Set it in your environment variables and redeploy.";
      return isApiRequest
        ? NextResponse.json({ error: message }, { status: 503 })
        : new NextResponse(message, { status: 503, headers: { "Content-Type": "text/plain" } });
    }
    return NextResponse.next();
  }

  if (isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (isApiRequest) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  if (request.nextUrl.pathname !== "/") {
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
  }
  return NextResponse.redirect(loginUrl);
}
