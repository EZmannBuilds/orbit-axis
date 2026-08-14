// Orbit Axis :: daily-fortune service.
//
// Orchestrates: compute natal chart + current sky (deterministic, local Swiss
// Ephemeris) -> compose fortune (deterministic) -> return the stored fortune if
// one already exists for (chart, local date, engine version), else persist and
// return. Store-agnostic so the caching logic is unit-tested with an in-memory
// store and runs in production against Supabase.

import { computeNatalChart, chartInputHash } from "../astro/natal.js";
import { createCurrentSkyContext } from "../astro/current-sky-context.js";
import { composeFortune, FORTUNE_ENGINE_VERSION } from "./engine.js";
import { isValidIanaTimezone } from "../locations/timezone.js";

// Update Two: "Balanced" was removed. Only Simple and Advanced remain, Simple
// is the default. Any legacy value (Balanced in any casing, or anything
// unrecognized) normalizes to Simple — Advanced is never inferred, because it
// exposes degrees/coordinates/aspects a user never explicitly opted into.
export const DETAIL_LEVELS = ["Simple", "Advanced"];
export const DEFAULT_DETAIL = "Simple";
export const CURRENT_TIMEZONE_SOURCES = ["device", "geolocation"];
export const DEFAULT_CURRENT_TIMEZONE = "UTC";

// Single source of truth for coercing any incoming/stored detail value to a
// currently-supported one. Simple -> Simple, Advanced -> Advanced, everything
// else (Balanced, balanced, BALANCED, null, garbage) -> Simple.
export function normalizeDetailLevel(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "advanced") return "Advanced";
  return DEFAULT_DETAIL;
}

class FortuneError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}
export { FortuneError };

// Map a composed fortune into a daily_fortunes row.
/**
 * One reading per day, keeping the newest when a date has more than one.
 *
 * WHY THIS IS NEEDED. `getFortune` looks a reading up by (profile, date,
 * ENGINE VERSION), but `listHistory` selects by (owner, date) with no version
 * filter. So the moment the engine version changes, a date that gets recomposed
 * gains a second row — and History and the week strip would show the same day
 * twice, with different words, which reads as the app inventing readings.
 *
 * Found before shipping the v2 phrase banks, by asking what a version bump does
 * to rows that already exist rather than assuming it does nothing.
 *
 * Newest wins because it is the one the rest of the app will serve for that
 * date: `created_at` if the row has it, otherwise the later engine version.
 * Order within a date is otherwise not guaranteed by the query.
 */
export function oneReadingPerDate(rows) {
  if (!Array.isArray(rows)) return [];
  const best = new Map();
  for (const row of rows) {
    const date = row?.fortune_date;
    if (!date) continue;                       // never silently drop a dateless row
    const held = best.get(date);
    if (!held || newerThan(row, held)) best.set(date, row);
  }
  const kept = [...best.values()];
  // listHistory asks for fortune_date.desc; preserve that regardless of Map order.
  kept.sort((a, b) => String(b.fortune_date).localeCompare(String(a.fortune_date)));
  const undated = rows.filter((r) => !r?.fortune_date);
  return [...kept, ...undated];
}

function newerThan(row, held) {
  const at = Date.parse(row?.created_at || "");
  const heldAt = Date.parse(held?.created_at || "");
  if (!Number.isNaN(at) && !Number.isNaN(heldAt) && at !== heldAt) return at > heldAt;
  return String(row?.fortune_engine_version || "")
    .localeCompare(String(held?.fortune_engine_version || "")) > 0;
}

function toRow(owner, profile, f) {
  return {
    owner_id: owner,
    birth_profile_id: profile.id,
    fortune_date: f.fortune_date,
    timezone_name: f.timezone_name,
    fortune_engine_version: f.fortune_engine_version,
    seed_hash: f.seed_hash,
    sky_snapshot: f.sky_snapshot,
    mood: f.mood, love_reading: f.love_reading, luck_reading: f.luck_reading, watch_out: f.watch_out,
    lucky_number: f.lucky_number,
    lucky_color_name: f.lucky_color.name, lucky_color_value: f.lucky_color.value,
    factors: f.factors,
  };
}

// Normalize a stored row back into the fortune shape the UI expects.
function fromRow(row) {
  return {
    fortune_engine_version: row.fortune_engine_version,
    fortune_date: row.fortune_date,
    timezone_name: row.timezone_name,
    chart_id: row.birth_profile_id,
    seed_hash: row.seed_hash,
    sky_snapshot: row.sky_snapshot,
    mood: row.mood, love_reading: row.love_reading, luck_reading: row.luck_reading, watch_out: row.watch_out,
    lucky_number: row.lucky_number,
    lucky_color: { name: row.lucky_color_name, value: row.lucky_color_value },
    factors: row.factors,
  };
}

// Compose a fortune for a saved chart profile at an instant (no persistence).
// `currentTimezoneName` is the user's *current* (browsing) timezone — it
// decides which local calendar day "today" is. It never touches the natal
// chart calculation (birth timezone stays fixed to the birthplace/birth time).
export function fortuneForProfile(profile, now = new Date(), currentTimezoneName = null) {
  const chart = computeNatalChart(profile);
  const requestedTimezone = (currentTimezoneName && isValidIanaTimezone(currentTimezoneName))
    ? currentTimezoneName
    : null;
  const sky = createCurrentSkyContext({
    at: now,
    timezoneName: requestedTimezone,
    timezoneSource: requestedTimezone ? "current_timezone" : null,
    fallbackTimezone: profile.timezone_name || DEFAULT_CURRENT_TIMEZONE,
  });
  return composeFortune({
    chart,
    sky,
    localDate: sky.local_date,
    timezoneName: sky.user_timezone,
    chartId: profile.id, chartInputHash: chartInputHash(profile),
  });
}

export function createFortuneService(store) {
  return {
    // Return today's fortune for a saved chart, using the cache when present.
    async today(owner, profile, now = new Date(), currentTimezoneName = null) {
      if (!profile?.id) throw new FortuneError("no_chart", "no active chart");
      const composed = fortuneForProfile(profile, now, currentTimezoneName);
      const cached = await store.getFortune(profile.id, composed.fortune_date, FORTUNE_ENGINE_VERSION);
      if (cached) return { fortune: fromRow(cached), cached: true };
      let saved = null;
      try { saved = await store.insertFortune(toRow(owner, profile, composed)); } catch { /* cache best-effort */ }
      return { fortune: saved ? fromRow(saved) : composed, cached: false };
    },

    async history(owner, { birthProfileId = null, limit = 30 } = {}) {
      const rows = await store.listHistory(owner, { birthProfileId, limit });
      return oneReadingPerDate(rows).map(fromRow);
    },

    async getDetail(owner) {
      // Normalize on read so a legacy Balanced row surfaces as Simple even
      // before the migration runs (defense in depth alongside the DB migration).
      return normalizeDetailLevel(await store.getDetailLevel(owner));
    },

    async setDetail(owner, level) {
      // Accept only currently-supported levels, but treat a legacy "Balanced"
      // (any casing) as Simple rather than an error, so a stale client that
      // still sends it migrates cleanly. Anything else is a genuine bad request.
      const raw = String(level ?? "").trim();
      const validated = /^balanced$/i.test(raw) ? "Simple"
        : DETAIL_LEVELS.includes(raw) ? raw
        : null;
      if (!validated) throw new FortuneError("invalid_detail", `detail must be one of ${DETAIL_LEVELS.join(", ")}`);
      await store.setDetailLevel(owner, validated);
      return { astrology_detail_level: validated };
    },

    async getCurrentTimezone(owner) {
      const row = await store.getCurrentTimezone(owner);
      const name = row?.current_timezone_name;
      return {
        timezone_name: name && isValidIanaTimezone(name) ? name : DEFAULT_CURRENT_TIMEZONE,
        source: row?.current_timezone_source || null,
        updated_at: row?.current_timezone_updated_at || null,
        persisted: !!name,
      };
    },

    async setCurrentTimezone(owner, { timezone_name, source } = {}) {
      if (!isValidIanaTimezone(timezone_name)) {
        throw new FortuneError("invalid_timezone", "timezone_name must be a valid IANA timezone (e.g. \"America/New_York\").");
      }
      const cleanSource = CURRENT_TIMEZONE_SOURCES.includes(source) ? source : "device";
      await store.setCurrentTimezone(owner, { name: timezone_name, source: cleanSource });
      return { timezone_name, source: cleanSource };
    },
  };
}
