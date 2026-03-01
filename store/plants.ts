import { create } from "zustand";
import type { Plant } from "@/types";

interface PlantsState {
  plants: Plant[];
  isLoading: boolean;
  setPlants: (plants: Plant[]) => void;
  addPlant: (plant: Plant) => void;
  updatePlant: (id: string, updates: Partial<Plant>) => void;
  removePlant: (id: string) => void;
  setLoading: (isLoading: boolean) => void;
}

export const usePlantsStore = create<PlantsState>((set) => ({
  plants: [],
  isLoading: false,
  setPlants: (plants) => set({ plants }),
  addPlant: (plant) => set((state) => ({ plants: [...state.plants, plant] })),
  updatePlant: (id, updates) =>
    set((state) => ({
      plants: state.plants.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    })),
  removePlant: (id) =>
    set((state) => ({
      plants: state.plants.filter((p) => p.id !== id),
    })),
  setLoading: (isLoading) => set({ isLoading }),
}));
