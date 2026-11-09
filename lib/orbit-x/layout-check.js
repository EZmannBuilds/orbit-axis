// Orbit X :: a geometric layout check for rendered slides (Dev Update 6.1).
//
// WHY THIS EXISTS. A desk post has a person looking at every slide before it
// is exported. A channel post does not, so the channel needs to know, without
// eyes, when type lands on the brand mark or on other type. Building the
// channel turned up exactly that in the shipped renderer: on fact and movement
// slides the footer metadata line is drawn across a footer-left or centred
// mark, and Celestial Editorial's vertical label crosses the positions grid.
//
// WHAT IT DOES. It walks the SVG the renderer produced, applies each group's
// translate/scale, estimates every <text> box with the same character-width
// factors templates.js fits copy with, and reports boxes that intersect the
// Orbit Axis mark or each other. Estimates, not font metrics: deterministic,
// fast, and good enough to catch a line printed on a logo. It is advisory for
// founder-reviewed families (the desk shows the findings beside the samples)
// and blocking for AI-proposed types and for every post the channel publishes.

const CHAR = Object.freeze({ serif: 0.54, sans: 0.5 });
const attr = (s, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(s);
  return m ? m[1] : null;
};

function parseTransform(t) {
  const out = { tx: 0, ty: 0, s: 1, rotated: false, rot: null };
  if (!t) return out;
  for (const m of t.matchAll(/(translate|scale|rotate)\(([^)]*)\)/g)) {
    const n = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (m[1] === "translate") { out.tx += (n[0] || 0) * out.s; out.ty += (n[1] || 0) * out.s; }
    if (m[1] === "scale") out.s *= n[0] || 1;
    if (m[1] === "rotate") { out.rotated = true; out.rot = n; }
  }
  return out;
}

function textBox(attrs, content, ctx) {
  const size = Number(attr(attrs, "font-size")) || 26;
  const x = Number(attr(attrs, "x")) || 0;
  const y = Number(attr(attrs, "y")) || 0;
  const family = /georgia|serif/i.test(attr(attrs, "font-family") || "") && !/sans/i.test(attr(attrs, "font-family") || "")
    ? "serif" : "sans";
  const spacing = Number(attr(attrs, "letter-spacing")) || 0;
  const text = content.replace(/&[a-z#0-9]+;/gi, "x");
  const width = text.length * (size * CHAR[family] + spacing);
  const anchor = attr(attrs, "text-anchor") || "start";
  let x0 = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  let box = { x0, y0: y - size * 0.75, x1: x0 + width, y1: y + size * 0.2 };
  const own = parseTransform(attr(attrs, "transform"));
  if (own.rotated && own.rot && Math.abs(Math.abs(own.rot[0]) - 90) < 1) {
    // A vertical label: rotate the box about its own pivot.
    const [, cx = x, cy = y] = own.rot;
    box = { x0: cx - (y - box.y0), y0: cy - (box.x1 - cx), x1: cx + (box.y1 - y), y1: cy - (box.x0 - cx) };
    box = { x0: Math.min(box.x0, box.x1), x1: Math.max(box.x0, box.x1), y0: Math.min(box.y0, box.y1), y1: Math.max(box.y0, box.y1) };
  } else if (own.rotated) {
    return null;
  }
  return { x0: box.x0 * ctx.s + ctx.tx, x1: box.x1 * ctx.s + ctx.tx, y0: box.y0 * ctx.s + ctx.ty, y1: box.y1 * ctx.s + ctx.ty,
    text: text.slice(0, 40), size: size * ctx.s };
}

const overlap = (a, b, pad = 0) => a.x0 < b.x1 - pad && b.x0 < a.x1 - pad && a.y0 < b.y1 - pad && b.y0 < a.y1 - pad;

/**
 * @param {string} svg one rendered slide
 * @returns {Array<{ kind: "text_on_mark"|"text_on_text", a: string, b?: string }>}
 */
export function layoutCollisions(svg) {
  const texts = [];
  const marks = [];
  const stack = [{ tx: 0, ty: 0, s: 1, rotated: false }];
  const re = /<g\b([^>]*)>|<\/g>|<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  for (const m of String(svg).matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith("</g")) { if (stack.length > 1) stack.pop(); continue; }
    if (m[0].startsWith("<g")) {
      const t = parseTransform(attr(m[1], "transform"));
      const ctx = { tx: top.tx + t.tx * top.s, ty: top.ty + t.ty * top.s, s: top.s * t.s, rotated: top.rotated || t.rotated };
      stack.push(ctx);
      if (/aria-label="Orbit Axis"/.test(m[1])) {
        // The compact mark: a ring of radius 35 at (64, 64) crossed by the
        // axis from (37, 115) to (91, 13), in its own 128-unit box.
        marks.push({ x0: ctx.tx + 25 * ctx.s, y0: ctx.ty + 10 * ctx.s, x1: ctx.tx + 105 * ctx.s, y1: ctx.ty + 118 * ctx.s });
      }
      continue;
    }
    if (top.rotated) continue;
    const content = String(m[3] || "").replace(/<[^>]+>/g, "").trim();
    if (!content) continue;
    const box = textBox(m[2], content, top);
    if (box) texts.push(box);
  }
  const found = [];
  for (const t of texts) {
    for (const mark of marks) if (overlap(t, mark, 2)) found.push({ kind: "text_on_mark", a: t.text });
  }
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      // Small labels inside one strip row legitimately sit close; only report
      // a real crossing (a few pixels of genuine overlap).
      if (overlap(texts[i], texts[j], 4)) found.push({ kind: "text_on_text", a: texts[i].text, b: texts[j].text });
    }
  }
  return found;
}

/** Collisions across a whole rendered post, labelled by slide. */
export function postCollisions(rendered) {
  return (rendered?.slides || []).flatMap((slide, i) =>
    layoutCollisions(slide.svg).map((c) => `slide ${i + 1}: ${c.kind === "text_on_mark" ? `"${c.a}" overlaps the Orbit Axis mark` : `"${c.a}" overlaps "${c.b}"`}`));
}
