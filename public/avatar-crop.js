// Orbit Axis :: the avatar crop editor.
//
// A square stage, a decoded image drawn into it, and two things a person can
// change: where the picture sits, and how far in it is zoomed. What the circle
// shows is exactly what gets saved — the same rectangle is handed to
// normalizeAvatar(), so there is no gap between the preview and the result.
// A cropper whose preview lies is worse than no cropper.
//
// WHY THE MATHS LIVES IN A PURE FUNCTION
//
// cropRectFor() takes numbers and returns numbers. It is the only part that can
// be wrong in a way nobody notices — an off-by-one in the pointer handling is
// visible immediately, whereas a crop rectangle that drifts by 3% produces
// pictures that are subtly not what the person framed. So it is separated from
// the DOM and tested directly.
//
// COORDINATES
//
//   stage   the square on screen, STAGE px a side
//   image   the decoded bitmap, natural pixels
//   scale   1 = the image's shorter side exactly fills the stage ("cover")
//   offset  where the image's centre sits relative to the stage's centre,
//           in STAGE px, so panning reads the same at every zoom level
//
// The crop is then the stage's square, converted back into image pixels.

/** The stage is square; this is its size in CSS pixels. */
export const STAGE = 320;

/** Zoom bounds, as multiples of "cover". 3x is past useful on a phone photo. */
export const MIN_SCALE = 1;
export const MAX_SCALE = 3;

/**
 * The source rectangle to take from the image, given a pan and a zoom.
 *
 * Pure: no DOM, no canvas. Returns { sx, sy, side } in IMAGE pixels, which is
 * exactly the shape normalizeAvatar() takes.
 *
 * @param {object} p
 * @param {number} p.width   natural image width
 * @param {number} p.height  natural image height
 * @param {number} p.scale   1 = cover
 * @param {number} p.offsetX pan in stage px, +right
 * @param {number} p.offsetY pan in stage px, +down
 */
export function cropRectFor({ width, height, scale, offsetX = 0, offsetY = 0 }) {
  const safeScale = clamp(Number(scale) || 1, MIN_SCALE, MAX_SCALE);

  // At scale 1 the shorter side covers the stage exactly, so this is how many
  // image pixels one stage pixel is worth.
  const cover = Math.min(width, height) / STAGE;
  const perStagePx = cover / safeScale;

  // The stage's square, in image pixels. ROUNDED FIRST, and every bound below
  // is computed from the rounded value.
  //
  // Rounding last instead produced a rectangle whose origin was clamped against
  // an unrounded side — so a clamped crop came back fractional, and sx + side
  // could land a pixel past the image edge. drawImage answers that with a
  // transparent stripe rather than an error, so it would have shipped as
  // avatars with a hairline of nothing down one side.
  const side = Math.round(Math.min(STAGE * perStagePx, Math.min(width, height)));

  // Centre of the visible square, in image pixels. Panning right moves the
  // PICTURE right, which moves the crop LEFT — hence the subtraction, and the
  // reason this is worth a comment: getting the sign wrong produces a cropper
  // that fights the person using it.
  const cx = width / 2 - offsetX * perStagePx;
  const cy = height / 2 - offsetY * perStagePx;

  return {
    sx: Math.round(clamp(cx - side / 2, 0, Math.max(0, width - side))),
    sy: Math.round(clamp(cy - side / 2, 0, Math.max(0, height - side))),
    side,
  };
}

/**
 * How far the picture may be panned before its edge enters the stage.
 *
 * Without this a person can drag the photo off the stage entirely and save a
 * square of empty canvas. Returned as a magnitude for each axis.
 */
export function panLimits({ width, height, scale }) {
  const safeScale = clamp(Number(scale) || 1, MIN_SCALE, MAX_SCALE);
  const cover = Math.min(width, height) / STAGE;
  const shownW = width / cover * safeScale;
  const shownH = height / cover * safeScale;
  return {
    x: Math.max(0, (shownW - STAGE) / 2),
    y: Math.max(0, (shownH - STAGE) / 2),
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Wire a stage element into a working editor.
 *
 * Returns { setImage, cropRect, destroy }. The caller owns the decoded image
 * and is responsible for releasing it — this module never closes a bitmap it
 * did not create, because the same bitmap is reused for the final encode.
 */
export function createCropEditor({ stage, canvas, zoom, onChange = () => {} }) {
  const ctx = canvas?.getContext?.("2d") || null;
  let image = null;
  let scale = MIN_SCALE;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = null;

  function clampPan() {
    if (!image) return;
    const limit = panLimits({ width: image.width, height: image.height, scale });
    offsetX = clamp(offsetX, -limit.x, limit.x);
    offsetY = clamp(offsetY, -limit.y, limit.y);
  }

  function draw() {
    if (!ctx || !image) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    if (canvas.width !== STAGE * dpr) {
      canvas.width = STAGE * dpr;
      canvas.height = STAGE * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, STAGE, STAGE);

    const { sx, sy, side } = cropRectFor({
      width: image.width, height: image.height, scale, offsetX, offsetY,
    });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, sx, sy, side, side, 0, 0, STAGE, STAGE);
    onChange();
  }

  function onPointerDown(event) {
    if (!image) return;
    dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragging || event.pointerId !== dragging.id) return;
    offsetX += event.clientX - dragging.x;
    offsetY += event.clientY - dragging.y;
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    clampPan();
    draw();
    // Only once a drag is genuinely under way, so a tap that turns out not to
    // be a drag still scrolls the dialog normally.
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (dragging && event.pointerId === dragging.id) dragging = null;
  }

  // Arrow keys, because dragging is unavailable without a pointer and framing a
  // photo is not an optional part of choosing one.
  function onKeyDown(event) {
    const step = event.shiftKey ? 20 : 5;
    const moves = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0],
      ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;
    offsetX += move[0];
    offsetY += move[1];
    clampPan();
    draw();
    event.preventDefault();
  }

  function onZoom() {
    scale = clamp(Number(zoom.value) / 100, MIN_SCALE, MAX_SCALE);
    clampPan();
    draw();
  }

  stage?.addEventListener("pointerdown", onPointerDown);
  stage?.addEventListener("pointermove", onPointerMove);
  stage?.addEventListener("pointerup", onPointerUp);
  stage?.addEventListener("pointercancel", onPointerUp);
  stage?.addEventListener("keydown", onKeyDown);
  zoom?.addEventListener("input", onZoom);

  return {
    /** Adopt a decoded image and reset the framing to centred, unzoomed. */
    setImage(next) {
      image = next;
      scale = MIN_SCALE;
      offsetX = 0;
      offsetY = 0;
      if (zoom) zoom.value = "100";
      draw();
    },
    /** The rectangle to hand to normalizeAvatar(). Null when nothing is loaded. */
    cropRect() {
      if (!image) return null;
      return cropRectFor({
        width: image.width, height: image.height, scale, offsetX, offsetY,
      });
    },
    destroy() {
      stage?.removeEventListener("pointerdown", onPointerDown);
      stage?.removeEventListener("pointermove", onPointerMove);
      stage?.removeEventListener("pointerup", onPointerUp);
      stage?.removeEventListener("pointercancel", onPointerUp);
      stage?.removeEventListener("keydown", onKeyDown);
      zoom?.removeEventListener("input", onZoom);
      image = null;              // released by the caller, not here
    },
  };
}
