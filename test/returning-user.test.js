// Orbit Axis :: Returning User Chart Flow — regression coverage.
//
// The bug: a signed-in user with saved charts was re-shown chart setup on login
// / refresh. Two independent causes, both covered here:
//   1. A failed (or slow) /api/charts request left `charts` empty, which the UI
//      read as "this account has no charts" and opened onboarding.
//   2. Saved charts existed but no active chart was stored, so the personalized
//      experience never loaded.
// Plus the server-side active-chart resolution/healing that backs it all.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decideStartupView, STARTUP_VIEW } from "../public/startup-state.js";
import { createChartService, pickFallbackActive } from "../lib/charts/service.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(ROOT, "public", "app.js"), "utf8");
const html = readFileSync(join(ROOT, "public", "index.html"), "utf8");

// ── In-memory owner-scoped chart store ──────────────────────────────────────
function memStore(profiles = [], activeId = null) {
  const rows = profiles.map((profile) => ({ ...profile }));
  let active = activeId;
  let activity = 0;
  const calls = { setActiveId: 0, activateProfile: 0 };
  function nextActivityStamp() {
    activity += 1;
    return new Date(Date.UTC(2026, 6, 14, 12, 0, activity)).toISOString();
  }
  return {
    calls,
    get activeId() { return active; },
    async listProfiles() { return [...rows]; },
    async getProfile(_o, id) { return rows.find((p) => p.id === id) || null; },
    async getActiveId() { return active; },
    async setActiveId(_o, id) { calls.setActiveId += 1; active = id; },
    async activateProfile(_o, id) {
      calls.activateProfile += 1;
      const row = rows.find((p) => p.id === id);
      if (!row) throw new Error("not found");
      row.last_active_at = nextActivityStamp();
      active = id;
      return row;
    },
    async deleteProfile(_o, id) {
      const i = rows.findIndex((p) => p.id === id);
      if (i >= 0) rows.splice(i, 1);
    },
    async getCalculation() { return null; },
    async insertCalculation(row) { return row; },
  };
}

const base = {
  birth_date: "1990-05-05", birth_time: "12:00", time_accuracy: "exact",
  latitude: 40.7128, longitude: -74.006, timezone_name: "America/New_York",
  utc_offset_at_birth: "-04:00", zodiac_system: "tropical", house_system: "placidus",
};
const chartA = { ...base, id: "a", nickname: "My Chart", is_primary: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const chartB = { ...base, id: "b", nickname: "Mom", is_primary: false, created_at: "2026-02-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z" };
const chartC = { ...base, id: "c", nickname: "Friend", is_primary: false, created_at: "2026-03-01T00:00:00Z", updated_at: "2026-03-01T00:00:00Z" };

// ══ 1. Signed-in user with one active saved chart ═══════════════════════════
test("1. returning user with an active chart: no onboarding, chart loads", async () => {
  const view = decideStartupView({ authResolved: true, signedIn: true, chartsStatus: "ready", chartCount: 1 });
  assert.equal(view, STARTUP_VIEW.READY);
  assert.notEqual(view, STARTUP_VIEW.ONBOARDING);

  const svc = createChartService(memStore([chartA], "a"));
  const active = await svc.getActive("owner");
  assert.equal(active.profile.id, "a");
});

// ══ 2. Several charts: the correct active one is restored ═══════════════════
test("2. several charts: the stored active chart is the one restored", async () => {
  const store = memStore([{ ...chartA }, { ...chartB }, { ...chartC, last_active_at: "2026-07-01T00:00:00Z" }], "b");
  const svc = createChartService(store);
  const active = await svc.getActive("owner");
  assert.equal(active.profile.id, "b", "must restore the stored active chart, not a newer activity/edit fallback");
  assert.equal(store.calls.activateProfile, 0, "valid stored active references are authoritative");

  const { charts, active_chart_id } = await svc.list("owner");
  assert.equal(active_chart_id, "b");
  assert.deepEqual(charts.filter((c) => c.is_active).map((c) => c.id), ["b"]);
});

// ══ 3. Charts exist but none is active: one is selected and persisted ═══════
test("3. saved charts but no active chart: a valid chart is selected and activated", async () => {
  const store = memStore([{ ...chartB, last_active_at: "2026-07-01T00:00:00Z" }, chartC], null); // no active id stored
  const svc = createChartService(store);
  const active = await svc.getActive("owner");

  assert.ok(active, "must not report 'no chart' when charts exist");
  assert.equal(active.profile.id, "b", "newest activity wins when there is no valid active id");
  assert.equal(store.activeId, active.profile.id, "selection is persisted via the activation system");
  assert.ok(active.profile.last_active_at > "2026-07-01T00:00:00Z", "fallback receives fresh activity");
  assert.ok(store.calls.activateProfile >= 1);
});

test("3b. a stale/dangling active id heals to a real chart", async () => {
  const store = memStore([chartB], "deleted-elsewhere");
  const svc = createChartService(store);
  const active = await svc.getActive("owner");
  assert.equal(active.profile.id, "b");
  assert.equal(store.activeId, "b", "the dangling id is repaired");
});

test("3c. fallback preference: last active, then primary, then most recently updated", () => {
  assert.equal(pickFallbackActive([{ ...chartB, last_active_at: "2026-06-01T00:00:00Z" }, { ...chartC, last_active_at: "2026-07-01T00:00:00Z" }]).id, "c");
  assert.equal(pickFallbackActive([chartB, chartA, chartC]).id, "a", "primary My Chart wins");
  assert.equal(pickFallbackActive([chartB, { ...chartA, is_primary: false }]).id, "a", "legacy My Chart wins if primary is missing");
  // Without a primary, the most recently updated wins (B updated 2026-06 > C 2026-03).
  assert.equal(pickFallbackActive([chartC, chartB]).id, "b");
  assert.equal(pickFallbackActive([]), null);
});

test("3d. fallback without activity and without primary uses most recently updated", async () => {
  const store = memStore([chartC, chartB], null);
  const svc = createChartService(store);
  const active = await svc.getActive("owner");
  assert.equal(active.profile.id, "b");
  assert.equal(store.activeId, "b");
  assert.ok(active.profile.last_active_at, "persisted fallback gets activity");
});

// ══ 4. Zero charts: onboarding appears after loading completes ══════════════
test("4. signed-in user with zero charts: onboarding appears once loading completes", () => {
  assert.equal(
    decideStartupView({ authResolved: true, signedIn: true, chartsStatus: "ready", chartCount: 0 }),
    STARTUP_VIEW.ONBOARDING,
  );
});

test("4b. zero charts + dismissed: onboarding does not reopen this session", () => {
  assert.equal(
    decideStartupView({ authResolved: true, signedIn: true, chartsStatus: "ready", chartCount: 0, onboardingDismissed: true }),
    STARTUP_VIEW.READY,
  );
});

// ══ 5. Slow auth / slow chart request: setup never flashes ══════════════════
test("5. setup never flashes while auth or the chart request is still in flight", () => {
  // Auth unresolved — even though we have zero charts so far.
  assert.equal(
    decideStartupView({ authResolved: false, signedIn: false, chartsStatus: "idle", chartCount: 0 }),
    STARTUP_VIEW.LOADING,
  );
  // Auth resolved, signed in, but charts still loading — the dangerous window.
  for (const status of ["idle", "loading"]) {
    const view = decideStartupView({ authResolved: true, signedIn: true, chartsStatus: status, chartCount: 0 });
    assert.equal(view, STARTUP_VIEW.LOADING);
    assert.notEqual(view, STARTUP_VIEW.ONBOARDING, `chartsStatus=${status} must never onboard`);
  }
});

// ══ 6. Chart request failure: error + retry, never onboarding ═══════════════
test("6. a failed saved-chart request shows a recoverable error, not onboarding", () => {
  const view = decideStartupView({ authResolved: true, signedIn: true, chartsStatus: "error", chartCount: 0 });
  assert.equal(view, STARTUP_VIEW.ERROR);
  assert.notEqual(view, STARTUP_VIEW.ONBOARDING, "a failure must never be read as 'you have no chart'");
});

// ══ 7. Active chart deleted while others remain ════════════════════════════
test("7. deleting the active chart promotes another chart to active", async () => {
  const store = memStore([
    { ...chartA, last_active_at: "2026-07-01T00:00:00Z" },
    { ...chartB, last_active_at: "2026-07-10T00:00:00Z" },
    { ...chartC, last_active_at: "2026-07-05T00:00:00Z" },
  ], "a");
  const svc = createChartService(store);
  const result = await svc.remove("owner", "a");
  assert.equal(result.empty, false);
  assert.equal(result.active_chart_id, "b");
  assert.equal(store.activeId, "b");
  assert.ok(store.calls.activateProfile >= 1);
});

test("7b. deleting a non-active chart keeps active chart and activity unchanged", async () => {
  const rows = [{ ...chartA, last_active_at: "2026-07-01T00:00:00Z" }, { ...chartB, last_active_at: "2026-07-10T00:00:00Z" }];
  const store = memStore(rows, "a");
  const svc = createChartService(store);
  const result = await svc.remove("owner", "b");
  assert.equal(result.active_chart_id, "a");
  assert.equal(store.activeId, "a");
  assert.equal(rows[0].last_active_at, "2026-07-01T00:00:00Z");
  assert.equal(store.calls.activateProfile, 0);
});

// ══ 8. Final chart deleted: no-chart state ═════════════════════════════════
test("8. deleting the final chart transitions to the no-chart state", async () => {
  const store = memStore([chartA], "a");
  const svc = createChartService(store);
  const result = await svc.remove("owner", "a", { confirmEmpty: true });
  assert.equal(result.empty, true);
  assert.equal(result.active_chart_id, null);
  assert.equal(await svc.getActive("owner"), null);
  // And only now does onboarding become the right view.
  assert.equal(
    decideStartupView({ authResolved: true, signedIn: true, chartsStatus: "ready", chartCount: 0 }),
    STARTUP_VIEW.ONBOARDING,
  );
});

test("8b. deleting the only chart without confirmEmpty is refused", async () => {
  const svc = createChartService(memStore([chartA], "a"));
  await assert.rejects(() => svc.remove("owner", "a"), (e) => e.code === "last_chart");
});

// ══ 9. Switching charts from the Home selector ═════════════════════════════
test("9. switching the active chart persists and survives a reload", async () => {
  const store = memStore([chartA, chartB], "a");
  const svc = createChartService(store);
  await svc.activate("owner", "b");
  assert.equal(store.activeId, "b");
  assert.ok(store.calls.activateProfile >= 1);
  // "Reload": a fresh service against the same store restores the new selection.
  const reloaded = await createChartService(store).getActive("owner");
  assert.equal(reloaded.profile.id, "b");
});

test("9c. switching charts survives sign-out and later sign-in", async () => {
  const store = memStore([chartA, chartB], "a");
  await createChartService(store).activate("owner", "b");
  // Later login reads the same persisted active preference.
  const afterLogin = await createChartService(store).getActive("owner");
  assert.equal(afterLogin.profile.id, "b");
});

test("9b. the Home selector refreshes the reading through the activation endpoint", () => {
  // Update 5.2 removed the carousel, so there is no slide index to reset — the
  // cards simply re-render from the new fortune. What still matters, and what
  // this test now guards, is that switching charts goes through the single
  // authenticated activation endpoint rather than a second selection system.
  assert.match(appJs, /\/activate/);
  assert.match(appJs, /axisWireChartPicker/);
  assert.match(appJs, /axisRenderFortune/, "the reading re-renders after a switch");
  assert.ok(!/AXIS\.carousel/.test(appJs), "no carousel state should survive");
});

// ══ 10. Signed-out local preview still works ═══════════════════════════════
test("10. signed-out local preview is preserved and separate from saved charts", () => {
  assert.equal(
    decideStartupView({ authResolved: true, signedIn: false, chartsStatus: "idle", chartCount: 0 }),
    STARTUP_VIEW.SIGNED_OUT,
  );
  // The local preview path (localStorage birth -> /api/fortune/preview) remains.
  assert.match(appJs, /axisGetBirth\(\)/);
  assert.match(appJs, /\/api\/fortune\/preview/);
});

// ══ 11 & 12. Structure: no-flash, + action, modal, a11y, keyboard ══════════
test("11. the Home selector stands alone, and its error state survives", () => {
  // The "+" and Manage controls were removed on 2026-08-08. This test used to
  // assert they existed; it now asserts they do NOT, so their return is a
  // decision rather than a regression.
  //
  // What it always really guarded is the part below: a recoverable chart-load
  // failure must stay distinguishable from "you have no chart", and must offer
  // a way back. That is untouched.
  assert.ok(html.includes('id="today-chart-select"'), "the selector exists");
  assert.ok(!html.includes('id="today-chart-add"'), "the + action is gone");
  assert.ok(!html.includes('id="today-chart-manage"'), "the manage entry point is gone");
  assert.ok(html.includes('id="today-chart-error"'), "recoverable error state exists");
  assert.ok(html.includes('id="today-chart-retry"'), "retry control exists");
});

test("11b. a startup gate exists and is shown before anything is decided", () => {
  assert.ok(html.includes('id="startup-gate"'), "startup gate exists");
  // It must NOT start hidden — it covers the app from first paint.
  assert.doesNotMatch(html, /<div class="startup-gate" id="startup-gate" hidden/);
  assert.match(appJs, /finishStartup/);
});

test("12. the chart modal is keyboard operable (focus trap, Escape, focus restore)", () => {
  assert.ok(html.includes('id="chart-modal"'), "chart modal exists");
  assert.ok(html.includes('role="dialog"') && html.includes('aria-modal="true"'), "dialog semantics");
  assert.ok(html.includes('id="confirm-modal"'), "accessible delete confirmation exists");
  assert.ok(html.includes('role="alertdialog"'), "confirm uses alertdialog");
  // Focus trap + Escape + focus restoration live in the shared modal utility.
  assert.match(appJs, /event\.key === "Escape"/);
  assert.match(appJs, /event\.key !== "Tab"/);
  assert.match(appJs, /entry\.restoreTo/);
  // Native confirm() is no longer used for destructive chart deletion.
  assert.doesNotMatch(appJs, /if \(!confirm\(/);
});

// ══ The two original root causes, locked down ══════════════════════════════
test("regression: the fortune path never opens the onboarding gate", () => {
  // axisLoadToday used to do: $("#onboarding-gate").hidden = state.charts.length > 0
  // A failed fortune request must never re-onboard a returning user.
  const axisLoadToday = appJs.slice(appJs.indexOf("async function axisLoadToday"));
  const body = axisLoadToday.slice(0, axisLoadToday.indexOf("\n}\n"));
  assert.doesNotMatch(body, /onboarding-gate/, "axisLoadToday must not touch the onboarding gate");
});

test("regression: onboarding is opened automatically from exactly one place", () => {
  // Dev Update 1.4 replaced the separate onboarding dialog with the one chart
  // form in "first" mode, but the property being protected is the same: only
  // resolveChartState may make a form appear that the user did not ask for.
  const resolver = appJs.slice(
    appJs.indexOf("async function resolveChartState"),
    appJs.indexOf("function setStartupStatus"));
  const opens = resolver.match(/openChartForm\(/g) || [];
  assert.equal(opens.length, 1, "exactly one code path opens onboarding automatically");
  assert.match(resolver, /STARTUP_VIEW\.ONBOARDING/, "and it is gated on the ONBOARDING decision");
});

test("regression: a failed chart request does not clear known charts", () => {
  // loadSavedCharts must set status=error, not blank the list into "no charts".
  const fn = appJs.slice(appJs.indexOf("async function loadSavedCharts"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /chartsStatus = "error"/);
  assert.doesNotMatch(body, /catch[\s\S]*?state\.charts = \[\]/, "an error must not empty the chart list");
});
