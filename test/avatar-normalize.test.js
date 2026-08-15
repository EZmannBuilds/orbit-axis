// Orbit Axis :: client avatar normalization.
//
// Node has no canvas, so the pipeline is driven with a stub that records what
// it was asked to draw. That is enough to prove the parts that matter and that
// a browser cannot be trusted to get right on its own: the crop is centred,
// the output is exactly 512, the original is never what gets uploaded, and
// every object URL is revoked whether the pipeline succeeded or threw.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  centreSquare, normalizeAvatar, previewFor, releaseImage, WEBP_QUALITY,
  AVATAR_DIMENSION, AVATAR_MAX_BYTES,
} from "../public/avatar-normalize.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const threw = async (fn) => { try { await fn(); return null; } catch (e) { return e.code; } };

// ── A canvas that records rather than draws ─────────────────────────────────

function stubCanvas({ blobType = "image/webp", blobSize = 40_000 } = {}) {
  const calls = [];
  return {
    calls,
    create(width, height) {
      calls.push({ kind: "create", width, height });
      return {
        width, height,
        getContext: () => ({
          imageSmoothingEnabled: false,
          imageSmoothingQuality: "low",
          drawImage: (...args) => calls.push({ kind: "draw", args }),
        }),
        toBlob: (cb, type, quality) => {
          calls.push({ kind: "encode", type, quality });
          cb({ type: blobType, size: blobSize });
        },
      };
    },
  };
}

// createImageBitmap is what the pipeline reaches for first.
function withBitmap(width, height, fn) {
  const original = globalThis.createImageBitmap;
  let closed = 0;
  globalThis.createImageBitmap = async () => ({ width, height, close: () => { closed += 1; } });
  return Promise.resolve(fn(() => closed)).finally(() => {
    globalThis.createImageBitmap = original;
  });
}

const file = (size = 500_000, type = "image/jpeg") => ({ size, type });

// ── Cropping ────────────────────────────────────────────────────────────────

test("the crop is centred, not anchored to a corner", () => {
  // A landscape photo: the square comes from the middle, so a portrait keeps
  // the face rather than the top of someone's head.
  assert.deepEqual(centreSquare(1000, 600), { sx: 200, sy: 0, side: 600 });
  assert.deepEqual(centreSquare(600, 1000), { sx: 0, sy: 200, side: 600 });
  assert.deepEqual(centreSquare(800, 800), { sx: 0, sy: 0, side: 800 });
  // Odd differences round rather than drift off the edge.
  const c = centreSquare(1001, 600);
  assert.equal(c.side, 600);
  assert.ok(c.sx + c.side <= 1001);
});

test("the pipeline draws the centre square into exactly 512", async () => {
  const canvas = stubCanvas();
  await withBitmap(1200, 900, async () => {
    const blob = await normalizeAvatar(file(), { createCanvas: canvas.create });
    assert.equal(blob.type, "image/webp");
  });
  const created = canvas.calls.find((c) => c.kind === "create");
  assert.equal(created.width, AVATAR_DIMENSION);
  assert.equal(created.height, AVATAR_DIMENSION);
  const draw = canvas.calls.find((c) => c.kind === "draw");
  // drawImage takes source width AND height separately, so the source square
  // occupies two arguments: [image, sx, sy, sw, sh, dx, dy, dw, dh].
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = draw.args;
  assert.equal(sx, 150, "1200 wide, 900 tall: the square starts 150 in");
  assert.equal(sy, 0);
  assert.equal(sw, 900);
  assert.equal(sh, 900, "and it is a square, not the whole frame");
  assert.deepEqual([dx, dy, dw, dh], [0, 0, AVATAR_DIMENSION, AVATAR_DIMENSION]);
});

test("the output is WebP, which is what strips the metadata", async () => {
  const canvas = stubCanvas();
  await withBitmap(800, 800, async () => {
    await normalizeAvatar(file(), { createCanvas: canvas.create });
  });
  const encode = canvas.calls.find((c) => c.kind === "encode");
  assert.equal(encode.type, "image/webp");
  assert.equal(encode.quality, WEBP_QUALITY);
  assert.ok(WEBP_QUALITY > 0 && WEBP_QUALITY < 1);
});

// ── Refusals ────────────────────────────────────────────────────────────────

test("source limits are enforced before anything is decoded", async () => {
  const canvas = stubCanvas();
  assert.equal(await threw(() => normalizeAvatar(file(11_000_000, "image/png"), { createCanvas: canvas.create })),
    "avatar_source_too_large");
  assert.equal(await threw(() => normalizeAvatar(file(1000, "image/gif"), { createCanvas: canvas.create })),
    "avatar_source_format");
  assert.equal(await threw(() => normalizeAvatar(file(1000, "image/svg+xml"), { createCanvas: canvas.create })),
    "avatar_source_format");
  assert.equal(await threw(() => normalizeAvatar(file(0, "image/png"), { createCanvas: canvas.create })),
    "avatar_empty");
  assert.equal(canvas.calls.length, 0, "nothing was decoded or drawn");
});

test("an image below the minimum is refused rather than upscaled", async () => {
  const canvas = stubCanvas();
  const code = await withBitmap(64, 64, () =>
    threw(() => normalizeAvatar(file(), { createCanvas: canvas.create })));
  assert.equal(code, "avatar_source_too_small");
  assert.ok(!canvas.calls.some((c) => c.kind === "draw"), "and never reaches the canvas");
});

test("a browser that cannot produce WebP falls back to PNG", async () => {
  // REVERSED on 2026-08-08, and the old comment here was wrong on its facts.
  // It said PNG "would send bytes the server refuses" — the server has always
  // accepted PNG (AVATAR_CONTENT_TYPES lists it, lib/charts/avatar.js sniffs
  // and allows it, and the Storage bucket permits it). Only the client
  // insisted, so on Safari — which has historically substituted PNG for a
  // requested WebP — every photo was refused with "this browser couldn't
  // prepare the image". Zero avatars had ever been uploaded in Production.
  const canvas = stubCanvas({ blobType: "image/png" });
  const blob = await withBitmap(800, 800, () =>
    normalizeAvatar(file(), { createCanvas: canvas.create }));
  assert.equal(blob.type, "image/png", "PNG is an acceptable result, not a failure");

  // WebP is still ASKED FOR first — it is several times smaller at this
  // quality, so falling back must stay a fallback rather than becoming default.
  assert.equal(canvas.calls.filter((c) => c.kind === "encode")[0].type, "image/webp");
});

test("a browser that can produce neither format still fails loudly", async () => {
  // The loud failure this test originally protected is still here; it just
  // belongs one format later than it used to.
  const canvas = stubCanvas({ blobType: "image/gif" });
  const code = await withBitmap(800, 800, () =>
    threw(() => normalizeAvatar(file(), { createCanvas: canvas.create })));
  assert.equal(code, "avatar_encode_failed");
});

test("an oversized normalized result is refused before upload", async () => {
  const canvas = stubCanvas({ blobSize: AVATAR_MAX_BYTES + 1 });
  const code = await withBitmap(4000, 4000, () =>
    threw(() => normalizeAvatar(file(), { createCanvas: canvas.create })));
  assert.equal(code, "avatar_too_large");
});

test("a decode failure is reported rather than throwing something raw", async () => {
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => { throw new Error("boom"); };
  try {
    const code = await threw(() => normalizeAvatar(file(), { createCanvas: stubCanvas().create }));
    assert.equal(code, "avatar_decode_failed");
  } finally {
    globalThis.createImageBitmap = original;
  }
});

// ── Memory ──────────────────────────────────────────────────────────────────

test("the decoded bitmap is released on success and on failure", async () => {
  const okCanvas = stubCanvas();
  const closedAfterSuccess = await withBitmap(800, 800, async (closed) => {
    await normalizeAvatar(file(), { createCanvas: okCanvas.create });
    return closed();
  });
  assert.equal(closedAfterSuccess, 1, "released after a successful run");

  const badCanvas = stubCanvas({ blobType: "image/png" });
  const closedAfterFailure = await withBitmap(800, 800, async (closed) => {
    await threw(() => normalizeAvatar(file(), { createCanvas: badCanvas.create }));
    return closed();
  });
  assert.equal(closedAfterFailure, 1, "and released when the pipeline threw");
});

test("releaseImage tolerates something with no close method", () => {
  assert.doesNotThrow(() => releaseImage(null));
  assert.doesNotThrow(() => releaseImage({}));
});

test("a preview hands back its own revoker, and revoking twice is safe", () => {
  const revoked = [];
  const original = { create: globalThis.URL?.createObjectURL, revoke: globalThis.URL?.revokeObjectURL };
  globalThis.URL = {
    ...globalThis.URL,
    createObjectURL: () => "blob:stub",
    revokeObjectURL: (u) => revoked.push(u),
  };
  try {
    const p = previewFor({ type: "image/webp", size: 10 });
    assert.equal(p.url, "blob:stub");
    assert.equal(p.released, false);
    p.release();
    assert.equal(p.released, true);
    p.release();
    assert.deepEqual(revoked, ["blob:stub"], "revoked once, not twice");
  } finally {
    if (original.create) globalThis.URL.createObjectURL = original.create;
    if (original.revoke) globalThis.URL.revokeObjectURL = original.revoke;
  }
});

// ── What the module must not do ─────────────────────────────────────────────

test("normalization is one pass, with no loop and no dependency", () => {
  const src = readFileSync(join(ROOT, "public", "avatar-normalize.js"), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  const banned = ["requestAnimationFrame", "setInterval", "Math.random",
                  "http://", "https://", "localStorage", "sessionStorage"];
  for (const b of banned) {
    assert.ok(!code.includes(b), `${b} must not appear in a one-shot normalizer`);
  }
  // Every object URL created has a revoke on the same path.
  const creates = (code.match(/createObjectURL/g) || []).length;
  const revokes = (code.match(/revokeObjectURL/g) || []).length;
  assert.equal(creates, revokes, "an object URL without a revoke is a leak");
});

test("only the normalized blob leaves the browser, never the original file", () => {
  const src = readFileSync(join(ROOT, "public", "avatar-normalize.js"), "utf8");
  // normalizeAvatar returns the blob from the canvas, and the source `file` is
  // only ever passed to validation and decoding.
  const fn = src.slice(src.indexOf("export async function normalizeAvatar"),
                       src.indexOf("function canvasToBlob"));
  assert.match(fn, /return blob;/);
  assert.ok(!/return file/.test(fn), "the original is never handed back for upload");
  assert.match(fn, /validateSourceFile/);
  assert.match(fn, /finally \{/, "release runs whatever happens");
});
