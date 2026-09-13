import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

/** Gateway errors that are usually transient */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

let client: SupabaseClient | null = null;

/**
 * Server-side Supabase client using the service role key, which bypasses RLS.
 * Created on first use so a missing env var fails the request instead of the build.
 */
export function getSupabase(): SupabaseClient {
  client ??= createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithRetry },
    }
  );
  return client;
}

/**
 * Retries a read once when it fails at the network level or with a gateway error.
 * Writes are not retried, because the first attempt may already have been applied.
 */
async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? "GET";
  if (method !== "GET" && method !== "HEAD") return fetch(input, init);

  try {
    const res = await fetch(input, init);
    if (!RETRYABLE_STATUSES.has(res.status)) return res;
    await res.body?.cancel();
  } catch (error) {
    if (init?.signal?.aborted) throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  return fetch(input, init);
}
