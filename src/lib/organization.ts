import "server-only";
import { getSupabase } from "@/lib/supabase";

/** The single organization until multi-tenancy arrives; every table already carries the column. */
export const DEFAULT_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

/** Business settings are edited in the database, so they change without a deploy. */
export interface BusinessProfile {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  /** Opening and closing hour per weekday abbreviation; null means closed */
  hours?: Record<string, [number, number] | null>;
}

export interface AiSettings {
  personality?: string;
  /** Below this, a reply is treated as uncertain and escalated */
  confidenceThreshold?: number;
  escalateOnComplaint?: boolean;
  /** Seeded but not yet enforced: the assistant answers at any hour. See docs/CHANGELOG_AI_UPGRADE.md */
  afterHoursReply?: boolean;
}

export interface Organization {
  id: string;
  name: string;
  timezone: string;
  business: BusinessProfile;
  ai: AiSettings;
}

const CACHE_MS = 60_000;

let cached: { value: Organization; at: number } | null = null;

/**
 * Loads the organization, cached briefly so a burst of messages does not
 * re-read settings on every turn. Settings edits appear within a minute.
 */
export async function getOrganization(): Promise<Organization> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const { data, error } = await getSupabase()
    .from("organizations")
    .select("id, name, timezone, settings")
    .eq("id", DEFAULT_ORGANIZATION_ID)
    .maybeSingle();
  if (error) throw new Error(`Failed to load organization: ${error.message}`);
  if (!data) throw new Error("No organization row found. Run supabase/migrations/0001_foundation.sql.");

  const settings = (data.settings ?? {}) as { business?: BusinessProfile; ai?: AiSettings };
  const value: Organization = {
    id: data.id,
    name: data.name,
    timezone: data.timezone,
    business: { name: data.name, ...settings.business },
    ai: settings.ai ?? {},
  };

  cached = { value, at: Date.now() };
  return value;
}

/** Drops the cache, for tests and for settings pages that need to show their own write. */
export function clearOrganizationCache(): void {
  cached = null;
}
