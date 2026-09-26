import "server-only";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { DASHBOARD_CHANNEL, DASHBOARD_EVENT } from "@/lib/realtime-channel";
import { getSupabase } from "@/lib/supabase";

let channel: RealtimeChannel | null = null;

/**
 * Tells open dashboards that a conversation changed, so they reload it through the
 * authenticated API. The ping carries an ID and no message content, which is why the
 * database itself does not need to be readable with the public key.
 */
export async function notifyDashboard(conversationId: string): Promise<void> {
  try {
    channel ??= getSupabase().channel(DASHBOARD_CHANNEL);
    const result = await channel.httpSend(DASHBOARD_EVENT, { conversationId });
    if (!result.success) console.error("Realtime notify failed:", result);
  } catch (error) {
    console.error("Realtime notify failed:", error);
  }
}
