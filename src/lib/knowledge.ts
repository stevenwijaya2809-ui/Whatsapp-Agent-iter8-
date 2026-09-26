import "server-only";
import { getSupabase } from "@/lib/supabase";

/** Entries in this category are always given to the model, so basics are never missing. */
const ESSENTIALS_CATEGORY = "essentials";

const MAX_MATCHES = 5;

export interface KnowledgeEntry {
  id: string;
  category: string;
  question: string;
  answer: string;
  tags: string[];
  updated_at: string;
}

export interface KnowledgeResult {
  entries: KnowledgeEntry[];
  /** True when the customer's question matched nothing beyond the essentials */
  miss: boolean;
}

/**
 * Finds the business knowledge relevant to a customer message: full-text matches plus the
 * essentials. A miss is reported so the caller can log a knowledge gap rather than let the
 * model fill the silence with an invention.
 */
export async function retrieveKnowledge(organizationId: string, question: string): Promise<KnowledgeResult> {
  const supabase = getSupabase();

  const essentialsQuery = supabase
    .from("kb_entries")
    .select("id, category, question, answer, tags, updated_at")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .eq("category", ESSENTIALS_CATEGORY);

  const search = question.trim();
  const matchesQuery = search
    ? supabase
        .from("kb_entries")
        .select("id, category, question, answer, tags, updated_at")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .textSearch("search", search, { type: "websearch", config: "simple" })
        .limit(MAX_MATCHES)
    : null;

  const [essentials, matches] = await Promise.all([essentialsQuery, matchesQuery]);
  if (essentials.error) throw new Error(`Failed to load knowledge: ${essentials.error.message}`);

  // A failed text search should degrade to the essentials rather than break the reply
  if (matches?.error) console.error("Knowledge search failed:", matches.error.message);

  const matched = (matches?.data ?? []) as KnowledgeEntry[];
  const ranked = rankByOverlap(matched, search);
  const byId = new Map<string, KnowledgeEntry>();
  for (const entry of [...ranked, ...((essentials.data ?? []) as KnowledgeEntry[])]) byId.set(entry.id, entry);

  return { entries: [...byId.values()], miss: ranked.length === 0 };
}

/**
 * Orders matches by how many of the customer's words appear in the entry. Postgres returns
 * matches unranked here; at a few dozen entries this is enough and keeps the query simple.
 */
export function rankByOverlap<T extends { question: string; answer: string; tags: string[] }>(
  entries: T[],
  question: string
): T[] {
  const words = new Set(
    question
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2)
  );
  if (words.size === 0) return entries;

  return [...entries]
    .map((entry) => {
      const haystack = `${entry.question} ${entry.answer} ${entry.tags.join(" ")}`.toLowerCase();
      let score = 0;
      for (const word of words) if (haystack.includes(word)) score++;
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry);
}
