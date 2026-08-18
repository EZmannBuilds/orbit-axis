// Orbit Axis :: Dev Update 4.3 — the starfield and the card tilt.
//
// Both features are motion, so both are tested the same way round: not "does
// it move" but "does everything that moves also stop" — under the OS
// preference, under the in-app toggle, off the tarot route, with the tab
// hidden, and when iOS says no. The starfield additionally must add no delay:
// it decorates the wait, it must never lengthen it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "public", "app.js"), "utf8");
const HTML = readFileSync(join(ROOT, "public", "index.html"), "utf8");
const TAROT_CSS = readFileSync(join(ROOT, "public", "styles", "tarot.css"), "utf8");
const AUTH_CSS = readFileSync(join(ROOT, "public", "styles", "auth.css"), "utf8");

function bodyOf(name) {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} must exist`);
  let i = APP.indexOf("{", start), depth = 0;
  for (let j = i; j < APP.length; j += 1) {
    if (APP[j] === "{") depth += 1;
    else if (APP[j] === "}") { depth -= 1; if (depth === 0) return APP.slice(i, j + 1); }
  }
  throw new Error(`unbalanced ${name}`);
}

/* ── The starfield ──────────────────────────────────────────────────────── */

test("the starfield is deterministic, capped, and decorative", () => {
  const body = bodyOf("buildStarfield");
  assert.match(body, /let seed = 62/, "the same seed gives the same sky every open");
  assert.match(body, /i < 42/, "the star count is capped");
  assert.match(body, /aria-hidden/, "the field carries nothing and says so");
  assert.ok(!body.includes("setTimeout") && !body.includes("await"),
    "building the field is synchronous — it cannot delay anything");
});

test("the starfield decorates the wait without lengthening it", () => {
  const finish = bodyOf("finishStartup");
  // "starfield", not "star": this function is FULL of the substring "star" —
  // state.startup, #startup-gate — and the first draft of this assertion
  // failed on its own function under test. What must be absent is any
  // reference to the field, and any timer.
  assert.ok(!finish.includes("setTimeout") && !finish.includes("starfield") && !finish.includes("startup-stars"),
    "finishStartup drops the gate the moment startup resolves — stars or no stars");
  const boot = bodyOf("boot");
  assert.match(boot, /^\s*buildStarfield\(\);/m, "the field exists from the first line of boot");
});

test("the stars move by opacity only, and stop under both refusals", () => {
  const twinkle = AUTH_CSS.slice(AUTH_CSS.indexOf("@keyframes star-twinkle"));
  const frames = twinkle.slice(0, twinkle.indexOf("}\n}") + 3);
  assert.ok(frames.includes("opacity"), "twinkle animates opacity");
  assert.ok(!/transform|width|height|left|top/.test(frames),
    "and ONLY opacity — nothing that costs layout or paint per frame");
  assert.match(AUTH_CSS, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,120}\.starfield i \{ animation: none/,
    "the OS refusal stops the twinkle");
  assert.match(AUTH_CSS, /:root\[data-motion="reduced"\] \.starfield i \{ animation: none/,
    "and so does the in-app toggle");
});

/* ── The card tilt ──────────────────────────────────────────────────────── */

test("card motion is a setting, off by default, with honest help text", () => {
  assert.match(APP, /tarotMotion: \{ default: "off", seg: "#set-tarot-motion" \}/,
    "the preference exists and defaults off — motion nobody asked for is the failure mode");
  assert.match(HTML, /id="set-tarot-motion"/, "the control exists");
  assert.match(HTML, /saying no simply\s+leaves it off/, "the help says what a denial does");
  assert.match(HTML, /reduced-motion setting always wins/, "and who outranks it");
});

test("the permission is asked for at the toggle, never at launch", () => {
  const defs = APP.split("tarotMotionRequestPermission").length - 1;
  assert.equal(defs, 2, "one definition and exactly one call — nothing else asks");
  const wire = bodyOf("wireSettings");
  assert.ok(wire.includes("tarotMotionRequestPermission()"),
    "the one call sits in the settings click — a user gesture, which iOS requires");
  assert.ok(!bodyOf("boot").includes("tarotMotionRequestPermission"),
    "and launch never prompts");
  assert.ok(wire.includes('settings.set(key, "off")'),
    "a denial puts the switch back off");
  assert.match(wire, /toast\("Motion access was declined/,
    "and says so instead of leaving a dead switch");
});

test("the sensor listener exists only while all four gates hold", () => {
  const sync = bodyOf("tarotMotionSync");
  for (const gate of ['tarotPref("tarotMotion", "off") === "on"',
                      'currentWorkspace() === "tarot"',
                      'document.visibilityState === "visible"',
                      "!reducedMotionActive()",
                      "TILT.granted !== false"]) {
    assert.ok(sync.includes(gate), `attach requires: ${gate}`);
  }
  assert.ok(sync.includes('removeEventListener("deviceorientation"'),
    "losing any gate releases the sensor");
  assert.ok(sync.includes('removeProperty("--tilt-x")'),
    "and zeroes the tilt rather than freezing it mid-lean");
});

test("every exit path re-runs the sync", () => {
  assert.match(APP, /window\.addEventListener\("hashchange", tarotMotionSync\)/,
    "navigating away releases the sensor");
  assert.match(APP, /document\.addEventListener\("visibilitychange", tarotMotionSync\)/,
    "hiding the tab releases it");
  assert.match(bodyOf("enterTarot"), /tarotMotionSync\(\)/,
    "arriving re-evaluates");
  assert.match(APP, /if \(key === "tarotMotion"\) tarotMotionSync\(\)/,
    "and so does the setting itself");
});

test("the tilt is subtle, relative, and frame-bounded", () => {
  assert.match(APP, /TILT_MAX_OUTPUT = 5/, "five degrees — felt, not watched");
  const handler = bodyOf("tarotTiltHandler");
  assert.ok(handler.includes("TILT.baseline = { beta: e.beta, gamma: e.gamma }"),
    "movement is measured from how the phone was already held, not from level");
  assert.ok(handler.includes("now - TILT.last < 33"),
    "a time gate bounds writes — this client has no animation-frame code, on purpose");
});

test("the tilt composes with the reversed card and collapses under both refusals", () => {
  assert.match(TAROT_CSS, /\.tarot-card-slot \{ perspective: 700px; \}/,
    "perspective makes rotation read as depth");
  assert.match(TAROT_CSS, /\.tarot-card--reversed \{\s*transform: rotate\(180deg\) rotateX\(var\(--tilt-x, 0deg\)\) rotateY\(var\(--tilt-y, 0deg\)\);/,
    "a reversed card keeps its 180° and tilts within it");
  // Folded into the file's LAST refusal block (the meaning's) rather than
  // appended as a new one — tarot-surface.test.js anchors on lastIndexOf of
  // that block, and one refusal block per concern-group is tidier anyway.
  const osRefusal = TAROT_CSS.slice(TAROT_CSS.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(osRefusal, /\.tarot-card \{ transform: none; transition: none; \}/,
    "the OS refusal collapses the tilt");
  assert.match(TAROT_CSS, /:root\[data-motion="reduced"\] \.tarot-card \{ transform: none; transition: none; \}/,
    "and so does the in-app toggle");
});
