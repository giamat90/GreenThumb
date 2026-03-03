import { useState, useCallback, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCurrentWeather, getWeatherByCity } from "@/lib/weather";
import { useUserStore } from "@/store/user";
import type { WeatherData } from "@/lib/weather";

export interface UseWeatherReturn {
  weather: WeatherData | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => void;
}

function todayCacheKey(): string {
  return `weather_cache_${new Date().toISOString().slice(0, 10)}`;
}

export function useWeather(): UseWeatherReturn {
  const { profile } = useUserStore();
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchWeather = useCallback(
    async (forceRefresh = false) => {
      if (!profile) return;

      // Require at minimum a city name or GPS coordinates
      const hasLocation = profile.city || (profile.lat && profile.lng);
      if (!hasLocation) {
        setError("Set your city in Profile to get weather");
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Check daily cache first (avoid hammering the free-tier API)
        const cacheKey = todayCacheKey();
        if (!forceRefresh) {
          const cached = await AsyncStorage.getItem(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached) as { data: WeatherData; ts: string };
            setWeather(parsed.data);
            setLastUpdated(new Date(parsed.ts));
            setIsLoading(false);
            return;
          }
        }

        // Fetch fresh data
        let data: WeatherData;
        if (profile.lat && profile.lng) {
          data = await getCurrentWeather(profile.lat, profile.lng);
        } else {
          data = await getWeatherByCity(profile.city!);
        }

        // Cache for the rest of the day
        const ts = new Date().toISOString();
        await AsyncStorage.setItem(cacheKey, JSON.stringify({ data, ts }));

        setWeather(data);
        setLastUpdated(new Date(ts));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load weather");
      } finally {
        setIsLoading(false);
      }
    },
    [profile]
  );

  useEffect(() => {
    fetchWeather();
  }, [fetchWeather]);

  const refresh = useCallback(() => fetchWeather(true), [fetchWeather]);

  return { weather, isLoading, error, lastUpdated, refresh };
}
