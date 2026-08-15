// Orbit Axis :: base authenticated data export (Dev Update 1.2).
//
// WHY THIS USES THE USER'S OWN TOKEN, NOT THE SERVICE-ROLE KEY
//
// The obvious implementation reads every table with the service-role key and
// filters by owner id in application code. That works right up until one query
// forgets its filter, at which point the export quietly hands one person
// somebody else's birth data.
//
// Instead, every request here is made with the SIGNED-IN USER'S access token.
// Row-level security then does the filtering, in the database, for every table
// at once, whether or not this file remembered to ask. A missing `owner_id`
// filter becomes an empty result rather than a data breach — the failure mode
// is disappointing instead of catastrophic, which is the right way round.
//
// It also means export works where deletion currently cannot: the approved
// shared-database configuration refuses to run with a service-role key present,
// so anything that requires one is unavailable in production today. Export
// needs no such key and so has no such problem.
//
// WHAT IS DELIBERATELY ABSENT
//
// No job table, no queue, no expiring link, no archive format. The data a
// single account owns today is a few kilobytes of JSON. An asynchronous export
// pipeline would be a new store to secure, to include in this very export, and
// to delete on account closure — three new obligations to solve a problem
// nobody has. Dev Update 2.4 revisits this when journals make it real.

import { getSupabaseUser } from "../auth/supabase-auth.js";
import { supabaseConfig } from "../local-llm/config.js";
import { relationshipExportStatus } from "../charts/identity.js";

/**
 * Bumped whenever the shape changes in a way a consumer could notice.
 * Additive fields do not require a bump; removing or retyping one does.
 * 1.1.0: chart identity (Dev Update 1.10) — relationship_type_status and the
 * avatar_present / avatar_exported / avatar_export_limitation trio joined
 * each birth profile, and the internal avatar storage columns were removed
 * from the rows (they name the private bucket layout, which is not the
 * account holder's content).
 *
 * 1.2.0: export privacy (Dev Update 1.10.1) — MINOR rather than patch, because
 * a consumer has to understand something new. Production database identifiers
 * (the Auth uuid, owner_id/user_id, and every row id) are gone, records are
 * now serialized from an explicit allow-list instead of spreading whole rows,
 * and the relationships those ids used to carry are expressed as export-local
 * references (`ref`, `chart_ref`, `person_ref`, `active_chart_ref`). Nothing a
 * user authored was removed; only the database's own identity was.
 *
 * 1.3.0: saved Tarot reflections (Tarot MVP) — MINOR, because a whole category
 * appeared. Each reflection carries its cards by stable per-deck SLUG with the
 * authored text as it was drawn, the question if one was asked, and the draw
 * contract that produced it (deck version, contract version, local date,
 * timezone). Deliberately absent: the card row uuid, which a slug exists to
 * replace and which this export's own privacy audit would flag; the draw seed,
 * which is an internal of the draw rather than the reader's content; and
 * source_note_path, which names a path in the owner's private vault sync.
 */
export const EXPORT_SCHEMA_VERSION = "1.3.0";

/** Why the picture bytes are absent, stated inside the export itself. */
export const AVATAR_EXPORT_LIMITATION =
  "private avatar images are not included in this export format";

/**
 * Export-local references.
 *
 * A production uuid answers "which row is this in Orbit's database", which is
 * a question about Orbit's infrastructure rather than about the person's data.
 * The export only needs to answer "which record in THIS FILE is this", so it
 * mints its own names — chart-1, person-2 — valid inside one document and
 * meaningless outside it.
 *
 * Deliberately sequential over the source order, NOT derived from the uuid:
 * a truncation, hash, or encoding of the original would still be the original
 * identifier wearing a hat, and would still correlate two exports of the same
 * account. Sequence numbers cannot be reversed because they carry no input.
 */
function referenceTable(prefix) {
  const assigned = new Map();
  return {
    /** Mint (or reuse) this row's reference. Order of first call decides the number. */
    assign(id) {
      if (id === null || id === undefined) return null;
      const key = String(id);
      if (!assigned.has(key)) assigned.set(key, `${prefix}-${assigned.size + 1}`);
      return assigned.get(key);
    },
    /** Resolve a foreign key to an already-minted reference, or null if it points nowhere. */
    lookup(id) {
      if (id === null || id === undefined) return null;
      return assigned.get(String(id)) ?? null;
    },
  };
}

/** Copy only these keys, and only when the source actually has them. */
function pick(row, keys) {
  const out = {};
  for (const key of keys) if (row[key] !== undefined) out[key] = row[key];
  return out;
}

/**
 * The chart fields an export carries.
 *
 * An allow-list, not a subtraction. `...row` exported whatever the table
 * happened to hold, so every column added over the next year would have
 * shipped in the export the day it was created — including the next internal
 * one. Naming the fields inverts that: a new column is absent until somebody
 * decides it belongs to the user.
 *
 * Coordinates ARE included, deliberately. They are the birthplace the person
 * chose, and they are what makes the export portable — a chart cannot be
 * recomputed anywhere else without them. Removing them would protect nobody
 * (it is the user's own file, about their own birth) and would quietly break
 * the ownership promise the export exists to keep.
 */
export const EXPORT_CHART_FIELDS = Object.freeze([
  "nickname", "relationship_type", "is_primary",
  "first_name", "last_name",
  "birth_date", "birth_time", "time_accuracy",
  "birthplace_name", "birthplace_city", "birthplace_region",
  "birthplace_country", "birthplace_country_code",
  "latitude", "longitude", "timezone_name", "utc_offset_at_birth",
  "zodiac_system", "house_system", "notes",
  "created_at", "updated_at", "last_active_at", "avatar_updated_at",
]);

export const EXPORT_PERSON_FIELDS = Object.freeze([
  "display_name", "relationship_type", "notes", "created_at", "updated_at",
]);

export const EXPORT_FORTUNE_FIELDS = Object.freeze([
  "fortune_date", "timezone_name", "fortune_engine_version",
  "mood", "love_reading", "luck_reading", "watch_out",
  "lucky_number", "lucky_color_name", "lucky_color_value",
  "sky_snapshot", "factors", "created_at", "updated_at",
]);

/**
 * A saved Tarot reflection, as the export presents it.
 *
 * `reading_data` is NOT spread. It is server-written jsonb, and spreading it
 * would carry whatever the service happens to put there into every future
 * export — which is exactly the failure the chart allow-list exists to
 * prevent, one level deeper. The presenter below rebuilds it field by field.
 *
 * `source_note_path` is deliberately absent: it names a path inside the
 * owner's private vault sync, not part of a reading, and the export's own
 * privacy audit already forbids the key.
 */
export const EXPORT_TAROT_FIELDS = Object.freeze([
  "question", "spread_type", "created_at",
]);

export const EXPORT_JOURNAL_FIELDS = Object.freeze([
  "entry_type", "title", "content", "entry_at", "metadata",
  "created_at", "updated_at",
]);

export const EXPORT_PROFILE_FIELDS = Object.freeze([
  "display_name", "first_name", "last_name",
  "astrology_detail_level",
  "current_timezone_name", "current_timezone_source", "current_timezone_updated_at",
  "created_at", "updated_at",
]);

/**
 * A birth profile as the export presents it.
 *
 * The stored relationship value is exported EXACTLY as stored — a legacy
 * 'other' or 'public_figure' is the user's data — with a status field that
 * says what the value means today, so a reader two years from now does not
 * need this codebase to interpret it. The avatar is reported honestly:
 * whether one exists, that its bytes are not in this JSON document, and why.
 * The raw storage path and version are internals of the private bucket, not
 * account content, and never leave the server.
 *
 * `refs` carries the tables that turn foreign keys into export-local names.
 * Omitting it (the older single-argument call) still produces a valid record,
 * just without the cross-references.
 */
export function presentExportChart(row, refs = {}) {
  if (!row || typeof row !== "object") return row;
  const present = Boolean(row.avatar_storage_path);
  return {
    ref: refs.charts?.assign(row.id) ?? null,
    person_ref: refs.people?.lookup(row.person_id) ?? null,
    ...pick(row, EXPORT_CHART_FIELDS),
    relationship_type_status: relationshipExportStatus(row.relationship_type ?? null),
    avatar_present: present,
    avatar_exported: false,
    avatar_export_limitation: present ? AVATAR_EXPORT_LIMITATION : null,
  };
}

/**
 * The tables this export reads, and how each is scoped to its owner.
 *
 * `column` is belt AND braces: RLS already restricts these rows, but an
 * explicit filter documents the intent at the call site and keeps the query
 * honest if a policy is ever loosened by accident.
 *
 * Tables absent from this list are absent on purpose:
 *   - ask_conversations / ask_messages — Ask Orbit is approved for removal in
 *     Dev Update 1.3. Exporting a surface that is about to disappear would
 *     promise continuity the roadmap has already decided against. Dev Update
 *     2.4 revisits retired-feature data explicitly.
 *   - chart_calculations — derived output, recomputed from the birth profile by
 *     the engine. Exporting it would ship megabytes of cache as if it were
 *     something the user authored.
 *   - llm_runs / vault_* / sync_events / business_metrics — operational and
 *     owner-tooling records, not the account holder's personal content.
 */
export const EXPORT_SOURCES = Object.freeze([
  { key: "profile", table: "profiles", column: "user_id", single: true },
  { key: "birth_profiles", table: "birth_profiles", column: "owner_id", order: "created_at.asc" },
  { key: "people", table: "people", column: "owner_id", order: "created_at.asc" },
  { key: "fortune_history", table: "daily_fortunes", column: "owner_id", order: "fortune_date.desc" },
  { key: "journal_entries", table: "journal_entries", column: "owner_id", order: "created_at.asc" },
  { key: "tarot_readings", table: "tarot_readings", column: "owner_id", order: "created_at.asc" },
]);

/**
 * Columns that must never leave the database, checked by name after the rows
 * are fetched rather than by trusting the select list.
 *
 * The select list is written by a person and can be widened by a later change
 * that means well. This runs on the actual result, so a column added to a table
 * in six months cannot ride along silently.
 */
const FORBIDDEN_KEYS = Object.freeze([
  "password", "encrypted_password", "password_hash",
  "access_token", "refresh_token", "token", "token_hash",
  "service_role", "service_role_key", "apikey", "api_key",
  "secret", "session_id", "confirmation_token", "recovery_token",
]);

export class AccountExportError extends Error {
  constructor(stage, message, { status = 500, cause = null } = {}) {
    super(message);
    this.name = "AccountExportError";
    this.stage = stage;
    this.status = status;
    this.cause = cause;
  }
}

/**
 * Recursively strip anything named like a credential.
 *
 * Whole-key match rather than substring: a substring rule would delete
 * `lucky_color_token` if such a thing were ever added, and silently returning
 * an incomplete export is its own kind of wrong.
 */
export function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.includes(key.toLowerCase())) continue;
      out[key] = stripSecrets(inner);
    }
    return out;
  }
  return value;
}

/**
 * Build the export document for the account belonging to a VERIFIED token.
 *
 * The user id is derived from the token, never from a parameter — the same rule
 * that governs deletion, for the same reason.
 *
 * @param {object} options
 * @param {string} options.accessToken
 * @param {string} [options.timezone]  IANA name, used only for a human-readable
 *                                     local timestamp alongside the UTC one.
 * @param {Function} [options.fetchImpl]
 * @param {Function} [options.verifyUser]
 * @param {Function} [options.now]
 */
export async function buildAccountExport({
  accessToken,
  timezone = "UTC",
  fetchImpl = fetch,
  verifyUser = getSupabaseUser,
  now = () => new Date(),
} = {}) {
  if (!accessToken) {
    throw new AccountExportError("authentication", "Sign in to export your data.", { status: 401 });
  }

  const identity = await verifyUser(accessToken);
  if (!identity?.ok || !identity.user?.id) {
    throw new AccountExportError("authentication",
      "Your session is no longer valid. Sign in again.", { status: 401 });
  }
  const user = identity.user;

  const config = supabaseConfig();
  if (!config.url || !config.anonKey) {
    throw new AccountExportError("configuration",
      "Export is not available on this instance.", { status: 503 });
  }
  const root = config.url.replace(/\/+$/, "");

  const read = async ({ table, column, order }) => {
    const query = new URLSearchParams();
    query.set(column, `eq.${user.id}`);
    query.set("select", "*");
    if (order) query.set("order", order);
    let res;
    try {
      res = await fetchImpl(`${root}/rest/v1/${table}?${query}`, {
        headers: {
          apikey: config.anonKey,
          // The USER's token. RLS is the ownership check.
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw new AccountExportError("read",
        "Your data could not be gathered just now. Please try again.",
        { status: 503, cause: error });
    }
    if (!res.ok) {
      // The database's own message is never forwarded: it can name columns,
      // policies, and internal constraints.
      throw new AccountExportError("read",
        "Your data could not be gathered just now. Please try again.",
        { status: 502 });
    }
    return res.json();
  };

  const data = {};
  for (const source of EXPORT_SOURCES) {
    const rows = await read(source);
    data[source.key] = source.single ? (rows[0] ?? null) : rows;
  }

  // References are minted in source order — people first, because charts point
  // at them — so the same account exports the same names every time. Every
  // query in EXPORT_SOURCES carries an explicit `order`, which is what makes
  // that ordering a property of the export rather than of the database's mood.
  const refs = { people: referenceTable("person"), charts: referenceTable("chart") };
  for (const person of data.people || []) refs.people.assign(person.id);
  for (const chart of data.birth_profiles || []) refs.charts.assign(chart.id);

  const generatedAt = now();
  const document = {
    orbit_axis_export: {
      schema_version: EXPORT_SCHEMA_VERSION,
      generated_at_utc: generatedAt.toISOString(),
      generated_at_local: localTimestamp(generatedAt, timezone),
      timezone,
      // Says what this file is, in the file, for someone opening it in a text
      // editor two years from now with no other context.
      about: "Everything Orbit Axis stores about your account. Calculated chart "
        + "results are not included because they are recomputed from your birth "
        + "details rather than stored as your own content.",
    },
    account: {
      // No `id`. The Supabase Auth uuid identifies a row in Orbit's database,
      // not the person — the email already says whose file this is, and an
      // export holds exactly one account, so nothing here needs to point at it.
      email: user.email ?? null,
      created_at: user.created_at ?? null,
      last_sign_in_at: user.last_sign_in_at ?? null,
      email_confirmed_at: user.email_confirmed_at ?? user.confirmed_at ?? null,
    },
    active_chart_ref: refs.charts.lookup(data.profile?.active_birth_profile_id),
    preferences: {
      astrology_detail_level: data.profile?.astrology_detail_level ?? null,
      current_timezone_name: data.profile?.current_timezone_name ?? null,
      current_timezone_source: data.profile?.current_timezone_source ?? null,
    },
    profile: data.profile
      ? { ...pick(data.profile, EXPORT_PROFILE_FIELDS),
          active_chart_ref: refs.charts.lookup(data.profile.active_birth_profile_id) }
      : null,
    birth_profiles: (data.birth_profiles || []).map((row) => presentExportChart(row, refs)),
    people: (data.people || []).map((row) => ({
      ref: refs.people.lookup(row.id),
      ...pick(row, EXPORT_PERSON_FIELDS),
    })),
    fortune_history: (data.fortune_history || []).map((row) => ({
      // The fortune was cast for one chart; the reference says which, without
      // naming the row it came from.
      chart_ref: refs.charts.lookup(row.birth_profile_id),
      ...pick(row, EXPORT_FORTUNE_FIELDS),
    })),
    journal_entries: (data.journal_entries || []).map((row) => pick(row, EXPORT_JOURNAL_FIELDS)),
    tarot_readings: (data.tarot_readings || []).map(presentExportTarotReading),
    // Named so the gap is visible rather than inferred from silence. A user
    // reading their export should not have to guess whether a category is
    // missing or simply empty.
    not_yet_included: {
      note: "These categories do not exist yet. Dev Update 2.4 adds them to this "
        + "export in the same change that creates them.",
      categories: [
        "gratitude", "dreams", "wellness", "saved_insights",
        "notification_preferences", "compatibility_notes", "researcher_data",
      ],
    },
  };

  return stripSecrets(document);
}

/**
 * A saved Tarot reflection.
 *
 * The cards are rebuilt from their stored slugs and authored text rather than
 * copied wholesale, so a column or key added to `reading_data` later cannot
 * ride into an export unnoticed. Card slugs are stable per-deck names, not
 * database uuids — which is what lets this pass the export's own privacy
 * audit, since a raw uuid in a server-written field is a finding there and
 * would be right to be.
 *
 * The draw contract travels with the reading: without the deck version and
 * local date, a reflection saved a year ago cannot be explained, and an export
 * that cannot explain its own contents is a list rather than a record.
 */
export function presentExportTarotReading(row) {
  if (!row || typeof row !== "object") return row;
  const data = row.reading_data && typeof row.reading_data === "object" ? row.reading_data : {};
  const draw = data.draw && typeof data.draw === "object" ? data.draw : {};
  return {
    ...pick(row, EXPORT_TAROT_FIELDS),
    cards: (Array.isArray(data.cards) ? data.cards : []).map((entry) => ({
      position: entry?.position ?? null,
      slug: entry?.card?.slug ?? null,
      name: entry?.card?.name ?? null,
      arcana: entry?.card?.arcana ?? null,
      suit: entry?.card?.suit ?? null,
      upright_meaning: entry?.card?.upright_meaning ?? null,
      reflection_prompt: entry?.card?.reflection_prompt ?? null,
    })),
    drawn: {
      deck_version: draw.deck_version ?? null,
      contract_version: draw.contract_version ?? null,
      local_date: draw.local_date ?? null,
      timezone: draw.timezone ?? null,
      reproducible: draw.reproducible ?? null,
    },
  };
}

/** A readable local timestamp, or null when the timezone name is unusable. */
function localTimestamp(date, timezone) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "long",
    }).format(date);
  } catch {
    // An invalid IANA name is the caller's problem to notice, not a reason to
    // fail an export the user is entitled to.
    return null;
  }
}

/**
 * A filename someone can find again in their Downloads folder.
 *
 * Date only — a time would make every export look like a different document,
 * and the precise instant is inside the file anyway. Nothing identifying: no
 * email, no uuid, no chart name. The router sanitises it again before it
 * becomes a header.
 */
export function exportFilename(date = new Date()) {
  return `orbit-axis-export-${date.toISOString().slice(0, 10)}.json`;
}

/* ── Export privacy audit ──────────────────────────────────────────────────
   One definition of "what must never appear", used by the tests and available
   to any future consumer. It walks the document STRUCTURALLY rather than
   grepping the serialized text, because a naive text search cannot tell a
   database identifier from a uuid a person typed into their own notes — and a
   privacy check that fires on the user's own prose is a check people learn to
   ignore. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keys that must not exist anywhere in an export, at any depth. */
export const FORBIDDEN_EXPORT_KEYS = Object.freeze([
  "id", "owner_id", "user_id", "auth_user_id", "created_by", "updated_by",
  "birth_profile_id", "person_id", "chart_id", "fortune_id", "calculation_id",
  "active_birth_profile_id",
  "avatar_storage_path", "avatar_version",
  "source_note_path", "seed_hash",
  "geo_place_id", "geo_provider", "geo_resolved_at",
]);

/** Substrings that would mean a storage internal or a credential escaped. */
const FORBIDDEN_EXPORT_SUBSTRINGS = Object.freeze([
  "chart-avatars", "storage/v1", "/object/", "supabase.co",
  "service_role", "sb_secret", "eyJhbGciOi",
]);

/** An export-local reference: a short prefix and a sequence number, nothing else. */
export const EXPORT_REF_RE = /^(account|chart|person|fortune|calculation)-[1-9][0-9]*$/;

/**
 * Audit a finished export document.
 *
 * Returns `{ ok, findings }` — findings name the exact path, so a failure
 * points at the field rather than at the whole file. Values are inspected only
 * where a structural leak could hide: keys everywhere, and uuid-shaped strings
 * in fields the SERVER writes. A uuid inside `notes` or `content` is the
 * person's own text and is left alone, on purpose.
 */
export function auditExportPrivacy(document) {
  const findings = [];
  const userAuthored = new Set(["notes", "content", "title", "about", "note"]);

  const walk = (node, path) => {
    if (typeof node === "string") {
      for (const bad of FORBIDDEN_EXPORT_SUBSTRINGS) {
        if (node.includes(bad)) findings.push(`${path}: contains "${bad}"`);
      }
      const leaf = path.split(".").pop().replace(/\[\d+\]$/, "");
      if (UUID_RE.test(node) && !userAuthored.has(leaf)) {
        findings.push(`${path}: raw uuid in a server-written field`);
      }
      return;
    }
    if (Array.isArray(node)) return node.forEach((item, i) => walk(item, `${path}[${i}]`));
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (FORBIDDEN_EXPORT_KEYS.includes(key)) findings.push(`${path}.${key}: forbidden key`);
        if (key.endsWith("_ref") || key === "ref") {
          if (value !== null && !EXPORT_REF_RE.test(String(value))) {
            findings.push(`${path}.${key}: "${value}" is not an export-local reference`);
          }
        }
        walk(value, `${path}.${key}`);
      }
    }
  };

  walk(document, "export");
  return { ok: findings.length === 0, findings };
}

/**
 * Check that every reference in the document resolves.
 *
 * A dangling `chart_ref` would be worse than the uuid it replaced: it looks
 * like a relationship and is not one.
 */
export function auditExportReferences(document) {
  const findings = [];
  const declared = new Set();
  const seen = new Set();
  for (const group of ["birth_profiles", "people"]) {
    for (const [i, record] of (document?.[group] || []).entries()) {
      if (!record.ref) { findings.push(`${group}[${i}]: missing ref`); continue; }
      if (seen.has(record.ref)) findings.push(`${group}[${i}]: duplicate ref ${record.ref}`);
      seen.add(record.ref);
      declared.add(record.ref);
    }
  }
  const check = (value, where) => {
    if (value !== null && value !== undefined && !declared.has(value)) {
      findings.push(`${where}: dangling reference ${value}`);
    }
  };
  check(document?.active_chart_ref, "active_chart_ref");
  check(document?.profile?.active_chart_ref, "profile.active_chart_ref");
  for (const [i, f] of (document?.fortune_history || []).entries()) check(f.chart_ref, `fortune_history[${i}].chart_ref`);
  for (const [i, c] of (document?.birth_profiles || []).entries()) check(c.person_ref, `birth_profiles[${i}].person_ref`);
  return { ok: findings.length === 0, findings };
}
