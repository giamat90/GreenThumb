import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { getBadgeTier, type BadgeTier } from "@/lib/reactions";

export function useUserKudos(userId: string | null | undefined): {
  kudos: number;
  badge: BadgeTier | null;
  loading: boolean;
} {
  const [kudos, setKudos] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    supabase
      .from("user_kudos_total")
      .select("total_kudos")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        setKudos((data as { total_kudos: number } | null)?.total_kudos ?? 0);
        setLoading(false);
      });
  }, [userId]);

  return { kudos, badge: getBadgeTier(kudos), loading };
}
