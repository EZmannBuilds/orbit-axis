// Orbit :: saved-chart service (business logic).
//
// Store-agnostic: takes a `store` implementing the interface in store.js, so the
// rules here are unit-tested against an in-memory store and run in production
// against Supabase. Never trusts a client-supplied owner_id — the caller passes
// the authenticated owner and every store call is scoped to it.

import { computeNatalChart, chartInputHash, CALCULATION_VERSION } from "../astro/natal.js";
import { EPHEMERIS_VERSION } from "../astro/ephemeris.js";
import { verifyPlaceSignature } from "../locations/geoapify.js";
import { resolveBirthTiming, timezoneForCoordinates } from "../locations/timezone.js";
import { validateRelationship, DEFAULT_FIRST_CHART_RELATIONSHIP } from "./identity.js";
import { AvatarError } from "./avatar.js";

export const PRIMARY_NAME = "My Chart";
const TIME_ACCURACIES = new Set(["exact", "reported", "approximate", "unknown"]);

/**
 * A birth date has to be a real day that has already happened.
 *
 * The client checks this too, but the client is not the boundary — a request
 * can arrive without ever passing through it. Presence alone was the only check
 * here before Dev Update 1.4, which accepted 2099-01-01 and let Luxon decide
 * about 2026-02-30 further downstream, where the error is about timezone
 * interpretation rather than about the date being wrong.
 *
 * Compared as calendar dates, never as instants: a birth date is a date on a
 * wall calendar, and converting it to an instant would make "today" wrong for
 * roughly half the planet for roughly half of every day.
 */
function assertUsableBirthDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) throw new ChartError("invalid_input", "birth_date must be a calendar date in YYYY-MM-DD form");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  const real = probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
  if (!real) throw new ChartError("invalid_input", "birth_date is not a real calendar date");
  if (y < 1000) throw new ChartError("invalid_input", "birth_date is outside the supported range");
  // One day of slack against UTC, because "today" depends on where the caller
  // is: a birth recorded a few hours ahead of UTC is not a time traveller.
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const tomorrowKey = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrow.getUTCDate()).padStart(2, "0")}`;
  if (value > tomorrowKey) throw new ChartError("invalid_input", "birth_date cannot be in the future");
}

class ChartError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}
export { ChartError };

const BIRTH_FIELDS = [
  "first_name", "last_name",
  "birth_date", "birth_time", "time_accuracy", "birthplace_name",
  "latitude", "longitude", "timezone_name", "utc_offset_at_birth",
  "birthplace_city", "birthplace_region", "birthplace_country", "birthplace_country_code",
  "geo_provider", "geo_place_id", "geo_resolved_at",
  "zodiac_system", "house_system", "notes", "relationship_type",
];

/**
 * Geography a caller may never set directly.
 *
 * These describe WHERE a birth happened, and the whole point of the signed
 * place token is that only a location the server itself resolved can become a
 * chart. Copying them from request input defeated that: omitting `birthplace`
 * entirely and passing bare `latitude`/`longitude` sailed past the signature
 * check, because the check only ran when a place object was present.
 *
 * They are now writable from exactly two sources — `applyResolvedPlace`, after
 * a signature has been verified, and the existing stored record when a chart is
 * being edited without changing its birthplace.
 */
const SERVER_RESOLVED_PLACE_FIELDS = new Set([
  "birthplace_name", "latitude", "longitude", "timezone_name", "utc_offset_at_birth",
  "birthplace_city", "birthplace_region", "birthplace_country", "birthplace_country_code",
  "geo_provider", "geo_place_id", "geo_resolved_at",
]);
const PROFILE_NAME_FIELDS = ["first_name", "last_name"];
const ASTRO_INPUT_FIELDS = new Set([
  "birth_date", "birth_time", "time_accuracy", "birthplace_name",
  "latitude", "longitude", "timezone_name", "utc_offset_at_birth",
  "zodiac_system", "house_system", "birthplace",
]);

function cleanText(value, max = 160) {
  if (value == null) return null;
  const text = String(value).normalize("NFKC").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, max) : null;
}

function selectedPlace(input) {
  const place = input.birthplace;
  if (!place || typeof place !== "object") return null;
  const normalized = {
    provider: cleanText(place.provider, 40) || "geoapify",
    provider_place_id: cleanText(place.provider_place_id, 220),
    label: cleanText(place.label, 220),
    city: cleanText(place.city, 120),
    region: cleanText(place.region, 120),
    country: cleanText(place.country, 120),
    country_code: cleanText(place.country_code, 8)?.toLowerCase() || null,
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
  };
  if (!normalized.provider_place_id || !normalized.label) {
    throw new ChartError("invalid_input", "Choose a birthplace from the search results.");
  }
  if (!verifyPlaceSignature(normalized, place.selection_token)) {
    throw new ChartError("invalid_input", "Choose a birthplace from the search results.");
  }
  return normalized;
}

function applyResolvedPlace(out, place) {
  out.birthplace_name = place.label;
  out.latitude = place.latitude;
  out.longitude = place.longitude;
  out.birthplace_city = place.city;
  out.birthplace_region = place.region;
  out.birthplace_country = place.country;
  out.birthplace_country_code = place.country_code;
  out.geo_provider = place.provider;
  out.geo_place_id = place.provider_place_id;
  out.geo_resolved_at = new Date().toISOString();
}

/**
 * House systems Orbit offers, in the order the interface lists them.
 *
 * Every one of these resolves to a distinct Swiss Ephemeris code in the
 * engine's HOUSE_SYSTEM_CODE map. Adding a name here without adding it there
 * would produce a chart computed as Placidus under another name.
 */
export const HOUSE_SYSTEMS = Object.freeze([
  "placidus", "whole", "equal", "koch", "campanus", "regiomontanus", "porphyry",
]);

function sanitizeInput(input, { base = null } = {}) {
  const source = { ...(base || {}), ...(input || {}) };
  const out = {};
  for (const f of BIRTH_FIELDS) {
    // Place geography comes from the stored record, never from the request.
    // A verified selection overwrites it below, in applyResolvedPlace.
    const from = SERVER_RESOLVED_PLACE_FIELDS.has(f) ? (base || {}) : source;
    if (from[f] !== undefined) out[f] = from[f];
  }
  for (const f of PROFILE_NAME_FIELDS) out[f] = cleanText(out[f], 80);
  out.birthplace_name = cleanText(out.birthplace_name, 220);
  out.birthplace_city = cleanText(out.birthplace_city, 120);
  out.birthplace_region = cleanText(out.birthplace_region, 120);
  out.birthplace_country = cleanText(out.birthplace_country, 120);
  out.birthplace_country_code = cleanText(out.birthplace_country_code, 8)?.toLowerCase() || null;
  out.notes = cleanText(out.notes, 2000);
  out.relationship_type = cleanText(out.relationship_type, 80);
  const place = selectedPlace(input || {});
  if (place) applyResolvedPlace(out, place);
  if (!out.birth_date) throw new ChartError("invalid_input", "birth_date is required");
  assertUsableBirthDate(out.birth_date);
  const acc = out.time_accuracy || "unknown";
  if (!TIME_ACCURACIES.has(acc)) throw new ChartError("invalid_input", `time_accuracy must be one of ${[...TIME_ACCURACIES].join(", ")}`);
  out.time_accuracy = acc;
  if (acc === "unknown") out.birth_time = null;
  else out.birth_time = cleanText(out.birth_time, 16);
  if (out.latitude == null || out.longitude == null) throw new ChartError("invalid_input", "latitude and longitude are required");
  try {
    out.timezone_name = timezoneForCoordinates(out.latitude, out.longitude);
    const timing = resolveBirthTiming({
      birthDate: out.birth_date,
      birthTime: out.birth_time,
      timeAccuracy: out.time_accuracy,
      timezoneName: out.timezone_name,
    });
    out.utc_offset_at_birth = timing.utc_offset_at_birth;
  } catch (error) {
    throw new ChartError(error.code || "invalid_input", error.message);
  }
  // The engine computes tropical only — its own declaration says
  // `zodiac_system?: "tropical"` — so this is recorded rather than chosen. When
  // sidereal is implemented in the engine, this becomes a real choice and the
  // interface can offer it; until then anything else would be a label over
  // positions that had not changed.
  out.zodiac_system = "tropical";

  // House system IS a real choice: the engine maps it to a Swiss Ephemeris
  // code and it is part of the chart's input hash, so changing it recomputes.
  // Validated by name here because the engine falls back to Placidus for an
  // unrecognised value — silently computing a different chart from the one
  // that was asked for is the failure this prevents.
  const house = String(out.house_system || "placidus").toLowerCase();
  if (!HOUSE_SYSTEMS.includes(house)) {
    throw new ChartError("invalid_input",
      `house_system must be one of ${HOUSE_SYSTEMS.join(", ")}`);
  }
  out.house_system = house;
  return out;
}

function hasAstroInputChange(patch = {}) {
  return Object.keys(patch || {}).some((key) => ASTRO_INPUT_FIELDS.has(key));
}

async function syncProfileNames(store, ownerId, clean, profile = null) {
  if (!store.upsertProfileNames) return;
  const isPrimary = profile ? !!profile.is_primary : true;
  if (!isPrimary) return;
  const first = clean.first_name;
  const last = clean.last_name;
  if (first == null && last == null) return;
  await store.upsertProfileNames(ownerId, first, last);
}

function newestTime(profile, fields) {
  for (const field of fields) {
    const time = Date.parse(profile?.[field] || 0) || 0;
    if (time) return time;
  }
  return 0;
}

// Pick a sensible active chart when none is set (or the stored one is gone).
// Preference: most recently active → primary/"My Chart" → most recently
// updated → first. Never returns a chart the owner doesn't have.
export function pickFallbackActive(profiles = []) {
  if (!profiles.length) return null;
  const withActivity = profiles.filter((p) => p.last_active_at);
  if (withActivity.length) {
    return [...withActivity].sort((a, b) =>
      newestTime(b, ["last_active_at"]) - newestTime(a, ["last_active_at"])
      || newestTime(b, ["updated_at", "created_at"]) - newestTime(a, ["updated_at", "created_at"])
      || String(a.created_at || "").localeCompare(String(b.created_at || ""))
    )[0];
  }
  const primary = profiles.find((p) => p.is_primary) || profiles.find((p) => p.nickname === PRIMARY_NAME);
  if (primary) return primary;
  const byRecency = [...profiles].sort((a, b) => {
    const at = newestTime(a, ["updated_at", "created_at"]);
    const bt = newestTime(b, ["updated_at", "created_at"]);
    return bt - at;
  });
  return byRecency[0] || profiles[0];
}

function sortForManagement(profiles, activeId) {
  return [...profiles].sort((a, b) => {
    if (a.id === activeId && b.id !== activeId) return -1;
    if (b.id === activeId && a.id !== activeId) return 1;
    return newestTime(b, ["last_active_at"]) - newestTime(a, ["last_active_at"])
      || newestTime(b, ["updated_at", "created_at"]) - newestTime(a, ["updated_at", "created_at"])
      || String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });
}

// What a chart response may carry. The raw storage path stays server-side: it
// embeds the owner's user id and the bucket layout, and no client needs
// either — has_avatar plus avatar_version is the whole contract, the same
// boundary publicIdentity draws (see identity.js). Internal callers that need
// the path use profileFor / the store, never these presented rows.
function presentProfile(profile) {
  if (!profile || typeof profile !== "object") return profile;
  const { avatar_storage_path, ...rest } = profile;
  return { ...rest, has_avatar: Boolean(avatar_storage_path) };
}

// A compact summary attached to each chart for the saved-charts panel.
function summarize(chart) {
  return {
    sun: chart.big_three.sun?.sign || null,
    moon: chart.big_three.moon?.sign || null,
    rising: chart.big_three.rising?.unavailable ? null : chart.big_three.rising?.sign || null,
    time_known: chart.time_known,
  };
}

// Stateless natal calculation — no persistence, no auth. Powers the "enter
// birth details → see chart" preview and the My Chart panel before sign-in.
export function previewChart(input) {
  const clean = sanitizeInput(input);
  return computeNatalChart(clean);
}

export function createChartService(store) {
  async function calculateAndCache(ownerId, profile, { force = false } = {}) {
    const input_hash = chartInputHash(profile);
    if (!force) {
      const cached = await store.getCalculation(profile.id, CALCULATION_VERSION, input_hash);
      if (cached) return { chart: cached.chart_data, cached: true, calculation: cached };
    }
    const chart = computeNatalChart(profile);
    const row = {
      birth_profile_id: profile.id,
      calculation_version: CALCULATION_VERSION,
      ephemeris_version: EPHEMERIS_VERSION,
      input_hash,
      calculated_at: new Date().toISOString(),
      chart_data: chart,
      source_hash: input_hash,
      calculation_status: chart.calculation_status,
      warnings: chart.warnings,
    };
    let calculation = null;
    try { calculation = await store.insertCalculation(row); } catch { /* cache write best-effort */ }
    return { chart, cached: false, calculation };
  }

  // Single source of truth for "which chart is active". A returning user must
  // never be treated as chart-less just because no active id was stored (or the
  // stored one points at a deleted chart) — in that case we auto-select a
  // sensible saved chart and persist it through the normal activation path, so
  // Home, the fortune, chat, and history all agree and it survives a refresh.
  async function resolveActive(ownerId, profiles) {
    if (!profiles.length) return null;
    const storedId = await store.getActiveId(ownerId);
    const stored = storedId ? profiles.find((p) => p.id === storedId) : null;
    if (stored) return stored;
    const fallback = pickFallbackActive(profiles);
    if (!fallback) return null;
    return activateStoredProfile(ownerId, fallback);
  }

  async function activateStoredProfile(ownerId, profile) {
    if (store.activateProfile) {
      return await store.activateProfile(ownerId, profile.id);
    }
    await store.setActiveId(ownerId, profile.id);
    const stamp = new Date().toISOString();
    if (store.touchLastActive) {
      return await store.touchLastActive(ownerId, profile.id, stamp);
    }
    if (store.updateProfile) {
      return await store.updateProfile(ownerId, profile.id, { last_active_at: stamp });
    }
    return { ...profile, last_active_at: stamp };
  }

  return {
    async list(ownerId) {
      const profiles = await store.listProfiles(ownerId);
      const active = await resolveActive(ownerId, profiles);
      const activeId = active?.id || null;
      const resolvedProfiles = profiles.map((p) => p.id === activeId ? { ...p, ...active } : p);
      const withSummary = [];
      for (const p of sortForManagement(resolvedProfiles, activeId)) {
        const { chart } = await calculateAndCache(ownerId, p);
        withSummary.push({ ...presentProfile(p), is_active: p.id === activeId, summary: summarize(chart) });
      }
      return { charts: withSummary, active_chart_id: activeId };
    },

    async get(ownerId, id) {
      const profile = await store.getProfile(ownerId, id);
      if (!profile) throw new ChartError("not_found", "chart not found");
      const { chart, cached } = await calculateAndCache(ownerId, profile);
      const activeId = await store.getActiveId(ownerId);
      return { profile: presentProfile(profile), chart, cached, is_active: profile.id === activeId };
    },

    // The stored row alone, with the same ownership boundary as get() but no
    // natal calculation. Avatar requests need the metadata, not an ephemeris
    // subprocess per image fetch.
    async profileFor(ownerId, id) {
      const profile = await store.getProfile(ownerId, id);
      if (!profile) throw new ChartError("not_found", "chart not found");
      return profile;
    },

    /**
     * The one writer of avatar metadata. `storagePath` null clears it.
     *
     * Guarded by the version the caller read: when the store supports a
     * conditional update the guard is enforced at the row itself, so two
     * requests that both read version N cannot both land — the second PATCH
     * matches nothing and is refused as stale. This is optimistic concurrency
     * on one row, not distributed atomicity with Storage; the write order
     * (bytes first, metadata second) is what keeps failures recoverable.
     */
    async setAvatarState(ownerId, id, { expectedVersion, storagePath }) {
      const profile = await store.getProfile(ownerId, id);
      if (!profile) throw new ChartError("not_found", "chart not found");
      const current = Number(profile.avatar_version || 0);
      const stale = () => new AvatarError("avatar_stale_write",
        "This chart's picture changed somewhere else. Reload and try again.");
      if (Number(expectedVersion) !== current) throw stale();
      const stamp = new Date().toISOString();
      const patch = {
        avatar_storage_path: storagePath,
        avatar_version: current + 1,
        avatar_updated_at: stamp,
        updated_at: stamp,
      };
      if (store.updateProfileGuarded) {
        const updated = await store.updateProfileGuarded(ownerId, id, { avatar_version: current }, patch);
        if (!updated) throw stale();
        return updated;
      }
      return store.updateProfile(ownerId, id, patch);
    },

    async create(ownerId, input) {
      const clean = sanitizeInput(input);
      const existing = await store.listProfiles(ownerId);
      const hasPrimary = existing.some((p) => p.is_primary);
      const isFirst = existing.length === 0;

      // First chart (and none primary yet) becomes "My Chart" automatically.
      const autoPrimary = isFirst && !hasPrimary;
      const nickname = autoPrimary
        ? PRIMARY_NAME
        : cleanText(input.nickname, 120);
      if (!nickname) throw new ChartError("invalid_input", "nickname is required for saved charts");

      // The 1.10 product model, enforced at the boundary the client cannot
      // skip: the first chart defaults to Self, every additional chart must
      // choose one of the four current values, and the legacy values are
      // refused on new writes with their own code (IdentityError).
      clean.relationship_type = autoPrimary && clean.relationship_type == null
        ? DEFAULT_FIRST_CHART_RELATIONSHIP
        : validateRelationship(clean.relationship_type);

      const row = {
        owner_id: ownerId,
        nickname,
        is_primary: autoPrimary,
        ...clean,
      };
      const profile = await store.insertProfile(row);
      if (autoPrimary) await syncProfileNames(store, ownerId, clean, profile);

      // The first chart becomes active. Additional chart creation preserves the
      // current active chart unless the user explicitly switches later.
      const activeProfile = autoPrimary ? await activateStoredProfile(ownerId, profile) : profile;

      const { chart } = await calculateAndCache(ownerId, activeProfile, { force: true });
      return { profile: presentProfile(activeProfile), chart, became_primary: autoPrimary };
    },

    async update(ownerId, id, patch) {
      const profile = await store.getProfile(ownerId, id);
      if (!profile) throw new ChartError("not_found", "chart not found");
      const allowed = {};
      for (const f of [...BIRTH_FIELDS, "nickname"]) if (patch[f] !== undefined) allowed[f] = patch[f];
      if (patch.birthplace !== undefined || hasAstroInputChange(allowed)) {
        Object.assign(allowed, sanitizeInput(patch, { base: profile }));
      } else {
        for (const f of PROFILE_NAME_FIELDS) if (allowed[f] !== undefined) allowed[f] = cleanText(allowed[f], 80);
        if (allowed.nickname !== undefined) allowed.nickname = cleanText(allowed.nickname, 120);
      }
      if (allowed.nickname === null || allowed.nickname === "") throw new ChartError("invalid_input", "nickname is required");
      // An EXPLICIT relationship edit must be one of the four current values;
      // legacy values cannot be re-chosen. A patch that never mentions
      // relationship_type leaves the stored value — legacy or not — exactly
      // as it is, which is what keeps a rename or avatar change from silently
      // reclassifying somebody's chart.
      if (patch.relationship_type !== undefined) {
        allowed.relationship_type = validateRelationship(patch.relationship_type);
      }
      // Never let a client flip is_primary/owner_id directly.
      const updated = await store.updateProfile(ownerId, id, { ...allowed, updated_at: new Date().toISOString() });
      await syncProfileNames(store, ownerId, updated, updated);
      const { chart } = await calculateAndCache(ownerId, updated, { force: hasAstroInputChange(patch) });
      return { profile: presentProfile(updated), chart };
    },

    async activate(ownerId, id) {
      const profile = await store.getProfile(ownerId, id);
      if (!profile) throw new ChartError("not_found", "chart not found");
      const activeProfile = await activateStoredProfile(ownerId, profile);
      return { active_chart_id: id, profile: presentProfile(activeProfile) };
    },

    async remove(ownerId, id, { confirmEmpty = false } = {}) {
      const profile = await store.getProfile(ownerId, id);
      if (!profile) throw new ChartError("not_found", "chart not found");
      const all = await store.listProfiles(ownerId);
      if (all.length <= 1 && !confirmEmpty) {
        throw new ChartError("last_chart", "Deleting your only chart leaves an empty state — you'll need to add a new chart before Orbit can show a fortune or My Chart. Re-send with confirmEmpty to proceed.");
      }
      const activeId = await store.getActiveId(ownerId);
      await store.deleteProfile(ownerId, id);

      let newActive = activeId;
      if (activeId === id) {
        // Deleting the active chart must never strand the user in a chart-less
        // state while other charts remain: promote a sensible replacement.
        const remaining = all.filter((p) => p.id !== id);
        const replacement = pickFallbackActive(remaining);
        if (replacement) {
          const activeProfile = await activateStoredProfile(ownerId, replacement);
          newActive = activeProfile.id;
        } else {
          newActive = null;
          await store.setActiveId(ownerId, null);
        }
      }
      return { deleted: id, active_chart_id: newActive, empty: newActive === null };
    },

    async calculate(ownerId, id, opts = {}) {
      const profile = await store.getProfile(ownerId, id);
      if (!profile) throw new ChartError("not_found", "chart not found");
      return calculateAndCache(ownerId, profile, opts);
    },

    async getActive(ownerId) {
      const profiles = await store.listProfiles(ownerId);
      const profile = await resolveActive(ownerId, profiles);
      if (!profile) return null; // genuinely zero saved charts
      const { chart } = await calculateAndCache(ownerId, profile);
      return { profile: presentProfile(profile), chart };
    },
  };
}
