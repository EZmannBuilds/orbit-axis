import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanLocationQuery,
  locationCacheStats,
  normalizeGeoapifyFeature,
  resetLocationCache,
  safePlaceForClient,
  searchGeoapify,
  verifyPlaceSignature,
} from "../lib/locations/geoapify.js";
import { resolveBirthTiming, timezoneForCoordinates } from "../lib/locations/timezone.js";

const PLACE = {
  provider: "geoapify",
  provider_place_id: "paris-test",
  label: "Paris, Ile-de-France, France",
  latitude: 48.8566,
  longitude: 2.3522,
};

test("location queries are normalized and bounded", () => {
  assert.equal(cleanLocationQuery("  New   York  "), "New York");
  assert.throws(() => cleanLocationQuery("ny"), /at least 3/);
  assert.throws(() => cleanLocationQuery("x".repeat(121)), /too long/);
});

test("Geoapify features are reduced to safe normalized fields", () => {
  const normalized = normalizeGeoapifyFeature({
    properties: {
      formatted: "Paris, Ile-de-France, France",
      place_id: "abc",
      city: "Paris",
      state: "Ile-de-France",
      country: "France",
      country_code: "FR",
      lat: 48.85661234,
      lon: 2.35224567,
      datasource: { raw: { billing: "not copied" } },
    },
  });
  assert.deepEqual(Object.keys(normalized).sort(), [
    "city", "country", "country_code", "label", "latitude", "longitude", "provider", "provider_place_id", "region",
  ]);
  assert.equal(normalized.latitude, 48.856612);
  assert.equal(normalized.country_code, "fr");
});

test("signed places verify and tampering fails", () => {
  process.env.GEOAPIFY_API_KEY = "unit-test-location-secret";
  const signed = safePlaceForClient(PLACE);
  assert.equal(verifyPlaceSignature(signed, signed.selection_token), true);
  assert.equal(verifyPlaceSignature({ ...signed, latitude: 49 }, signed.selection_token), false);
});

test("Geoapify search returns safe client results with a mocked fetch", async () => {
  process.env.GEOAPIFY_API_KEY = "unit-test-location-secret";
  const calls = [];
  const results = await searchGeoapify("Paris", {
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        async json() {
          return {
            features: [{ properties: { formatted: PLACE.label, place_id: PLACE.provider_place_id, lat: PLACE.latitude, lon: PLACE.longitude } }],
          };
        },
      };
    },
  });
  assert.equal(results.length, 1);
  assert.ok(results[0].selection_token);
  assert.equal(calls[0].searchParams.get("text"), "Paris");
  assert.equal(calls[0].searchParams.get("format"), "geojson");
});

// Every autocomplete request is a billed credit, so "did it actually skip the
// provider" is the assertion that matters — a cache that quietly still fetches
// saves nothing and would never show up in the results.
test("a repeated place search is served from cache without calling the provider", async () => {
  process.env.GEOAPIFY_API_KEY = "unit-test-location-secret";
  resetLocationCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return {
      ok: true,
      async json() {
        return { features: [{ properties: { formatted: PLACE.label, place_id: PLACE.provider_place_id, lat: PLACE.latitude, lon: PLACE.longitude } }] };
      },
    };
  };

  const first = await searchGeoapify("Paris", { fetchImpl, cache: true });
  const second = await searchGeoapify("Paris", { fetchImpl, cache: true });
  assert.equal(calls, 1, "the second identical search must not reach Geoapify");
  assert.deepEqual(second, first, "and must return the same places");

  // Case and surrounding whitespace are the same query to a person, so they
  // must be the same query to the meter.
  await searchGeoapify("  paris  ", { fetchImpl, cache: true });
  assert.equal(calls, 1, "case and spacing must not mint a second credit");

  // A different result limit is a different response, so it must not reuse one.
  await searchGeoapify("Paris", { fetchImpl, cache: true, limit: 8 });
  assert.equal(calls, 2, "a different limit is a different request");

  const stats = locationCacheStats();
  assert.equal(stats.hits, 2);
  assert.equal(stats.misses, 2);
});

test("cached places are signed with the key in force, never the key they were fetched under", async () => {
  process.env.GEOAPIFY_API_KEY = "first-secret";
  resetLocationCache();
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return { features: [{ properties: { formatted: PLACE.label, place_id: PLACE.provider_place_id, lat: PLACE.latitude, lon: PLACE.longitude } }] };
    },
  });

  const before = await searchGeoapify("Paris", { fetchImpl, cache: true });
  // Rotate the secret. The cache still holds the place; the token must not be
  // the stale one, or a rotation would hand out selections the server rejects.
  process.env.GEOAPIFY_API_KEY = "second-secret";
  const after = await searchGeoapify("Paris", { fetchImpl, cache: true });

  assert.notEqual(after[0].selection_token, before[0].selection_token,
    "a rotated key must produce a new token");
  assert.equal(verifyPlaceSignature(after[0], after[0].selection_token), true,
    "and that token must verify under the current key");
  process.env.GEOAPIFY_API_KEY = "unit-test-location-secret";
});

test("an injected transport does not read or write the provider cache", async () => {
  process.env.GEOAPIFY_API_KEY = "unit-test-location-secret";
  resetLocationCache();
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return { features: [{ properties: { formatted: PLACE.label, place_id: PLACE.provider_place_id, lat: PLACE.latitude, lon: PLACE.longitude } }] };
    },
  });
  await searchGeoapify("Berlin", { fetchImpl });
  await searchGeoapify("Berlin", { fetchImpl });
  // This is what keeps the error-path tests below honest: a stub that returns
  // one thing must never be able to answer for a stub that returns another.
  assert.equal(locationCacheStats().size, 0, "a stubbed transport must not populate the cache");
});

// The cache's value was estimated by simulation; this line is how the estimate
// gets checked against production. The privacy half is the part that has to be
// enforced rather than intended: a birthplace is among the most identifying
// things Orbit holds, so the query must never reach a log.
test("the cache reports its hit rate without ever logging what was searched", async () => {
  process.env.GEOAPIFY_API_KEY = "unit-test-location-secret";
  resetLocationCache();
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return { features: [{ properties: { formatted: PLACE.label, place_id: PLACE.provider_place_id, lat: PLACE.latitude, lon: PLACE.longitude } }] };
    },
  });

  const lines = [];
  const realLog = console.log;
  console.log = (...args) => { lines.push(args.join(" ")); };
  try {
    // 49 distinct misses, then one repeat: quiet until the cadence is reached.
    for (let i = 0; i < 49; i++) await searchGeoapify(`Testville${i}`, { fetchImpl, cache: true });
    assert.equal(lines.length, 0, "reporting is cadenced, not one line per lookup");
    await searchGeoapify("Testville0", { fetchImpl, cache: true });
  } finally {
    console.log = realLog;
  }

  assert.equal(lines.length, 1, "one report at the cadence boundary");
  const line = lines[0];
  assert.match(line, /^\[locations\] /, "house log format");

  const payload = JSON.parse(line.slice("[locations] ".length));
  assert.equal(payload.lookups, 50);
  assert.equal(payload.hits, 1);
  assert.equal(payload.misses, 49);
  assert.equal(payload.hit_rate_pct, 2);
  assert.equal(payload.entries, 49);

  // The whole point. No query text, no place label, no coordinates.
  assert.doesNotMatch(line, /Testville/, "a birthplace query must never be logged");
  assert.doesNotMatch(line, /Paris|Ile-de-France|France/, "nor a returned place label");
  assert.doesNotMatch(line, /48\.85|2\.35/, "nor coordinates");
  assert.deepEqual(
    Object.keys(payload).sort(),
    ["entries", "hit_rate_pct", "hits", "lookups", "misses"],
    "counters only — a new field here is a new disclosure",
  );
});

test("Geoapify search handles empty, provider, timeout, malformed, and missing-key cases", async () => {
  process.env.GEOAPIFY_API_KEY = "unit-test-location-secret";
  const empty = await searchGeoapify("Nowhere", {
    fetchImpl: async () => ({ ok: true, async json() { return { features: [] }; } }),
  });
  assert.deepEqual(empty, []);
  await assert.rejects(() => searchGeoapify("Paris", {
    fetchImpl: async () => ({ ok: false, async json() { return {}; } }),
  }), /failed/);
  await assert.rejects(() => searchGeoapify("Paris", {
    timeoutMs: 1,
    fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      setTimeout(resolve, 50);
    }),
  }), /timed out/);
  await assert.rejects(() => searchGeoapify("Paris", {
    fetchImpl: async () => ({ ok: true, async json() { throw new Error("bad json"); } }),
  }), /malformed/);
  const oldKey = process.env.GEOAPIFY_API_KEY;
  process.env.GEOAPIFY_API_KEY = "";
  await assert.rejects(() => searchGeoapify("Paris", {
    fetchImpl: async () => ({ ok: true, async json() { return { features: [] }; } }),
  }), /not configured/);
  process.env.GEOAPIFY_API_KEY = oldKey;
});

test("timezone and historical offsets are resolved locally", () => {
  const zone = timezoneForCoordinates(48.8566, 2.3522);
  assert.equal(zone, "Europe/Paris");
  const timing = resolveBirthTiming({
    birthDate: "1990-06-16",
    birthTime: "08:30",
    timeAccuracy: "exact",
    timezoneName: zone,
  });
  assert.equal(timing.utc_offset_at_birth, "+02:00");
  assert.equal(timing.time_known, true);
});

test("timezone resolver covers common birthplace regions", () => {
  assert.equal(timezoneForCoordinates(31.1349, -97.7756), "America/Chicago");
  assert.equal(timezoneForCoordinates(40.7128, -74.006), "America/New_York");
  assert.equal(timezoneForCoordinates(51.5074, -0.1278), "Europe/London");
  assert.equal(timezoneForCoordinates(35.6762, 139.6503), "Asia/Tokyo");
  assert.throws(() => timezoneForCoordinates(91, 0), /Latitude is invalid/);
});

test("unknown birth time resolves offset without claiming an exact instant", () => {
  const timing = resolveBirthTiming({
    birthDate: "1990-12-16",
    birthTime: null,
    timeAccuracy: "unknown",
    timezoneName: "America/New_York",
  });
  assert.equal(timing.utc_offset_at_birth, "-05:00");
  assert.equal(timing.utc_instant, null);
  assert.equal(timing.time_known, false);
});

test("DST gap and ambiguous local times produce clear errors", () => {
  assert.throws(() => resolveBirthTiming({
    birthDate: "2024-03-10",
    birthTime: "02:30",
    timeAccuracy: "exact",
    timezoneName: "America/New_York",
  }), /does not exist/);
  assert.throws(() => resolveBirthTiming({
    birthDate: "2024-11-03",
    birthTime: "01:30",
    timeAccuracy: "exact",
    timezoneName: "America/New_York",
  }), /ambiguous/);
});
