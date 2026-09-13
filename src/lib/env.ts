import "server-only";

/** Reads a required server environment variable, failing with a clear message when it is missing. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Add it to .env.local (see .env.example).`);
  }
  return value;
}
