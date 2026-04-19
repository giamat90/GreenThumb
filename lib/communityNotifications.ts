import { supabase } from "@/lib/supabase";

type CommunityNotifPayload =
  | { type: "like"; postId: string }
  | { type: "comment"; postId: string; commentText: string }
  | { type: "follow"; targetUserId: string }
  | { type: "task_completed"; plantId: string; plantName: string; taskType: "watering" | "fertilizing" | "follow_up" };

/**
 * Fire-and-forget call to the notify-community edge function.
 * Never throws — failures are silently swallowed so they never
 * interrupt the like / comment / follow action.
 */
export function sendCommunityNotification(payload: CommunityNotifPayload): void {
  (async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

      fetch(`${supabaseUrl}/functions/v1/notify-community`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: anonKey,
        },
        body: JSON.stringify(payload),
      }).catch(() => {
        // network errors are silently ignored
      });
    } catch {
      // session errors are silently ignored
    }
  })();
}
