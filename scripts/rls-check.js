#!/usr/bin/env node
// Orbit Axis :: Row Level Security verification against a real Supabase project.
//
// WHY THIS EXISTS
//
// RLS policies are the only thing standing between one user's birth data and
// another user's browser. They are written in SQL, applied by migration, and
// never exercised by ordinary unit tests — which run against no database at
// all. A policy can be syntactically valid, present in the schema, and still
// wrong. The only way to know it holds is to sign in as two different people
// and try to cross the boundary.
//
// WHAT IT DOES
//
// Creates two disposable users, gives each one a chart, and then attempts every
// crossing that must fail: read, update, delete, activate, and history access
// from A against B's rows, plus the same from an anonymous caller. Cleans up
// after itself.
//
// HOSTED WRITES
//
// Orbit uses ONE Supabase project for local, preview, and production. That is a
// deliberate cost decision, and it means this script writes to the same database
// real people use. So it refuses to run until the caller names the project:
//
//   node scripts/rls-check.js --confirm-project <project-ref>
//
// The project ref is a public identifier, not a secret. Requiring it means a
// stray invocation cannot silently write to production, and running against the
// wrong project fails closed rather than doing damage.

import { randomUUID, randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] || "");
};
const KEEP = args.includes("--keep-users");

const URL_ = process.env.SUPABASE_URL || "";
const ANON = process.env.SUPABASE_ANON_KEY || "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!URL_ || !ANON || !SERVICE) {
  fail("SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must all be set.\n"
    + "  Run with: node --env-file=.env.local scripts/rls-check.js --confirm-project <ref>");
}

const projectRef = (URL_.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || "unknown";
const confirmed = flag("--confirm-project");

if (confirmed !== projectRef) {
  fail(`This script writes to a hosted Supabase project.\n\n`
    + `    Project reference : ${projectRef}\n`
    + `    Confirmation given: ${confirmed || "(none)"}\n\n`
    + `  It creates two disposable users and a chart for each, then deletes them.\n`
    + `  Re-run naming the project to confirm:\n\n`
    + `    node --env-file=.env.local scripts/rls-check.js --confirm-project ${projectRef}`);
}

// ── HTTP helpers ────────────────────────────────────────────────────────────
const rest = (token, extra = {}) => ({
  apikey: ANON,
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  ...extra,
});

async function call(path, { method = "GET", token = ANON, body, headers = {}, admin = false } = {}) {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: admin
      ? { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...headers }
      : rest(token, headers),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
}

// ── Results ─────────────────────────────────────────────────────────────────
const results = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

// A disposable identity. The prefix makes test rows identifiable in the
// database without revealing anything about a real person; the password is
// generated per run and never printed, logged, or written to disk.
const disposable = () => ({
  email: `orbit-rls-${randomUUID().slice(0, 8)}@example.com`,
  password: `T${randomBytes(18).toString("base64url")}9!`,
});

async function createUser(who) {
  const identity = disposable();
  const created = await call("/auth/v1/admin/users", {
    method: "POST",
    admin: true,
    // Confirmed on creation: this script tests RLS, not the mail pipeline, and
    // an unconfirmed user cannot sign in to be tested.
    body: { email: identity.email, password: identity.password, email_confirm: true },
  });
  if (!created.ok) throw new Error(`could not create ${who}: HTTP ${created.status}`);

  const signedIn = await call("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email: identity.email, password: identity.password },
  });
  if (!signedIn.ok || !signedIn.data?.access_token) {
    throw new Error(`could not sign in ${who}: HTTP ${signedIn.status}`);
  }
  return { id: created.data.id, email: identity.email, token: signedIn.data.access_token };
}

async function deleteUser(user) {
  if (!user?.id) return false;
  const res = await call(`/auth/v1/admin/users/${user.id}`, { method: "DELETE", admin: true });
  return res.ok;
}

// Synthetic birth data. Never a real person's, and never the owner's own.
const CHART = (label) => ({
  birth_date: "1990-06-15",
  birth_time: "14:30",
  time_accuracy: "exact",
  latitude: 41.8781,
  longitude: -87.6298,
  timezone_name: "America/Chicago",
  utc_offset_at_birth: "-05:00",
  birthplace_name: `Test City ${label}`,
  nickname: `RLS test ${label}`,
});

async function main() {
  console.log(`\nOrbit Axis — Row Level Security verification`);
  console.log(`Project: ${projectRef}  (hosted write confirmed)\n`);

  let A = null;
  let B = null;
  try {
    A = await createUser("user A");
    B = await createUser("user B");
    check("two disposable users created and signed in", true, `${A.email.slice(0, 14)}… / ${B.email.slice(0, 14)}…`);

    // ── Each user creates their own chart ──────────────────────────────────
    const insert = async (user, label) => {
      const res = await call("/rest/v1/birth_profiles", {
        method: "POST",
        token: user.token,
        headers: { Prefer: "return=representation" },
        body: { ...CHART(label), owner_id: user.id },
      });
      if (!res.ok) throw new Error(`${label} could not create own chart: HTTP ${res.status}`);
      return res.data[0];
    };
    const chartA = await insert(A, "A");
    const chartB = await insert(B, "B");
    check("each user can create their own chart", Boolean(chartA?.id && chartB?.id));

    // ── Own access works ───────────────────────────────────────────────────
    const ownA = await call(`/rest/v1/birth_profiles?id=eq.${chartA.id}`, { token: A.token });
    check("user A can read their own chart", ownA.ok && ownA.data.length === 1);

    // ── Cross-user access must fail ────────────────────────────────────────
    // RLS makes another user's row invisible rather than forbidden, so the
    // correct evidence of denial is an EMPTY RESULT, not a 403. A test that
    // asserted 403 here would fail against a perfectly secure database.
    const readBsChart = await call(`/rest/v1/birth_profiles?id=eq.${chartB.id}`, { token: A.token });
    check("user A cannot READ user B's chart",
      readBsChart.ok && readBsChart.data.length === 0,
      `rows visible: ${readBsChart.data?.length ?? "?"}`);

    const updateBs = await call(`/rest/v1/birth_profiles?id=eq.${chartB.id}`, {
      method: "PATCH",
      token: A.token,
      headers: { Prefer: "return=representation" },
      body: { nickname: "OWNED BY A" },
    });
    check("user A cannot UPDATE user B's chart",
      updateBs.status === 403 || (updateBs.ok && updateBs.data.length === 0),
      `HTTP ${updateBs.status}, rows changed: ${updateBs.data?.length ?? 0}`);

    const deleteBs = await call(`/rest/v1/birth_profiles?id=eq.${chartB.id}`, {
      method: "DELETE",
      token: A.token,
      headers: { Prefer: "return=representation" },
    });
    check("user A cannot DELETE user B's chart",
      deleteBs.status === 403 || (deleteBs.ok && deleteBs.data.length === 0),
      `HTTP ${deleteBs.status}, rows deleted: ${deleteBs.data?.length ?? 0}`);

    // Prove B's chart actually survived, rather than trusting the response.
    const survived = await call(`/rest/v1/birth_profiles?id=eq.${chartB.id}`, { token: B.token });
    check("user B's chart still exists and is unmodified",
      survived.ok && survived.data.length === 1 && survived.data[0].nickname === "RLS test B");

    // ── Ownership cannot be forged on insert ───────────────────────────────
    const forged = await call("/rest/v1/birth_profiles", {
      method: "POST",
      token: A.token,
      headers: { Prefer: "return=representation" },
      body: { ...CHART("forged"), owner_id: B.id },
    });
    const forgedRow = forged.ok ? forged.data?.[0] : null;
    check("user A cannot create a chart OWNED BY user B",
      !forged.ok || forgedRow?.owner_id === A.id,
      forged.ok ? `insert accepted but owner forced to ${forgedRow?.owner_id === A.id ? "A" : "B — LEAK"}`
                : `HTTP ${forged.status} rejected`);
    if (forgedRow?.id) {
      await call(`/rest/v1/birth_profiles?id=eq.${forgedRow.id}`, { method: "DELETE", token: A.token });
    }

    // ── The activation RPC is owner-scoped ─────────────────────────────────
    const activateOwn = await call("/rest/v1/rpc/activate_birth_profile", {
      method: "POST", token: A.token, body: { p_birth_profile_id: chartA.id },
    });
    check("user A can activate their OWN chart", activateOwn.ok, `HTTP ${activateOwn.status}`);

    const activateOther = await call("/rest/v1/rpc/activate_birth_profile", {
      method: "POST", token: A.token, body: { p_birth_profile_id: chartB.id },
    });
    check("user A cannot ACTIVATE user B's chart", !activateOther.ok, `HTTP ${activateOther.status}`);

    // ── Ask Orbit conversation history is owner-scoped ─────────────────────
    const convo = await call("/rest/v1/ask_conversations", {
      method: "POST", token: A.token, headers: { Prefer: "return=representation" },
      body: { owner_id: A.id, title: "RLS test conversation" },
    });
    check("user A can create their own conversation", convo.ok, `HTTP ${convo.status}`);

    if (convo.ok && convo.data?.[0]?.id) {
      const seen = await call(`/rest/v1/ask_conversations?id=eq.${convo.data[0].id}`, { token: B.token });
      check("user B cannot read user A's conversation",
        seen.ok && seen.data.length === 0, `rows visible: ${seen.data?.length ?? "?"}`);
      await call(`/rest/v1/ask_conversations?id=eq.${convo.data[0].id}`, { method: "DELETE", token: A.token });
    }

    // ── Tarot reflections: owner-scoped, and the daily one lands once ──────
    // tarot_readings holds saved reflections, and the daily card now saves
    // ITSELF when a signed-in reader turns it over. That makes the once-per-day
    // guard in saveReading() the only thing standing between a reader and a
    // duplicate row for every device they open — and that guard is a PostgREST
    // filter on a JSON path INSIDE reading_data.
    //
    // No unit test can exercise it: the suite stubs fetch, so a filter that
    // matches nothing still passes every assertion, and the guard fails open
    // into exactly the duplicates it exists to prevent. This is the only place
    // the query meets a real database.
    const DAILY_DATE = "2026-08-20";
    const dailyReading = await call("/rest/v1/tarot_readings", {
      method: "POST", token: A.token, headers: { Prefer: "return=representation" },
      body: {
        owner_id: A.id,
        spread_type: "daily",
        reading_data: {
          cards: [{ position: "Todays card", card: { slug: "the-emperor" } }],
          draw: { local_date: DAILY_DATE, timezone: "UTC" },
        },
      },
    });
    check("user A can save their own tarot reflection", dailyReading.ok, `HTTP ${dailyReading.status}`);

    if (dailyReading.ok && dailyReading.data?.[0]?.id) {
      // Character for character, the query saveReading() runs before it inserts.
      const dedupe = (token, localDate) => call(
        `/rest/v1/tarot_readings?owner_id=eq.${A.id}&spread_type=eq.daily`
        + `&reading_data->draw->>local_date=eq.${localDate}&order=created_at.asc&limit=1`,
        { token });

      const sameDay = await dedupe(A.token, DAILY_DATE);
      check("the daily dedupe query finds today's saved reading",
        sameDay.ok && sameDay.data.length === 1,
        `rows: ${sameDay.data?.length ?? "?"} — a miss is one duplicate row per device, per day`);

      const otherDay = await dedupe(A.token, "2026-08-19");
      check("the dedupe query does not match a different day",
        otherDay.ok && otherDay.data.length === 0,
        "a false match would stop tomorrow's card from ever being saved");

      const crossed = await dedupe(B.token, DAILY_DATE);
      check("user B cannot read user A's tarot reflection",
        crossed.ok && crossed.data.length === 0, `rows visible: ${crossed.data?.length ?? "?"}`);

      await call(`/rest/v1/tarot_readings?id=eq.${dailyReading.data[0].id}`,
        { method: "DELETE", token: A.token });
    }

    // ── Anonymous access ───────────────────────────────────────────────────
    const anonRead = await call("/rest/v1/birth_profiles?select=id", { token: ANON });
    check("anonymous callers get no charts at all",
      anonRead.status === 401 || (anonRead.ok && anonRead.data.length === 0),
      `HTTP ${anonRead.status}, rows: ${Array.isArray(anonRead.data) ? anonRead.data.length : "n/a"}`);

    const anonFortunes = await call("/rest/v1/daily_fortunes?select=id", { token: ANON });
    check("anonymous callers get no readings",
      anonFortunes.status === 401 || (anonFortunes.ok && anonFortunes.data.length === 0),
      `HTTP ${anonFortunes.status}`);

    const anonReadings = await call("/rest/v1/tarot_readings?select=id", { token: ANON });
    check("anonymous callers get no saved reflections",
      anonReadings.status === 401 || (anonReadings.ok && anonReadings.data.length === 0),
      `HTTP ${anonReadings.status}`);

    const anonWrite = await call("/rest/v1/birth_profiles", {
      method: "POST", token: ANON, body: CHART("anon"),
    });
    check("anonymous callers cannot write", !anonWrite.ok, `HTTP ${anonWrite.status}`);

    // ── An expired / forged token is refused ───────────────────────────────
    const forgedToken = await call("/rest/v1/birth_profiles?select=id", { token: `${ANON}.tampered` });
    check("a tampered token is refused", !forgedToken.ok, `HTTP ${forgedToken.status}`);
  } catch (error) {
    check(`test run aborted: ${error.message}`, false);
  } finally {
    // Cleanup always runs. Deleting the user cascades to their rows, which is
    // why the fixture data does not need separate teardown.
    if (!KEEP) {
      const removedA = await deleteUser(A);
      const removedB = await deleteUser(B);
      check("disposable users removed", removedA && removedB);

      const leftovers = await call(
        `/rest/v1/birth_profiles?owner_id=in.(${[A?.id, B?.id].filter(Boolean).join(",")})&select=id`,
        { admin: true });
      check("no test rows left behind",
        !leftovers.ok || (Array.isArray(leftovers.data) && leftovers.data.length === 0),
        `rows remaining: ${Array.isArray(leftovers.data) ? leftovers.data.length : "?"}`);
    } else {
      console.log(`\n  --keep-users given: the two test accounts were left in place.`);
    }
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.error(`\n  ROW LEVEL SECURITY IS NOT HOLDING. Failed:`);
    failed.forEach((f) => console.error(`    - ${f.name}`));
    process.exit(1);
  }
  console.log(`  Row Level Security holds: no cross-user access was possible.\n`);
}

main().catch((error) => fail(`Unexpected failure: ${error.message}`));
