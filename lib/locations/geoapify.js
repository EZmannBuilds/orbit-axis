import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseConfig } from "../local-llm/config.js";

const GEOAPIFY_ROOT = "https://api.geoapify.com/v1/geocode/autocomplete";
const MIN_QUERY = 3;
const MAX_QUERY = 120;
const DEFAULT_LIMIT = 5;

export class LocationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function geoapifyKey() {
  supabaseConfig();
  return process.env.GEOAPIFY_API_KEY || "";
}

export function cleanLocationQuery(query) {
  const q = String(query || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (q.length < MIN_QUERY) throw new LocationError("query_too_short", "Enter at least 3 characters.");
  if (q.length > MAX_QUERY) throw new LocationError("query_too_long", "Search is too long.");
  return q;
}

function bestLocality(p = {}) {
  return p.city || p.town || p.village || p.municipality || p.county || p.district || p.suburb || p.name || "";
}

export function normalizeGeoapifyFeature(feature) {
  const p = feature?.properties || {};
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const label = p.formatted || [bestLocality(p), p.state, p.country].filter(Boolean).join(", ");
  if (!label) return null;
  return {
    provider: "geoapify",
    provider_place_id: String(p.place_id || p.datasource?.raw?.place_id || `${lat},${lon}`),
    label,
    city: bestLocality(p),
    region: p.state || p.county || "",
    country: p.country || "",
    country_code: String(p.country_code || "").toLowerCase(),
    latitude: Math.round(lat * 1e6) / 1e6,
    longitude: Math.round(lon * 1e6) / 1e6,
  };
}

export function signPlace(place) {
  const key = geoapifyKey();
  if (!key) throw new LocationError("geoapify_unconfigured", "Birthplace search is not configured.", 503);
  const payload = JSON.stringify({
    provider: place.provider,
    provider_place_id: place.provider_place_id,
    label: place.label,
    latitude: place.latitude,
    longitude: place.longitude,
  });
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function verifyPlaceSignature(place, signature) {
  if (!signature) return false;
  const expected = Buffer.from(signPlace(place));
  const received = Buffer.from(String(signature));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function safePlaceForClient(place) {
  return { ...place, selection_token: signPlace(place) };
}

/* ── The result cache ────────────────────────────────────────────────────────
   Every autocomplete request is a billed Geoapify credit, and the traffic is
   extremely repetitive: the query is a PREFIX, so a handful of strings —
   "lon", "new", "chi", "par" — are typed by nearly everyone, and the shortest
   prefixes are both the most expensive in aggregate and the most reused. Place
   data is also effectively static; cities do not move.

   WHAT IS STORED. The normalized places, UNSIGNED. Signing happens on the way
   out, so a rotated GEOAPIFY_API_KEY can never hand a caller a selection token
   minted under the old secret — the signature always matches the key in force
   right now.

   THE HONEST CAVEAT, same as lib/api/rate-limit.js: this Map lives in one
   process. On Fluid Compute each warm instance keeps its own, and a cold start
   begins empty. That makes it a cost reduction, not a quota guarantee.

   Empty results are cached too — a typo is a query that will be retyped, and
   re-asking the provider to confirm a place still does not exist is the purest
   form of wasted credit. Failures are NOT cached: an outage must not become a
   sticky one. */
const CACHE = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 1000;
const cacheStats = { hits: 0, misses: 0 };

const cacheKey = (q, limit) => `${limit}:${q.toLowerCase()}`;

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { CACHE.delete(key); return null; }
  // Re-insert so the Map's insertion order doubles as LRU recency.
  CACHE.delete(key);
  CACHE.set(key, hit);
  return hit.places;
}

function cacheSet(key, places) {
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, { at: Date.now(), places });
}

/** Observability for tests and diagnostics. */
export function locationCacheStats() {
  return { ...cacheStats, size: CACHE.size };
}

/* ── Reporting the hit rate ──────────────────────────────────────────────────
   The saving this cache is worth was estimated by simulation, in one process,
   against a synthetic city distribution. Production is many processes, each
   starting cold, against real people — so the estimate is a hypothesis and this
   line is how it gets checked.

   AGGREGATE ONLY, and that is not a detail. The query here is a birthplace: it
   is among the most identifying things Orbit holds, it belongs to the person
   who typed it, and a log is exactly the sort of place it must never turn up.
   Counters go out; what was searched for never does. A test asserts it.

   Cadenced rather than per-request, so a busy instance reports occasionally and
   a quiet one stays silent. /api/health was the obvious alternative home and is
   deliberately not used: it is unauthenticated and documented to describe
   nothing about the running system beyond the fact that it answered. */
const LOG_EVERY = 50;

function reportCache() {
  const lookups = cacheStats.hits + cacheStats.misses;
  if (lookups === 0 || lookups % LOG_EVERY !== 0) return;
  try {
    console.log(`[locations] ${JSON.stringify({
      lookups,
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hit_rate_pct: Math.round((cacheStats.hits / lookups) * 100),
      entries: CACHE.size,
    })}`);
  } catch { /* a diagnostic must never be able to fail a birthplace search */ }
}

export function resetLocationCache() {
  CACHE.clear();
  cacheStats.hits = 0;
  cacheStats.misses = 0;
}

/**
 * @param {object} options
 *   cache defaults to ON only for the real `fetch`. A caller that injects a
 *   transport is, by definition, not talking to the provider this cache holds
 *   results for — serving them one would be wrong, not merely surprising. Pass
 *   `cache: true` explicitly to exercise caching with a stub.
 */
export async function searchGeoapify(query, {
  fetchImpl = fetch,
  limit = DEFAULT_LIMIT,
  timeoutMs = 5000,
  cache = fetchImpl === fetch,
} = {}) {
  const key = geoapifyKey();
  if (!key) throw new LocationError("geoapify_unconfigured", "Birthplace search is not configured.", 503);
  const q = cleanLocationQuery(query);
  const capped = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, 8));

  const ck = cacheKey(q, capped);
  if (cache) {
    const hit = cacheGet(ck);
    if (hit) {
      cacheStats.hits++;
      reportCache();
      return hit.map(safePlaceForClient);
    }
    cacheStats.misses++;
    reportCache();
  }

  const url = new URL(GEOAPIFY_ROOT);
  url.searchParams.set("text", q);
  url.searchParams.set("limit", String(capped));
  url.searchParams.set("format", "geojson");
  url.searchParams.set("apiKey", key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") throw new LocationError("geoapify_timeout", "Birthplace search timed out.", 504);
    throw new LocationError("geoapify_unreachable", "Birthplace search is unavailable.", 502);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new LocationError("geoapify_error", "Birthplace search failed.", 502);
  let data;
  try { data = await res.json(); } catch { throw new LocationError("geoapify_malformed", "Birthplace search returned malformed data.", 502); }
  const features = Array.isArray(data.features) ? data.features : [];
  const places = features.map(normalizeGeoapifyFeature).filter(Boolean).slice(0, capped);
  // Stored unsigned; signed per call, against whichever key is in force now.
  if (cache) cacheSet(ck, places);
  return places.map(safePlaceForClient);
}
