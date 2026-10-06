// Orbit Axis :: base authenticated data export (Dev Update 1.2).
//
// Exercised with injected doubles rather than against the hosted database. The
// properties that matter here are negative ones — what must NOT be in the file
// — and those are exactly the ones a manual spot-check of a real export is
// worst at proving.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAccountExport, stripSecrets, exportFilename,
  EXPORT_SCHEMA_VERSION, EXPORT_SOURCES, AccountExportError,
  auditExportPrivacy,
} from "../lib/account/export.js";
import { exportData } from "../lib/api/v1/handlers/account.js";
import { handleApiV1, createLimiters } from "../lib/api/v1/router.js";
import { SESSION_COOKIE } from "../lib/auth/supabase-auth.js";

const USER_ID = "11111111-2222-3333-4444-555555555555";
// Real uuid shapes, so "no production identifier survives" is a claim the
// tests can actually check rather than a string that happens to look tidy.
const CHART_A = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
const CHART_B = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";
const FORTUNE_A = "ffffffff-1111-4fff-8fff-ffffffffffff";
const FORTUNE_B = "ffffffff-2222-4fff-8fff-ffffffffffff";
const OTHER_ID = "99999999-8888-7777-6666-555555555555";
const TOKEN = "test-access-token";

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

/**
 * A Supabase REST double that answers per table and records every request, so
 * a test can assert on what was ASKED as well as what came back.
 */
function fakeRest(rowsByTable = {}, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const parsed = new URL(String(url));
    const table = parsed.pathname.split("/rest/v1/")[1] || "";
    calls.push({ url: String(url), table, params: parsed.searchParams, headers: init.headers || {} });
    if (status !== 200) return { ok: false, status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => rowsByTable[table] ?? [] };
  };
  impl.calls = calls;
  return impl;
}

function withSupabaseEnv(run) {
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = "https://exampleprojectref000.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  return Promise.resolve(run()).finally(() => {
    if (savedUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = savedKey;
  });
}

const build = (opts = {}) => withSupabaseEnv(() => buildAccountExport({
  accessToken: TOKEN, verifyUser: okUser, fetchImpl: fakeRest({}), ...opts,
}));

// ── authentication and ownership ────────────────────────────────────────────

test("an export requires a token", async () => {
  await assert.rejects(
    () => build({ accessToken: "" }),
    (e) => e instanceof AccountExportError && e.stage === "authentication" && e.status === 401,
  );
});

test("an unverifiable token is refused rather than trusted", async () => {
  await assert.rejects(
    () => build({ verifyUser: async () => ({ ok: false }) }),
    (e) => e instanceof AccountExportError && e.status === 401,
  );
});

test("the identity comes from the token, never from a parameter", async () => {
  // There is no user-id argument to pass, which is the point. The id used in
  // every query must be the one the verified token reported.
  const fetchImpl = fakeRest({});
  await build({ fetchImpl });
  assert.ok(fetchImpl.calls.length > 0);
  for (const call of fetchImpl.calls) {
    const scope = [...call.params.values()].find((v) => v.startsWith("eq."));
    assert.equal(scope, `eq.${USER_ID}`, `${call.table} was scoped to the wrong id`);
    assert.ok(!call.url.includes(OTHER_ID), "no other user's id may appear in any query");
  }
});

test("every query is made with the user's own token, so RLS does the filtering", async () => {
  const fetchImpl = fakeRest({});
  await build({ fetchImpl });
  for (const call of fetchImpl.calls) {
    assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`,
      `${call.table} must be read as the user, not with a service-role key`);
  }
});

test("every declared source is actually read", async () => {
  const fetchImpl = fakeRest({});
  await build({ fetchImpl });
  const read = new Set(fetchImpl.calls.map((c) => c.table));
  for (const source of EXPORT_SOURCES) {
    assert.ok(read.has(source.table), `${source.table} is declared but never queried`);
  }
});

// ── contents ────────────────────────────────────────────────────────────────

test("an empty account still produces a valid document", async () => {
  const doc = await build();
  assert.equal(doc.orbit_axis_export.schema_version, EXPORT_SCHEMA_VERSION);
  assert.equal(doc.profile, null);
  assert.deepEqual(doc.birth_profiles, []);
  assert.deepEqual(doc.fortune_history, []);
  assert.equal(doc.active_chart_ref, null);
  // A brand-new account must not get an error page where its export should be.
  // Dev Update 1.10.1: the Auth uuid is gone; the email says whose file it is.
  assert.ok(!("id" in doc.account), "the Auth uuid never leaves the server");
  assert.equal(doc.account.email, "disposable@example.test");
});

test("multiple charts and fortune history are carried through", async () => {
  const doc = await build({
    fetchImpl: fakeRest({
      profiles: [{ user_id: USER_ID, active_birth_profile_id: CHART_B, astrology_detail_level: "Advanced" }],
      birth_profiles: [
        { id: CHART_A, owner_id: USER_ID, nickname: "My Chart", relationship_type: "self" },
        { id: CHART_B, owner_id: USER_ID, nickname: "Mom", relationship_type: "family" },
      ],
      daily_fortunes: [
        { id: FORTUNE_A, owner_id: USER_ID, birth_profile_id: CHART_B, fortune_date: "2026-07-27", mood: "steady" },
        { id: FORTUNE_B, owner_id: USER_ID, birth_profile_id: CHART_A, fortune_date: "2026-07-26", mood: "bright" },
      ],
    }),
  });
  assert.equal(doc.birth_profiles.length, 2);
  assert.equal(doc.fortune_history.length, 2);
  // The active chart is named by its export-local reference — the second
  // chart in source order — never by its production uuid.
  assert.equal(doc.active_chart_ref, "chart-2");
  assert.equal(doc.birth_profiles[1].ref, "chart-2");
  assert.ok(!JSON.stringify(doc).includes(CHART_B), "the row uuid is absent");
  assert.equal(doc.preferences.astrology_detail_level, "Advanced");
});

test("relationship type is exported where it is already present", async () => {
  // Dev Update 1.10 formalises this field; Dev Update 1.2 must not silently
  // drop the values that already exist.
  const doc = await build({
    fetchImpl: fakeRest({
      birth_profiles: [{ id: CHART_A, owner_id: USER_ID, relationship_type: "family" }],
    }),
  });
  assert.equal(doc.birth_profiles[0].relationship_type, "family");
});

test("account dates are included", async () => {
  const doc = await build();
  assert.equal(doc.account.created_at, "2026-01-01T00:00:00.000Z");
  assert.equal(doc.account.email_confirmed_at, "2026-01-01T00:05:00.000Z");
});

test("both a UTC and a localized timestamp are recorded", async () => {
  const doc = await build({
    timezone: "America/Chicago",
    now: () => new Date("2026-07-28T12:00:00.000Z"),
  });
  assert.equal(doc.orbit_axis_export.generated_at_utc, "2026-07-28T12:00:00.000Z");
  assert.equal(doc.orbit_axis_export.timezone, "America/Chicago");
  assert.ok(doc.orbit_axis_export.generated_at_local, "a readable local time is included");
});

test("an unusable timezone degrades instead of failing the export", async () => {
  const doc = await build({ timezone: "Not/AZone" });
  assert.equal(doc.orbit_axis_export.generated_at_local, null);
  assert.equal(doc.account.email, "disposable@example.test", "the export still succeeds");
});

test("categories that do not exist yet are named rather than silently absent", async () => {
  const doc = await build();
  const pending = doc.not_yet_included.categories;
  for (const category of ["gratitude", "dreams", "wellness", "saved_insights",
    "notification_preferences", "compatibility_notes", "researcher_data"]) {
    assert.ok(pending.includes(category), `${category} should be listed as pending`);
  }
});

test("remembered daily draws are carried through without database identity", async () => {
  const doc = await build({
    fetchImpl: fakeRest({
      tarot_daily_draws: [{
        id: FORTUNE_A, owner_id: USER_ID,
        local_date: "2026-08-20", deck_version: "rws-1", card_slug: "the-star",
        orientation: "reversed", created_at: "2026-08-20T07:00:00.000Z",
      }],
    }),
  });
  assert.deepEqual(doc.daily_draws, [{
    local_date: "2026-08-20", deck_version: "rws-1", card_slug: "the-star",
    orientation: "reversed", created_at: "2026-08-20T07:00:00.000Z",
  }]);
  assert.deepEqual(auditExportPrivacy(doc).findings, []);
});

// ── what must never appear ──────────────────────────────────────────────────

test("credential-shaped fields are stripped at any depth", () => {
  const cleaned = stripSecrets({
    keep: "yes",
    access_token: "leak",
    nested: { refresh_token: "leak", password_hash: "leak", fine: 1 },
    list: [{ service_role_key: "leak", ok: true }],
  });
  assert.deepEqual(cleaned, { keep: "yes", nested: { fine: 1 }, list: [{ ok: true }] });
});

test("a credential appearing in a row is removed from the finished document", async () => {
  // The select list is written by a person and can be widened by a later change
  // that means well; the strip runs on the actual result.
  const doc = await build({
    fetchImpl: fakeRest({
      profiles: [{ user_id: USER_ID, encrypted_password: "should-never-ship", display_name: "A" }],
    }),
  });
  assert.equal(doc.profile.display_name, "A");
  assert.ok(!("encrypted_password" in doc.profile));
  assert.ok(!JSON.stringify(doc).includes("should-never-ship"));
});

test("no other user's records can arrive through a declared source", async () => {
  // RLS is the real guarantee and cannot be exercised here, but the query that
  // relies on it must still be scoped, so a policy regression is not the only
  // thing standing between two accounts.
  const fetchImpl = fakeRest({});
  await build({ fetchImpl });
  for (const call of fetchImpl.calls) {
    assert.ok(call.params.toString().includes(`eq.${USER_ID}`),
      `${call.table} query must carry an owner filter`);
  }
});

test("a read failure never forwards the database's own message", async () => {
  await assert.rejects(
    () => build({ fetchImpl: fakeRest({}, { status: 500 }) }),
    (e) => {
      assert.ok(e instanceof AccountExportError);
      assert.doesNotMatch(e.message, /column|policy|relation|permission|constraint/i,
        "an internal error must not describe the schema");
      return true;
    },
  );
});

// ── filename ────────────────────────────────────────────────────────────────

test("the download has a clear, findable filename", () => {
  const name = exportFilename(new Date("2026-07-28T12:00:00.000Z"));
  assert.equal(name, "orbit-axis-export-2026-07-28.json");
});

// ── HTTP surface ────────────────────────────────────────────────────────────

function mockReq({ method = "GET", url = "/api/v1/account/export", headers = {} } = {}) {
  return { method, url, headers, socket: { remoteAddress: "127.0.0.1" } };
}

const limiters = () => createLimiters();

test("anonymous export is refused with 401", async () => {
  const res = await handleApiV1(mockReq(), "/api/v1/account/export", { limiters: limiters() });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, "UNAUTHORIZED");
  assert.equal(res.body.data, null);
});

/** The session cookie holds base64url JSON, matching lib/auth/supabase-auth.js. */
function sessionCookieHeader(session) {
  return `${SESSION_COOKIE}=${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
}

test("the token is accepted from a bearer header or the session cookie", async () => {
  // A browser sends the cookie; a future iOS client has no shared cookie jar
  // and sends the header. Both transports must reach the same place.
  for (const headers of [
    { authorization: `Bearer ${TOKEN}` },
    { cookie: sessionCookieHeader({ access_token: TOKEN }) },
  ]) {
    const result = await withSupabaseEnv(() => exportData(null, {
      req: mockReq({ headers }),
      deps: { verifyUser: okUser, fetchImpl: fakeRest({}) },
    }));
    assert.equal(result.document.account.email, "disposable@example.test");
  }
});

test("a successful export sets download and no-store headers", async () => {
  const res = await withSupabaseEnv(() => handleApiV1(
    mockReq({ headers: { authorization: `Bearer ${TOKEN}` } }),
    "/api/v1/account/export",
    { limiters: limiters(), accountDeps: { verifyUser: okUser, fetchImpl: fakeRest({}) } },
  ));
  assert.equal(res.status, 200);
  assert.match(res.headers["Content-Disposition"], /^attachment; filename="orbit-axis-export-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.equal(res.headers["Cache-Control"], "no-store",
    "an export must not be cached by a browser or a CDN");
  assert.ok(res.headers["X-Request-Id"], "every response carries a request id");
  // The envelope carries the document itself, not the {filename, document} pair.
  assert.equal(res.body.data.account.email, "disposable@example.test");
  assert.equal(res.body.data.filename, undefined);
});

test("the filename cannot inject a header", async () => {
  const res = await withSupabaseEnv(() => handleApiV1(
    mockReq({ headers: { authorization: `Bearer ${TOKEN}` } }),
    "/api/v1/account/export",
    { limiters: limiters(), accountDeps: { verifyUser: okUser, fetchImpl: fakeRest({}) } },
  ));
  const disposition = res.headers["Content-Disposition"];
  assert.doesNotMatch(disposition, /[\r\n]/);
});

test("export is rate limited", async () => {
  const shared = limiters();
  const req = () => handleApiV1(
    mockReq({ headers: { authorization: `Bearer ${TOKEN}` } }),
    "/api/v1/account/export",
    { limiters: shared, accountDeps: { verifyUser: okUser, fetchImpl: fakeRest({}) } },
  );
  const statuses = [];
  for (let i = 0; i < 8; i += 1) statuses.push((await withSupabaseEnv(req)).status);
  assert.ok(statuses.includes(429), `expected a 429 within the account budget, got ${statuses}`);
});

test("only GET is served", async () => {
  const res = await handleApiV1(
    mockReq({ method: "POST" }), "/api/v1/account/export", { limiters: limiters() },
  );
  assert.equal(res.status, 405);
});

test("export never requires a service-role key", async () => {
  // Deletion currently cannot run in the approved shared-database
  // configuration precisely because it needs one. Export must not inherit that
  // limitation, so this asserts the module does not read the variable at all.
  const source = await import("node:fs").then((fs) => fs.readFileSync(
    new URL("../lib/account/export.js", import.meta.url), "utf8"));
  assert.ok(!source.includes("SUPABASE_SERVICE_ROLE_KEY"),
    "the export path must work without a service-role key");
});

// ── Chart identity in the export (Dev Update 1.10) ──────────────────────────

test("each chart exports identity honestly: status named, avatar reported, path withheld", async () => {
  const { presentExportChart, AVATAR_EXPORT_LIMITATION } = await import("../lib/account/export.js");

  const withAvatar = presentExportChart({
    id: "c1", nickname: "Mom", relationship_type: "family",
    avatar_storage_path: "owner-uuid/c1/avatar.webp", avatar_version: 4,
    avatar_updated_at: "2026-08-01T00:00:00Z",
  });
  assert.equal(withAvatar.relationship_type, "family");
  assert.equal(withAvatar.relationship_type_status, "set");
  assert.equal(withAvatar.avatar_present, true);
  assert.equal(withAvatar.avatar_exported, false, "binaries are not in a JSON export");
  assert.equal(withAvatar.avatar_export_limitation, AVATAR_EXPORT_LIMITATION);
  assert.ok(!("avatar_storage_path" in withAvatar), "the raw path names the bucket layout");
  assert.ok(!("avatar_version" in withAvatar), "the cache key is an internal");
  assert.ok(!JSON.stringify(withAvatar).includes("owner-uuid/"));

  const statuses = [
    [{ relationship_type: "other" }, "legacy_unclassified"],
    [{ relationship_type: "public_figure" }, "legacy_classification"],
    [{ relationship_type: null }, "unclassified"],
    [{ relationship_type: "self" }, "set"],
  ];
  for (const [row, expected] of statuses) {
    assert.equal(presentExportChart({ id: "x", ...row }).relationship_type_status, expected,
      `${row.relationship_type} exports as ${expected}`);
  }

  const noAvatar = presentExportChart({ id: "c2", nickname: "Bo", relationship_type: null });
  assert.equal(noAvatar.avatar_present, false);
  assert.equal(noAvatar.avatar_exported, false);
  assert.equal(noAvatar.avatar_export_limitation, null);
});
