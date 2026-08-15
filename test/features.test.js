// Orbit Axis :: version-one feature flags.
//
// Learn and News are built but unfinished. These tests exist because
// the failure mode is asymmetric: a feature wrongly OFF means someone in
// development sets a variable, while a feature wrongly ON means a stranger
// finds a broken page in production. Everything below leans on that asymmetry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FEATURES, FEATURE_IDS, featureEnabled, featureFlags,
  enabledFeatureIds, workspaceBlocked,
} from "../lib/features.js";

const PROD = { ORBIT_ENVIRONMENT: "production" };
const LOCAL = { ORBIT_ENVIRONMENT: "local" };
const PREVIEW = { ORBIT_ENVIRONMENT: "preview" };

// ── Defaults ────────────────────────────────────────────────────────────────

test("every gated feature is off when nothing is configured", () => {
  for (const id of FEATURE_IDS) {
    assert.equal(featureEnabled(id, {}), false, `${id} must default to off`);
  }
  assert.deepEqual(enabledFeatureIds({}), []);
});

test("the three unfinished features are exactly the ones gated", () => {
  assert.deepEqual([...FEATURE_IDS].sort(), ["learn", "news"]);
  // Tarot USED to be here. It graduated when it became a finished surface with
  // an authored deck; what gates it now is deckStatus(), which refuses an
  // empty, incomplete or unreviewed deck wherever it runs. A feature leaving
  // this registry should be a deliberate act, so it is asserted rather than
  // noticed later.
  assert.ok(!FEATURE_IDS.includes("tarot"), "tarot is no longer flag-gated");
});

// ── Production is absolute ──────────────────────────────────────────────────

test("production cannot enable an unfinished feature, whatever the environment says", () => {
  for (const id of FEATURE_IDS) {
    const env = { ...PROD, [FEATURES[id].env]: "true" };
    assert.equal(featureEnabled(id, env), false,
      `${id} must stay off in production even when its variable says true`);
  }
});

test("production is detected from either ORBIT_ENVIRONMENT or a real Vercel deployment", () => {
  assert.equal(featureEnabled("learn", { ORBIT_ENVIRONMENT: "production", ORBIT_FEATURE_LEARN: "true" }), false);
  // VERCEL=1 alongside VERCEL_ENV is what an actual deployment carries. The
  // resolver requires both, and rightly so: VERCEL_ENV alone is a variable
  // anyone can set locally, and it should not be able to reclassify a machine.
  assert.equal(featureEnabled("learn", { VERCEL: "1", VERCEL_ENV: "production", ORBIT_FEATURE_LEARN: "true" }), false);
  assert.equal(featureEnabled("learn", { VERCEL: "1", VERCEL_ENV: "preview", ORBIT_FEATURE_LEARN: "true" }), true,
    "a preview deployment may show the work for review");
});

test("an unset environment resolves to local, where flags may be set", () => {
  // Deferring to the application's environment resolver means "nothing is set"
  // means a developer's machine — a real deployment always carries VERCEL_ENV,
  // and the startup guard refuses to run a deployed instance without an
  // explicit environment. Treating unset as production would sound safer while
  // simply making local development impossible.
  assert.equal(featureEnabled("learn", { ORBIT_FEATURE_LEARN: "true" }), true);
  assert.equal(featureEnabled("learn", {}), false, "but still off unless asked for");
});

test("the flag agrees with the application's own environment resolver", () => {
  // Two pieces of code that both decide "is this production?" eventually
  // disagree, and the one that disagrees quietly is the feature flag.
  const source = readFileSync(new URL("../lib/features.js", import.meta.url), "utf8");
  assert.match(source, /resolveEnvironment/,
    "feature gating must not re-derive the environment from raw variables");
});

// ── Deliberate enabling ─────────────────────────────────────────────────────

test("local development can enable a feature deliberately", () => {
  assert.equal(featureEnabled("learn", { ...LOCAL, ORBIT_FEATURE_LEARN: "true" }), true);
});

test("a Vercel preview can enable a feature so the work can be reviewed", () => {
  assert.equal(featureEnabled("learn", { ...PREVIEW, ORBIT_FEATURE_LEARN: "true" }), true);
});

test("enabling one feature does not enable the others", () => {
  // The specimen used to be tarot, with learn and news as the untouched pair.
  // Tarot graduated, so learn is the specimen and news is what must stay off.
  const env = { ...LOCAL, ORBIT_FEATURE_LEARN: "true" };
  assert.deepEqual(enabledFeatureIds(env), ["learn"]);
  assert.equal(featureEnabled("learn", env), true);
  assert.equal(featureEnabled("news", env), false);
});

// ── Only unambiguous values count ───────────────────────────────────────────

test("ambiguous flag values fail safe", () => {
  // "1", "yes", "on" all look enabling to a person and are rejected on purpose:
  // a flag that guesses eventually guesses wrong, and here wrong means exposing
  // an unfinished feature.
  for (const value of ["1", "yes", "on", "TRUE!", "", "  ", "false", "no", "0", "disabled", "undefined"]) {
    assert.equal(featureEnabled("learn", { ...LOCAL, ORBIT_FEATURE_LEARN: value }), false,
      `"${value}" must not enable a feature`);
  }
});

test("the accepted values are recognised regardless of case or padding", () => {
  for (const value of ["true", "TRUE", " True ", "enabled", "ENABLED"]) {
    assert.equal(featureEnabled("learn", { ...LOCAL, ORBIT_FEATURE_LEARN: value }), true, value);
  }
});

test("a non-string value cannot enable a feature", () => {
  for (const value of [true, 1, {}, [], null, undefined]) {
    assert.equal(featureEnabled("learn", { ...LOCAL, ORBIT_FEATURE_LEARN: value }), false);
  }
});

test("an unknown feature name is never enabled", () => {
  assert.equal(featureEnabled("nonexistent", { ...LOCAL, ORBIT_FEATURE_NONEXISTENT: "true" }), false);
  assert.equal(featureEnabled("", LOCAL), false);
});

// ── Route gating ────────────────────────────────────────────────────────────

test("core workspaces are never gated", () => {
  // A typo in the registry must not be able to hide Home. Anything not gated
  // answers false, rather than defaulting to blocked.
  for (const id of ["home", "me", "ask", "history", "settings", "more"]) {
    assert.equal(workspaceBlocked(id, PROD), false, `${id} is core and must always be reachable`);
  }
});

test("unfinished workspaces are blocked in production and open when enabled", () => {
  for (const id of FEATURE_IDS) {
    assert.equal(workspaceBlocked(id, PROD), true);
    assert.equal(workspaceBlocked(id, { ...LOCAL, [FEATURES[id].env]: "true" }), false);
  }
});

test("featureFlags reports every feature, not only the enabled ones", () => {
  const flags = featureFlags({ ...LOCAL, ORBIT_FEATURE_NEWS: "true" });
  assert.deepEqual(Object.keys(flags).sort(), ["learn", "news"]);
  assert.equal(flags.news, true);
});

// ── The client agrees with the server ───────────────────────────────────────

const APP_JS = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("the client defaults every flag to off before asking the server", () => {
  // A flag that defaults to on would reveal the feature for as long as the
  // request took — the one moment nobody is watching.
  assert.match(APP_JS, /const featureState = \{ learn: false, news: false \}/);
});

test("the client only accepts a strict true from the server", () => {
  assert.match(APP_JS, /data\?\.features\?\.\[key\] === true/);
});

test("both navigation and routing use the gated list", () => {
  // Gating the rail alone would leave the feature reachable by hash. Dev Update
  // 1.3 removed the command palette and the number-key shortcuts, which were
  // the other two ways in; what remains must still consult the gate.
  assert.match(APP_JS, /availableWorkspaces\(\)\.filter\(ws => ws\.primary\)/, "rail");
  assert.match(APP_JS, /workspaceAvailable\(hash\)/, "hash routing");
});

test("a disabled panel is removed from the document, not merely hidden", () => {
  // `hidden` leaves the markup in the page for anyone reading the DOM. Hiding
  // with an attribute is not the same as not shipping it.
  assert.match(APP_JS, /\$\(`#panel-\$\{gated\.id\}`\)\?\.remove\(\)/);
  assert.match(APP_JS, /\$\(`#tab-\$\{gated\.id\}`\)\?\.remove\(\)/);
});

test("flags are loaded before the navigation is built", () => {
  const load = APP_JS.indexOf("await loadFeatureFlags()");
  const build = APP_JS.indexOf("buildRail();", load);
  assert.ok(load > 0 && build > load,
    "building the rail first would flash hidden features on screen");
});

test("the three workspaces are marked with their feature gate", () => {
  for (const id of FEATURE_IDS) {
    assert.match(APP_JS, new RegExp(`id: "${id}"[^}]*feature: "${id}"`),
      `the ${id} workspace must declare its gate`);
  }
});

test("the unfinished implementations are preserved, not deleted", () => {
  // The point of a flag is that the work survives. If these panels were gone,
  // the flag would be pretending.
  for (const id of FEATURE_IDS) {
    assert.ok(APP_JS.includes(`id: "${id}"`), `${id} must remain in the workspace registry`);
  }
  // The markup now lives OUTSIDE public/, which is what keeps it out of the
  // production artifact — everything under public/ is copied there verbatim.
  // Preserved and unshipped are different properties, and both are required.
  for (const id of FEATURE_IDS) {
    const fragment = readFileSync(new URL(`../features/panels/${id}.html`, import.meta.url), "utf8");
    assert.ok(fragment.includes(`id="panel-${id}"`), `the ${id} panel markup must be preserved`);
  }
});

test("the unfinished markup is not inside public/, so it cannot ship", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  for (const id of FEATURE_IDS) {
    assert.ok(!html.includes(`id="panel-${id}"`),
      `panel-${id} must not be in index.html — public/ is copied verbatim into the artifact`);
  }
});
