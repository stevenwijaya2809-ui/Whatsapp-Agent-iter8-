import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, createSession, isAuthEnabled, isCorrectPassword } from "@/lib/auth";
import { errorResponse } from "@/lib/http";

/** Slows down password guessing a little. */
const WRONG_PASSWORD_DELAY_MS = 400;

export async function POST(request: NextRequest) {
  if (!isAuthEnabled()) {
    return errorResponse("DASHBOARD_PASSWORD is not set on the server", 503);
  }

  const body = await request.json().catch(() => null);

  if (!isCorrectPassword(body?.password)) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));
    return errorResponse("Wrong password", 401);
  }

  const session = createSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: session.value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: session.maxAge,
  });
  return response;
}
