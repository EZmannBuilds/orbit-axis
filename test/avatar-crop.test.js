// Orbit Axis :: the avatar crop maths.
//
// The pointer handling fails visibly — you drag and nothing moves. The crop
// RECTANGLE fails invisibly: a few percent of drift produces pictures that are
// subtly not what the person framed, and nobody reports that as a bug because
// it looks like they framed it badly. So the maths is a pure function and it is
// tested directly.

import { test } from "node:test";
import assert from "node:assert/strict";

import { STAGE, MIN_SCALE, MAX_SCALE, cropRectFor, panLimits } from "../public/avatar-crop.js";
import { clampCrop, centreSquare } from "../public/avatar-normalize.js";

// ── The default framing ─────────────────────────────────────────────────────

test("unzoomed and unpanned is exactly the centre square", () => {
  // The framing everyone got before cropping existed. If this drifts, every
  // avatar saved without touching the editor moves.
  for (const [w, h] of [[1200, 800], [800, 1200], [1000, 1000], [4032, 3024]]) {
    const crop = cropRectFor({ width: w, height: h, scale: 1 });
    const centre = centreSquare(w, h);
    assert.deepEqual(crop, centre, `${w}x${h}`);
  }
});

test("a square image unzoomed takes the whole image", () => {
  const crop = cropRectFor({ width: 900, height: 900, scale: 1 });
  assert.deepEqual(crop, { sx: 0, sy: 0, side: 900 });
});

// ── Zoom ────────────────────────────────────────────────────────────────────

test("zooming in takes a smaller square, still centred", () => {
  const at1 = cropRectFor({ width: 1000, height: 1000, scale: 1 });
  const at2 = cropRectFor({ width: 1000, height: 1000, scale: 2 });
  assert.ok(at2.side < at1.side, "2x must crop tighter than 1x");
  assert.equal(at2.side, 500, "2x on a square image is half the side");
  // Still centred: equal margins on both axes.
  assert.equal(at2.sx, at2.sy);
  assert.equal(at2.sx, Math.round((1000 - 500) / 2));
});

test("zoom is clamped to its bounds rather than trusted", () => {
  const tooFar = cropRectFor({ width: 1000, height: 1000, scale: 99 });
  const atMax = cropRectFor({ width: 1000, height: 1000, scale: MAX_SCALE });
  assert.deepEqual(tooFar, atMax, "beyond max behaves as max");

  const tooLittle = cropRectFor({ width: 1000, height: 1000, scale: 0.1 });
  const atMin = cropRectFor({ width: 1000, height: 1000, scale: MIN_SCALE });
  assert.deepEqual(tooLittle, atMin, "below min behaves as min");
});

test("a nonsense scale falls back rather than producing NaN", () => {
  // A NaN here becomes a NaN source rectangle, and drawImage with NaN silently
  // paints nothing — an all-transparent avatar with no error anywhere.
  for (const bad of [NaN, undefined, null, "wide", Infinity]) {
    const crop = cropRectFor({ width: 800, height: 600, scale: bad });
    assert.ok(Number.isFinite(crop.sx) && Number.isFinite(crop.sy) && Number.isFinite(crop.side),
      `scale ${bad} produced a non-finite rectangle`);
    assert.ok(crop.side > 0);
  }
});

// ── Panning ─────────────────────────────────────────────────────────────────

test("panning right moves the crop left, and vice versa", () => {
  // The sign that matters. Getting it backwards produces a cropper that fights
  // the person using it, which is obvious in use and easy to get wrong in code.
  const base = cropRectFor({ width: 2000, height: 2000, scale: 2 });
  const panRight = cropRectFor({ width: 2000, height: 2000, scale: 2, offsetX: 40 });
  const panLeft = cropRectFor({ width: 2000, height: 2000, scale: 2, offsetX: -40 });

  assert.ok(panRight.sx < base.sx, "dragging the picture right shows more of its left");
  assert.ok(panLeft.sx > base.sx, "dragging the picture left shows more of its right");
});

test("panning can never leave the image", () => {
  // Off the edge, drawImage produces transparent pixels — an avatar with a grey
  // stripe down one side, uploaded without complaint.
  for (const offset of [-100000, -500, 500, 100000]) {
    for (const [w, h] of [[1200, 800], [800, 1200]]) {
      const crop = cropRectFor({ width: w, height: h, scale: 1.5, offsetX: offset, offsetY: offset });
      assert.ok(crop.sx >= 0 && crop.sy >= 0, `negative origin at offset ${offset}`);
      assert.ok(crop.sx + crop.side <= w, `runs past the right edge at ${offset}`);
      assert.ok(crop.sy + crop.side <= h, `runs past the bottom edge at ${offset}`);
    }
  }
});

test("pan limits are zero when nothing is zoomed on a square image", () => {
  // Nothing to pan to: the image exactly covers the stage.
  assert.deepEqual(panLimits({ width: 800, height: 800, scale: 1 }), { x: 0, y: 0 });

  // A wide image has horizontal room but none vertically.
  const wide = panLimits({ width: 1600, height: 800, scale: 1 });
  assert.ok(wide.x > 0, "a wide image can pan sideways");
  assert.equal(wide.y, 0, "…but not vertically");

  // Zooming creates room on both axes.
  const zoomed = panLimits({ width: 800, height: 800, scale: 2 });
  assert.ok(zoomed.x > 0 && zoomed.y > 0);
});

test("the stage is the unit panning is measured in", () => {
  // Panning by a whole stage width at 1x on a square image would move the crop
  // by the whole image — which the clamp then prevents. This pins that the
  // conversion uses STAGE rather than a hardcoded number.
  assert.equal(STAGE, 320);
  const crop = cropRectFor({ width: 3200, height: 3200, scale: 1, offsetX: STAGE / 10 });
  assert.equal(crop.sx, 0, "a tenth of a stage is a tenth of the image here");
});

// ── The boundary into the encoder ───────────────────────────────────────────

test("clampCrop repairs a rectangle rather than rejecting it", () => {
  // Rounding, not misuse: half a pixel over the edge is an artefact of float
  // maths, and refusing would fail a crop the person framed correctly.
  const repaired = clampCrop({ sx: -5, sy: -5, side: 5000 }, 1200, 800);
  assert.equal(repaired.sx, 0);
  assert.equal(repaired.sy, 0);
  assert.equal(repaired.side, 800, "never larger than the shorter side");
  assert.ok(repaired.sx + repaired.side <= 1200);
});

test("clampCrop survives missing and nonsense values", () => {
  const fallback = clampCrop({}, 1000, 600);
  assert.equal(fallback.side, 600);
  assert.ok(Number.isFinite(fallback.sx) && Number.isFinite(fallback.sy));

  const nonsense = clampCrop({ sx: NaN, sy: "up", side: null }, 1000, 600);
  assert.ok(Number.isFinite(nonsense.sx) && Number.isFinite(nonsense.sy) && nonsense.side > 0);
});

test("an editor rectangle always survives the clamp unchanged", () => {
  // The two halves must agree: whatever the editor produces, the encoder must
  // accept verbatim. If clamping ever alters it, the saved picture is not the
  // previewed one — the exact failure this cropper exists to avoid.
  for (const [w, h] of [[1200, 800], [800, 1200], [4032, 3024], [1000, 1000]]) {
    for (const scale of [1, 1.5, 2, MAX_SCALE]) {
      for (const offset of [-200, -37, 0, 37, 200]) {
        const rect = cropRectFor({ width: w, height: h, scale, offsetX: offset, offsetY: -offset });
        assert.deepEqual(clampCrop(rect, w, h), rect,
          `${w}x${h} @${scale} offset ${offset} was altered by the clamp`);
      }
    }
  }
});
