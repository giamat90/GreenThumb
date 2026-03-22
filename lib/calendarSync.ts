import * as Calendar from "expo-calendar";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";
import type { Plant } from "@/types";

const CALENDAR_TITLE = "GreenThumb 🌿";
const CALENDAR_COLOR = "#3E7428";

// ─── Permissions ──────────────────────────────────────────────────────────────

export async function requestCalendarPermission(): Promise<boolean> {
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

// ─── Calendar management ──────────────────────────────────────────────────────

export async function getOrCreateGreenThumbCalendar(): Promise<string> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  console.log("[CalSync] available calendars:", calendars.map((c) => `"${c.title}" id=${c.id} source=${c.source?.name}/${c.source?.type}`));

  // On Android, resolve the Google source first so we know what the "correct" source is
  let source: Calendar.Source;
  if (Platform.OS === "ios") {
    const defaultCal = await Calendar.getDefaultCalendarAsync();
    source = defaultCal.source;
  } else {
    // Prefer a com.google source so the calendar syncs to Google Calendar.
    // Fall back to LOCAL only if no Google account is linked.
    const googleSource = calendars
      .map((c) => c.source)
      .find((s) => s.type === "com.google");
    source = googleSource ?? ({ isLocalAccount: true, name: "GreenThumb", type: "LOCAL" } as Calendar.Source);
    console.log("[CalSync] Android source resolved:", JSON.stringify(source));
  }

  const existing = calendars.find((c) => c.title === CALENDAR_TITLE);
  if (existing) {
    // If the existing calendar is LOCAL on Android but we now have a Google source,
    // delete it and recreate under the Google account so events sync.
    if (Platform.OS === "android" && existing.source?.type === "LOCAL" && source.type === "com.google") {
      console.log("[CalSync] existing calendar is LOCAL — migrating to Google source");
      try { await Calendar.deleteCalendarAsync(existing.id); } catch {}
    } else {
      console.log("[CalSync] found existing calendar id:", existing.id);
      return existing.id;
    }
  }

  console.log("[CalSync] creating new calendar with source:", JSON.stringify(source));
  const id = await Calendar.createCalendarAsync({
    title: CALENDAR_TITLE,
    color: CALENDAR_COLOR,
    entityType: Calendar.EntityTypes.EVENT,
    source,
    name: CALENDAR_TITLE,
    ownerAccount: source.name,
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });

  console.log("[CalSync] created new calendar id:", id);
  return id;
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export async function syncPlantEvents(plants: Plant[]): Promise<number> {
  console.log("[CalSync] starting sync, plants count:", plants.length);
  try {
    const calendarId = await getOrCreateGreenThumbCalendar();
    console.log("[CalSync] calendar id:", calendarId);

    // Load existing events for the next 180 days to detect duplicates
    const now = new Date();
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 180);
    const existingEvents = await Calendar.getEventsAsync([calendarId], now, horizon);
    console.log("[CalSync] existing events in calendar:", existingEvents.length);
    const existingKeys = new Set(
      existingEvents.map((e) => `${e.title}|${new Date(e.startDate).toDateString()}`)
    );

    // Fetch pending diagnosis follow-up dates from Supabase
    const plantIds = plants.map((p) => p.id);
    const followUpMap: Record<string, string> = {};
    if (plantIds.length > 0) {
      const { data: diagData } = await supabase
        .from("diagnoses")
        .select("plant_id, follow_up_date")
        .in("plant_id", plantIds)
        .not("follow_up_date", "is", null)
        .gte("follow_up_date", now.toISOString());
      console.log("[CalSync] follow-up diagnoses found:", diagData?.length ?? 0);
      for (const d of diagData ?? []) {
        const row = d as { plant_id: string; follow_up_date: string | null };
        if (row.follow_up_date && !followUpMap[row.plant_id]) {
          followUpMap[row.plant_id] = row.follow_up_date;
        }
      }
    }

    let created = 0;

    for (const plant of plants) {
      console.log("[CalSync] plant:", plant.name, "| next_watering:", plant.next_watering, "| next_fertilizer_at:", plant.next_fertilizer_at);

      // ── Watering event ────────────────────────────────────────────────────
      if (plant.next_watering) {
        const start = new Date(plant.next_watering);
        if (start > now) {
          const title = `💧 Water ${plant.name}`;
          const key = `${title}|${start.toDateString()}`;
          if (!existingKeys.has(key)) {
            console.log("[CalSync] creating event:", title, "on", start.toDateString());
            const end = new Date(start);
            end.setMinutes(end.getMinutes() + 15);
            const eventId = await Calendar.createEventAsync(calendarId, {
              title,
              startDate: start,
              endDate: end,
              notes: "Watering reminder from GreenThumb",
              alarms: [{ relativeOffset: -60 }],
            });
            console.log("[CalSync] event created:", eventId);
            created++;
          } else {
            console.log("[CalSync] SKIP watering (duplicate):", title, start.toDateString());
          }
        } else {
          console.log("[CalSync] SKIP watering (date in past):", plant.name, start.toDateString());
        }
      } else {
        console.log("[CalSync] SKIP watering (no next_watering):", plant.name);
      }

      // ── Fertilizer event ──────────────────────────────────────────────────
      if (plant.next_fertilizer_at) {
        const start = new Date(plant.next_fertilizer_at);
        if (start > now) {
          const title = `🌱 Fertilize ${plant.name}`;
          const key = `${title}|${start.toDateString()}`;
          if (!existingKeys.has(key)) {
            console.log("[CalSync] creating event:", title, "on", start.toDateString());
            const end = new Date(start);
            end.setMinutes(end.getMinutes() + 15);
            const eventId = await Calendar.createEventAsync(calendarId, {
              title,
              startDate: start,
              endDate: end,
              notes: "Fertilizer reminder from GreenThumb",
              alarms: [{ relativeOffset: -60 }],
            });
            console.log("[CalSync] event created:", eventId);
            created++;
          } else {
            console.log("[CalSync] SKIP fertilizer (duplicate):", title, start.toDateString());
          }
        } else {
          console.log("[CalSync] SKIP fertilizer (date in past):", plant.name, start.toDateString());
        }
      } else {
        console.log("[CalSync] SKIP fertilizer (no next_fertilizer_at):", plant.name);
      }

      // ── Diagnosis follow-up ───────────────────────────────────────────────
      const followUpDate = followUpMap[plant.id];
      if (followUpDate) {
        const start = new Date(followUpDate);
        if (start > now) {
          const title = `🔬 Check ${plant.name} health`;
          const key = `${title}|${start.toDateString()}`;
          if (!existingKeys.has(key)) {
            console.log("[CalSync] creating event:", title, "on", start.toDateString());
            const end = new Date(start);
            end.setMinutes(end.getMinutes() + 30);
            const eventId = await Calendar.createEventAsync(calendarId, {
              title,
              startDate: start,
              endDate: end,
              notes: "Follow-up diagnosis reminder from GreenThumb",
              alarms: [{ relativeOffset: -120 }],
            });
            console.log("[CalSync] event created:", eventId);
            created++;
          } else {
            console.log("[CalSync] SKIP follow-up (duplicate):", title, start.toDateString());
          }
        } else {
          console.log("[CalSync] SKIP follow-up (date in past):", plant.name, start.toDateString());
        }
      }
    }

    console.log("[CalSync] total events created:", created);
    return created;
  } catch (err) {
    console.error("[CalSync] error:", err);
    return 0;
  }
}

// ─── Delete all GreenThumb calendar events ────────────────────────────────────

export async function deleteGreenThumbEvents(): Promise<void> {
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const cal = calendars.find((c) => c.title === CALENDAR_TITLE);
    if (!cal) return;
    await Calendar.deleteCalendarAsync(cal.id);
  } catch (err) {
    console.warn("calendarSync: deleteGreenThumbEvents failed", err);
  }
}
