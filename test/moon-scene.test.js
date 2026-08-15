// Orbit Axis :: the Moon scene's deterministic layer.
//
// The scene is mostly CSS and SVG, which tests cannot see. What they CAN
// pin down is everything the look depends on: that the stars never move
// between renders, that the phase geometry comes from canonical data, and that
// a missing field becomes a missing scene rather than a confident wrong Moon.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  starField, STAR_COUNT, STAR_SEED, SHOOTING_STAR, SHOOTING_STAR_KEY,
  sceneInputs, illuminationLabel, moonPositionLabel, MOTION,
  OBSERVER_ORIENTATION_SUPPORTED, SCALE_ACCURATE, ORIENTATION_NOTE,
} from "../public/moon-scene.js";
import { moonState } from "../lib/home/highlights.js";
import { moonPhasePathD, moonAccessibleLabel } from "../public/moon-phase.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// ── The star field ──────────────────────────────────────────────────────────

test("the star field is identical on every call, not random", () => {
  const a = starField();
  const b = starField();
  assert.equal(a.length, STAR_COUNT);
  assert.deepEqual(a, b, "two renders must produce the same sky");
  // And a third time, after other work, in case of hidden generator state.
  starField(10, 1);
  assert.deepEqual(starField(), a);
});

test("a different seed gives a different sky, so the seed is doing the work", () => {
  assert.notDeepEqual(starField(STAR_COUNT, STAR_SEED + 1), starField());
});

test("stars stay out of the band where the Earth arc and text live", () => {
  for (const s of starField()) {
    assert.ok(s.y >= 0 && s.y <= 62, `star at ${s.y}% intrudes on the lower band`);
    assert.ok(s.x >= 0 && s.x <= 100);
    assert.ok(s.o > 0 && s.o < 1, "never invisible and never fully opaque");
    assert.ok(s.r > 0 && s.r < 2, "restrained density, not a starburst");
  }
});

test("nothing in the scene layer is random or clock-dependent", () => {
  const src = readFileSync(join(ROOT, "public", "moon-scene.js"), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*")).join("\n");
  assert.ok(!code.includes("Math.random"), "no Math.random in the scene layer");
  assert.ok(!code.includes("Date.now"), "no clock-dependent geometry");
  assert.ok(!code.includes("fetch("), "the scene layer makes no requests");
});

test("the shooting star has a fixed trajectory and a non-personal session key", () => {
  assert.ok(Number.isFinite(SHOOTING_STAR.x1) && Number.isFinite(SHOOTING_STAR.y2));
  assert.ok(SHOOTING_STAR.durationMs > 0 && SHOOTING_STAR.durationMs < 4000,
    "brief enough to read as a glance, not an animation");
  assert.match(SHOOTING_STAR_KEY, /^oa_/);
  assert.doesNotMatch(SHOOTING_STAR_KEY, /user|email|id|chart|birth/i,
    "the session key names nothing personal");
});

// ── Phase geometry, from canonical data only ────────────────────────────────

const PHASES = [
  { phase: "New Moon", illumination: 0, waxing: true },
  { phase: "Waxing Crescent", illumination: 24, waxing: true },
  { phase: "First Quarter", illumination: 50, waxing: true },
  { phase: "Waxing Gibbous", illumination: 78, waxing: true },
  { phase: "Full Moon", illumination: 100, waxing: true },
  { phase: "Waning Gibbous", illumination: 78, waxing: false },
  { phase: "Last Quarter", illumination: 50, waxing: false },
  { phase: "Waning Crescent", illumination: 24, waxing: false },
];

test("all eight canonical phases produce scene inputs", () => {
  for (const p of PHASES) {
    const s = sceneInputs(p);
    assert.ok(s, `${p.phase} produced nothing`);
    assert.equal(s.phase, p.phase);
    assert.equal(s.direction, p.waxing ? "waxing" : "waning");
    assert.ok(s.fraction >= 0 && s.fraction <= 1);
  }
});

test("waxing and waning of the same illumination draw differently", () => {
  for (const pct of [24, 50, 78]) {
    const wax = moonPhasePathD(66, 66, 62, pct / 100, true);
    const wane = moonPhasePathD(66, 66, 62, pct / 100, false);
    assert.notEqual(wax, wane,
      `${pct}% waxing and waning must not share artwork`);
  }
});

test("crescent and gibbous draw differently, and New is not Full", () => {
  const crescent = moonPhasePathD(66, 66, 62, 0.24, true);
  const gibbous = moonPhasePathD(66, 66, 62, 0.78, true);
  assert.notEqual(crescent, gibbous);
  const newMoon = moonPhasePathD(66, 66, 62, 0, true);
  const full = moonPhasePathD(66, 66, 62, 1, true);
  assert.notEqual(newMoon, full, "a New Moon must never render as a Full Moon");
});

test("the same payload always produces the same geometry", () => {
  const once = PHASES.map((p) => moonPhasePathD(66, 66, 62, p.illumination / 100, p.waxing));
  const twice = PHASES.map((p) => moonPhasePathD(66, 66, 62, p.illumination / 100, p.waxing));
  assert.deepEqual(once, twice);
});

test("the scene claims phase, never observer orientation or scale", () => {
  assert.equal(OBSERVER_ORIENTATION_SUPPORTED, false);
  assert.equal(SCALE_ACCURATE, false);
  assert.match(ORIENTATION_NOTE, /not the tilt/i);
});

// ── Missing and malformed data ──────────────────────────────────────────────

test("a missing field yields no scene rather than a default Full Moon", () => {
  assert.equal(sceneInputs(null), null);
  assert.equal(sceneInputs({}), null);
  assert.equal(sceneInputs({ phase: "Full Moon" }), null, "no illumination, no scene");
  assert.equal(sceneInputs({ illumination: 100 }), null, "no phase name, no scene");
});

test("moonState survives a payload missing degree and elongation", () => {
  const sky = { moon: { phase_name: "Full Moon", illumination_percent: 99.6, waxing: false, sign: "Leo" } };
  const m = moonState(sky);
  assert.equal(m.degrees, null, "an absent degree is null, never 0");
  assert.equal(m.elongation, null);
  assert.equal(m.illumination, 100, "illumination is rounded once, at the source");
  assert.equal(moonPositionLabel(m), "Moon in Leo", "the degree line degrades to the sign");
});

test("moonState carries the canonical degree and phase angle when present", () => {
  const sky = { moon: {
    phase_name: "Waxing Gibbous", illumination_percent: 82.7, waxing: true,
    sign: "Pisces", degrees: 4, minutes: 31, elongation_degrees: 128.4,
  } };
  const m = moonState(sky);
  assert.equal(m.degrees, 4);
  assert.equal(m.elongation, 128.4);
  assert.equal(moonPositionLabel(m), "Moon at 4° Pisces");
});

test("illumination is honestly rounded, never a float on screen", () => {
  assert.equal(illuminationLabel(82.7), "83% illuminated");
  assert.equal(illuminationLabel(0), "0% illuminated");
  assert.equal(illuminationLabel(100), "100% illuminated");
  assert.equal(illuminationLabel(null), null);
  assert.doesNotMatch(illuminationLabel(47.3819), /\./, "no decimal reaches the screen");
});

test("the accessible label states the phase without the artwork", () => {
  const label = moonAccessibleLabel("Waning Crescent", 12.4);
  assert.match(label, /Waning Crescent/);
  assert.match(label, /12% illuminated/);
});

// ── Motion policy ───────────────────────────────────────────────────────────

test("ambient motion is slow enough not to read as loading", () => {
  assert.ok(MOTION.driftSeconds >= 30, "Moon drift is atmospheric, not animated");
  assert.ok(MOTION.starDriftSeconds >= 60);
  assert.ok(MOTION.glowSeconds >= 8);
  assert.ok(MOTION.refreshMs > 0 && MOTION.refreshMs <= 2000,
    "the refresh turn is partial and brief, never a continuous spin");
});

// ── The rendered scene, motion, and states ──────────────────────────────────
//
// Source-text assertions, because the scene is CSS and DOM the Node runner
// cannot execute. Each one is anchored to a unique token: an unbounded
// indexOf returns -1 and silently scans the whole file, which passes on
// nothing at all.

const APP = readFileSync(join(ROOT, "public", "app.js"), "utf8");
const HTML = readFileSync(join(ROOT, "public", "index.html"), "utf8");
const CSS = readFileSync(join(ROOT, "public", "styles", "fortune.css"), "utf8");

function block(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  assert.ok(a > -1, `anchor missing: ${from}`);
  assert.ok(b > a, `end anchor missing: ${to}`);
  return src.slice(a, b);
}

test("the shooting star runs once per session and never on a refresh", () => {
  const fn = block(APP, "function moonMaybeShootingStar", "\n/**");
  assert.match(fn, /sessionStorage\.getItem\(SHOOTING_STAR_KEY\)/,
    "the marker survives route changes and refreshes, unlike a module flag");
  assert.match(fn, /sessionStorage\.setItem\(SHOOTING_STAR_KEY, "1"\)/);
  assert.match(fn, /if \(seen\) return/, "a second call does nothing");
  assert.match(fn, /prefers-reduced-motion: reduce/, "reduced motion skips it");
  assert.match(fn, /catch \{\s*\n?\s*return;/,
    "unavailable storage omits the effect rather than replaying it every time");
  // `seen` starts true so any unexpected path fails closed to "already shown".
  assert.match(fn, /let seen = true/);
});

test("the shooting star is decorative, bounded, and out of the text column", () => {
  const scene = block(APP, "function moonSceneHtml", "function moonSceneUnavailableHtml");
  // The element is generated, not served: index.html has no moon-shoot node.
  assert.match(scene, /id="moon-shoot" hidden/, "it starts hidden");
  assert.match(scene, /aria-hidden="true"/, "the whole scene is decorative");
  assert.match(CSS, /\.moon-scene__shoot\.is-flying \{ animation: moon-shoot [\d]+ms[^}]*1 both/,
    "it plays exactly once, not infinitely");
});

test("reduced motion removes every ambient effect and the shooting star", () => {
  const rm = block(CSS, "@media (prefers-reduced-motion: reduce)", "@media (forced-colors");
  for (const layer of ["__stars", "__star", "__moon", "__earth.is-turning", "__shoot.is-flying"]) {
    assert.ok(rm.includes(layer), `${layer} still animates under reduced motion`);
  }
  assert.match(rm, /animation: none/);
  assert.match(rm, /\.moon-scene__shoot \{ display: none/,
    "the star is removed, not frozen as an unexplained dot");
});

test("a hidden tab pauses the scene without a JavaScript loop", () => {
  assert.match(APP, /visibilitychange", moonSyncPaused/);
  assert.match(APP, /classList\.toggle\("moon-paused", document\.hidden === true\)/);
  assert.match(CSS, /\.moon-paused[^{]*\{ animation-play-state: paused/);
  const code = APP.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  assert.ok(!code.includes("requestAnimationFrame"),
    "no continuous animation loop anywhere in the client");
});

test("the Earth turn is bound to a real request and cannot stick", () => {
  const fn = block(APP, "async function moonRefreshSky", "function moonStatus");
  assert.match(fn, /if \(MOON\.refreshing\) return/, "a duplicate refresh is dropped, not queued");
  assert.match(fn, /earth\?\.classList\.add\("is-turning"\)/);
  assert.match(fn, /\} finally \{/, "cleanup is guaranteed");
  const finallyBlock = fn.slice(fn.indexOf("} finally {"));
  assert.match(finallyBlock, /MOON\.refreshing = false/);
  assert.match(finallyBlock, /classList\.remove\("is-turning"\)/,
    "a failed refresh cannot leave the Earth turning");
  assert.match(finallyBlock, /button\.disabled = false/, "the control always re-enables");
  // Motion is evidence of a request, so it must not start on ordinary entry.
  const entry = block(APP, "AXIS.loadedOnce = true", "// Fortune:");
  assert.ok(!entry.includes("is-turning"), "Home entry does not spin the Earth");
});

test("the Earth turn is a single partial turn, not a spinner", () => {
  assert.match(CSS, /\.moon-scene__earth\.is-turning \{ animation: moon-earth-turn \d+ms[^}]*\}/);
  assert.ok(!/moon-earth-turn[^}]*infinite/.test(CSS), "never loops");
  const kf = block(CSS, "@keyframes moon-earth-turn", "@keyframes moon-shoot");
  assert.match(kf, /rotate\(0deg\)/);
  assert.match(kf, /rotate\(1?\d deg\)|rotate\(\d+deg\)/, "it stops at a partial angle");
});

test("refresh announces through the live region and hides server detail", () => {
  assert.match(HTML, /id="moon-status"[^>]*role="status"[^>]*aria-live="polite"/,
    "the live region is in the served markup, not created on demand");
  const fn = block(APP, "async function moonRefreshSky", "function moonStatus");
  assert.match(fn, /moonStatus\("Refreshing the current sky…"\)/);
  assert.match(fn, /moonStatus\("The current sky is up to date\."\)/);
  assert.match(fn, /couldn't refresh the sky just now/);
  assert.ok(!/error\.message|error\.stack|String\(error\)/.test(fn),
    "no raw server detail reaches the reader");
  assert.match(fn, /The Moon shown above is from the last successful reading/,
    "a failed refresh keeps the previous valid Moon rather than discarding it");
});

test("a payload without a usable Moon renders the frame, never a default phase", () => {
  const empty = block(APP, "function moonSceneUnavailableHtml", "\n/**");
  assert.ok(!empty.includes("renderMoonSVG"), "no disc is drawn without canonical data");
  assert.match(empty, /moon-scene--empty/);
  assert.match(empty, /moon-scene__earth/, "the frame keeps its footprint so the page does not jump");
  const render = block(APP, "function axisRenderMoon", "function moonSceneHtml");
  assert.match(render, /scene \? moonSceneHtml\(scene\) : moonSceneUnavailableHtml\(\)/);
});

test("one missing optional field does not destroy the scene", () => {
  const render = block(APP, "function axisRenderMoon", "function moonSceneHtml");
  // Each optional line is guarded independently rather than sharing one branch.
  //
  // The "Moon at 15 degrees Gemini" line was REMOVED on 2026-08-08 when the
  // section was trimmed: the sign is already in the heading above it, and the
  // exact degree belongs to Technical Sky. What this test is really about —
  // that one absent field drops its own fragment and not the whole panel —
  // is still covered by the two assertions below.
  assert.ok(!render.includes('moon-state__position'), "the degree line is gone");
  assert.match(render, /moon\.nextEvent\s*\?/);
  assert.match(render, /\[illum, moon\.direction\]\.filter\(Boolean\)/,
    "an absent illumination drops its own fragment, not the whole line");
});

test("forced colors keeps the phase readable without gradients", () => {
  const at = CSS.indexOf(".moon-scene__moon svg path");
  assert.ok(at > -1, "scene forced-colors rules missing");
  const start = CSS.lastIndexOf("@media (forced-colors: active)", at);
  const fc = CSS.slice(start, CSS.indexOf("}", at) + 2);
  assert.match(fc, /\.moon-scene \{ border: 1px solid CanvasText/, "the disc keeps an edge");
  assert.match(fc, /\.moon-scene__sky, \.moon-scene__stars, \.moon-scene__shoot \{ display: none/,
    "decorative noise is dropped");
  assert.match(fc, /svg path \{ fill: Highlight/, "lit and unlit stay distinguishable");
  assert.match(fc, /\.moon-scene__earth[^}]*border-top: 1px solid CanvasText/,
    "the horizon survives as a line");
});

test("the scene never claims a tilt, and says so where a reader can see it", () => {
  const render = block(APP, "function axisRenderMoon", "function moonSceneHtml");
  assert.match(render, /ORIENTATION_NOTE/, "the limitation is rendered, not just exported");
  assert.match(render, /href="#positions"/, "and the deeper sky has a truthful link");
});

test("the scene adds no dependency, remote image, or model request", () => {
  const scene = readFileSync(join(ROOT, "public", "moon-scene.js"), "utf8");
  for (const banned of ["three", "webgl", "canvas", "http://", "https://", "import(",
                        "openai", "anthropic", "ollama"]) {
    assert.ok(!scene.toLowerCase().includes(banned), `${banned} must not appear`);
  }
  const cssCode = CSS.split("\n").filter((l) => !l.trim().startsWith("/*") && !l.trim().startsWith("*")).join("\n");
  assert.ok(!/url\(\s*['"]?https?:/.test(cssCode), "no remote image host in the scene styles");
});

test("an unknown waxing state is never reported as waning", () => {
  // The canonical payload states direction explicitly. When it does not, the
  // old code collapsed absent into false and printed "waning" — a confident
  // claim the sky never made.
  const noFlag = moonState({ moon: { phase_name: "Full Moon", illumination_percent: 99, sign: "Leo" } });
  assert.equal(noFlag.waxing, null);
  assert.equal(noFlag.direction, null);
  assert.match(noFlag.meaning, /isn’t available/, "and the prose makes no claim either");
  // Either flag alone is enough to decide it.
  assert.equal(moonState({ moon: { phase_name: "x", illumination_percent: 1, waning: true } }).direction, "waning");
  assert.equal(moonState({ moon: { phase_name: "x", illumination_percent: 1, waning: false } }).direction, "waxing");
  assert.equal(moonState({ moon: { phase_name: "x", illumination_percent: 1, waxing: true } }).direction, "waxing");
});

test("no direction means no disc, because a terminator has to pick a side", () => {
  assert.equal(sceneInputs({ phase: "Full Moon", illumination: 99 }), null);
  assert.equal(sceneInputs({ phase: "Full Moon", illumination: 99, waxing: null }), null);
  assert.ok(sceneInputs({ phase: "Full Moon", illumination: 99, waxing: false }));
});

test("a missing phase name does not leave a heading starting mid-sentence", () => {
  const render = block(APP, "function axisRenderMoon", "function moonSceneHtml");
  assert.match(render, /moon\.phase\s*\n?\s*\?/, "the phase line is guarded");
  assert.match(render, /The Moon in \$\{esc\(moon\.sign\)\}/,
    "the sign alone still reads as a sentence");
  assert.match(render, /The phase name isn’t available right now/);
});

test("both ways of asking for less motion suppress the shooting star", () => {
  const fn = block(APP, "function moonMaybeShootingStar", "\n/**");
  assert.match(fn, /prefers-reduced-motion: reduce/, "the OS preference counts");
  assert.match(fn, /dataset\.motion === "reduced"/,
    "and so does Orbit's own Motion setting, which is the one a user clicks");
  // Both gates return BEFORE the session marker is written, so a reduced-motion
  // user does not silently spend their one star on an effect they never see.
  const osAt = fn.indexOf("prefers-reduced-motion");
  const appAt = fn.indexOf('dataset.motion === "reduced"');
  const markerAt = fn.indexOf("setItem(SHOOTING_STAR_KEY");
  assert.ok(osAt < markerAt && appAt < markerAt, "neither gate burns the marker");
  assert.match(CSS, /:root\[data-motion="reduced"\] \.moon-scene__shoot \{ display: none/,
    "and the element is removed, not merely frozen");
});
