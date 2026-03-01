import { create } from "zustand";
import type { Profile } from "@/types";

interface UserState {
  profile: Profile | null;
  isLoading: boolean;
  setProfile: (profile: Profile | null) => void;
  clearProfile: () => void;
  setLoading: (isLoading: boolean) => void;
}

export const useUserStore = create<UserState>((set) => ({
  profile: null,
  isLoading: false,
  setProfile: (profile) => set({ profile }),
  clearProfile: () => set({ profile: null }),
  setLoading: (isLoading) => set({ isLoading }),
}));
