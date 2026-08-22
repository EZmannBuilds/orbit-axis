// Orbit Axis :: the Facebook / LinkedIn page cover, composed as SVG.
//
// A COVER IS CROPPED TWICE, THEN PUNCHED THROUGH. Facebook scales one upload
// to fill two boxes and centre-crops whatever overflows:
//
//   desktop  820x312 → shows the centre 1640 x 624 of the upload
//   mobile   640x360 → shows the centre 1522 x  856
//
// so the region surviving BOTH is their intersection: 1522 x 624, centred.
// That much is arithmetic. The part that is NOT arithmetic, and that a first
// version of this file got badly wrong, is the profile picture: Facebook lays
// it over the cover's BOTTOM CENTRE — not the lower-left — and on mobile it is
// enormous. A centred lockup and tagline sat exactly under it; the preview
// read "Calc———nted." and the wordmark was cropped to "AXIS".
//
// AVATAR below is therefore MEASURED off the real page previews, desktop and
// mobile, and stated as the union of the two. It is not derived from anything
// and cannot be: only the rendered page knows. Re-measure it if Facebook moves
// the furniture.
//
// What follows from that: the centre third is unusable, the mark must not
// appear at all (the avatar is already the mark, inches away), and the words
// belong in the left strip. The page's own name sits directly beneath the
// cover, so repeating "Orbit Axis" here would be the third time in one screen.
//
// This is composed rather than rastered because it carries TYPE, and the pure
// rasteriser in mark-raster.js draws geometry only — deliberately, since that
// is what lets the icon rebuild with no toolchain. The trade is that turning
// this into the PNG a platform accepts needs an SVG renderer.

import { axisMotif } from "../orbit-x/celestial.js";
import { TOKENS } from "../orbit-x/templates.js";

export const COVER = Object.freeze({
  width: 1640,
  height: 856,
  // The region both crops keep. Measured, not guessed — see the header.
  safe: Object.freeze({ x: 59, y: 116, w: 1522, h: 624 }),
  // Where the profile picture lands, as the union of both previews. Nothing
  // that must be read may enter this box.
  avatar: Object.freeze({ x: 597, w: 542, y: 135 }),
});

/** The clear column to the left of the avatar, inside the safe zone. */
export const LEFT_STRIP = Object.freeze({
  x: COVER.safe.x,
  w: COVER.avatar.x - COVER.safe.x,
});

const esc = (t) => String(t ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * @param {object} opts
 * @param {string[]} opts.lines the statement, pre-broken. Two short lines beat
 *   one long one here: the clear column is 538px wide, which is a third of the
 *   canvas, and type that runs past it runs under the profile picture.
 * @param {string} opts.eyebrow small letterspaced label above the statement.
 */
export function coverSvg({
  lines = ["Calculated,", "not invented."],
  eyebrow = "THE SHARED SKY, MEASURED",
} = {}) {
  const { width: W, height: H, safe } = COVER;
  const x = 112;                       // inside LEFT_STRIP, optically indented
  // Sized so the LONGEST line still clears the avatar with room to spare. A
  // test measures every line and fails if one crowds it.
  const statementSize = 60;
  const lineGap = 1.2;
  // The block is centred in the SAFE band, not the canvas: the canvas centre
  // is 428 and the safe band's is 428 too, but only one of those stays true
  // if the crop model changes.
  const blockH = (lines.length - 1) * statementSize * lineGap;
  const firstBaseline = safe.y + safe.h / 2 - blockH / 2 + statementSize * 0.32;

  const statement = lines.map((line, i) =>
    `<text x="${x}" y="${firstBaseline + i * statementSize * lineGap}" font-family="${TOKENS.serif}"`
    + ` font-size="${statementSize}" fill="${TOKENS.ink}">${esc(line)}</text>`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"`
    + ` role="img" aria-label="Orbit Axis — ${esc(lines.join(" "))}">`
    + `<title>Orbit Axis</title>`
    + `<defs><radialGradient id="cover-field" cx="74%" cy="24%" r="78%">`
    + `<stop offset="0" stop-color="${TOKENS.accentDeep}" stop-opacity="0.40"/>`
    + `<stop offset="1" stop-color="${TOKENS.bg}" stop-opacity="0"/></radialGradient></defs>`
    + `<rect width="${W}" height="${H}" fill="${TOKENS.bg}"/>`
    + `<rect width="${W}" height="${H}" fill="url(#cover-field)"/>`
    // Concentric orbits off the right edge — the instrument register, kept
    // clear of the words and unbothered by whatever the avatar covers.
    + `<g fill="none" stroke="${TOKENS.moonRim}" opacity="0.55">`
    + `<circle cx="${W - 150}" cy="130" r="300" stroke-width="2"/>`
    + `<circle cx="${W - 150}" cy="130" r="470" stroke-width="2" opacity="0.7"/>`
    + `<circle cx="${W - 150}" cy="130" r="640" stroke-width="2" opacity="0.45"/></g>`
    + `<circle cx="${W - 470}" cy="452" r="9" fill="${TOKENS.brand}" opacity="0.9"/>`
    + `<g opacity="0.8">${axisMotif({ x: x + 4, y: H - 104, length: 168 })}</g>`
    + `<text x="${x}" y="${firstBaseline - statementSize - 26}" font-family="${TOKENS.sans}"`
    + ` font-size="27" letter-spacing="6" fill="${TOKENS.brand}">${esc(eyebrow)}</text>`
    + statement
    + `</svg>`;
}
