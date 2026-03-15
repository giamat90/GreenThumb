import { create } from "zustand";

interface NetworkState {
  isOnline: boolean;
  setIsOnline: (val: boolean) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  isOnline: true,
  setIsOnline: (val) => set({ isOnline: val }),
}));
