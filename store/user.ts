import { create } from "zustand";
import type { Profile, Subscription } from "@/types";

interface UserState {
  profile: Profile | null;
  isLoading: boolean;
  // Subscription is tracked separately from Profile so it can be updated
  // in real-time from RevenueCat without requiring a Supabase round-trip.
  subscription: Subscription;
  setProfile: (profile: Profile | null) => void;
  clearProfile: () => void;
  setLoading: (isLoading: boolean) => void;
  setSubscription: (subscription: Subscription) => void;
}

export const useUserStore = create<UserState>((set) => ({
  profile: null,
  isLoading: false,
  subscription: "free",
  setProfile: (profile) =>
    set((state) => ({
      // Don't override subscription — it's managed by checkSubscriptionStatus/setSubscription
      profile: profile ? { ...profile, subscription: state.subscription } : null,
    })),
  clearProfile: () => set({ profile: null, subscription: "free" }),
  setLoading: (isLoading) => set({ isLoading }),
  setSubscription: (subscription) =>
    set((state) => ({
      subscription,
      // Mirror the value into profile so existing reads of profile.subscription
      // stay correct without requiring a Supabase refetch.
      profile: state.profile ? { ...state.profile, subscription } : null,
    })),
}));
