// Orbit Axis :: fortune / settings HTTP dispatch (transport-agnostic).
//
// Returns { status, body }. Owner derived from the authenticated server
// identity (never the client). A stateless /api/fortune/preview path composes a
// deterministic fortune from posted birth data with no persistence, so Today
// works in local dev before sign-in. Fortune responses carry per-level factor
// phrasings so the client renders Simple/Advanced without extra calls.

import { createFortuneService, fortuneForProfile, FortuneError, DEFAULT_DETAIL, DEFAULT_CURRENT_TIMEZONE } from "./service.js";
import { createSupabaseFortuneStore, supabaseFortuneStore, currentOwnerId, isConfigured } from "./store.js";
import { createChartService } from "../charts/service.js";
import { createSupabaseChartStore, supabaseChartStore } from "../charts/store.js";
import { sanitizePreviewInput } from "./sanitize.js";
import { isValidIanaTimezone, timezoneForCoordinates, validateCoordinates, TimezoneError } from "../locations/timezone.js";
import { clampHistoryWindow } from "../entitlements/enforce.js";

/**
 * The readings whose local day falls inside the last `days` days, today
 * included — so a window of 7 means today and the six before it, not today
 * plus seven, which would quietly hand out an extra day.
 *
 * A reading with no fortune_date is KEPT. Dropping a row because a date is
 * missing would turn a data problem into the appearance of deleted history.
 */
function withinDays(fortunes, days) {
  if (!Array.isArray(fortunes) || !Number.isFinite(days)) return fortunes;
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  return fortunes.filter((f) => {
    if (!f?.fortune_date) return true;
    const at = Date.parse(`${f.fortune_date}T00:00:00Z`);
    return Number.isNaN(at) ? true : at >= cutoff.getTime();
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(status, error, extra = {}) { return { status, body: { ok: false, error, ...extra } }; }
function ok(body) { return { status: 200, body: { ok: true, ...body } }; }

function servicesFor(auth = null) {
  return {
    fortuneSvc: createFortuneService(auth ? createSupabaseFortuneStore(auth) : supabaseFortuneStore),
    chartSvc: createChartService(auth ? createSupabaseChartStore(auth) : supabaseChartStore),
  };
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

export async function handleFortuneRoute(method, route, query, body, auth = null) {
  // ── stateless preview (no owner, no persistence) ──
  if (route === "/api/fortune/preview" && method === "POST") {
    let input;
    try { input = sanitizePreviewInput(body || {}); }
    catch (e) { return err(400, e.message); }
    const currentTz = isValidIanaTimezone(body?.current_timezone_name) ? body.current_timezone_name : null;
    const fortune = fortuneForProfile({ ...input, id: "local" }, new Date(), currentTz);
    return ok({ fortune, detail_level: (body && body.detail_level) || DEFAULT_DETAIL, cached: false, persisted: false });
  }

  // ── detail-level setting ──
  if (route === "/api/settings/detail") {
    const { owner, guard } = requireOwner(auth);
    const { fortuneSvc } = servicesFor(auth);
    if (method === "GET") {
      if (!owner) return ok({ astrology_detail_level: DEFAULT_DETAIL, persisted: false });
      try { return ok({ astrology_detail_level: await fortuneSvc.getDetail(owner), persisted: true }); }
      catch { return ok({ astrology_detail_level: DEFAULT_DETAIL, persisted: false }); }
    }
    if (method === "PUT" || method === "POST") {
      if (guard) return guard;
      try { return ok(await fortuneSvc.setDetail(owner, body?.astrology_detail_level)); }
      catch (e) { return err(e instanceof FortuneError ? 400 : 500, e.message); }
    }
    return err(405, "Method not allowed");
  }

  // ── current-timezone setting (distinct from birth timezone) ──
  if (route === "/api/settings/current-timezone") {
    const { owner, guard } = requireOwner(auth);
    const { fortuneSvc } = servicesFor(auth);
    if (method === "GET") {
      if (!owner) return ok({ timezone_name: DEFAULT_CURRENT_TIMEZONE, source: null, persisted: false });
      try { return ok(await fortuneSvc.getCurrentTimezone(owner)); }
      catch { return ok({ timezone_name: DEFAULT_CURRENT_TIMEZONE, source: null, persisted: false }); }
    }
    if (method === "PUT" || method === "POST") {
      if (guard) return guard;
      try { return ok({ ...(await fortuneSvc.setCurrentTimezone(owner, body || {})), persisted: true }); }
      catch (e) { return err(e instanceof FortuneError ? 400 : 500, e.message); }
    }
    return err(405, "Method not allowed");
  }

  // ── resolve current timezone from browser geolocation coordinates ──
  // Session-only: coordinates are used to look up a timezone and are never
  // persisted. If signed in, the resolved zone is stored (source=geolocation);
  // if not, it's simply returned for the client to hold for this session.
  if (route === "/api/settings/current-location" && method === "POST") {
    let latitude, longitude;
    try {
      ({ latitude, longitude } = validateCoordinates(body?.latitude, body?.longitude));
    } catch (e) {
      return err(400, e instanceof TimezoneError ? e.message : "Invalid coordinates");
    }
    let timezone_name;
    try { timezone_name = timezoneForCoordinates(latitude, longitude); }
    catch (e) { return err(400, e.message); }
    const { owner } = requireOwner(auth);
    const { fortuneSvc } = servicesFor(auth);
    if (owner) {
      try { await fortuneSvc.setCurrentTimezone(owner, { timezone_name, source: "geolocation" }); }
      catch { /* best-effort persistence; the resolved zone still returns */ }
    }
    return ok({ timezone_name, source: "geolocation", persisted: !!owner });
  }

  if (!route.startsWith("/api/fortune")) return null;

  const { owner, guard } = requireOwner(auth);
  if (guard) return guard;
  const { fortuneSvc, chartSvc } = servicesFor(auth);

  // ── today's fortune for the active chart ──
  if (route === "/api/fortune/today" && method === "GET") {
    let active;
    try { active = await chartSvc.getActive(owner); }
    catch (e) { return err(500, "Could not load active chart"); }
    if (!active) return err(404, "No active chart. Add a chart to see your daily fortune.", { code: "no_active_chart" });
    try {
      const [detail, currentTz] = await Promise.all([fortuneSvc.getDetail(owner), fortuneSvc.getCurrentTimezone(owner)]);
      const { fortune, cached } = await fortuneSvc.today(owner, active.profile, new Date(), currentTz.timezone_name);
      return ok({ fortune, cached, detail_level: detail, chart: { id: active.profile.id, nickname: active.profile.nickname }, current_timezone: currentTz });
    } catch (e) {
      return err(e instanceof FortuneError ? 400 : 500, e.message);
    }
  }

  // ── history ──
  if (route === "/api/fortune/history" && method === "GET") {
    const scope = query.get("scope") || "active"; // active | all | specific
    let birthProfileId = null;
    if (scope === "active") {
      const active = await chartSvc.getActive(owner);
      birthProfileId = active?.profile?.id || null;
      if (!birthProfileId) return ok({ fortunes: [], scope, note: "No active chart yet." });
    } else if (scope === "specific") {
      birthProfileId = query.get("chart_id");
      if (!birthProfileId || !UUID_RE.test(birthProfileId)) return err(400, "scope=specific requires a valid chart_id");
    }
    const limit = Math.min(Number(query.get("limit")) || 30, 30);
    const fortunes = await fortuneSvc.history(owner, { birthProfileId, limit });

    // ── Entitlement (Dev Update 3.0) ────────────────────────────────────────
    // CLAMPED, NOT REFUSED. A 403 when somebody asks for their own past
    // readings reads as a bug, and gets reported as one. A shorter list plus an
    // honest marker is the truth: these are the readings your plan keeps.
    //
    // Clamped by DAY rather than by count, because the plan promises days. A
    // count would silently give someone with gaps in their history a longer
    // window than someone who reads every morning.
    //
    // The window is measured against fortune_date, the local day the reading is
    // FOR — not created_at, which is when a row happened to be written.
    const { days, clamped } = await clampHistoryWindow(auth, null);
    const kept = clamped ? withinDays(fortunes, days) : fortunes;

    return ok({
      fortunes: kept,
      scope,
      count: kept.length,
      ...(clamped ? { window_days: days, clamped: true } : {}),
    });
  }

  // ── single fortune by id ──
  const m = route.match(/^\/api\/fortune\/([^/]+)$/);
  if (m && method === "GET") {
    const id = m[1];
    if (!UUID_RE.test(id)) return err(400, "Invalid fortune id");
    const list = await fortuneSvc.history(owner, { limit: 30 });
    const found = list.find((f) => f.id === id);
    return found ? ok({ fortune: found }) : err(404, "Fortune not found");
  }

  return err(404, "Unknown fortune route");
}
