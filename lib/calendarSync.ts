import * as Calendar from "expo-calendar";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";
import type { Plant } from "@/types";

const CALENDAR_TITLE = "GreenThumb 🌿";
const CALENDAR_COLOR = "#2D6A4F";

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
  const existing = calendars.find((c) => c.title === CALENDAR_TITLE);
  if (existing) return existing.id;

  // Resolve the default local source for the new calendar
  let source: Calendar.Source;
  if (Platform.OS === "ios") {
    const defaultCal = await Calendar.getDefaultCalendarAsync();
    source = defaultCal.source;
  } else {
    const localSource = calendars
      .map((c) => c.source)
      .find((s) => s.type === "LOCAL" || s.name === "PC Sync");
    source = localSource ?? ({ isLocalAccount: true, name: "GreenThumb", type: "LOCAL" } as Calendar.Source);
  }

  const id = await Calendar.createCalendarAsync({
    title: CALENDAR_TITLE,
    color: CALENDAR_COLOR,
    entityType: Calendar.EntityTypes.EVENT,
    source,
    name: CALENDAR_TITLE,
    ownerAccount: "GreenThumb",
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });

  return id;
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export async function syncPlantEvents(plants: Plant[]): Promise<number> {
  try {
    const calendarId = await getOrCreateGreenThumbCalendar();

    // Load existing events for the next 180 days to detect duplicates
    const now = new Date();
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 180);
    const existingEvents = await Calendar.getEventsAsync([calendarId], now, horizon);
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
      for (const d of diagData ?? []) {
        const row = d as { plant_id: string; follow_up_date: string | null };
        if (row.follow_up_date && !followUpMap[row.plant_id]) {
          followUpMap[row.plant_id] = row.follow_up_date;
        }
      }
    }

    let created = 0;

    for (const plant of plants) {
      // ── Watering event ────────────────────────────────────────────────────
      if (plant.next_watering) {
        const start = new Date(plant.next_watering);
        if (start > now) {
          const title = `💧 Water ${plant.name}`;
          if (!existingKeys.has(`${title}|${start.toDateString()}`)) {
            const end = new Date(start);
            end.setMinutes(end.getMinutes() + 15);
            await Calendar.createEventAsync(calendarId, {
              title,
              startDate: start,
              endDate: end,
              notes: "Watering reminder from GreenThumb",
              alarms: [{ relativeOffset: -60 }],
            });
            created++;
          }
        }
      }

      // ── Fertilizer event ──────────────────────────────────────────────────
      if (plant.next_fertilizer_at) {
        const start = new Date(plant.next_fertilizer_at);
        if (start > now) {
          const title = `🌱 Fertilize ${plant.name}`;
          if (!existingKeys.has(`${title}|${start.toDateString()}`)) {
            const end = new Date(start);
            end.setMinutes(end.getMinutes() + 15);
            await Calendar.createEventAsync(calendarId, {
              title,
              startDate: start,
              endDate: end,
              notes: "Fertilizer reminder from GreenThumb",
              alarms: [{ relativeOffset: -60 }],
            });
            created++;
          }
        }
      }

      // ── Diagnosis follow-up ───────────────────────────────────────────────
      const followUpDate = followUpMap[plant.id];
      if (followUpDate) {
        const start = new Date(followUpDate);
        if (start > now) {
          const title = `🔬 Check ${plant.name} health`;
          if (!existingKeys.has(`${title}|${start.toDateString()}`)) {
            const end = new Date(start);
            end.setMinutes(end.getMinutes() + 30);
            await Calendar.createEventAsync(calendarId, {
              title,
              startDate: start,
              endDate: end,
              notes: "Follow-up diagnosis reminder from GreenThumb",
              alarms: [{ relativeOffset: -120 }],
            });
            created++;
          }
        }
      }
    }

    return created;
  } catch (err) {
    console.warn("calendarSync: syncPlantEvents failed", err);
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
