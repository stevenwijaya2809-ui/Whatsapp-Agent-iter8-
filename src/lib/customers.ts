import "server-only";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization";
import { getSupabase } from "@/lib/supabase";
import type { Customer } from "@/lib/types";

/**
 * Returns the customer behind a phone number, creating them on first contact.
 * The WhatsApp profile name is kept current, but a name set by an operator is never
 * overwritten with an empty one.
 */
export async function ensureCustomer(phone: string, name: string | null): Promise<Customer> {
  const now = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from("customers")
    .upsert(
      {
        organization_id: DEFAULT_ORGANIZATION_ID,
        phone,
        ...(name ? { name } : {}),
        last_interaction_at: now,
        updated_at: now,
      },
      { onConflict: "organization_id,phone" }
    )
    .select()
    .single();
  if (error) throw new Error(`Failed to save customer: ${error.message}`);
  return data;
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const { data, error } = await getSupabase().from("customers").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load customer: ${error.message}`);
  return data;
}

export type CustomerChanges = Partial<
  Pick<Customer, "name" | "status" | "lead_status" | "tags" | "preferences" | "ai_summary">
>;

export async function updateCustomer(id: string, changes: CustomerChanges): Promise<Customer | null> {
  const { data, error } = await getSupabase()
    .from("customers")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Failed to update customer: ${error.message}`);
  return data;
}

export async function addCustomerTag(id: string, tag: string): Promise<Customer | null> {
  const customer = await getCustomer(id);
  if (!customer) return null;
  if (customer.tags.includes(tag)) return customer;
  return updateCustomer(id, { tags: [...customer.tags, tag] });
}
