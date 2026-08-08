// Orbit Axis :: client-side avatar normalization.
//
// Turns whatever the person picked into exactly one shape: a 512x512 WebP
// under 1 MB, with no metadata. The server re-checks all of it against the
// bytes — see lib/charts/avatar.js — because a browser is a client and every
// limit enforced only here is a limit that can be skipped.
//
// So why do it at all? Three reasons that the server cannot provide:
//
//   1. The person sees the square they are about to get, before uploading.
//   2. A 12 MP phone photo becomes ~40 KB, so the upload is quick and the
//      stored object is small.
//   3. Re-encoding is what strips EXIF and GPS. A holiday photo carries the
//      coordinates it was taken at, and an avatar attached to someone's birth
//      chart is the last place that should travel to.
//
// Canvas is used for one decode-crop-resize-encode pass and nothing else.
// There is no animation loop and no dependency.

import {
  AVATAR_DIMENSION, AVATAR_MAX_BYTES, AVATAR_SOURCE_MIN_DIMENSION,
  AvatarError, validateSourceFile, validateSourceDimensions,
} from "./chart-avatar-limits.js";

/** WebP encoding quality. 0.86 keeps a 512 square comfortably under 1 MB. */
export const WEBP_QUALITY = 0.86;

/**
 * Decodes a file without leaking the object URL.
 *
 * createImageBitmap is preferred: it decodes off the main thread and never
 * needs a URL at all. The <img> path is the fallback for browsers without it,
 * and its `finally` is the only thing standing between repeated previews and
 * an object-URL leak — which is invisible until the tab is using hundreds of
 * megabytes.
 */
export async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      throw new AvatarError("avatar_decode_failed", "Orbit couldn't open that image.");
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new AvatarError("avatar_decode_failed", "Orbit couldn't open that image."));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The centre square of a rectangle.
 *
 * Cropping to the centre rather than the top-left is the difference between a
 * portrait and the top of someone's head.
 */
export function centreSquare(width, height) {
  const side = Math.min(width, height);
  return {
    sx: Math.round((width - side) / 2),
    sy: Math.round((height - side) / 2),
    side,
  };
}

/**
 * A crop rectangle the canvas can actually be asked for.
 *
 * The editor works in floats and in whatever units the pointer produced; this
 * is the boundary where that becomes a square inside the image. Every value is
 * clamped rather than validated-and-rejected, because a crop half a pixel over
 * the edge is a rounding artefact, not a person doing something wrong — and
 * drawImage with a source rectangle outside the bitmap silently produces
 * transparent edges, which would upload as a picture with a grey stripe.
 */
export function clampCrop(crop, width, height) {
  const maxSide = Math.min(width, height);
  const side = Math.round(Math.min(Math.max(Number(crop?.side) || maxSide, 1), maxSide));
  const sx = Math.round(Math.min(Math.max(Number(crop?.sx) || 0, 0), width - side));
  const sy = Math.round(Math.min(Math.max(Number(crop?.sy) || 0, 0), height - side));
  return { sx, sy, side };
}

/** Frees a decoded bitmap. ImageBitmap holds memory until told otherwise. */
export function releaseImage(image) {
  if (image && typeof image.close === "function") image.close();
}

/**
 * Encode the square canvas, preferring WebP and accepting PNG.
 *
 * WHY THIS NO LONGER GIVES UP. It used to demand WebP and throw "This browser
 * couldn't prepare the image" if `toBlob` returned anything else — which is
 * exactly what Safari has historically done, silently substituting PNG. So the
 * one browser Orbit ships to on iOS could be the one that refused every photo.
 *
 * PNG was always acceptable: AVATAR_CONTENT_TYPES has listed it all along, the
 * server sniffs and accepts it, and the Storage bucket's allowed types include
 * it. The client was the only part insisting.
 *
 * WebP is still preferred — it is several times smaller at this quality — so
 * this asks for it first and only falls back when the browser substitutes.
 */
export async function encodeSquare(canvas) {
  const webp = await canvasToBlob(canvas, "image/webp", WEBP_QUALITY);
  if (webp && webp.type === "image/webp") return webp;

  // Either toBlob refused outright, or it silently produced something else.
  // Ask for PNG explicitly rather than trusting whatever the substitute was —
  // a blob claiming a type nobody requested is not a thing to upload.
  const png = await canvasToBlob(canvas, "image/png");
  if (png && png.type === "image/png") return png;

  throw new AvatarError("avatar_encode_failed",
    "This browser couldn't prepare the image. Try another photo.");
}

/**
 * The whole pipeline: validate, decode, crop, resize, re-encode.
 *
 * Returns a Blob ready to upload. The original file is never sent — only this
 * result, which is why the metadata cannot come with it.
 */
export async function normalizeAvatar(file, { createCanvas, crop = null } = {}) {
  validateSourceFile({ size: file?.size, type: file?.type });

  const image = await decodeImage(file);
  try {
    const width = image.width;
    const height = image.height;
    validateSourceDimensions(width, height);

    // An explicit crop from the editor, clamped to the image. Falls back to the
    // centre square, which is what every caller got before cropping existed —
    // so a caller that passes nothing behaves exactly as it always has.
    const { sx, sy, side } = crop
      ? clampCrop(crop, width, height)
      : centreSquare(width, height);
    const canvas = createCanvas
      ? createCanvas(AVATAR_DIMENSION, AVATAR_DIMENSION)
      : Object.assign(document.createElement("canvas"),
        { width: AVATAR_DIMENSION, height: AVATAR_DIMENSION });
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AvatarError("avatar_decode_failed", "Orbit couldn't process that image.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, sx, sy, side, side, 0, 0, AVATAR_DIMENSION, AVATAR_DIMENSION);

    const blob = await encodeSquare(canvas);
    if (blob.size > AVATAR_MAX_BYTES) {
      throw new AvatarError("avatar_too_large", "That image was still too large after processing.");
    }
    return blob;
  } finally {
    // Runs whether the pipeline succeeded or threw, so a rejected image does
    // not keep its decoded bitmap alive.
    releaseImage(image);
  }
}

function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type, quality });   // OffscreenCanvas
  }
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * A preview URL plus the function that disposes of it.
 *
 * Handing back the revoker with the URL makes the cleanup impossible to forget
 * separately — the caller receives one object and calling `release()` is the
 * only thing it can do with the second half.
 */
export function previewFor(blob) {
  const url = URL.createObjectURL(blob);
  let released = false;
  return {
    url,
    release() {
      if (released) return;
      released = true;
      URL.revokeObjectURL(url);
    },
    get released() { return released; },
  };
}

export { AVATAR_DIMENSION, AVATAR_MAX_BYTES, AVATAR_SOURCE_MIN_DIMENSION, AvatarError };
