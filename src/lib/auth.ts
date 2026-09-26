import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "dashboard_session";

const SESSION_DAYS = 7;

/** The dashboard is protected once DASHBOARD_PASSWORD is set. */
export function isAuthEnabled(): boolean {
  return Boolean(process.env.DASHBOARD_PASSWORD);
}

export function isCorrectPassword(password: unknown): boolean {
  if (typeof password !== "string" || !isAuthEnabled()) return false;
  // Comparing signatures keeps the comparison constant-length
  return safeEqual(sign(password), sign(process.env.DASHBOARD_PASSWORD!));
}

/** Cookie value for a signed in operator: "<expiry>.<signature>". */
export function createSession(): { value: string; maxAge: number } {
  const expiresAt = Date.now() + SESSION_DAYS * 86_400_000;
  return { value: `${expiresAt}.${sign(String(expiresAt))}`, maxAge: SESSION_DAYS * 86_400 };
}

export function isValidSession(cookieValue: string | undefined): boolean {
  if (!cookieValue || !isAuthEnabled()) return false;

  const [expiry, signature] = cookieValue.split(".");
  if (!expiry || !signature) return false;
  if (!(Number(expiry) > Date.now())) return false;

  return safeEqual(signature, sign(expiry));
}

/** Signed with the password itself, so changing the password signs everyone out. */
function sign(value: string): string {
  return createHmac("sha256", process.env.DASHBOARD_PASSWORD ?? "").update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
