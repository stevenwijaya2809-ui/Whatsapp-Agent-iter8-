import "server-only";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization";
import { getSupabase } from "@/lib/supabase";
import type { Note } from "@/lib/types";

/** What operators have written about a customer, most recent first. */
export async function listNotes(customerId: string, limit = 10): Promise<Note[]> {
  const { data, error } = await getSupabase()
    .from("notes")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load notes: ${error.message}`);
  return data;
}

export interface NewNote {
  customerId: string;
  conversationId: string | null;
  body: string;
  author?: "human" | "ai";
}

export async function addNote({ customerId, conversationId, body, author = "human" }: NewNote): Promise<Note> {
  const { data, error } = await getSupabase()
    .from("notes")
    .insert({
      organization_id: DEFAULT_ORGANIZATION_ID,
      customer_id: customerId,
      conversation_id: conversationId,
      author,
      body,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to save the note: ${error.message}`);
  return data;
}
