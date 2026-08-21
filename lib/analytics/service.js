// Orbit Axis :: first-party analytics service (Dev Update 6.0).
//
// Two jobs, kept apart on purpose.
//
// WRITING is done with the ANONYMOUS key, because the visitors worth counting
// are the ones who have not signed up and hold no token. The events table is
// insertable by anon for that reason, and the database constrains the event
// name so an open insert path cannot become an open storage path. When a
// request does carry a verified session, the owner id is taken FROM THAT
// SESSION and never from the request body — the same rule the rest of Orbit
// follows about who a write belongs to.
//
// READING is admin-only and goes through the caller's OWN token, so the
// allowlist in orbit_x_admins and the RLS policies are what decide, not this
// file. A non-admin reaching these functions gets nothing back because the
// database returns nothing, which is the correct place for that answer.
//
// Writing NEVER throws into the request path. A failed count must not turn into
// a failed page: every write path returns a boolean and swallows the reason.

import { supabaseConfig } from "../local-llm/config.js";
import { validateEvent, validateSession } from "./events.js";

const TIMEOUT_MS = 8000;

function anonBase(override = null) {
  // Injectable so the write path can be exercised without ambient environment.
  // It read process.env directly at first, which made every test that asserts
  // what gets written depend on whether a .env file happened to be present —
  // they passed under `npm run test:local` and failed under a bare `node
  // --test`, which is a test that proves nothing about the code.
  const config = override || supabaseConfig();
  if (!config.url || !config.anonKey) return null;
  return {
    root: config.url.replace(/\/+$/, ""),
    headers: {
      apikey: config.anonKey,
      authorization: `Bearer ${config.anonKey}`,
      "content-type": "application/json",
    },
  };
}

function authedBase(auth) {
  const config = supabaseConfig();
  const url = auth?.url || config.url;
  const anonKey = auth?.anonKey || config.anonKey;
  const accessToken = auth?.accessToken;
  if (!url || !anonKey || !accessToken) return null;
  return {
    root: url.replace(/\/+$/, ""),
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
  };
}

async function post(base, pathQuery, body, extraHeaders, fetchImpl) {
  const res = await fetchImpl(`${base.root}/rest/v1/${pathQuery}`, {
    method: "POST",
    headers: { ...base.headers, ...extraHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`rest_${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function get(base, pathQuery, fetchImpl) {
  const res = await fetchImpl(`${base.root}/rest/v1/${pathQuery}`, {
    method: "GET",
    headers: base.headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`rest_${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Record a visit.
 *
 * A PLAIN INSERT, not an upsert. PostgREST resolves `on_conflict` by reading
 * the existing row, so an upsert needs SELECT on the table — and anon
 * deliberately has none, because these tables are readable only by an admin.
 * Asking for the upsert returned 401 and recorded nothing, which is the failure
 * this comment exists to stop anyone reintroducing.
 *
 * Idempotency does not need the upsert: the session id is the primary key, so a
 * replayed landing beacon is rejected by the database rather than duplicated,
 * and the rejection is swallowed like any other write failure. The first
 * landing wins, which is the one that carries the attribution.
 *
 * @returns {Promise<boolean>} whether it was written; never throws
 */
export async function recordSession(body, { fetchImpl = fetch, config = null } = {}) {
  const row = validateSession(body);
  if (!row) return false;
  const base = anonBase(config);
  if (!base) return false;
  try {
    await post(base, "analytics_sessions", row, { prefer: "return=minimal" }, fetchImpl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Record one event.
 *
 * `ownerId` comes from the verified session at the call site, or is null. A
 * client cannot claim to be an account here, which is why the parameter is
 * separate from the body rather than read out of it.
 *
 * @returns {Promise<boolean>} whether it was written; never throws
 */
export async function recordEvent(body, { ownerId = null, fetchImpl = fetch, config = null } = {}) {
  const event = validateEvent(body);
  if (!event) return false;
  const base = anonBase(config);
  if (!base) return false;
  try {
    await post(base, "analytics_events", { ...event, owner_id: ownerId || null },
      { prefer: "return=minimal" }, fetchImpl);
    return true;
  } catch {
    return false;
  }
}

const DAY_MS = 86_400_000;
const iso = (now, days) => new Date(now.getTime() - days * DAY_MS).toISOString();

/** Count rows without transferring them: PostgREST's exact count header. */
async function countRows(base, table, query, fetchImpl) {
  const res = await fetchImpl(`${base.root}/rest/v1/${table}?${query}&select=id`, {
    method: "HEAD",
    headers: { ...base.headers, prefer: "count=exact" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`rest_${res.status}`);
  const range = res.headers.get("content-range") || "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

/**
 * The beta metrics panel's numbers.
 *
 * AGGREGATES ONLY. Nothing here returns a row, an id, an email, or anything
 * that could identify one person — the panel exists to answer whether the
 * experiment is working, and a list of who did what is not needed for that and
 * would be a different thing entirely.
 *
 * Account totals come from a security-definer function because auth.users is
 * not reachable any other way; it returns counts and refuses non-admins itself.
 */
export async function betaMetrics({ auth, now = new Date(), fetchImpl = fetch } = {}) {
  const base = authedBase(auth);
  if (!base) return null;

  const since7 = iso(now, 7);
  const since30 = iso(now, 30);

  // Sessions and events, read under the admin's own token so RLS decides.
  const [sessions7, sessions30, events30] = await Promise.all([
    get(base, `analytics_sessions?created_at=gte.${since7}&select=visitor_id,utm_source,utm_campaign,campaign_key`, fetchImpl),
    get(base, `analytics_sessions?created_at=gte.${since30}&select=visitor_id,created_at,utm_source`, fetchImpl),
    get(base, `analytics_events?occurred_at=gte.${since30}&select=name,visitor_id,owner_id,occurred_at`, fetchImpl),
  ]);

  const countBy = (rows, key) => {
    const out = {};
    for (const row of rows || []) {
      const value = row[key] || "(direct)";
      out[value] = (out[value] || 0) + 1;
    }
    return out;
  };

  const eventsByName = {};
  for (const row of events30 || []) eventsByName[row.name] = (eventsByName[row.name] || 0) + 1;

  // A returning visitor is one seen on more than one distinct day. Days rather
  // than sessions, because two tabs in one sitting is not a return.
  const daysByVisitor = new Map();
  for (const row of sessions30 || []) {
    const day = String(row.created_at || "").slice(0, 10);
    if (!day) continue;
    if (!daysByVisitor.has(row.visitor_id)) daysByVisitor.set(row.visitor_id, new Set());
    daysByVisitor.get(row.visitor_id).add(day);
  }
  let returningVisitors = 0;
  for (const days of daysByVisitor.values()) if (days.size > 1) returningVisitors += 1;

  // Conversion by source: of the PEOPLE attributed to a source, how many
  // signed up. Counted per visitor rather than per visit — one person who
  // arrives from the same link three times is one person, and counting them
  // three times would report a conversion rate above what actually happened.
  // Raw pairs, never a percentage: a rate computed from four visits reads like
  // a trend and is not one.
  const signupVisitors = new Set(
    (events30 || []).filter((e) => e.name === "signup_completed").map((e) => e.visitor_id));
  const visitorsBySource = new Map();
  const visitsBySource = {};
  for (const row of sessions30 || []) {
    const source = row.utm_source || "(direct)";
    visitsBySource[source] = (visitsBySource[source] || 0) + 1;
    if (!visitorsBySource.has(source)) visitorsBySource.set(source, new Set());
    visitorsBySource.get(source).add(row.visitor_id);
  }
  const bySource = {};
  for (const [source, visitors] of visitorsBySource) {
    let signups = 0;
    for (const visitor of visitors) if (signupVisitors.has(visitor)) signups += 1;
    bySource[source] = { visits: visitsBySource[source], visitors: visitors.size, signups };
  }

  // Account-level facts, from the admin-gated counting function.
  let accounts = null;
  try {
    accounts = await post(base, "rpc/orbit_beta_account_totals", {}, {}, fetchImpl);
  } catch {
    accounts = null;
  }

  return {
    generated_at: now.toISOString(),
    window_days: 30,
    accounts,
    visits: {
      sessions_7d: (sessions7 || []).length,
      sessions_30d: (sessions30 || []).length,
      unique_visitors_30d: daysByVisitor.size,
      returning_visitors_30d: returningVisitors,
    },
    acquisition: {
      by_source_30d: countBy(sessions30 || [], "utm_source"),
      by_campaign_7d: countBy(sessions7 || [], "utm_campaign"),
      by_orbit_x_content_7d: countBy(sessions7 || [], "campaign_key"),
      conversion_by_source_30d: bySource,
    },
    usage_30d: eventsByName,
    // Stated with the numbers rather than in a doc nobody opens beside them.
    caveats: [
      "First-party only. Visitors who block storage, or send Do Not Track or Global Privacy Control, are not counted.",
      "Event inserts are open to anonymous callers by design, so counts are a floor with a spam ceiling, not an audited ledger.",
      "Signed-out usage is counted per browser, not per person.",
    ],
  };
}

export { countRows };
