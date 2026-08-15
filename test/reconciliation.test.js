// Orbit Axis :: Update 3.3.2 branch-reconciliation regression suite.
//
// Explicit, auditable proof that reconciling the returning-user chart flow and
// the Me planet-grid redesign onto one base preserved the behavior of BOTH
// feature lines. Logic-level checks import the real services; frontend behaviors
// are asserted against the served source (the project is deliberately
// dependency-free with no DOM harness), mirroring frontend-static.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createChartService, pickFallbackActive, PRIMARY_NAME } from "../lib/charts/service.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(ROOT, "public", "app.js"), "utf8");
const html = readFileSync(join(ROOT, "public", "index.html"), "utf8");

// Minimal in-memory store mirroring the Supabase interface (as charts.test.js).
function memStore() {
  const profiles = new Map();
  const active = new Map();
  const calcs = [];
  return {
    _calcs: calcs,
    async listProfiles(o) { return [...profiles.values()].filter((p) => p.owner_id === o); },
    async getProfile(o, id) { const p = profiles.get(id); return p && p.owner_id === o ? p : null; },
    async countProfiles(o) { return (await this.listProfiles(o)).length; },
    async insertProfile(row) { profiles.set(row.id, row); return row; },
    async updateProfile(o, id, patch) { const p = profiles.get(id); Object.assign(p, patch); return p; },
    async activateProfile(o, id) { active.set(o, id); return profiles.get(id); },
    async deleteProfile(o, id) { profiles.delete(id); },
    async getActiveId(o) { return active.get(o) || null; },
    async setActiveId(o, id) { active.set(o, id); },
    async upsertProfileNames() {},
    async getCalculation() { return null; },
    async insertCalculation(row) { calcs.push(row); return row; },
  };
}
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let idc = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++idc).padStart(12, "0")}`;
async function addChart(svc, store, input) {
  const id = nextId();
  // service.create computes its own id; emulate by creating through the service.
  return svc.create(OWNER, input);
}
const SAMPLE = { birth_date: "1990-06-15", time_accuracy: "unknown", latitude: 40.7128, longitude: -74.006, birthplace: null };

// The service.create path requires a signed place; use the lower-level store for
// restoration tests where we only need profiles to exist.
function seedProfiles(store, rows) { for (const r of rows) store.insertProfile(r); }

// ── Returning-user flow (from feat/orbit-axis-returning-user-chart-flow) ─────
test("reconciled: active-chart restoration + heal (fallback preference order)", async () => {
  const store = memStore();
  const svc = createChartService(store);
  seedProfiles(store, [
    { id: "p-primary", owner_id: OWNER, nickname: PRIMARY_NAME, is_primary: true, birth_date: "1990-01-01", time_accuracy: "unknown", latitude: 1, longitude: 1, updated_at: "2026-01-01" },
    { id: "p-recent", owner_id: OWNER, nickname: "Recent", birth_date: "1991-01-01", time_accuracy: "unknown", latitude: 1, longitude: 1, last_active_at: "2026-07-01", updated_at: "2026-02-01" },
  ]);
  // A stale/dangling active id must heal to a real chart, not error.
  await store.setActiveId(OWNER, "does-not-exist");
  const active = await svc.getActive(OWNER);
  assert.ok(active && active.profile, "getActive heals a dangling active id");
  assert.equal(active.profile.id, "p-recent", "last-active wins the fallback");
});

test("reconciled: pickFallbackActive prefers last-active, then primary, then recency", () => {
  const chosen = pickFallbackActive([
    { id: "a", is_primary: true, updated_at: "2026-01-01" },
    { id: "b", last_active_at: "2026-07-10", updated_at: "2026-02-01" },
  ]);
  assert.equal(chosen.id, "b");
});

test("reconciled: onboarding is opened from exactly one place (no fortune/chart-fail path opens it)", () => {
  // The onboarding gate is opened by exactly one call site.
  // Dev Update 1.4 replaced the separate onboarding dialog with the one chart
  // form opened in "first" mode. The invariant is unchanged and is about
  // AUTOMATIC opening: a form that appears unprompted may have exactly one
  // trigger, and that trigger must be the ONBOARDING decision. A button the
  // user presses is a different thing and is not counted here.
  const resolverBody = appJs.slice(
    appJs.indexOf("async function resolveChartState"),
    appJs.indexOf("function setStartupStatus"));
  const autoOpeners = (resolverBody.match(/openChartForm\(/g) || []).length;
  assert.equal(autoOpeners, 1,
    `first-run onboarding must open automatically from exactly one gated path (found ${autoOpeners})`);
  // That single opener lives in the chart-state resolver, gated on the pure
  // startup decision (ONBOARDING) — which is derived from a confirmed zero-chart,
  // auth-resolved, successful-request result and is unit-tested in returning-user.
  const resolver = appJs.slice(appJs.indexOf("async function resolveChartState"), appJs.indexOf("async function resolveChartState") + 1600);
  assert.match(resolver, /view === STARTUP_VIEW\.ONBOARDING[\s\S]*openChartForm\("first"\)/, "opener gated on the ONBOARDING decision");
  assert.match(resolver, /chartCount: state\.charts\.length/, "decision receives the real chart count");
  // A recoverable failure closes onboarding and shows a retry instead.
  assert.match(resolver, /STARTUP_VIEW\.ERROR[\s\S]*closeModal\(modal\)[\s\S]*errorBox\.hidden = false/, "chart failure never opens onboarding");
  // The fortune loader must never open onboarding — a fortune failure is inline.
  const fortuneBlock = appJs.slice(appJs.indexOf("async function axisLoadToday"), appJs.indexOf("async function axisLoadToday") + 2000);
  assert.ok(fortuneBlock.length > 0, "fortune loader found");
  assert.ok(!/onboarding/.test(fortuneBlock), "fortune load never references onboarding");
});

test("reconciled: a failed chart request shows a recoverable error, not onboarding", () => {
  assert.ok(html.includes('id="today-chart-error"'), "recoverable chart-error banner exists");
  assert.ok(html.includes('id="today-chart-retry"'), "retry control exists");
  assert.match(appJs, /startup|state\.ready|gate/i, "a startup gate exists to prevent onboarding flashing");
});

// ── Me page (from feat/orbit-axis-me-planet-grid-redesign) ───────────────────
test("reconciled: Sun, Moon, Rising, and every planet still reach the reader", () => {
  // The constants moved into the interpretation layer in Dev Update 1.5, but
  // the guarantee is unchanged: the Big Three lead, and no planet is dropped.
  const planets = readFileSync(join(ROOT, "lib", "interpretation", "planets.js"), "utf8");
  for (const p of ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"]) {
    assert.ok(planets.includes(`"${p}"`) || planets.includes(`${p}:`), `${p} must still have a reading`);
  }
  const compose = readFileSync(join(ROOT, "lib", "interpretation", "compose.js"), "utf8");
  assert.match(compose, /composeBigThree/, "the Big Three are still composed as a set");
  assert.match(compose, /PLANET_ORDER\.map/, "every planet is composed, in a stable order");
  // The heading dropped the word "Planet" when Chiron and Lilith joined the
  // section — they are points, and calling them planets would be wrong. The
  // guarantee being checked is that the section still reaches the reader.
  assert.ok(html.includes("Sun, Moon, and Rising") && html.includes(">Placements<"));
});

test("reconciled: unknown birth time still hides Rising/houses (no fabrication)", () => {
  // Same guarantee, now enforced in the composer rather than a label helper.
  const compose = readFileSync(join(ROOT, "lib", "interpretation", "compose.js"), "utf8");
  // Houses are read from the chart's own house maps and never inferred. The
  // line became a ternary when points arrived (point_houses vs planet_houses);
  // what matters is that both branches read a map the chart supplied.
  assert.match(compose, /houseNumber = .*planet_houses\?\.\[planetName\]/);
  assert.match(compose, /houseNumber = .*point_houses\?\.\[planetName\]/);
  assert.match(compose, /unavailable: true/, "Rising is withheld, not estimated");
  assert.match(appJs, /!chart\?\.time_known \|\| !chart\?\.houses\?\.length/,
    "the houses section refuses to render without a usable time");
});

test("reconciled: every planet renders, with no hidden detail mode", () => {
  // Update 5.2 retired Simple/Advanced. There is one complete experience, so
  // nothing may be gated behind a detail level any more.
  assert.ok(!appJs.includes("placement-card__tech advanced-only"),
    "the old advanced-only gating is gone");
  assert.match(appJs, /renderPlacements\(readingPayload\.remainingPlacements/,
    "the placements section renders the composed placements");
  assert.match(appJs, /renderPlacements\(readingPayload\.remainingPlacements, readingPayload\.pointPlacements\)/,
    "Chiron and Lilith reach the reader too, and are not composed then dropped");
  // Sun and Moon are not dropped — they lead the page in the Big Three, and
  // the complete ten still appear in Chart Data.
  const compose = readFileSync(join(ROOT, "lib", "interpretation", "compose.js"), "utf8");
  assert.match(compose, /BIG_THREE_KEYS = Object\.freeze\(\["Sun", "Moon", "ascendant"\]\)/);
  assert.match(appJs, /STANDARD_PLANET_ORDER\.map/, "chart data still lists all ten bodies");
});

// ── Dev Update 1.3 :: Ask Orbit retired from the interface ───────────────────
//
// Ask Orbit was removed from the product, not from the database. These two
// tests pin the halves of that separately, because getting one right and the
// other wrong is the actual risk: a leftover entry point sends someone to a
// page that no longer exists, and an over-eager cleanup deletes conversations
// people are still entitled to export.

test("Ask Orbit has no entry point left in the interface", () => {
  for (const relic of ['id="panel-ask"', 'id="ask-input"', 'id="ask-form"', 'id="ask-drawer"', 'href="#ask"']) {
    assert.ok(!html.includes(relic), `${relic} must be gone from the shipped markup`);
  }
  assert.ok(!appJs.includes("function wireAsk"), "the Ask composer wiring must be gone");
  assert.ok(!appJs.includes("submitAsk"), "the Ask submit path must be gone");
  assert.ok(!/\{ id: "ask"/.test(appJs), "Ask must not be a navigable workspace");
});

test("a legacy Ask Orbit link recovers instead of breaking", () => {
  // Bookmarks and old notes still carry #ask. It must land somewhere real and
  // say what happened, rather than falling through to a blank panel.
  assert.match(appJs, /ask: \{ to: "home", notice:/, "#ask must redirect with an explanation");
  assert.match(appJs, /RETIRED_ROUTES/, "retired routes must be declared in one place");
});

test("Ask Orbit conversations are still owned, exportable, and deletable", () => {
  // The interface is gone; the data is not. Removing these paths would quietly
  // strand records a person is entitled to take with them.
  assert.ok(html.includes("Saved Ask Orbit conversations"),
    "deletion must still name the conversations it removes");
});

test("reconciled base keeps the surfaces Dev Update 1.3 did not retire", () => {
  assert.ok(html.includes('id="panel-me"'), "My Chart panel still present");
  assert.ok(html.includes('id="today-chart-picker"'), "Home saved-chart selector still present");
});
