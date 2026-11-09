// Orbit X :: an in-memory channel store (Dev Update 6.1).
//
// Same interface as channelStore(), no database. Used by the tests and by
// `node scripts/orbit-x-channel.js preview`, which shows what the channel
// would do over several days without touching Supabase or Meta.
//
// It emulates the guarantees the migration enforces, so a test that passes
// here is exercising the same rules: the UNIQUE slot key, the partial unique
// index on a live period, write-once facts, proposed-only inserts and the
// status transitions of the registry, and the append-only log. It is not a
// substitute for testing the migration itself against Postgres.

import { randomUUID } from "node:crypto";
import { LIVE_POST_STATUSES, TERMINAL_RUN_STATES } from "./channel-store.js";

const TYPE_MOVES = Object.freeze({
  proposed: ["approved", "rejected", "superseded"],
  approved: ["retired", "rejected", "superseded"],
  retired: ["approved", "superseded"],
  rejected: [],
  superseded: [],
});

export function memoryChannelStore({ now = () => new Date() } = {}) {
  const db = { types: [], runs: [], events: [], posts: [], control: { paused: false, reason: null, updated_at: null } };
  const iso = () => now().toISOString();
  const clone = (v) => (v == null ? v : structuredClone(v));

  const store = {
    db,
    async getControl() { return clone(db.control); },
    async setControl({ paused, reason = null }) {
      db.control = { paused: Boolean(paused), reason, updated_at: iso() };
      return clone(db.control);
    },

    async listPostTypes() {
      return clone([...db.types].sort((a, b) => a.type_key.localeCompare(b.type_key) || b.version - a.version));
    },
    async postTypeById(id) { return clone(db.types.find((t) => t.id === id) || null); },
    async insertPostTypes(list) {
      const out = [];
      for (const row of list) {
        if (row.status !== "proposed") throw new Error("post types are inserted as proposed");
        if (db.types.some((t) => t.type_key === row.type_key && t.version === row.version)) continue;
        if (db.types.some((t) => t.status !== "superseded" && t.spec_hash === row.spec_hash
          && t.render_fingerprint === row.render_fingerprint)) continue;
        const saved = { id: randomUUID(), proposed_at: iso(), approved_at: null, approved_by: null,
          decided_at: null, decision_reason: null, ...clone(row) };
        db.types.push(saved);
        out.push(clone(saved));
      }
      return out;
    },
    async updatePostType(id, fields) {
      const row = db.types.find((t) => t.id === id);
      if (!row) throw new Error("no such post type");
      if (fields.status && fields.status !== row.status) {
        if (!TYPE_MOVES[row.status].includes(fields.status)) throw new Error(`cannot move ${row.status} -> ${fields.status}`);
        row.decided_at = iso();
        if (fields.status === "approved") row.approved_at = iso();
      }
      Object.assign(row, fields, { updated_at: iso() });
      return clone(row);
    },
    /** Test and preview convenience: approve through the same transition rules. */
    async approveAll(filter = () => true) {
      for (const row of db.types.filter((t) => t.status === "proposed" && filter(t))) {
        await store.updatePostType(row.id, { status: "approved" });
      }
    },

    async runBySlot(slotKey) { return clone(db.runs.find((r) => r.slot_key === slotKey) || null); },
    async runById(id) { return clone(db.runs.find((r) => r.id === id) || null); },
    async insertRun(row) {
      if (db.runs.some((r) => r.slot_key === row.slot_key)) return null;
      const saved = { id: randomUUID(), attempts: 0, lease_until: null, created_at: iso(), updated_at: iso(),
        finished_at: null, post_id: null, plan: null, checks: null, generated: null, media: null, graph: null,
        error: null, ...clone(row) };
      db.runs.push(saved);
      return clone(saved);
    },
    async leaseRun(id, untilIso, nowIso) {
      const row = db.runs.find((r) => r.id === id);
      if (!row || (row.lease_until && row.lease_until >= nowIso)) return null;
      row.lease_until = untilIso;
      return clone(row);
    },
    async updateRun(id, fields) {
      const row = db.runs.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, clone(fields), { updated_at: iso() });
      return clone(row);
    },
    async unfinishedRunsBefore(slotDate) {
      return clone(db.runs.filter((r) => r.slot_date < slotDate && !TERMINAL_RUN_STATES.includes(r.state)));
    },
    async recentRuns({ mode = null, limit = 40 } = {}) {
      return clone(db.runs.filter((r) => !mode || r.mode === mode)
        .sort((a, b) => b.slot_date.localeCompare(a.slot_date) || b.created_at.localeCompare(a.created_at))
        .slice(0, limit));
    },

    async appendEvent(runId, step, outcome, detail = null) {
      db.events.push(Object.freeze({ id: db.events.length + 1, run_id: runId || null, at: iso(), step, outcome, detail: clone(detail) }));
    },
    async eventsForRun(runId) { return clone(db.events.filter((e) => e.run_id === runId)); },
    async recentEvents({ step = null, sinceIso = null, limit = 50 } = {}) {
      return clone(db.events.filter((e) => (!step || e.step === step) && (!sinceIso || e.at >= sinceIso))
        .reverse().slice(0, limit));
    },

    async liveCoverage({ eventKey = null, periodKey = null } = {}) {
      return clone(db.posts.filter((p) => LIVE_POST_STATUSES.includes(p.status)
        && ((eventKey && p.event_key === eventKey) || (periodKey && p.period_key === periodKey))));
    },
    async insertPost(row) {
      if (row.period_key && LIVE_POST_STATUSES.includes(row.status)
        && db.posts.some((p) => p.period_key === row.period_key && LIVE_POST_STATUSES.includes(p.status))) {
        return { conflict: true, post: null };
      }
      if (row.status === "published" && (!row.external_media_id || !row.published_at)) throw new Error("published needs a media id");
      const saved = { id: randomUUID(), created_at: iso(), updated_at: iso(), publish_attempts: 0, ...clone(row) };
      db.posts.push(saved);
      return { conflict: false, post: clone(saved) };
    },
    async postById(id) { return clone(db.posts.find((p) => p.id === id) || null); },
    async updatePost(id, fields) {
      const row = db.posts.find((p) => p.id === id);
      if (!row) return null;
      if ("event_payload" in fields) throw new Error("event_payload is write-once");
      const next = { ...row, ...clone(fields) };
      if (next.status === "published" && (!next.external_media_id || !next.published_at)) throw new Error("published needs a media id");
      if (LIVE_POST_STATUSES.includes(next.status) && next.period_key && db.posts.some((p) => p.id !== id
        && p.period_key === next.period_key && LIVE_POST_STATUSES.includes(p.status))) throw new Error("live period conflict");
      Object.assign(row, next, { updated_at: iso() });
      return clone(row);
    },
  };
  return store;
}

/**
 * A copy writer for previews and tests: no model, no network. It writes the
 * scaffold's derived (factual) fields and fills every interpretive field with
 * a line that SAYS it is sample copy, varied by date and hook style so the
 * near-duplicate guard sees different openings on different days. It is never
 * used by the deployed channel; runChannelTick only uses it when injected.
 */
export async function previewCopy(packet, { samplePost }) {
  const e = packet.event;
  const candidate = { eventKey: "preview", eventType: e.type, title: e.title, timestamp: e.timestamp,
    facts: e.facts, source: e.source, approximate: e.approximate, readingType: e.facts?.period?.type };
  const post = samplePost(candidate, packet.format, {});
  const day = String(e.facts?.local_date || e.facts?.date || e.facts?.period?.start_date || "").slice(5) || "evergreen";
  const style = Object.keys(packet.channel || {}).length ? String(packet.channel.hookStyle || "").split(" ").slice(3, 7).join(" ") : "";
  const line = `Sample copy (${day}): astrologers traditionally associate this with a theme the real post would name.`;
  const headline = post.reading ? `Sample ${packet.formatName} ${day}`.slice(0, 60) : `${post.headline}`;
  const json = {
    ...post,
    headline,
    slides: post.slides.map((s) => (s.role === "one_sentence" ? s
      : /^Sample copy\./.test(s.body) ? { ...s, body: line } : s)),
    caption: `Sample caption for ${e.title} (${day}). It opens with ${style || "a calm line"} and is never published.`,
  };
  delete json.reading;
  delete json.design;
  return { text: JSON.stringify(json), usage: null };
}
