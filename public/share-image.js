/* ============================================================================
   Orbit — Share image renderer
   ----------------------------------------------------------------------------
   Turns a reading — a day's sky, or a tarot card — into a PNG the reader can
   post. Client-side and offline: a <canvas>, the tokens' own colours, and no
   network call, because a share button that needs a server is a share button
   that fails on a train.

   WHAT THIS IS NOT. It is not the Orbit X renderer. That one draws editorial
   carousels from engine facts on the server and is bound to those formats;
   this draws what the reader is already looking at, at the size they asked
   for. The two are allowed to look like the same brand and share no code.

   FACTS ARE PASSED IN, NEVER RE-DERIVED. Nothing here computes a position, a
   phase, or a date. Whatever the app already rendered and verified is what
   gets drawn — this file cannot disagree with the screen because it is not
   allowed an opinion about astronomy.
   ========================================================================== */

/** The three sizes people actually post at. Portrait first: it is the one
 *  that survives both a feed and a story without being cropped twice. */
export const SHARE_PRESETS = Object.freeze({
  portrait: { id: "portrait", label: "Portrait", w: 1080, h: 1350, note: "Feed" },
  square:   { id: "square",   label: "Square",   w: 1080, h: 1080, note: "Feed" },
  story:    { id: "story",    label: "Story",    w: 1080, h: 1920, note: "Stories" },
});

export const SHARE_PRESET_IDS = Object.freeze(Object.keys(SHARE_PRESETS));

/* The palette, taken from tokens.css rather than invented. Dark only: the
   image is posted against someone else's feed, not against our theme, and a
   light card on a dark feed is the one that looks broken. */
const IMG = Object.freeze({
  bg: "#080a12",          // --brand-deep-space
  panel: "#101321",       // --brand-surface
  text: "#f4f2fa",        // --brand-star-white
  muted: "#8e93a8",       // --brand-muted-starlight
  accent: "#b9a7ff",      // --brand-celestial-highlight
  rule: "rgba(185, 167, 255, 0.18)",
});

const SANS = '"Inter", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/**
 * Render one share image.
 *
 * @param {object} content
 * @param {string} content.eyebrow  small caps line — "DAILY READING", "TAROT"
 * @param {string} content.title    the headline; wraps to at most three lines
 * @param {string} [content.subtitle] one line under the title (a date, a position)
 * @param {string} [content.body]   the prose; wrapped and clipped to fit
 * @param {string} [content.image] same-origin card artwork, drawn under the title
 * @param {string[]} [content.meta] short facts printed as a list above the footer
 * @param {string} content.footer   the attribution line
 * @param {string} presetId
 * @returns {Promise<Blob>} a PNG
 */
export async function renderShareImage(content, presetId = "portrait") {
  const preset = SHARE_PRESETS[presetId] || SHARE_PRESETS.portrait;
  const canvas = document.createElement("canvas");
  canvas.width = preset.w;
  canvas.height = preset.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable on this device.");

  // Scale every measurement off the width, so one layout serves all three
  // sizes and nothing is tuned per preset.
  const U = preset.w / 1080;
  const pad = Math.round(96 * U);
  const inner = preset.w - pad * 2;

  ctx.fillStyle = IMG.bg;
  ctx.fillRect(0, 0, preset.w, preset.h);
  drawGlow(ctx, preset, U);

  let y = pad + Math.round(70 * U);

  if (content.eyebrow) {
    ctx.font = `600 ${Math.round(26 * U)}px ${SANS}`;
    ctx.fillStyle = IMG.accent;
    drawTracked(ctx, String(content.eyebrow).toUpperCase(), pad, y, 6 * U);
    y += Math.round(64 * U);
  }

  const titleSize = preset.id === "story" ? 84 : 76;
  y = drawWrapped(ctx, content.title || "", {
    x: pad, y, width: inner, font: `700 ${Math.round(titleSize * U)}px ${SANS}`,
    color: IMG.text, lineHeight: 1.16, maxLines: 3,
  });

  if (content.subtitle) {
    ctx.font = `500 ${Math.round(30 * U)}px ${SANS}`;
    ctx.fillStyle = IMG.muted;
    ctx.fillText(clip(ctx, content.subtitle, inner), pad, y);
    y += Math.round(38 * U);
  }

  // The card itself, when there is one. Drawn from the SAME url the page is
  // already showing, so a shared card can never be a different card. Square is
  // the short preset, so it gets a smaller face or the body has nowhere to go.
  if (content.image) {
    // Sized so the READING still fits. A face big enough to crowd the words
    // out is the wrong trade: the card is the picture, the reading is the
    // point, and square is the preset with the least height to spend.
    const share = preset.id === "square" ? 0.18 : preset.id === "story" ? 0.30 : 0.28;
    const cardW = Math.round(inner * share);
    const cardH = Math.round(cardW * 12 / 7);
    const drawn = await drawCardArt(ctx, content.image, pad, y + Math.round(12 * U), cardW, cardH, U);
    if (drawn) y += cardH + Math.round(30 * U);
  }

  // The footer and the meta block are placed from the BOTTOM, then the body
  // gets whatever is left. That ordering is the whole trick: the attribution
  // can never be pushed off the canvas by a long reading.
  const footerY = preset.h - pad;
  const metaLines = (content.meta || []).filter(Boolean);
  const metaH = metaLines.length
    ? metaLines.length * Math.round(38 * U) + Math.round(30 * U)
    : 0;
  const bodyBottom = footerY - Math.round(72 * U) - metaH;

  if (content.body) {
    y += Math.round(26 * U);
    drawWrapped(ctx, content.body, {
      x: pad, y, width: inner,
      font: `400 ${Math.round((preset.id === "square" ? 32 : 36) * U)}px ${SANS}`,
      color: IMG.text, lineHeight: 1.45, maxHeight: bodyBottom - y,
    });
  }

  if (metaLines.length) {
    let my = bodyBottom + Math.round(30 * U);
    ctx.font = `400 ${Math.round(27 * U)}px ${SANS}`;
    for (const line of metaLines) {
      ctx.fillStyle = IMG.muted;
      ctx.fillText(clip(ctx, line, inner), pad, my);
      my += Math.round(38 * U);
    }
  }

  ctx.strokeStyle = IMG.rule;
  ctx.lineWidth = Math.max(1, Math.round(2 * U));
  ctx.beginPath();
  ctx.moveTo(pad, footerY - Math.round(52 * U));
  ctx.lineTo(preset.w - pad, footerY - Math.round(52 * U));
  ctx.stroke();

  drawMark(ctx, pad, footerY - Math.round(20 * U), 26 * U);
  ctx.font = `500 ${Math.round(24 * U)}px ${SANS}`;
  ctx.fillStyle = IMG.muted;
  ctx.fillText(clip(ctx, content.footer || "", inner - Math.round(80 * U)),
    pad + Math.round(72 * U), footerY - Math.round(12 * U));

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Image could not be created.")), "image/png");
  });
}

/* ── Drawing helpers ─────────────────────────────────────────────────────── */

/** One soft violet bloom, top-right. The only decoration, and it never sits
 *  under text: the body starts well below it at every preset. */
function drawGlow(ctx, preset, U) {
  const cx = preset.w - 140 * U;
  const cy = 200 * U;
  const r = 520 * U;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, "rgba(118, 87, 232, 0.30)");
  g.addColorStop(1, "rgba(118, 87, 232, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

/** The Orbit mark: a ring with a slash, drawn rather than loaded so the image
 *  needs no asset and cannot render half-finished. */
function drawMark(ctx, x, y, size) {
  const r = size / 2;
  ctx.save();
  ctx.strokeStyle = "#7657e8";
  ctx.lineWidth = Math.max(2, size * 0.11);
  ctx.beginPath();
  ctx.arc(x + r, y - r, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + size * 0.08, y - size * 0.08);
  ctx.lineTo(x + size * 0.92, y - size * 0.92);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw one card face: cover-fitted into a 7:12 rounded frame, the proportion
 * of a printed tarot card and the same one the app uses on screen.
 *
 * Returns false rather than throwing if the image cannot be loaded — a share
 * image with no artwork is still worth having, and a card that 404s should not
 * cost the reader the whole export.
 */
async function drawCardArt(ctx, url, x, y, w, h, U) {
  let img;
  try {
    img = await new Promise((resolve, reject) => {
      const el = new Image();
      // Same-origin by construction (the app's own /images path), so the
      // canvas stays untainted and toBlob() keeps working.
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("card art failed to load"));
      el.src = url;
    });
  } catch { return false; }

  const r = Math.round(16 * U);
  ctx.save();
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.clip();

  // Cover-fit: fill the frame, crop the overflow, never distort the plate.
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();

  ctx.strokeStyle = IMG.rule;
  ctx.lineWidth = Math.max(1, Math.round(2 * U));
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.stroke();
  return true;
}

/** Letter-spaced small caps. Canvas has no letterSpacing everywhere yet, so
 *  the eyebrow is drawn a character at a time. */
function drawTracked(ctx, text, x, y, spacing) {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
}

/** Word-wrap into a column. Honours whichever of maxLines / maxHeight is
 *  given; the last line that fits gets an ellipsis if anything was dropped.
 *
 *  @returns {number} the next FREE baseline — one full line below the last
 *  line drawn, so a caller can keep stacking without doing the arithmetic.
 *  Returning the last baseline instead is what put the subtitle on top of the
 *  title the first time this ran. */
function drawWrapped(ctx, text, opts) {
  const { x, width, font, color, lineHeight } = opts;
  ctx.font = font;
  ctx.fillStyle = color;
  const size = parseInt(font.match(/(\d+)px/)?.[1] || "32", 10);
  const step = Math.round(size * lineHeight);
  const cap = opts.maxLines ?? Math.max(1, Math.floor((opts.maxHeight ?? Infinity) / step));

  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width) { line = next; continue; }
    if (line) lines.push(line);
    line = word;
    if (lines.length >= cap) break;
  }
  if (line && lines.length < cap) lines.push(line);

  const dropped = lines.length >= cap && words.length > lines.join(" ").split(/\s+/).length;
  let y = opts.y;
  lines.slice(0, cap).forEach((l, i) => {
    const last = i === Math.min(lines.length, cap) - 1;
    ctx.fillText(last && dropped ? clip(ctx, `${l}…`, width) : l, x, y);
    y += step;
  });
  return y;
}

/** Trim a single line to fit, with an ellipsis if it had to be cut. */
function clip(ctx, text, width) {
  let out = String(text);
  if (ctx.measureText(out).width <= width) return out;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > width) out = out.slice(0, -1);
  return `${out}…`;
}

/* ── Delivery ────────────────────────────────────────────────────────────── */

/**
 * Hand the image to the reader: the OS share sheet where there is one, a
 * download everywhere else.
 *
 * Feature-detected with canShare({ files }) rather than assumed — Safari on
 * iOS and Chrome on Android take files, most desktop browsers do not, and a
 * share() that throws mid-gesture leaves the reader with nothing.
 *
 * @returns {Promise<"shared"|"downloaded"|"cancelled">}
 */
export async function deliverShareImage(blob, filename, shareText) {
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: shareText || undefined });
      return "shared";
    } catch (error) {
      // AbortError is the reader closing the sheet — not a failure, and not
      // something to fall back from, because falling back would download a
      // file they just declined to share.
      if (error?.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}

/** A filename that sorts and says what it is. */
export function shareFilename(kind, isoDate, presetId) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || "")) ? isoDate : "today";
  return `orbit-axis_${kind}_${date}_${presetId}.png`;
}
