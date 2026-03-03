// OpenWeatherMap API wrapper
// Uses the free current-weather and 5-day/3-hour forecast endpoints.
// The API key is EXPO_PUBLIC_ prefixed — safe to use client-side (free tier, read-only).

export interface ForecastDay {
  date: string;           // ISO date string (YYYY-MM-DD)
  condition: string;      // 'clear' | 'rain' | 'clouds' | 'snow' | 'thunderstorm' | 'drizzle' | 'mist'
  rainExpected: boolean;
  rainAmountMm: number;   // total mm for the day
  tempMax: number;
  tempMin: number;
}

export interface WeatherData {
  city: string;
  temperature: number;    // celsius, current
  humidity: number;       // 0-100
  condition: string;
  rainExpected: boolean;  // rain in next 24h
  rainAmountMm: number;   // mm in next 24h
  uvIndex: number;
  forecast: ForecastDay[];
}

// ─── Internals ────────────────────────────────────────────────────────────────

const API_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY ?? "";
const BASE = "https://api.openweathermap.org/data/2.5";
const GEO = "https://api.openweathermap.org/geo/1.0";

function normaliseCondition(main: string): string {
  const m = main.toLowerCase();
  if (m === "thunderstorm") return "thunderstorm";
  if (m === "drizzle") return "drizzle";
  if (m === "rain") return "rain";
  if (m === "snow") return "snow";
  if (m === "clear") return "clear";
  if (m === "clouds") return "clouds";
  return "mist";
}

// Parse the 3-hour interval list into daily buckets
function groupForecastByDay(list: OWMForecastItem[]): ForecastDay[] {
  const byDay: Record<string, OWMForecastItem[]> = {};

  for (const item of list) {
    const day = item.dt_txt.slice(0, 10); // "YYYY-MM-DD"
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(item);
  }

  return Object.entries(byDay)
    .slice(0, 5)
    .map(([date, items]) => {
      const rainMm = items.reduce((sum, i) => sum + (i.rain?.["3h"] ?? 0), 0);
      const temps = items.map((i) => i.main.temp);
      const condition = normaliseCondition(items[Math.floor(items.length / 2)].weather[0].main);
      return {
        date,
        condition,
        rainExpected: rainMm > 0.5,
        rainAmountMm: Math.round(rainMm * 10) / 10,
        tempMax: Math.round(Math.max(...temps)),
        tempMin: Math.round(Math.min(...temps)),
      };
    });
}

// ─── Types mirroring the OWM JSON ─────────────────────────────────────────────

interface OWMCurrentResponse {
  name: string;
  main: { temp: number; humidity: number };
  weather: { main: string }[];
  rain?: { "1h"?: number };
}

interface OWMForecastItem {
  dt_txt: string;
  main: { temp: number; temp_max: number; temp_min: number };
  weather: { main: string }[];
  rain?: { "3h"?: number };
}

interface OWMForecastResponse {
  list: OWMForecastItem[];
}

interface OWMGeoResult {
  lat: number;
  lon: number;
  name: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getForecast(lat: number, lng: number): Promise<ForecastDay[]> {
  const url = `${BASE}/forecast?lat=${lat}&lon=${lng}&appid=${API_KEY}&units=metric&cnt=40`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather forecast error: ${res.status}`);
  const data = (await res.json()) as OWMForecastResponse;
  return groupForecastByDay(data.list);
}

export async function getCurrentWeather(lat: number, lng: number): Promise<WeatherData> {
  const [currentRes, forecast] = await Promise.all([
    fetch(`${BASE}/weather?lat=${lat}&lon=${lng}&appid=${API_KEY}&units=metric`),
    getForecast(lat, lng),
  ]);

  if (!currentRes.ok) throw new Error(`Weather API error: ${currentRes.status}`);
  const current = (await currentRes.json()) as OWMCurrentResponse;

  // Rain in next 24h = sum of first 8 forecast intervals (8 × 3h = 24h)
  const rainNext24h = forecast
    .slice(0, 1)
    .reduce((sum, d) => sum + d.rainAmountMm, 0);

  return {
    city: current.name,
    temperature: Math.round(current.main.temp),
    humidity: current.main.humidity,
    condition: normaliseCondition(current.weather[0].main),
    rainExpected: rainNext24h > 0.5 || (forecast[0]?.rainExpected ?? false),
    rainAmountMm: Math.round(rainNext24h * 10) / 10,
    uvIndex: 0, // UV not in free current-weather endpoint
    forecast,
  };
}

export async function getWeatherByCity(city: string): Promise<WeatherData> {
  const geoRes = await fetch(
    `${GEO}/direct?q=${encodeURIComponent(city)}&limit=1&appid=${API_KEY}`
  );
  if (!geoRes.ok) throw new Error(`Geocoding error: ${geoRes.status}`);
  const geoData = (await geoRes.json()) as OWMGeoResult[];
  if (!geoData.length) throw new Error(`City not found: ${city}`);

  const { lat, lon } = geoData[0];
  const weather = await getCurrentWeather(lat, lon);
  // Use the city name from the user's profile, not OWM's normalised name
  return { ...weather, city };
}
