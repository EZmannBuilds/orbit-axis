// Orbit Axis :: export privacy and export-local references (Dev Update 1.10.1).
//
// The export is a file a person downloads and may hand to someone else — a
// lawyer, a support agent, another app. What it says about Orbit's database is
// therefore a privacy question, not an implementation detail.
//
// These tests hold two lines:
//
//   1. NO PRODUCTION IDENTITY. No Auth uuid, no owner_id, no row primary key,
//      no storage internals. Checked STRUCTURALLY — the audit walks keys and
//      server-written values rather than grepping the serialized text, because
//      a uuid a person typed into their own notes is their data and a check
//      that fires on it is a check people learn to ignore.
//
//   2. THE RELATIONSHIPS SURVIVE. Stripping ids is easy; keeping "this fortune
//      belongs to that chart" true without them is the actual work. Every
//      reference must resolve, and a dangling one is worse than the uuid it
//      replaced because it looks like a relationship and is not.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAccountExport, EXPORT_SCHEMA_VERSION, EXPORT_REF_RE,
  auditExportPrivacy, auditExportReferences, presentExportChart,
  AVATAR_EXPORT_LIMITATION, FORBIDDEN_EXPORT_KEYS,
} from "../lib/account/export.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const USER_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_ID = "99999999-8888-7777-6666-555555555555";
const CHART_A = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
const CHART_B = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";
const CHART_C = "cccccccc-3333-4ccc-8ccc-cccccccccccc";
const PERSON_A = "dddddddd-1111-4ddd-8ddd-dddddddddddd";
const PROFILE_ROW = "eeeeeeee-1111-4eee-8eee-eeeeeeeeeeee";
const FORTUNE_A = "ffffffff-1111-4fff-8fff-ffffffffffff";

const okUser = async () => ({
  ok: true,
  user: {
    id: USER_ID,
    email: "disposable@example.test",
    created_at: "2026-01-01T00:00:00.000Z",
    last_sign_in_at: "2026-07-28T00:00:00.000Z",
    email_confirmed_at: "2026-01-01T00:05:00.000Z",
  },
});

function withSupabaseEnv(run) {
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = "http://127.0.0.1:55321";
  process.env.SUPABASE_ANON_KEY = "anon-key-for-tests";
  return Promise.resolve(run()).finally(() => {
    if (savedUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = savedKey;
  });
}

/** A REST double that answers each table with the rows the test declares. */
function fakeRest(tables = {}) {
  return async (url) => {
    const table = new URL(url).pathname.split("/").pop();
    return { ok: true, status: 200, json: async () => tables[table] ?? [] };
  };
}

/** A full, realistic account: several charts, a person, legacy values, history. */
const FULL_ACCOUNT = {
  profiles: [{
    id: PROFILE_ROW, user_id: USER_ID, display_name: "Someone",
    first_name: "Some", last_name: "One",
    active_birth_profile_id: CHART_B, astrology_detail_level: "Advanced",
    current_timezone_name: "Europe/Lisbon", current_timezone_source: "device",
    current_timezone_updated_at: "2026-07-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z",
  }],
  people: [{
    id: PERSON_A, owner_id: USER_ID, display_name: "Mum",
    relationship_type: "family", notes: "synthetic",
    created_at: "2026-01-02T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z",
  }],
  birth_profiles: [
    {
      id: CHART_A, owner_id: USER_ID, person_id: null, nickname: "My Chart",
      relationship_type: "self", is_primary: true,
      birth_date: "1990-06-15", birth_time: "08:30:00", time_accuracy: "exact",
      birthplace_name: "Synthetic City", latitude: 38.72, longitude: -9.14,
      timezone_name: "Europe/Lisbon", utc_offset_at_birth: "+01:00",
      zodiac_system: "tropical", house_system: "placidus",
      notes: "my own notes",
      source_note_path: "vault/charts/mine.md",
      geo_provider: "geoapify", geo_place_id: "51a2b3c4", geo_resolved_at: "2026-01-01T00:00:00.000Z",
      avatar_storage_path: `${USER_ID}/${CHART_A}/avatar.webp`, avatar_version: 4,
      avatar_updated_at: "2026-07-30T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-07-30T00:00:00.000Z",
      last_active_at: "2026-08-01T00:00:00.000Z",
    },
    {
      id: CHART_B, owner_id: USER_ID, person_id: PERSON_A, nickname: "Mum",
      relationship_type: "other", is_primary: false,
      birth_date: "1962-02-02", birth_time: null, time_accuracy: "unknown",
      birthplace_name: "Synthetic Town", latitude: 41.15, longitude: -8.61,
      timezone_name: "Europe/Lisbon", utc_offset_at_birth: "+00:00",
      created_at: "2026-01-03T00:00:00.000Z", updated_at: "2026-01-03T00:00:00.000Z",
    },
    {
      id: CHART_C, owner_id: USER_ID, person_id: null, nickname: "Someone Famous",
      relationship_type: "public_figure", is_primary: false,
      birth_date: "1970-03-03", birth_time: "10:00:00", time_accuracy: "reported",
      birthplace_name: "Synthetic Village", latitude: 40.0, longitude: -8.0,
      timezone_name: "Europe/Lisbon", utc_offset_at_birth: "+00:00",
      created_at: "2026-01-04T00:00:00.000Z", updated_at: "2026-01-04T00:00:00.000Z",
    },
  ],
  daily_fortunes: [
    {
      id: FORTUNE_A, owner_id: USER_ID, birth_profile_id: CHART_B,
      fortune_date: "2026-07-27", timezone_name: "Europe/Lisbon",
      fortune_engine_version: "1.2.0", seed_hash: "deadbeefcafe",
      mood: "steady", love_reading: "warm", luck_reading: "open", watch_out: "haste",
      lucky_number: 7, lucky_color_name: "Soft Blush", lucky_color_value: "#f3c",
      sky_snapshot: { sun: "Leo" }, factors: ["a"],
      created_at: "2026-07-27T00:00:00.000Z", updated_at: "2026-07-27T00:00:00.000Z",
    },
  ],
  journal_entries: [],
};

const build = (over = {}) => withSupabaseEnv(() => buildAccountExport({
  accessToken: "token", verifyUser: okUser,
  fetchImpl: fakeRest(FULL_ACCOUNT), now: () => new Date("2026-08-01T12:00:00.000Z"),
  ...over,
}));

// ── The privacy line ────────────────────────────────────────────────────────

test("a full export contains no production identity at all", async () => {
  const doc = await build();
  const verdict = auditExportPrivacy(doc);
  assert.deepEqual(verdict.findings, [], "the audit must find nothing");
  assert.equal(verdict.ok, true);
});

test("every specific identifier the old export carried is gone", async () => {
  const doc = await build();
  const text = JSON.stringify(doc);
  for (const [what, value] of [
    ["the Auth uuid", USER_ID],
    ["a chart row id", CHART_A],
    ["a second chart row id", CHART_B],
    ["the person row id", PERSON_A],
    ["the profiles row id", PROFILE_ROW],
    ["the fortune row id", FORTUNE_A],
  ]) {
    assert.ok(!text.includes(value), `${what} must not appear anywhere`);
  }
  assert.ok(!("id" in doc.account), "account.id is gone");
  assert.ok(!("user_id" in (doc.profile || {})), "profile.user_id is gone");
  assert.ok(!("id" in (doc.profile || {})), "profile.id is gone");
  assert.ok(!("active_birth_profile_id" in (doc.profile || {})));
  for (const chart of doc.birth_profiles) {
    for (const key of ["id", "owner_id", "person_id", "avatar_storage_path", "avatar_version"]) {
      assert.ok(!(key in chart), `birth_profiles[].${key} is gone`);
    }
  }
  for (const f of doc.fortune_history) {
    for (const key of ["id", "owner_id", "birth_profile_id", "seed_hash"]) {
      assert.ok(!(key in f), `fortune_history[].${key} is gone`);
    }
  }
  for (const p of doc.people) {
    for (const key of ["id", "owner_id"]) assert.ok(!(key in p), `people[].${key} is gone`);
  }
});

test("vault paths and provider ids do not ride along", async () => {
  const doc = await build();
  const text = JSON.stringify(doc);
  assert.ok(!text.includes("vault/charts"), "no source_note_path");
  assert.ok(!text.includes("51a2b3c4"), "no Geoapify place id");
  assert.ok(!text.includes("deadbeefcafe"), "no fortune seed hash");
  for (const chart of doc.birth_profiles) {
    for (const key of ["source_note_path", "geo_provider", "geo_place_id", "geo_resolved_at"]) {
      assert.ok(!(key in chart), `${key} is provider/vault metadata, not user content`);
    }
  }
});

test("no storage internal, bucket name, or signed URL appears", async () => {
  const doc = await build();
  const text = JSON.stringify(doc);
  for (const bad of ["chart-avatars", "storage/v1", "/object/", "avatar.webp", "token=", "supabase.co"]) {
    assert.ok(!text.includes(bad), `"${bad}" must not appear`);
  }
});

test("the audit is structural: a uuid a person typed into their own notes is left alone", async () => {
  // A privacy check that fires on the user's own prose is one people learn to
  // ignore. This is the difference between the real check and a naive grep.
  const doc = await build();
  doc.birth_profiles[0].notes = `I wrote this id down once: ${OTHER_ID}`;
  const verdict = auditExportPrivacy(doc);
  assert.deepEqual(verdict.findings, [], "user-authored text is not a leak");

  // But the same uuid in a server-written field IS caught.
  const leaked = await build();
  leaked.birth_profiles[0].timezone_name = OTHER_ID;
  assert.equal(auditExportPrivacy(leaked).ok, false, "a server field must not hold a uuid");
});

test("the audit catches a forbidden key wherever it is reintroduced", async () => {
  for (const key of ["owner_id", "user_id", "birth_profile_id", "avatar_storage_path", "id"]) {
    const doc = await build();
    doc.birth_profiles[0][key] = "anything";
    const verdict = auditExportPrivacy(doc);
    assert.equal(verdict.ok, false, `${key} must be caught`);
    assert.match(verdict.findings.join(" "), new RegExp(key));
  }
  assert.ok(FORBIDDEN_EXPORT_KEYS.length >= 15, "the forbidden list is not a token gesture");
});

// ── The relationship line ───────────────────────────────────────────────────

test("every reference resolves, and none is a truncated or hashed uuid", async () => {
  const doc = await build();
  assert.deepEqual(auditExportReferences(doc).findings, []);

  const refs = doc.birth_profiles.map((c) => c.ref);
  assert.deepEqual(refs, ["chart-1", "chart-2", "chart-3"], "sequential in source order");
  assert.equal(new Set(refs).size, refs.length, "unique");
  for (const ref of refs) {
    assert.match(ref, EXPORT_REF_RE);
    // A truncation or encoding of the original would still be the original.
    for (const uuid of [CHART_A, CHART_B, CHART_C]) {
      assert.ok(!uuid.startsWith(ref.replace("chart-", "")), "not a uuid fragment");
      assert.ok(!ref.includes(uuid.slice(0, 6)), "no uuid substring survives in a ref");
    }
  }
  assert.equal(doc.people[0].ref, "person-1");
});

test("the active chart is named by reference, in both places it appears", async () => {
  const doc = await build();
  assert.equal(doc.active_chart_ref, "chart-2", "CHART_B is the second chart in source order");
  assert.equal(doc.profile.active_chart_ref, "chart-2");
  assert.ok(!("active_chart_id" in doc), "the uuid-named field is gone");
});

test("a fortune still points at the chart it was cast for", async () => {
  const doc = await build();
  assert.equal(doc.fortune_history[0].chart_ref, "chart-2");
  const declared = new Set(doc.birth_profiles.map((c) => c.ref));
  assert.ok(declared.has(doc.fortune_history[0].chart_ref), "and that chart exists in this file");
});

test("a chart still points at the person it belongs to", async () => {
  const doc = await build();
  const mum = doc.birth_profiles.find((c) => c.nickname === "Mum");
  assert.equal(mum.person_ref, "person-1");
  assert.equal(doc.birth_profiles.find((c) => c.nickname === "My Chart").person_ref, null);
});

test("a dangling reference is reported rather than shipped", async () => {
  const doc = await build();
  doc.fortune_history[0].chart_ref = "chart-99";
  const verdict = auditExportReferences(doc);
  assert.equal(verdict.ok, false);
  assert.match(verdict.findings.join(" "), /dangling reference chart-99/);
});

test("the same account exports the same references every time", async () => {
  const a = await build();
  const b = await build();
  assert.deepEqual(a.birth_profiles.map((c) => c.ref), b.birth_profiles.map((c) => c.ref));
  assert.equal(a.active_chart_ref, b.active_chart_ref);
  assert.equal(a.fortune_history[0].chart_ref, b.fortune_history[0].chart_ref);
});

// ── Content preservation ────────────────────────────────────────────────────

test("nothing the person authored was lost with the identifiers", async () => {
  const doc = await build();
  const [mine, mum, figure] = doc.birth_profiles;
  assert.equal(mine.nickname, "My Chart");
  assert.equal(mine.notes, "my own notes");
  assert.equal(mine.birth_date, "1990-06-15");
  assert.equal(mine.birth_time, "08:30:00");
  assert.equal(mine.time_accuracy, "exact");
  assert.equal(mine.birthplace_name, "Synthetic City");
  assert.equal(mine.timezone_name, "Europe/Lisbon");
  assert.equal(mine.zodiac_system, "tropical");
  assert.equal(mine.house_system, "placidus");
  assert.equal(mine.is_primary, true);
  assert.equal(mine.created_at, "2026-01-01T00:00:00.000Z");
  assert.equal(mine.last_active_at, "2026-08-01T00:00:00.000Z");
  assert.equal(mum.birth_time, null, "an unknown birth time stays unknown");
  assert.equal(figure.nickname, "Someone Famous");

  // Coordinates are user-owned birth data and the reason the export is
  // portable at all — a chart cannot be recomputed elsewhere without them.
  assert.equal(mine.latitude, 38.72);
  assert.equal(mine.longitude, -9.14);

  assert.equal(doc.people[0].display_name, "Mum");
  assert.equal(doc.people[0].notes, "synthetic");
  assert.equal(doc.profile.display_name, "Someone");
  assert.equal(doc.profile.astrology_detail_level, "Advanced");
  assert.equal(doc.preferences.current_timezone_name, "Europe/Lisbon");
  assert.equal(doc.account.email, "disposable@example.test");
  assert.equal(doc.account.created_at, "2026-01-01T00:00:00.000Z");

  const f = doc.fortune_history[0];
  assert.equal(f.mood, "steady");
  assert.equal(f.love_reading, "warm");
  assert.equal(f.lucky_number, 7);
  assert.equal(f.lucky_color_name, "Soft Blush");
  assert.deepEqual(f.sky_snapshot, { sun: "Leo" });
  assert.deepEqual(f.factors, ["a"]);
  assert.equal(f.fortune_date, "2026-07-27");
});

test("the Dev Update 1.10 avatar and relationship contract is unchanged", async () => {
  const doc = await build();
  const [mine, mum, figure] = doc.birth_profiles;

  assert.equal(mine.avatar_present, true);
  assert.equal(mine.avatar_exported, false);
  assert.equal(mine.avatar_export_limitation, AVATAR_EXPORT_LIMITATION);
  assert.equal(mine.avatar_updated_at, "2026-07-30T00:00:00.000Z", "a readable timestamp survives");
  assert.equal(mum.avatar_present, false);
  assert.equal(mum.avatar_export_limitation, null);

  // Legacy values are exported exactly as stored, with an honest status.
  assert.equal(mine.relationship_type, "self");
  assert.equal(mine.relationship_type_status, "set");
  assert.equal(mum.relationship_type, "other");
  assert.equal(mum.relationship_type_status, "legacy_unclassified");
  assert.equal(figure.relationship_type, "public_figure");
  assert.equal(figure.relationship_type_status, "legacy_classification");
});

test("an empty account exports a valid, reference-consistent document", async () => {
  const doc = await build({ fetchImpl: fakeRest({}) });
  assert.equal(doc.orbit_axis_export.schema_version, EXPORT_SCHEMA_VERSION);
  assert.equal(doc.profile, null);
  assert.deepEqual(doc.birth_profiles, []);
  assert.equal(doc.active_chart_ref, null);
  assert.deepEqual(auditExportPrivacy(doc).findings, []);
  assert.deepEqual(auditExportReferences(doc).findings, []);
});

// ── Version and compatibility ───────────────────────────────────────────────

test("every schema version bump is explained where it happened", () => {
  // 1.3.0 added saved Tarot reflections — a whole category a consumer has to
  // understand, so MINOR rather than patch. The guarantee this test has always
  // carried is unchanged: the constant and the changelog in the file move
  // together, so a version can never be raised silently.
  assert.equal(EXPORT_SCHEMA_VERSION, "1.3.0");
  const src = readFileSync(join(ROOT, "lib", "account", "export.js"), "utf8");
  for (const version of ["1.1.0", "1.2.0", "1.3.0"]) {
    assert.ok(src.includes(`${version}:`), `the ${version} bump is explained in the file`);
  }
});

test("no import or restore reader exists, so nothing in this repo can break", () => {
  // Stated as a test so the claim is checked rather than remembered. If an
  // importer is ever added, this fails and forces the compatibility decision.
  const consumers = [];
  for (const file of ["lib/account/export.js", "lib/api/v1/handlers/account.js", "public/app.js"]) {
    const src = readFileSync(join(ROOT, file), "utf8");
    if (/schema_version\s*[=:]/.test(src) && !/EXPORT_SCHEMA_VERSION/.test(src)) consumers.push(file);
    if (/parseExport|importAccount|restoreAccount/.test(src)) consumers.push(file);
  }
  assert.deepEqual(consumers, [], "the export is write-only");
});

// ── Cross-user ──────────────────────────────────────────────────────────────

test("another user's rows cannot enter the document even if the database returns them", async () => {
  // RLS is the real defence; this proves the serializer adds no second way in.
  // A row belonging to someone else carries their owner_id — which the
  // allow-list drops — so no foreign identifier can survive serialization.
  const doc = await build({
    fetchImpl: fakeRest({
      ...FULL_ACCOUNT,
      birth_profiles: [
        ...FULL_ACCOUNT.birth_profiles,
        { id: "11111111-9999-4999-8999-999999999999", owner_id: OTHER_ID, nickname: "Not Mine", relationship_type: "friend" },
      ],
    }),
  });
  const text = JSON.stringify(doc);
  assert.ok(!text.includes(OTHER_ID), "no foreign owner id survives serialization");
  assert.deepEqual(auditExportPrivacy(doc).findings, []);
});

test("a client-supplied owner id cannot steer the export", async () => {
  const urls = [];
  await build({
    fetchImpl: async (url) => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => [] };
    },
  });
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.ok(url.includes(`eq.${USER_ID}`), "every query is scoped to the verified token's user");
    assert.ok(!url.includes(OTHER_ID), "and never to an id from anywhere else");
  }
});

// ── The serializer in isolation ─────────────────────────────────────────────

test("presentExportChart without reference tables still yields a clean record", () => {
  const record = presentExportChart({
    id: CHART_A, owner_id: USER_ID, person_id: PERSON_A,
    nickname: "Solo", relationship_type: "friend",
    avatar_storage_path: "x/y/avatar.webp", avatar_version: 2,
  });
  assert.equal(record.nickname, "Solo");
  assert.equal(record.ref, null, "no table, no reference — but never the uuid");
  assert.equal(record.person_ref, null);
  for (const key of ["id", "owner_id", "person_id", "avatar_storage_path", "avatar_version"]) {
    assert.ok(!(key in record), `${key} is absent`);
  }
  assert.equal(record.avatar_present, true);
});

// ── The download itself ─────────────────────────────────────────────────────

test("a success envelope with no document is refused, not saved as 'undefined'", () => {
  // JSON.stringify(undefined) returns undefined rather than throwing, so a 200
  // whose envelope carried no `data` saved a nine-byte file containing the
  // literal text "undefined" and announced "Downloaded" — a failure wearing a
  // success message, which is the one outcome a data-export feature must never
  // produce. Found by driving the real button on the hosted Preview.
  const src = readFileSync(join(ROOT, "public", "app.js"), "utf8");
  const start = src.indexOf("function wireAccountExport");
  assert.ok(start > -1, "the export wiring exists");
  const wiring = src.slice(start, src.indexOf("\nfunction ", start + 10));

  assert.match(wiring, /!document_ \|\| typeof document_ !== "object" \|\| !document_\.orbit_axis_export/,
    "the payload is checked for a real export document before anything is saved");
  const guardAt = wiring.indexOf("orbit_axis_export");
  const blobAt = wiring.indexOf("new Blob(");
  assert.ok(guardAt > -1 && guardAt < blobAt, "and checked BEFORE the blob is built");
  assert.match(wiring, /catch \{\s*message\.textContent = "Your data could not be prepared for download/,
    "a serialization failure is reported rather than saved");
  assert.ok(!/new Blob\(\[JSON\.stringify\(payload\.data/.test(wiring),
    "the unguarded stringify is gone");
});
