import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";
import { PLANT_LIMITS } from "@/constants";

interface IdentificationLimitResult {
  canIdentify: boolean;
  identificationCount: number;
  isLoading: boolean;
}

/**
 * Checks whether the current user has remaining plant identification slots
 * this calendar month. Free users get 5/month; Pro users are unlimited.
 *
 * We count saved plants (created_at >= start of month) as a proxy for
 * identifications used, since each identification typically leads to a save.
 */
export function useIdentificationLimit(): IdentificationLimitResult {
  const { profile } = useUserStore();
  const [identificationCount, setIdentificationCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!profile) {
      setIsLoading(false);
      return;
    }

    async function checkLimit() {
      setIsLoading(true);
      try {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const { count, error } = await supabase
          .from("plants")
          .select("id", { count: "exact", head: true })
          .eq("user_id", profile!.id)
          .gte("created_at", startOfMonth.toISOString());

        if (error) throw error;
        setIdentificationCount(count ?? 0);
      } catch {
        // Fail open — if the query errors, don't block the user
        setIdentificationCount(0);
      } finally {
        setIsLoading(false);
      }
    }

    checkLimit();
  }, [profile]);

  const monthlyLimit =
    profile?.subscription === "pro"
      ? PLANT_LIMITS.pro.identifications_per_month
      : PLANT_LIMITS.free.identifications_per_month;

  // Infinity > any number, so pro users always get canIdentify: true
  const canIdentify = identificationCount < monthlyLimit;

  return { canIdentify, identificationCount, isLoading };
}
