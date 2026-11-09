// Orbit X :: server-side PNG rasterization (Dev Update 6.1).
//
// THE SAME SVG THE DESK EXPORTS, DRAWN WITHOUT A BROWSER. The desk's
// exportSlides() paints renderPost()'s SVG onto a canvas at the aspect's own
// width and height and names each file
// `orbit-axis_<local_date>_<event-key-slug>_<nn>[_portrait].png`. The channel
// has no browser, so this module does the same thing with resvg: the same
// renderer output, the same pixel dimensions, the same filenames. Nothing
// here lays anything out; it only turns finished SVG into pixels.
//
// FONTS ARE BUNDLED, NEVER ASSUMED. A Vercel function has no system fonts, and
// resvg with no font draws no text at all, silently. The templates ask for
// Georgia (serif) and the Apple system / Helvetica / Arial stack (sans), so
// this module carries the open-licensed metric-compatible pair instead:
// Gelasio for Georgia and Arimo for Arial, both SIL OFL 1.1, subset to Latin
// and instanced to the two weights the templates use (lib/orbit-x/fonts/).
// Metric compatibility matters because templates.js fits text by character
// width factors measured for those families; a narrower or wider face would
// make the server's line breaks disagree with the desk preview.
//
// INSTAGRAM TAKES JPEG ONLY. Meta's Content Publishing API accepts JPEG and
// nothing else for image containers, so every slide is drawn once and encoded
// twice from the SAME pixels: the PNG the desk would have exported (archive
// and review parity), and a JPEG of it for Meta. jpeg-js is pure JavaScript,
// so no second native binary rides into the function.
//
// Server-only. The desk never loads this file (it is not on the allow-list of
// modules create-app serves), and resvg is imported lazily so nothing that
// merely renders SVG pays for a native binary.

import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { ASPECTS } from "./templates.js";
import { TEMPLATE } from "./formats.js";

export const FONT_FILES = Object.freeze([
  "Arimo-Regular.ttf",
  "Arimo-Bold.ttf",
  "Gelasio-Regular.ttf",
]);

export function fontPaths() {
  return FONT_FILES.map((name) => fileURLToPath(new URL(`./fonts/${name}`, import.meta.url)));
}

export class OrbitXRasterError extends Error {
  constructor(message, { code = "raster_failed" } = {}) {
    super(message);
    this.name = "OrbitXRasterError";
    this.code = code;
  }
}

let resvgModule = null;
async function loadResvg() {
  if (resvgModule) return resvgModule;
  try {
    resvgModule = await import("@resvg/resvg-js");
  } catch {
    throw new OrbitXRasterError("The PNG renderer (@resvg/resvg-js) is not installed for this platform.",
      { code: "raster_unavailable" });
  }
  return resvgModule;
}

/**
 * The export filename the desk would have produced for the same slide. Kept in
 * one place so a carousel the channel posts and a carousel a human exported
 * from the desk are named identically.
 *
 * @param {{ localDate: string, eventKey: string, index: number, aspect: string }} parts
 */
export function slideFilename({ localDate, eventKey, index, aspect }) {
  const A = ASPECTS[aspect] || ASPECTS.square;
  const slug = String(eventKey || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `${TEMPLATE.filePrefix}_${localDate}_${slug}_${String(index + 1).padStart(2, "0")}${A.suffix}.png`;
}

/** PNG signature + IHDR width/height, read without decoding the image. */
export function pngDimensions(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/**
 * Rasterize one finished SVG at the aspect's exact pixel size.
 *
 * @returns {Promise<Buffer>} PNG bytes
 */
export async function rasterizeSvg(svg, { aspect = "portrait" } = {}) {
  return (await rasterizeSlide(svg, { aspect })).png;
}

/** JPEG quality for Meta. High enough that type edges stay clean on a dark
 *  ground; the file stays far below Meta's 8 MB image ceiling. */
export const JPEG_QUALITY = 92;

/**
 * Draw one SVG and encode it as both PNG and JPEG from the same pixels.
 *
 * @returns {Promise<{ png: Buffer, jpeg: Buffer, width: number, height: number }>}
 */
export async function rasterizeSlide(svg, { aspect = "portrait" } = {}) {
  const A = ASPECTS[aspect];
  if (!A) throw new OrbitXRasterError(`Unknown aspect "${aspect}".`, { code: "raster_aspect" });
  const fonts = fontPaths();
  const missing = fonts.filter((p) => !existsSync(p));
  // A missing font is a refusal, not a fallback: a slide drawn without its
  // type would be published as a picture of nothing.
  if (missing.length) throw new OrbitXRasterError("A bundled Orbit X font is missing.", { code: "raster_fonts" });
  const { Resvg } = await loadResvg();
  let png;
  let rendered;
  try {
    const resvg = new Resvg(String(svg), {
      fitTo: { mode: "width", value: A.width },
      background: "#080a12",
      font: {
        loadSystemFonts: false,
        fontFiles: fonts,
        defaultFontFamily: "Arimo",
        sansSerifFamily: "Arimo",
        serifFamily: "Gelasio",
      },
    });
    rendered = resvg.render();
    png = rendered.asPng();
  } catch {
    throw new OrbitXRasterError("The slide could not be rasterized.");
  }
  const dims = pngDimensions(png);
  if (!dims || dims.width !== A.width || dims.height !== A.height) {
    throw new OrbitXRasterError(`Rasterized slide is not ${A.width}x${A.height}.`, { code: "raster_size" });
  }
  let jpeg;
  try {
    const { default: jpegJs } = await import("jpeg-js");
    jpeg = jpegJs.encode({ data: rendered.pixels, width: A.width, height: A.height }, JPEG_QUALITY).data;
  } catch {
    throw new OrbitXRasterError("The slide could not be encoded as JPEG.", { code: "raster_jpeg" });
  }
  return { png: Buffer.from(png), jpeg: Buffer.from(jpeg), width: A.width, height: A.height };
}

/** JPEG SOI marker check plus the SOF0/SOF2 frame size, without decoding. */
export function jpegDimensions(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const length = b.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

/**
 * Rasterize a rendered post (the return value of renderPost()).
 *
 * @param {{ design: object, slides: Array<{svg:string}> }} rendered
 * @param {{ localDate: string, eventKey: string }} naming
 * Each slide carries the desk's PNG filename and a sibling `.jpg` name for the
 * copy Meta receives.
 *
 * @returns {Promise<Array<{ index:number, filename:string, jpegFilename:string,
 *   png:Buffer, jpeg:Buffer, width:number, height:number }>>}
 */
export async function rasterizePost(rendered, { localDate, eventKey }) {
  const aspect = rendered?.design?.aspect || "portrait";
  const out = [];
  for (let i = 0; i < (rendered?.slides || []).length; i += 1) {
    const slide = await rasterizeSlide(rendered.slides[i].svg, { aspect });
    const filename = slideFilename({ localDate, eventKey, index: i, aspect });
    out.push({ index: i, filename, jpegFilename: filename.replace(/\.png$/, ".jpg"), ...slide });
  }
  return out;
}
