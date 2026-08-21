// Orbit Axis :: the natal chart wheel.
//
// Pure, deterministic, DOM-independent — importable from a browser
// <script type="module"> or straight from a Node test, the same arrangement
// moon-phase.js uses and for the same reason: geometry this fiddly deserves
// assertions, and assertions are cheap only if the module never touches a
// document.
//
// It calculates NOTHING. Every longitude here comes from the engine's chart;
// this file decides where on a circle to put a glyph and nothing else. If a
// position looks wrong the bug is upstream, and no amount of editing this file
// is the fix.
//
// ORIENTATION, which is the part everyone gets wrong first.
//
// A natal wheel is not a compass. The Ascendant sits at the LEFT (nine
// o'clock) and the zodiac runs COUNTERCLOCKWISE from it, so the Midheaven
// lands near the top and the Descendant at the right. In SVG the y-axis points
// down, so a naive `cos/sin` sweep runs the wrong way round and produces a
// mirrored chart — one that looks plausible and is wrong in a way a reader
// would only notice by comparing it against a wheel drawn anywhere else.
//
//   screenAngle = 180° - (longitude - ascendant)
//
//   ascendant   -> 180°  -> left      (x = cx - r)
//   +90°        ->  90°  -> bottom    (SVG y grows downward: the IC)
//   +180°       ->   0°  -> right     (the Descendant)
//   +270°       -> 270°  -> top       (the MC)
//
// PRINT IS THE PRIMARY TARGET. This wheel exists so a chart can be put on
// paper, which rules out three habits that are fine on screen: colour as the
// only carrier of meaning (aspect TYPE is a line style here, colour is
// decoration on top), hairlines that disappear at 180mm wide, and glyphs so
// small they fill in. Every stroke width below is chosen to survive a
// laser printer, not to look delicate on a retina display.

/* ── The glyphs ──────────────────────────────────────────────────────────────
   Ordinary Unicode, matching lib/symbols.js. Several of these ALSO have emoji
   presentations that Apple platforms prefer, which is why every glyph goes
   through textGlyph() below and the <text> carries font-variant-emoji — the
   same three-part fix tokens.css documents for the interface. Getting this
   wrong does not degrade quietly: "♈" arrives as a purple gradient tile. */

export const SIGN_GLYPHS = Object.freeze({
  Aries: "♈", Taurus: "♉", Gemini: "♊", Cancer: "♋",
  Leo: "♌", Virgo: "♍", Libra: "♎", Scorpio: "♏",
  Sagittarius: "♐", Capricorn: "♑", Aquarius: "♒", Pisces: "♓",
});

export const SIGN_ORDER = Object.freeze([
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
]);

export const BODY_GLYPHS = Object.freeze({
  Sun: "☉", Moon: "☽", Mercury: "☿", Venus: "♀", Mars: "♂",
  Jupiter: "♃", Saturn: "♄", Uranus: "♅", Neptune: "♆", Pluto: "♇",
  Chiron: "⚷", TrueLilith: "⚸",
});

/** Drawing order, which is also reading order in the accessible description. */
export const BODY_ORDER = Object.freeze([
  "Sun", "Moon", "Mercury", "Venus", "Mars",
  "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
  "Chiron", "TrueLilith",
]);

/** Shown as "True Lilith", never "TrueLilith" — the key is an engine name. */
export const BODY_LABELS = Object.freeze({ TrueLilith: "True Lilith" });

/**
 * Aspect line styles.
 *
 * The TYPE is carried by the dash pattern, never by the colour, so the wheel
 * survives greyscale printing and colour-blind readers with equal grace. The
 * colours are a second, redundant channel for people reading on screen.
 *
 * Conjunctions are deliberately absent: two bodies at the same longitude have
 * no line to draw between them, and the glyphs already sit side by side.
 */
export const ASPECT_STYLE = Object.freeze({
  Opposition: { dash: "", width: 2.4, colour: "#b4432f" },
  Square: { dash: "10 6", width: 2.2, colour: "#b4432f" },
  Trine: { dash: "", width: 1.6, colour: "#2f6d8c" },
  Sextile: { dash: "3 6", width: 1.6, colour: "#2f6d8c" },
});

/* ── Geometry ─────────────────────────────────────────────────────────────── */

export const WHEEL_SIZE = 1000;
export const WHEEL_CENTRE = WHEEL_SIZE / 2;

/**
 * Breathing room outside the rim, in user units.
 *
 * The ASC and MC labels sit beyond the outer circle, which put them outside a
 * 0..1000 viewBox and clipped them to nothing — invisible in the browser, and
 * invisible in a test asserting only that the text was in the markup. The
 * viewBox is widened rather than the labels moved inward, because inward is
 * where the sign glyphs already are.
 */
export const WHEEL_MARGIN = 56;

/** Ring radii, outermost first. Named so the drawing code reads as a diagram. */
export const RADII = Object.freeze({
  outer: 486,        // the rim
  signInner: 410,    // inner edge of the sign band
  tick: 396,         // degree ticks live just inside the signs
  houseInner: 336,   // inner edge of the house-number band
  bodyTick: 330,     // where a body's TRUE longitude is marked
  body: 286,         // where its glyph is drawn (may be nudged, see spread)
  aspect: 236,       // the circle aspect lines are chorded across
});

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Any angle, wrapped into [0, 360). Negative longitudes included. */
export function normalizeDegrees(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
}

/**
 * Ecliptic longitude -> angle on the drawn wheel, in degrees.
 *
 * See the orientation note at the top of this file. `ascendantLongitude` of 0
 * is the correct fallback rather than a special case: a chart with no known
 * birth time has no Ascendant to rotate to, so the wheel is drawn with 0°
 * Aries at the left and says so in words elsewhere.
 */
export function wheelAngle(longitude, ascendantLongitude = 0) {
  return normalizeDegrees(180 - (normalizeDegrees(longitude) - normalizeDegrees(ascendantLongitude)));
}

/** A point on the wheel. Angles are the wheel's own, from wheelAngle(). */
export function pointOnWheel(radius, angleDeg, cx = WHEEL_CENTRE, cy = WHEEL_CENTRE) {
  const a = angleDeg * DEG;
  return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
}

/** Two decimals is under a thousandth of the wheel — invisible, and it halves the file. */
function fixed(n) {
  return Number(n).toFixed(2).replace(/\.00$/, "");
}

function xy(radius, angleDeg) {
  const p = pointOnWheel(radius, angleDeg);
  return `${fixed(p.x)} ${fixed(p.y)}`;
}

/** The shortest signed distance from a to b on a circle, in (-180, 180]. */
export function angularDelta(a, b) {
  const d = normalizeDegrees(b - a);
  return d > 180 ? d - 360 : d;
}

/**
 * Nudge glyphs apart so a stellium is readable.
 *
 * THE PROBLEM: Sun, Mercury and Venus commonly sit within a couple of degrees
 * of each other. Drawn at their true angles the glyphs overlap into an inkblot,
 * which is the single thing most likely to make a printed wheel useless.
 *
 * THE APPROACH: relaxation. Sort by angle, then repeatedly push any pair closer
 * than `minSeparation` apart by half their deficit each, wrapping around the
 * circle. It converges quickly, treats a cluster symmetrically rather than
 * shunting it all one way, and — unlike assigning fixed slots — leaves
 * uncrowded bodies exactly where they belong.
 *
 * The true angle is kept on every result. The caller draws a tick at the true
 * position and a leader line to the nudged glyph, so the displacement is
 * visible rather than a quiet lie about where a planet was.
 *
 * Termination is not left to convergence alone: the loop is bounded, because a
 * wheel that renders slightly imperfectly beats one that hangs the page.
 *
 * WHY TEN DEGREES. It is set by the widest thing drawn at a body's angle, which
 * is not the glyph but the caption stack beneath it — the degree, and the
 * retrograde mark inward of that. Ten degrees is about 50px of arc at the glyph
 * radius and still 40px at the retrograde mark, which clears both. Eight
 * degrees cleared the glyphs and left the captions of a bottom-of-chart
 * stellium touching. Twelve bodies at ten degrees occupy a third of the
 * circle, so there is room to spare.
 */
export function spreadBodies(bodies, { minSeparation = 10, iterations = 240 } = {}) {
  const placed = bodies.map((body) => ({ ...body, angle: normalizeDegrees(body.trueAngle) }));
  if (placed.length < 2) return placed;

  // More bodies than the circle can hold at this separation would make the
  // relaxation fight itself for ever. Shrink the target instead of looping.
  const separation = Math.min(minSeparation, 360 / placed.length);

  placed.sort((a, b) => a.angle - b.angle);

  for (let pass = 0; pass < iterations; pass += 1) {
    let worst = 0;
    for (let i = 0; i < placed.length; i += 1) {
      const current = placed[i];
      const next = placed[(i + 1) % placed.length];
      // Forward gap, always positive: the wrap-around pair is not special.
      const gap = normalizeDegrees(next.angle - current.angle);
      const deficit = separation - gap;
      if (deficit > 0.001) {
        worst = Math.max(worst, deficit);
        const shift = deficit / 2;
        current.angle = normalizeDegrees(current.angle - shift);
        next.angle = normalizeDegrees(next.angle + shift);
      }
    }
    if (worst === 0) break;
    placed.sort((a, b) => a.angle - b.angle);
  }
  return placed;
}

/* ── Reading the chart ───────────────────────────────────────────────────── */

/** "13° 53′ Virgo", the same phrasing the interpretation uses. */
export function formatDegree(body) {
  if (!body) return "";
  const deg = Number.isFinite(body.degrees) ? body.degrees : 0;
  const min = Number.isFinite(body.minutes) ? String(body.minutes).padStart(2, "0") : "00";
  return `${deg}° ${min}′ ${body.sign || ""}`.trim();
}

/**
 * The number printed under a glyph: whole degrees within the sign, and nothing
 * else.
 *
 * It was "13°53′" once, and in a stellium the labels of three bodies eight
 * degrees apart overlapped into a smear — the glyphs had been spread, but their
 * captions are wider than the arc between them, so spreading the glyphs alone
 * fixed nothing. Two characters fit; six do not.
 *
 * Nothing is lost by it. The minutes, the sign and the house are all in the
 * positions table, which sits beside the wheel on screen and on the printed
 * sheet — so the wheel carries what a wheel is for (where things are, relative
 * to each other) and the table carries the precision.
 */
function shortDegree(body) {
  return `${Number.isFinite(body.degrees) ? body.degrees : 0}°`;
}

/**
 * The bodies to draw, in order, each with its true wheel angle.
 *
 * Points (Chiron, True Lilith) are included because the reading lists them, and
 * a wheel that omitted what the page discusses would be the wrong wheel. Lilith
 * here is the TRUE (osculating) apogee only — the engine also offers the mean
 * one, and two Liliths a few degrees apart reads as an error rather than as a
 * choice. That reasoning is app.js's, restated so the two stay in step.
 */
export function chartWheelBodies(chart, ascendantLongitude = 0) {
  if (!chart) return [];
  return BODY_ORDER
    .map((key) => {
      const body = chart.planets?.[key] ?? chart.points?.[key];
      if (!body || !Number.isFinite(body.longitude)) return null;
      const house = chart.planet_houses?.[key] ?? chart.point_houses?.[key] ?? null;
      return {
        key,
        label: BODY_LABELS[key] || key,
        glyph: BODY_GLYPHS[key] || "?",
        longitude: body.longitude,
        trueAngle: wheelAngle(body.longitude, ascendantLongitude),
        sign: body.sign || "",
        degrees: body.degrees,
        minutes: body.minutes,
        retrograde: Boolean(body.retrograde),
        house,
      };
    })
    .filter(Boolean);
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

function escAttr(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** The U+FE0E half of the emoji-presentation fix. See textGlyph() in app.js. */
function textGlyph(glyph) {
  const value = String(glyph ?? "");
  if (!value) return "";
  return value.endsWith("︎") ? value : `${value}︎`;
}

function line(r1, a1, r2, a2, cls) {
  const p1 = pointOnWheel(r1, a1);
  const p2 = pointOnWheel(r2, a2);
  return `<line x1="${fixed(p1.x)}" y1="${fixed(p1.y)}" x2="${fixed(p2.x)}" y2="${fixed(p2.y)}" class="${cls}"/>`;
}

function circle(r, cls) {
  return `<circle cx="${WHEEL_CENTRE}" cy="${WHEEL_CENTRE}" r="${r}" class="${cls}"/>`;
}

function glyphText(radius, angle, glyph, cls, size) {
  const p = pointOnWheel(radius, angle);
  return `<text x="${fixed(p.x)}" y="${fixed(p.y)}" class="${cls}" font-size="${size}"`
    + ` text-anchor="middle" dominant-baseline="central">${escAttr(textGlyph(glyph))}</text>`;
}

function plainText(radius, angle, text, cls, size) {
  const p = pointOnWheel(radius, angle);
  return `<text x="${fixed(p.x)}" y="${fixed(p.y)}" class="${cls}" font-size="${size}"`
    + ` text-anchor="middle" dominant-baseline="central">${escAttr(text)}</text>`;
}

/** The twelve sign sectors: dividers, glyphs, and the 5°/10° tick comb. */
function renderSigns(asc) {
  const parts = [circle(RADII.outer, "ow-rim"), circle(RADII.signInner, "ow-ring")];

  for (let i = 0; i < 12; i += 1) {
    const startLon = i * 30;
    const a = wheelAngle(startLon, asc);
    parts.push(line(RADII.outer, a, RADII.signInner, a, "ow-sign-divide"));
    // Glyph at the sector's midpoint — 15° into the sign, mid-band.
    const midAngle = wheelAngle(startLon + 15, asc);
    const midRadius = (RADII.outer + RADII.signInner) / 2;
    parts.push(glyphText(midRadius, midAngle, SIGN_GLYPHS[SIGN_ORDER[i]], "ow-sign-glyph", 42));
  }

  // A degree comb. Every 5°, longer every 10°, so a reader can count a
  // placement off the wheel instead of trusting the glyph's position.
  for (let d = 0; d < 360; d += 5) {
    const a = wheelAngle(d, asc);
    const long = d % 10 === 0;
    parts.push(line(RADII.signInner, a, long ? RADII.tick : RADII.tick + 6, a,
      long ? "ow-tick ow-tick--long" : "ow-tick"));
  }
  return parts.join("");
}

/**
 * House cusps and their numbers.
 *
 * Returns "" when the chart has no houses, which is not an edge case: a birth
 * time that was never known produces `houses: []`, and the honest wheel for
 * that chart is one with no house ring at all rather than twelve equal sectors
 * implying a precision nobody has.
 */
function renderHouses(chart, asc) {
  const houses = Array.isArray(chart?.houses) ? chart.houses : [];
  if (houses.length !== 12) return "";

  const parts = [circle(RADII.houseInner, "ow-ring")];
  houses.forEach((cusp, i) => {
    const a = wheelAngle(cusp.longitude, asc);
    // The angular cusps (1, 4, 7, 10) are the chart's spine — heavier, and
    // drawn right across to the rim so ASC/IC/DSC/MC read at a glance.
    const angular = cusp.house === 1 || cusp.house === 4 || cusp.house === 7 || cusp.house === 10;
    parts.push(line(RADII.signInner, a, RADII.aspect, a,
      angular ? "ow-cusp ow-cusp--angular" : "ow-cusp"));

    // The number sits halfway to the next cusp, which is where the house is.
    const next = houses[(i + 1) % 12];
    const span = normalizeDegrees(next.longitude - cusp.longitude) || 30;
    const midAngle = wheelAngle(cusp.longitude + span / 2, asc);
    parts.push(plainText((RADII.signInner + RADII.houseInner) / 2, midAngle,
      String(cusp.house), "ow-house-number", 26));
  });
  return parts.join("");
}

/** ASC and MC, named in words at the rim so the orientation is never a guess. */
function renderAngleLabels(chart, asc) {
  const ascendant = chart?.angles?.ascendant;
  const midheaven = chart?.angles?.midheaven;
  if (!ascendant && !midheaven) return "";
  const parts = [];
  if (ascendant && Number.isFinite(ascendant.longitude)) {
    parts.push(plainText(RADII.outer + 30, wheelAngle(ascendant.longitude, asc), "ASC", "ow-angle-label", 26));
  }
  if (midheaven && Number.isFinite(midheaven.longitude)) {
    parts.push(plainText(RADII.outer + 30, wheelAngle(midheaven.longitude, asc), "MC", "ow-angle-label", 26));
  }
  return parts.join("");
}

/**
 * Aspect lines, chorded across the inner circle.
 *
 * Only aspects BETWEEN DRAWN BODIES are rendered. The engine also aspects the
 * Ascendant and MC, which are drawn as cusps rather than as points inside the
 * wheel — a chord to a body that is not there would be a line from nowhere.
 * Those aspects are still listed in the reading; they are simply not chordable.
 */
function renderAspects(chart, asc, bodies) {
  const aspects = Array.isArray(chart?.aspects) ? chart.aspects : [];
  if (!aspects.length) return "";
  const angleOf = new Map(bodies.map((b) => [b.key, b.trueAngle]));

  const drawn = aspects
    .filter((a) => ASPECT_STYLE[a.aspect] && angleOf.has(a.a) && angleOf.has(a.b))
    .map((a) => {
      const style = ASPECT_STYLE[a.aspect];
      const p1 = pointOnWheel(RADII.aspect, angleOf.get(a.a));
      const p2 = pointOnWheel(RADII.aspect, angleOf.get(a.b));
      return `<line x1="${fixed(p1.x)}" y1="${fixed(p1.y)}" x2="${fixed(p2.x)}" y2="${fixed(p2.y)}"`
        + ` class="ow-aspect ow-aspect--${a.aspect.toLowerCase()}" stroke="${style.colour}"`
        + ` stroke-width="${style.width}"${style.dash ? ` stroke-dasharray="${style.dash}"` : ""}`
        + `><title>${escAttr(`${a.a} ${a.aspect.toLowerCase()} ${a.b}, orb ${a.orb}°`)}</title></line>`;
    });

  return `${circle(RADII.aspect, "ow-ring ow-ring--faint")}<g class="ow-aspects">${drawn.join("")}</g>`;
}

/** Body glyphs, each with a tick at its true degree and its position beneath. */
function renderBodies(placed) {
  return placed.map((body) => {
    const parts = [];
    // The tick is the truth; the glyph may have been nudged away from it.
    parts.push(line(RADII.bodyTick, body.trueAngle, RADII.bodyTick - 14, body.trueAngle, "ow-body-tick"));

    // Only draw a leader when the nudge is big enough to be worth explaining.
    if (Math.abs(angularDelta(body.trueAngle, body.angle)) > 1.5) {
      parts.push(line(RADII.bodyTick - 14, body.trueAngle, RADII.body + 26, body.angle, "ow-body-leader"));
    }

    parts.push(glyphText(RADII.body, body.angle, body.glyph, "ow-body-glyph", 38));
    parts.push(plainText(RADII.body - 30, body.angle, shortDegree(body), "ow-body-degree", 20));
    // Retrograde sits on its own line inward rather than being appended to the
    // degree, for the same reason the degree lost its minutes: width is the
    // enemy here, and "24° ℞" is nearly twice the arc of "24°".
    if (body.retrograde) {
      parts.push(plainText(RADII.body - 54, body.angle, "℞", "ow-body-retro", 19));
    }
    return `<g class="ow-body" data-body="${escAttr(body.key)}">${parts.join("")}</g>`;
  }).join("");
}

/**
 * A sentence describing the wheel for anyone who cannot see it.
 *
 * Not decoration: this is the wheel for a screen-reader user, and it is also
 * what survives when an SVG fails to load. Every body, its sign, its degree and
 * its house — the same facts the drawing carries.
 */
export function wheelDescription(chart, bodies) {
  const known = chart?.time_known !== false && Array.isArray(chart?.houses) && chart.houses.length === 12;
  const opening = known
    ? `Natal chart wheel. Ascendant in ${chart?.angles?.ascendant?.sign || "an unknown sign"}, `
      + `Midheaven in ${chart?.angles?.midheaven?.sign || "an unknown sign"}.`
    : "Natal chart wheel, drawn without houses because the birth time is not known. "
      + "Zero degrees Aries is at the left.";
  const placements = bodies
    .map((b) => `${b.label} at ${formatDegree(b)}${b.house ? ` in house ${b.house}` : ""}${b.retrograde ? ", retrograde" : ""}`)
    .join(". ");
  return `${opening} ${placements}.`;
}

/**
 * The whole wheel, as a standalone SVG string.
 *
 * `titleId`/`descId` are parameters rather than constants because a page may
 * hold more than one wheel — the print sheet and the on-screen panel can
 * coexist — and duplicate ids would break the aria references silently.
 */
export function renderChartWheel(chart, { titleId = "ow-title", descId = "ow-desc", className = "" } = {}) {
  if (!chart) return "";

  // No known birth time means no Ascendant to rotate to. Drawing from 0° Aries
  // is the honest fallback: the placements are still exactly right relative to
  // one another and to the signs, and only the houses are unavailable.
  const ascLongitude = Number.isFinite(chart?.angles?.ascendant?.longitude)
    ? chart.angles.ascendant.longitude
    : 0;

  const bodies = chartWheelBodies(chart, ascLongitude);
  const placed = spreadBodies(bodies);
  const description = wheelDescription(chart, bodies);

  const classAttr = `orbit-wheel${className ? ` ${className}` : ""}`;

  const box = `${-WHEEL_MARGIN} ${-WHEEL_MARGIN} ${WHEEL_SIZE + WHEEL_MARGIN * 2} ${WHEEL_SIZE + WHEEL_MARGIN * 2}`;

  return `<svg viewBox="${box}" class="${escAttr(classAttr)}"`
    + ` role="img" xmlns="http://www.w3.org/2000/svg"`
    + ` aria-labelledby="${escAttr(titleId)} ${escAttr(descId)}">`
    + `<title id="${escAttr(titleId)}">Natal chart wheel</title>`
    + `<desc id="${escAttr(descId)}">${escAttr(description)}</desc>`
    + renderSigns(ascLongitude)
    + renderHouses(chart, ascLongitude)
    + renderAspects(chart, ascLongitude, bodies)
    + renderBodies(placed)
    + renderAngleLabels(chart, ascLongitude)
    + `</svg>`;
}
