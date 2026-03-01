import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

// AsyncStorage crashes during Expo Router SSR (Node.js has no `window`).
// Provide a no-op storage fallback for SSR; real storage runs on the client.
const isSSR = Platform.OS === "web" && typeof window === "undefined";

const noopStorage = {
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: isSSR ? noopStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: !isSSR,
    detectSessionInUrl: false,
  },
});
