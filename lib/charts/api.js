// Orbit :: charts / sky HTTP dispatch (transport-agnostic).
//
// Returns { status, body } so server.js can stay thin. Ownership comes from the
// authenticated server identity (currentOwnerId), never from the client. IDs are
// validated. Errors map to structured JSON without leaking internals.

import { createChartService, previewChart, ChartError } from "./service.js";
import { buildChartReading } from "../interpretation/service.js";
import { composeHighlights, moonState } from "../home/highlights.js";
import { composePositions, composeSkySummary, calculationDetails } from "../positions/positions.js";
import { findTransits, groupTransits, summarise, birthTimeNotice } from "../transits/transits.js";
import { composeAll } from "../transits/interpretation.js";
import { LocationError } from "../locations/geoapify.js";
import { createSupabaseChartStore, supabaseChartStore, currentOwnerId, isConfigured } from "./store.js";
import { currentSky, nextLunarEvents } from "../astro/current-sky.js";
import { createCurrentSkyContext } from "../astro/current-sky-context.js";
import { createAvatarStore } from "./avatar-store.js";
import { refuseIfAtLimit } from "../entitlements/enforce.js";
import {
  validateAvatarUpload, avatarObjectPath, avatarCacheHeaders, assertFreshWrite,
  AvatarError,
} from "./avatar.js";
import { publicIdentity, IdentityError } from "./identity.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(status, error, extra = {}) { return { status, body: { ok: false, error, ...extra } }; }
function ok(body) { return { status: 200, body: { ok: true, ...body } }; }

// Swiss Ephemeris runs a subprocess per call; the sky snapshot only needs
// minute-level freshness, so cache it briefly instead of shelling out on
// every request (e.g. Home polling, repeated tab renders).
const SKY_CACHE_MS = 60_000;
let skyCache = { at: 0, sky: null, lunarEvents: null };
function cachedCurrentSkyContext(timezoneName) {
  const now = Date.now();
  if (!skyCache.sky || now - skyCache.at > SKY_CACHE_MS) {
    const instant = new Date(now);
    skyCache = {
      at: now,
      sky: currentSky(instant),
      lunarEvents: nextLunarEvents(instant),
    };
  }
  return createCurrentSkyContext({
    at: new Date(skyCache.sky.instant_utc),
    timezoneName,
    timezoneSource: "request",
    skySnapshot: skyCache.sky,
    lunarEventsSnapshot: skyCache.lunarEvents,
  });
}

function mapError(e) {
  if (e instanceof ChartError) {
    const status = { not_found: 404, invalid_input: 400, last_chart: 409 }[e.code] || 400;
    return err(status, e.message, { code: e.code });
  }
  // Saving a chart verifies the birthplace signature, and that verification
  // needs the same provider key the search used. When the key is absent the
  // signer raises a LocationError, which is a configuration answer — not a
  // crash — and used to surface as a bare 500 "Chart operation failed". That
  // told the person nothing and told the operator nothing either.
  if (e instanceof LocationError) {
    return err(e.status || 400, e.message, { code: e.code });
  }
  // Avatar refusals are answers, not crashes. Each carries a stable code and a
  // status that says what happened: a stale write is a conflict, an oversized
  // image is a payload problem, and everything else the validator refuses is a
  // bad request. Without this branch every one of them surfaced as a bare 500,
  // which told a probing client nothing and a legitimate client less.
  if (e instanceof AvatarError) {
    const status = e.code === "avatar_stale_write" ? 409
      : e.code === "avatar_too_large" ? 413
        : 400;
    return err(status, e.message, { code: e.code });
  }
  // Identity refusals (name and relationship rules) are client errors with
  // structured codes, exactly like the validator's.
  if (e instanceof IdentityError) {
    return err(400, e.message, { code: e.code });
  }
  return err(500, "Chart operation failed");
}

function serviceFor(auth = null) {
  return createChartService(auth ? createSupabaseChartStore(auth) : supabaseChartStore);
}

function requireOwner(auth = null) {
  if (auth?.ownerId && auth?.accessToken && auth?.anonKey && auth?.url) {
    return { owner: auth.ownerId, guard: null };
  }
  const owner = currentOwnerId();
  if (!owner || !isConfigured()) {
    return { owner: null, guard: err(401, "Sign-in required. Configure SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_ACCESS_TOKEN, and SUPABASE_OWNER_ID for the current user.") };
  }
  return { owner, guard: null };
}

// route: pathname (already known to start with the handled prefixes)
// Returns null if this module doesn't own the route.
// `raw` carries what a JSON body cannot: the avatar bytes, the declared
// Content-Type, and the request headers needed for conditional GETs. It is
// optional, so every existing caller keeps working unchanged.
export async function handleChartsRoute(method, route, query, body, auth = null, raw = {}) {
  const requestBody = raw.body ?? null;
  const contentType = raw.contentType ?? null;
  const requestHeaders = raw.headers ?? {};
  // ── current sky (public astronomy, no owner needed) ──
  // Accepts an optional ?tz=<IANA zone> for display-only local time/date;
  // the astronomy itself is always computed at the UTC instant.
  if (route === "/api/sky/current" && method === "GET") {
    // Highlights and Moon state are composed here, server-side, for the same
    // reason the chart reading is: one ranker, one Moon accessor, and no way
    // for the browser to grow a second opinion about either.
    const sky = cachedCurrentSkyContext(query?.get?.("tz"));
    return ok({
      sky,
      highlights: composeHighlights(sky),
      moon: moonState(sky),
      // Positions reads the same snapshot Home does, so the two pages cannot
      // disagree about the Sun, the Moon, or the retrograde count.
      positions: composePositions(sky),
      summary: composeSkySummary(sky),
      calculation: calculationDetails(sky),
    });
  }
  if (route === "/api/moon/current" && method === "GET") {
    const context = cachedCurrentSkyContext(query?.get?.("tz"));
    return ok({
      context_version: context.context_version,
      moon: context.moon,
      calculated_at_utc: context.calculated_at_utc,
      instant_utc: context.instant_utc,
      timezone_name: context.timezone_name,
      timezone_source: context.timezone_source,
      timezone_fallback: context.timezone_fallback,
      local_date: context.local_date,
      local_date_time: context.local_date_time,
      local_time_iso: context.local_time_iso,
      next_full_moon: context.next_full_moon,
      next_new_moon: context.next_new_moon,
      source: context.source,
    });
  }

  // Stateless natal preview (no persistence, no owner needed).
  if (route === "/api/chart/preview" && method === "POST") {
    try { return ok({ chart: previewChart(body || {}) }); }
    catch (e) { return mapError(e); }
  }

  if (!route.startsWith("/api/charts")) return null;

  const { owner, guard } = requireOwner(auth);
  if (guard) return guard;
  const svc = serviceFor(auth);

  // /api/charts
  if (route === "/api/charts") {
    if (method === "GET") { return ok(await svc.list(owner)); }
    if (method === "POST") {
      try {
        // ── Entitlement (Dev Update 3.0) ──────────────────────────────────
        // Counted from the owner's own list rather than a stored counter: a
        // counter and the rows it counts are two sources of one truth, and
        // they drift the first time a delete fails halfway.
        //
        // REFUSING, not clamping. The chart would not exist, so there is
        // nothing honest to return a smaller version of — unlike history,
        // which clamps. Returns null while enforcement is dark.
        const existing = await svc.list(owner);
        const count = Array.isArray(existing?.charts) ? existing.charts.length : 0;
        const refusal = await refuseIfAtLimit(
          auth, "chart.saved.limit", count,
          "You have reached the number of charts your plan can save.");
        if (refusal) return refusal;

        return ok(await svc.create(owner, body || {}));
      } catch (e) { return mapError(e); }
    }
    return err(405, "Method not allowed");
  }

  // /api/charts/:id[/action]
  const rest = route.slice("/api/charts/".length);
  const [id, action] = rest.split("/");
  if (!UUID_RE.test(id)) return err(400, "Invalid chart id");

  try {
    if (!action) {
      if (method === "GET") {
        // The reading is composed here, server-side, so the browser has exactly
        // one source for interpretation text and no way to invent a second.
        const result = await svc.get(owner, id);
        return ok({ ...result, reading: buildChartReading(result.chart, result.profile) });
      }
      if (method === "PATCH") return ok(await svc.update(owner, id, body || {}));
      if (method === "DELETE") {
        const confirmEmpty = query.get("confirmEmpty") === "true" || body?.confirmEmpty === true;
        // The stored path is read BEFORE the row goes — the row is the only
        // thing that knows it — but the object is removed AFTER svc.remove
        // has passed every guard, so a refused deletion (wrong owner, an
        // unconfirmed last chart) leaves the picture exactly where it was.
        const profile = await svc.profileFor(owner, id);
        const result = await svc.remove(owner, id, { confirmEmpty });
        // Row first, object second — NOT one transaction, and not claimed to
        // be. A failure here leaves residue under the owner's own prefix,
        // named in the response, removable by account deletion's sweep; a
        // missing object is already the state removal exists to reach.
        let avatarCleanup = "none";
        if (profile.avatar_storage_path) {
          const removed = await createAvatarStore(auth).remove(profile.avatar_storage_path);
          avatarCleanup = removed.ok ? "removed" : "residual";
        }
        return ok({ ...result, avatar_cleanup: avatarCleanup });
      }
      return err(405, "Method not allowed");
    }
    // Personal transits: the shared sky measured against ONE owned chart.
    // Ownership is enforced by svc.get, so a chart id belonging to someone
    // else fails here exactly as it does everywhere else.
    if (action === "transits" && method === "GET") {
      const { chart } = await svc.get(owner, id);
      const sky = cachedCurrentSkyContext(query?.get?.("tz"));
      const groups = groupTransits(findTransits(sky, chart));
      return ok({
        calculatedAt: sky.local_time_iso || null,
        timezone: sky.timezone_name || null,
        localDate: sky.local_date || null,
        summary: summarise(groups),
        // Readings are composed here so the browser renders text it was given
        // and cannot grow a second interpretation of the same aspect.
        immediate: composeAll(groups.immediate),
        background: composeAll(groups.background),
        all: groups.all,
        limitation: birthTimeNotice(chart),
      });
    }
    // ── Chart avatars ───────────────────────────────────────────────────
    //
    // Ownership is established by svc.profileFor BEFORE any storage call, so a
    // chart id belonging to someone else fails here exactly as it does
    // everywhere else — the Storage policies are the second line, not the
    // first. profileFor rather than get: an avatar request needs the stored
    // row, not a natal calculation.
    //
    // The raw object path is built from ids the server already holds and is
    // never returned; responses carry publicIdentity only.
    if (action === "avatar") {
      const profile = await svc.profileFor(owner, id);     // throws not_found for others
      const store = createAvatarStore(auth);
      const path = avatarObjectPath(owner, profile.id);

      if (method === "GET") {
        if (!profile.avatar_storage_path) return err(404, "No picture for this chart", { code: "avatar_not_found" });
        // A version-keyed validator: replacing the image changes the tag, so a
        // stale picture cannot survive in a cache.
        const headers = avatarCacheHeaders(profile.avatar_version, "image/webp");
        if (requestHeaders?.["if-none-match"] === headers.ETag) {
          return { status: 304, headers, body: null };
        }
        const got = await store.get(path);
        if (got.missing) {
          // Metadata says there is an image and Storage disagrees. Say so
          // plainly so the interface can fall back and the row stays
          // repairable by replacing or removing.
          return err(404, "That picture is no longer available", { code: "avatar_missing_object" });
        }
        if (!got.ok) return err(502, "We couldn't load that picture just now", { code: "avatar_storage_failed" });
        // The stored content type wins over the assumed one: a valid PNG
        // upload must not be served labelled as WebP under nosniff.
        return { status: 200, headers: { ...headers, "Content-Type": got.contentType }, body: got.bytes, binary: true };
      }

      if (method === "POST") {
        const bytes = requestBody instanceof Uint8Array ? Buffer.from(requestBody) : requestBody;
        // Throws AvatarError with a structured code; mapError turns it into a
        // client message that names no bucket, path, or uuid.
        const verdict = validateAvatarUpload(bytes, { declaredType: contentType || null });
        assertFreshWrite(query?.get?.("expectedVersion") ?? body?.expected_version ?? null,
          profile.avatar_version);

        const put = await store.put(path, bytes, verdict.contentType);
        if (!put.ok) {
          // Nothing was written to the row, so the previous avatar — and its
          // metadata — are exactly as they were.
          return err(502, "We couldn't save that picture just now", { code: "avatar_storage_failed" });
        }
        // Metadata moves only after the bytes are safely stored, and only if
        // the version is still the one this request read — a concurrent
        // replacement or removal makes this a stale write, refused at the row
        // itself. If the write fails the object exists but the row still
        // points at the old version, which is recoverable by uploading again;
        // the reverse order would leave a row pointing at bytes that were
        // never written.
        const updated = await svc.setAvatarState(owner, id, {
          expectedVersion: profile.avatar_version, storagePath: path,
        });
        return ok({ identity: publicIdentity(updated) });
      }

      if (method === "DELETE") {
        assertFreshWrite(query?.get?.("expectedVersion") ?? body?.expected_version ?? null,
          profile.avatar_version);
        const removed = await store.remove(path);
        if (!removed.ok) {
          return err(502, "We couldn't remove that picture just now", { code: "avatar_remove_failed" });
        }
        // An object that was already gone still clears the metadata: removal
        // exists to reach a state, and that state is "no picture".
        const updated = await svc.setAvatarState(owner, id, {
          expectedVersion: profile.avatar_version, storagePath: null,
        });
        return ok({ identity: publicIdentity(updated) });
      }
      return err(405, "Method not allowed");
    }
    if (action === "activate" && method === "POST") return ok(await svc.activate(owner, id));
    if (action === "calculate" && method === "POST") return ok(await svc.calculate(owner, id, { force: body?.force === true }));
    return err(404, "Unknown chart route");
  } catch (e) {
    return mapError(e);
  }
}
