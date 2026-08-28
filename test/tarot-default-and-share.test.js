// Orbit Axis :: tarot is off until chosen, and readings can be shared as images.
//
// WHY THIS EXISTS. Two defaults and one contract, all of which are the kind of
// thing that silently regresses:
//
//   1. Tarot ships OFF. It is a reflection prompt, not astronomy, and it does
//      not belong in an astrology app's navigation for someone who never asked
//      for it. The default lives in TWO places — the reader's `tarotEnabled()`
//      and the settings registry — and they have to agree, because a reader
//      whose switch says "Off" while the rail shows the tab has been told two
//      different things by the same app.
//
//   2. The share presets are the sizes people actually post at. A preset whose
//      height quietly changes produces images that get cropped by the platform
//      rather than rejected, which is the failure nobody reports.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SHARE_PRESETS, SHARE_PRESET_IDS, shareFilename } from "../public/share-image.js";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("tarot is off until the reader chooses it, in both places that decide", () => {
  // The reader-side gate.
  assert.match(app, /tarotPref\("tarot",\s*"off"\)\s*===\s*"on"/,
    "tarotEnabled() must default to off");
  // The settings registry, which seeds the switch and localStorage.
  assert.match(app, /tarot:\s*\{\s*default:\s*"off",\s*seg:\s*"#set-tarot"\s*\}/,
    "the settings default must be off too, or the switch and the rail disagree");
  assert.ok(!/tarotPref\("tarot",\s*"on"\)/.test(app),
    "no path may still read the old on-by-default");
});

test("the first-run question exists, and only writes when the chart saves", () => {
  assert.match(html, /id="cm-tarot-block"[^>]*hidden/,
    "the question ships hidden — first-run only");
  assert.match(html, /id="cm-tarot"[^>]*role="group"/,
    "asked with the same segmented control the rest of the app uses");
  assert.match(app, /function commitOnboardingTarotAsk\(\)/);
  // The answer must be applied from the SUCCESS path, never on click: a
  // form someone abandons must not change what the app shows.
  const submitIdx = app.indexOf("await post(\"/api/charts\", payload)");
  const commitIdx = app.indexOf("commitOnboardingTarotAsk();");
  assert.ok(submitIdx > 0 && commitIdx > submitIdx,
    "the tarot answer must be committed after the chart saves, not before");
});

test("tarot settings stay reachable, so an off default is never a dead end", () => {
  assert.match(html, /id="settings-tarot"/);
  assert.match(html, /id="set-tarot"/);
});

test("share presets are the three sizes people post at", () => {
  assert.deepEqual(SHARE_PRESET_IDS, ["portrait", "square", "story"]);
  assert.deepEqual(
    SHARE_PRESET_IDS.map((id) => [SHARE_PRESETS[id].w, SHARE_PRESETS[id].h]),
    [[1080, 1350], [1080, 1080], [1080, 1920]]);
  for (const id of SHARE_PRESET_IDS) assert.equal(SHARE_PRESETS[id].id, id);
});

test("share filenames say what, when, and at what size", () => {
  assert.equal(shareFilename("tarot", "2026-08-27", "story"),
    "orbit-axis_tarot_2026-08-27_story.png");
  // A missing or malformed date must not produce "undefined" in a filename
  // the reader is about to post.
  assert.equal(shareFilename("sky", null, "square"), "orbit-axis_sky_today_square.png");
  assert.equal(shareFilename("sky", "not-a-date", "square"), "orbit-axis_sky_today_square.png");
});

test("the sky share refuses to export the sign-up prompt", () => {
  // `#today-fortune` holds the "add your birth details" card for a reader with
  // no chart. Sharing that would export an advert for the form they are
  // looking at, so the builder requires the real reading.
  assert.match(app, /const fortune = \$\("#today-fortune \.fortune"\);\s*\n\s*if \(!fortune\) return null;/,
    "buildSkyShareContent must require the rendered reading, not the panel");
});

test("a shared tarot card is the card on screen, not one rebuilt from a slug", () => {
  assert.match(app, /img\.tarot-card__art/,
    "the artwork url is read from the DOM the reader is looking at");
});
