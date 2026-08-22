// Orbit Axis :: the Facebook / LinkedIn page cover, composed as SVG.
//
// A COVER IS CROPPED TWICE, DIFFERENTLY. Facebook scales one upload to fill
// two boxes and centre-crops whatever overflows:
//
//   desktop  820x312 → shows the centre 1640 x 624 of the upload
//   mobile   640x360 → shows the centre 1522 x  856
//
// So the only region that survives BOTH is the intersection: 1522 x 624,
// centred, leaving 59px of bleed left and right and 116px top and bottom.
// Anything that must be read lives inside SAFE below. The desktop layout also
// lays the page's profile picture over the cover's lower-left, which is why
// the lockup is centred and lifted above the midline rather than set left.
//
// This is composed rather than rastered because it carries TYPE, and the pure
// rasteriser in mark-raster.js draws geometry only — deliberately, since that
// is what lets the icon rebuild with no toolchain. The trade is that turning
// this into the PNG a platform accepts needs an SVG renderer.

import { orbitLogo, axisMotif } from "../orbit-x/celestial.js";
import { TOKENS } from "../orbit-x/templates.js";

export const COVER = Object.freeze({
  width: 1640,
  height: 856,
  // The region both crops keep. Measured, not guessed — see the header.
  safe: Object.freeze({ x: 59, y: 116, w: 1522, h: 624 }),
});

const esc = (t) => String(t ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * @param {object} opts
 * @param {string} opts.tagline one line, inside the safe zone. Keep it short:
 *   a cover crowded with type reads as an advertisement, which is the one
 *   thing this account is not.
 */
export function coverSvg({ tagline = "Calculated, not invented." } = {}) {
  const { width: W, height: H, safe } = COVER;
  const midX = W / 2;

  // The lockup: mark plus wordmark, centred, sitting above the midline so the
  // desktop profile picture cannot reach it.
  const scale = 1.55;
  const lockupY = 300;
  const lockupH = 128 * scale;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"`
    + ` role="img" aria-label="Orbit Axis — ${esc(tagline)}">`
    + `<title>Orbit Axis</title>`
    + `<defs><radialGradient id="cover-field" cx="72%" cy="22%" r="76%">`
    + `<stop offset="0" stop-color="${TOKENS.accentDeep}" stop-opacity="0.34"/>`
    + `<stop offset="1" stop-color="${TOKENS.bg}" stop-opacity="0"/></radialGradient></defs>`
    + `<rect width="${W}" height="${H}" fill="${TOKENS.bg}"/>`
    + `<rect width="${W}" height="${H}" fill="url(#cover-field)"/>`
    // Two faint orbits in the bleed, so the crop that keeps them and the crop
    // that loses them both look intentional.
    + `<circle cx="${W - 210}" cy="150" r="300" fill="none" stroke="${TOKENS.moonRim}" stroke-width="2" opacity="0.5"/>`
    + `<circle cx="${W - 210}" cy="150" r="470" fill="none" stroke="${TOKENS.line}" stroke-width="2" opacity="0.8"/>`
    + `<g opacity="0.75">${axisMotif({ x: safe.x + 40, y: H - 96, length: 190 })}</g>`
    + orbitLogo({ x: midX, y: lockupY, scale, anchor: "middle" })
    + `<text x="${midX}" y="${lockupY + lockupH + 96}" text-anchor="middle" font-family="${TOKENS.sans}"`
    + ` font-size="40" letter-spacing="3" fill="${TOKENS.body}">${esc(tagline)}</text>`
    + `</svg>`;
}
