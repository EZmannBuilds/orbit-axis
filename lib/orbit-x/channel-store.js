// Orbit X :: channel persistence (Dev Update 6.1).
//
// TWO CREDENTIAL LANES, ONE SHAPE. The cron job has no signed-in user, so it
// writes with the service-role key under the purpose-named "orbit-x-channel"
// authorization (lib/env/service-role.js), exactly as billing webhooks do. The
// desk reads the same tables with the admin's own token, and RLS answers the
// membership question a second time. Same functions, different credentials;
// the database decides what each lane may do.
//
// Facts stay write-once here too: updatePost() has its own allow-list and
// event_payload is not on it, and a database trigger refuses the change for
// every role, the service role included.

import { supabaseConfig } from "../local-llm/config.js";
import { resolveEnvironment } from "../env/environment.js";
import { serviceRoleVerdict } from "../env/service-role.js";

export class OrbitXChannelStoreError extends Error {
  constructor(message, { code = "channel_store_failed", status = 502 } = {}) {
    super(message);
    this.name = "OrbitXChannelStoreError";
    this.code = code;
    this.status = status;
  }
}

export const LIVE_POST_STATUSES = Object.freeze(["approved", "exported", "scheduled", "published"]);
export const TERMINAL_RUN_STATES = Object.freeze(["published", "dry_run_complete", "skipped", "failed", "expired", "killed"]);

const POST_UPDATABLE = new Set([
  "status", "approved_at", "published_at", "external_media_id", "permalink", "media",
  "publish_container_id", "publish_attempts", "last_publish_error", "scheduled_at",
  "rejection_reason", "editor_notes", "updated_at",
]);
const RUN_UPDATABLE = new Set([
  "state", "post_id", "post_type_id", "post_type_label", "format", "family", "autonomy",
  "plan", "checks", "generated", "media", "graph", "error", "attempts", "lease_until",
  "updated_at", "finished_at",
]);

/**
 * Service-role credentials for the channel, or null with a logged reason.
 * Mirrors billingAdminConfig(): local and test use the database on this
 * machine; production additionally needs the purpose-named allowance.
 */
export function channelAdminConfig(env = process.env, { log = console.error } = {}) {
  // The process environment may still need .env.local loaded (local dev, as
  // billing does); an injected environment (tests) is taken as given.
  const url = env.SUPABASE_URL || (env === process.env ? supabaseConfig().url : "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return null;
  const environment = resolveEnvironment({ env, loadEnvFiles: false });
  if (environment.isProduction) {
    const allowance = serviceRoleVerdict("orbit-x-channel", env, {
      environment: environment.environment, isVercel: environment.isVercel,
      vercelEnv: environment.vercelEnv, isDeployed: environment.isDeployed,
    });
    if (!allowance.authorized) {
      log(`[orbit-x-channel] service-role use refused: ${allowance.reason} (no key material is logged)`);
      return null;
    }
  }
  return { url, serviceKey };
}

/**
 * @param {{ url: string, apiKey: string, bearer: string }} creds
 *   service lane: { url, apiKey: serviceKey, bearer: serviceKey }
 *   desk lane:    { url, apiKey: anonKey,    bearer: adminAccessToken }
 */
export function channelStore(creds, { fetchImpl = fetch } = {}) {
  const root = String(creds?.url || "").replace(/\/+$/, "");
  const headers = {
    apikey: creds?.apiKey,
    authorization: `Bearer ${creds?.bearer}`,
    "content-type": "application/json",
    accept: "application/json",
  };
  const rest = (path) => `${root}/rest/v1/${path}`;
  const q = encodeURIComponent;

  async function request(path, { method = "GET", body, prefer, allowConflict = false } = {}) {
    let res;
    try {
      res = await fetchImpl(rest(path), {
        method,
        headers: { ...headers, ...(prefer ? { prefer } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new OrbitXChannelStoreError("Channel storage could not be reached.", { code: "channel_store_unreachable" });
    }
    if (res.status === 409 && allowConflict) return { conflict: true, rows: [] };
    if (!res.ok) {
      throw new OrbitXChannelStoreError("Channel storage refused the request.",
        { code: res.status === 409 ? "channel_store_conflict" : "channel_store_refused", status: res.status === 401 ? 401 : 502 });
    }
    const rows = await res.json().catch(() => []);
    return { conflict: false, rows: Array.isArray(rows) ? rows : [rows] };
  }

  const clean = (fields, allowed, what) => {
    const out = {};
    for (const [key, value] of Object.entries(fields || {})) {
      if (!allowed.has(key)) {
        throw new OrbitXChannelStoreError(`"${key}" is not an editable ${what} column.`, { code: "column_refused", status: 400 });
      }
      out[key] = value;
    }
    out.updated_at = new Date().toISOString();
    return out;
  };

  return {
    /* ── control (the instant pause) ── */
    async getControl() {
      const { rows } = await request("orbit_x_channel_control?id=eq.1&select=paused,reason,updated_at&limit=1");
      return rows[0] || { paused: false, reason: null, updated_at: null };
    },
    async setControl({ paused, reason = null, updatedBy = null }) {
      const { rows } = await request("orbit_x_channel_control?id=eq.1", {
        method: "PATCH", prefer: "return=representation",
        body: { paused: Boolean(paused), reason: reason ? String(reason).slice(0, 200) : null,
          updated_at: new Date().toISOString(), ...(updatedBy ? { updated_by: updatedBy } : {}) },
      });
      if (!rows[0]) throw new OrbitXChannelStoreError("The channel control row is missing.", { code: "control_missing", status: 404 });
      return rows[0];
    },

    /* ── the registry ── */
    async listPostTypes() {
      const { rows } = await request("orbit_x_post_types?select=*&order=type_key.asc,version.desc&limit=500");
      return rows;
    },
    async postTypeById(id) {
      const { rows } = await request(`orbit_x_post_types?id=eq.${q(id)}&select=*&limit=1`);
      return rows[0] || null;
    },
    async insertPostTypes(list) {
      if (!list.length) return [];
      const { rows, conflict } = await request("orbit_x_post_types", {
        method: "POST", prefer: "return=representation", body: list, allowConflict: true,
      });
      return conflict ? [] : rows;
    },
    async updatePostType(id, fields) {
      const allowed = new Set(["status", "decision_reason", "updated_at"]);
      const { rows } = await request(`orbit_x_post_types?id=eq.${q(id)}`, {
        method: "PATCH", prefer: "return=representation", body: clean(fields, allowed, "post type"),
      });
      if (!rows[0]) throw new OrbitXChannelStoreError("No such post type.", { code: "type_missing", status: 404 });
      return rows[0];
    },

    /* ── runs ── */
    async runBySlot(slotKey) {
      const { rows } = await request(`orbit_x_channel_runs?slot_key=eq.${q(slotKey)}&select=*&limit=1`);
      return rows[0] || null;
    },
    async runById(id) {
      const { rows } = await request(`orbit_x_channel_runs?id=eq.${q(id)}&select=*&limit=1`);
      return rows[0] || null;
    },
    /** Insert, or null when the slot is already claimed (the idempotency path). */
    async insertRun(row) {
      const { rows, conflict } = await request("orbit_x_channel_runs", {
        method: "POST", prefer: "return=representation", body: row, allowConflict: true,
      });
      return conflict ? null : rows[0] || null;
    },
    /** Take the lease if nobody holds a live one. Returns the row, or null. */
    async leaseRun(id, untilIso, nowIso) {
      const filter = `id=eq.${q(id)}&or=${q(`(lease_until.is.null,lease_until.lt."${nowIso}")`)}`;
      const { rows } = await request(`orbit_x_channel_runs?${filter}`, {
        method: "PATCH", prefer: "return=representation", body: { lease_until: untilIso, updated_at: nowIso },
      });
      return rows[0] || null;
    },
    async updateRun(id, fields) {
      const { rows } = await request(`orbit_x_channel_runs?id=eq.${q(id)}`, {
        method: "PATCH", prefer: "return=representation", body: clean(fields, RUN_UPDATABLE, "run"),
      });
      return rows[0] || null;
    },
    async unfinishedRunsBefore(slotDate) {
      const { rows } = await request(`orbit_x_channel_runs?slot_date=lt.${q(slotDate)}`
        + `&state=not.in.(${TERMINAL_RUN_STATES.join(",")})&select=*&limit=20`);
      return rows;
    },
    async recentRuns({ mode = null, limit = 40 } = {}) {
      const filter = mode ? `&mode=eq.${q(mode)}` : "";
      const { rows } = await request(`orbit_x_channel_runs?select=*${filter}&order=slot_date.desc,created_at.desc&limit=${Math.min(Number(limit) || 40, 200)}`);
      return rows;
    },

    /* ── the audit log ── */
    async appendEvent(runId, step, outcome, detail = null) {
      await request("orbit_x_channel_events", {
        method: "POST", prefer: "return=minimal",
        body: { run_id: runId || null, step: String(step).slice(0, 64), outcome, detail },
      });
    },
    async eventsForRun(runId) {
      const { rows } = await request(`orbit_x_channel_events?run_id=eq.${q(runId)}&select=*&order=at.asc&limit=500`);
      return rows;
    },
    async recentEvents({ step = null, sinceIso = null, limit = 50 } = {}) {
      const filters = [step ? `step=eq.${q(step)}` : "", sinceIso ? `at=gte.${q(sinceIso)}` : ""].filter(Boolean).join("&");
      const { rows } = await request(`orbit_x_channel_events?select=*${filters ? `&${filters}` : ""}&order=at.desc&limit=${limit}`);
      return rows;
    },

    /* ── posts ── */
    async liveCoverage({ eventKey = null, periodKey = null } = {}) {
      // Keys contain ":" and "-", which PostgREST's or() needs quoted.
      const keys = [eventKey ? `event_key.eq."${eventKey}"` : null, periodKey ? `period_key.eq."${periodKey}"` : null].filter(Boolean);
      if (!keys.length) return [];
      const or = q(`(${keys.join(",")})`);
      const { rows } = await request(`orbit_x_posts?or=${or}&status=in.(${LIVE_POST_STATUSES.join(",")})&select=id,status,origin,created_at&limit=10`);
      return rows;
    },
    async insertPost(row) {
      const { rows, conflict } = await request("orbit_x_posts", {
        method: "POST", prefer: "return=representation", body: row, allowConflict: true,
      });
      if (conflict) return { conflict: true, post: null };
      if (!rows[0]) throw new OrbitXChannelStoreError("The channel post could not be saved.", { code: "insert_unconfirmed" });
      return { conflict: false, post: rows[0] };
    },
    async postById(id) {
      const { rows } = await request(`orbit_x_posts?id=eq.${q(id)}&select=*&limit=1`);
      return rows[0] || null;
    },
    async updatePost(id, fields) {
      const { rows } = await request(`orbit_x_posts?id=eq.${q(id)}`, {
        method: "PATCH", prefer: "return=representation", body: clean(fields, POST_UPDATABLE, "post"),
      });
      return rows[0] || null;
    },
  };
}

/** The desk lane: the signed-in admin's own token. */
export function deskChannelStore(auth, opts = {}) {
  return channelStore({ url: auth.url, apiKey: auth.anonKey, bearer: auth.accessToken }, opts);
}

/** The cron lane: service role under the "orbit-x-channel" purpose. */
export function serviceChannelStore(admin, opts = {}) {
  return channelStore({ url: admin.url, apiKey: admin.serviceKey, bearer: admin.serviceKey }, opts);
}
