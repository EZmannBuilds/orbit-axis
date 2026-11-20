// Orbit Axis :: zodiac wheel, geocentric orbit view, and placement rows.
//
// Pure renderers. Every input is the `positions` array from /api/sky/current
// (Swiss Ephemeris via the engine); nothing here calculates or invents a
// position. Longitudes are derived only from the sign + degrees + minutes the
// API already reports.

const SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra",
  "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
const BODY_GLYPHS = { Sun: "☉", Moon: "☽", Mercury: "☿", Venus: "♀", Mars: "♂",
  Jupiter: "♃", Saturn: "♄", Uranus: "♅", Neptune: "♆", Pluto: "♇" };
// Mean distance from Earth, nearest first: the ring order for the orbit view.
const GEO_ORDER = ["Moon", "Mercury", "Venus", "Sun", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const TEXT = "︎"; // text presentation: never let a glyph become an emoji
const GLYPH_FONT = "'Apple Symbols','Noto Sans Symbols 2','Segoe UI Symbol',serif";

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r1 = (n) => Math.round(n * 10) / 10;

/** Ecliptic longitude in degrees, or null when the row is not usable. */
export function longitudeOf(p) {
  const i = SIGNS.indexOf(p?.sign);
  if (i < 0 || !Number.isFinite(p?.degrees)) return null;
  return i * 30 + p.degrees + (Number.isFinite(p.minutes) ? p.minutes / 60 : 0);
}

const usable = (positions) => (positions || [])
  .map((p) => ({ ...p, lon: longitudeOf(p) }))
  .filter((p) => p.lon != null && BODY_GLYPHS[p.name]);

// 0° Aries at nine o'clock, signs running counter-clockwise: the chart convention.
function at(cx, cy, r, lon) {
  const t = ((180 - lon) * Math.PI) / 180;
  return [cx + r * Math.cos(t), cy - r * Math.sin(t)];
}

export function zodiacWheelSvg(positions, { size = 320 } = {}) {
  const bodies = usable(positions);
  const c = size / 2, ro = size * 0.47, ri = size * 0.38, rp = size * 0.29;
  const out = [`<svg class="zw" viewBox="0 0 ${size} ${size}" role="img" aria-label="Zodiac wheel showing today's positions of ${bodies.map((b) => b.name).join(", ")}">`,
    `<circle class="zw__ring" cx="${c}" cy="${c}" r="${ro}"/>`,
    `<circle class="zw__ring" cx="${c}" cy="${c}" r="${ri}"/>`,
    `<circle class="zw__ring zw__ring--faint" cx="${c}" cy="${c}" r="${size * 0.2}"/>`];
  for (let i = 0; i < 12; i++) {
    const [x1, y1] = at(c, c, ri, i * 30), [x2, y2] = at(c, c, ro, i * 30);
    out.push(`<line class="zw__ring" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`);
    const [gx, gy] = at(c, c, (ri + ro) / 2, i * 30 + 15);
    out.push(`<text class="zw__sign" x="${r1(gx)}" y="${r1(gy)}" font-size="${r1(size * 0.045)}" font-family="${GLYPH_FONT}">${SIGN_GLYPHS[i]}${TEXT}</text>`);
  }
  for (let d = 0; d < 360; d += 5) {
    const [a, b] = at(c, c, ri, d), [e, f] = at(c, c, ri - (d % 30 ? 3 : 6), d);
    out.push(`<line class="zw__tick" x1="${r1(a)}" y1="${r1(b)}" x2="${r1(e)}" y2="${r1(f)}"/>`);
  }
  const placed = [];
  for (const b of bodies) {
    let r = rp;
    for (const lon of placed) if (Math.abs(((b.lon - lon + 540) % 360) - 180) < 7) r -= size * 0.065;
    placed.push(b.lon);
    const [mx, my] = at(c, c, ri - 2, b.lon), [px, py] = at(c, c, r + size * 0.03, b.lon), [x, y] = at(c, c, r, b.lon);
    const lum = b.name === "Sun" || b.name === "Moon" ? " zw__body--lum" : "";
    out.push(`<line class="zw__pointer" x1="${r1(mx)}" y1="${r1(my)}" x2="${r1(px)}" y2="${r1(py)}"/>`);
    out.push(`<text class="zw__body${lum}" x="${r1(x)}" y="${r1(y)}" font-size="${r1(size * 0.05)}" font-family="${GLYPH_FONT}">${BODY_GLYPHS[b.name]}${TEXT}<title>${escapeHtml(b.name)} ${escapeHtml(b.position)}</title></text>`);
  }
  out.push("</svg>");
  return out.join("");
}

/** Geocentric view: Earth at the centre, one ring per body, nearest first. */
export function orbitSvg(positions, { size = 260 } = {}) {
  const byName = Object.fromEntries(usable(positions).map((b) => [b.name, b]));
  const bodies = GEO_ORDER.map((n) => byName[n]).filter(Boolean);
  const c = size / 2;
  const out = [`<svg class="orb" viewBox="0 0 ${size} ${size}" role="img" aria-label="Seen from Earth: ${bodies.map((b) => `${b.name} at ${b.position}`).join("; ")}">`];
  for (let i = 0; i < 12; i++) {
    const [x, y] = at(c, c, size * 0.485, i * 30 + 15);
    out.push(`<text class="orb__sign" x="${r1(x)}" y="${r1(y)}" font-size="${r1(size * 0.04)}" font-family="${GLYPH_FONT}">${SIGN_GLYPHS[i]}${TEXT}</text>`);
  }
  bodies.forEach((b, i) => {
    const r = size * (0.085 + i * 0.037);
    out.push(`<circle class="orb__track" cx="${c}" cy="${c}" r="${r1(r)}"/>`);
    const [x, y] = at(c, c, r, b.lon);
    const cls = b.name === "Sun" ? "orb__body orb__body--sun" : b.name === "Moon" ? "orb__body orb__body--moon" : "orb__body";
    out.push(`<circle class="${cls}" cx="${r1(x)}" cy="${r1(y)}" r="${b.name === "Sun" ? 4.2 : 2.7}"><title>${escapeHtml(b.name)} ${escapeHtml(b.position)}</title></circle>`);
  });
  out.push(`<circle class="orb__earth" cx="${c}" cy="${c}" r="${r1(size * 0.025)}"/>`);
  out.push("</svg>");
  return out.join("");
}

/** Glyph-led open rows; `role` and retrograde come straight from the API. */
export function placementsListHtml(positions) {
  return usable(positions).map((b) => `
    <li class="placement">
      <span class="placement__glyph" aria-hidden="true">${BODY_GLYPHS[b.name]}${TEXT}</span>
      <span class="placement__name">${escapeHtml(b.name)}${b.retrograde ? ' <abbr class="placement__rx" title="Retrograde">℞</abbr>' : ""}
        ${b.role ? `<small>${escapeHtml(b.role)}</small>` : ""}</span>
      <span class="placement__pos">${escapeHtml(b.position)}</span>
    </li>`).join("");
}
