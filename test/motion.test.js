// Orbit Axis :: the motion layer, and the settings that switch it off.
//
// Motion is the one part of the interface a person can be physically unable to
// tolerate, so the contract here is not "does it move" but "does everything
// that moves also stop". Each assertion below pairs a piece of motion with the
// two ways it can be refused: the operating system's preference, and the
// in-app toggle, which exist separately because a person may need one without
// the other.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

const motion = read("public", "styles", "motion.css");
const tokens = read("public", "styles", "tokens.css");
const html = read("public", "index.html");
const appJs = read("public", "app.js");

/** The two blocks that refuse motion, as text, so a rule can be looked for in both. */
function refusals() {
  const media = motion.slice(motion.indexOf("@media (prefers-reduced-motion: reduce)"));
  const mediaBlock = media.slice(0, media.indexOf("\n}") + 2);
  const toggle = motion.slice(motion.indexOf(':root[data-motion="reduced"]'));
  return { mediaBlock, toggle };
}

test("changing page animates, and the animation does not outlive itself", () => {
  assert.match(motion, /@keyframes axis-panel-in/, "panels arrive rather than appearing");
  assert.match(motion, /\.workspace-panel:not\(\[hidden\]\)\s*\{\s*animation: axis-panel-in/,
    "the entrance keys off the panel being shown, which is what the router changes");

  // The panel entrance must NOT be filled forwards. A held transform makes the
  // panel a containing block for fixed positioning and pins the sticky chart
  // sub-navigation to it — for the rest of the session, not for the animation.
  const rule = /\.workspace-panel:not\(\[hidden\]\)\s*\{[^}]*\}/.exec(motion)?.[0] ?? "";
  assert.ok(!/\b(forwards|both)\b/.test(rule),
    `the panel entrance must not hold its transform, got: ${rule.replace(/\s+/g, " ")}`);
});

test("everything the motion layer adds can be switched off, both ways", () => {
  const { mediaBlock, toggle } = refusals();

  // A duration collapsed to 0.001ms in base.css still RUNS the first frame, so
  // an entrance would flash at opacity 0. These have to be `animation: none`.
  for (const where of [mediaBlock, toggle]) {
    assert.match(where, /\.workspace-panel:not\(\[hidden\]\)[\s\S]*?animation: none/,
      "the page-change entrance must stop, not merely shorten");
  }

  // Every press transform, in both refusals.
  for (const pressed of [".o-row--link:active", "a:active > .o-tile", "button:active > .o-tile",
                         ".rail__link:active .rail__icon"]) {
    for (const [name, where] of Object.entries({ "the OS preference": mediaBlock, "the in-app toggle": toggle })) {
      assert.ok(where.includes(pressed),
        `${pressed} moves on press but is not withdrawn by ${name}`);
    }
  }
});

test("a full-width surface presses by less than a button does", () => {
  // 5% of a pill is a few pixels. 5% of a row the width of the screen is
  // nearly twenty, and the row appears to flinch away from the finger.
  assert.match(tokens, /--press-scale: 0\.95;/);
  assert.match(tokens, /--press-scale-large: 0\.99;/);

  for (const large of [/\.o-row--link:active\s*\{[^}]*\}/, /a:active > \.o-tile,\s*\nbutton:active > \.o-tile\s*\{[^}]*\}/]) {
    const rule = large.exec(motion)?.[0] ?? "";
    assert.ok(rule.includes("--press-scale-large"),
      `a screen-width surface must use the large press scale, got: ${rule.replace(/\s+/g, " ")}`);
  }
});

test("rows answer a tap at all", () => {
  // Rows are what every list in the app is made of, and they were the only
  // interactive primitive with no press state — buttons and segments already
  // had one. This is the assertion that keeps them from losing it again.
  assert.match(motion, /\.o-row--link\s*\{[\s\S]*?transition: background/,
    "the row's hover and press colours must ease rather than snap");
  assert.match(motion, /\.o-row--link:active\s*\{[\s\S]*?transform: scale/,
    "a row must acknowledge being pressed");
});

// ── Density: removed, not merely hidden ───────────────────────────────────
//
// The control was taken off the Appearance page. A stored preference with no
// way to change it is worse than no preference: someone who set "compact" on a
// previous version would be stuck in it with nothing to undo it.

test("density is gone from the token layer, the document, and the settings", () => {
  assert.ok(!/data-density/.test(tokens), "no density variant may survive in the tokens");
  assert.ok(!/data-density/.test(html), "the document must not stamp a density it cannot change");
  assert.ok(!/set-density|density:/.test(appJs), "the setting must not be stored either");

  // The spacing it used to select is now simply the spacing, so nothing that
  // consumed --density-* is left resolving to nothing. Bounded to the block
  // that declares it: `[\s\S]*?` from the file's first `:root` would match a
  // declaration under any later selector and assert nothing.
  const declaring = tokens.split(/(?=^:root)/m).find(block => block.includes("--density-card-pad:"));
  assert.ok(declaring, "--density-card-pad must still be declared somewhere");
  assert.match(declaring.slice(0, declaring.indexOf("{")), /^:root\s*$/,
    `the density values must now be the base values, but they are declared on: ${declaring.slice(0, declaring.indexOf("{")).trim()}`);
});
