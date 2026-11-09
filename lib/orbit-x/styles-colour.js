// Orbit X :: colour helpers shared by the styled families and their assets
// (Dev Update 6.2). Pure arithmetic: luminance, WCAG contrast, mixing.


const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export function luminance(hex) {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
export function mix(a, b, t) {
  const p = (h) => { const s = h.replace("#", ""); const n = parseInt(s, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const [x, y] = [p(a), p(b)];
  return `#${[0, 1, 2].map((i) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, "0")).join("")}`;
}
/** Large text per WCAG: 24px regular or 18.66px bold and up. */
export const isLargeText = (size, weight) => size >= 24 || (weight >= 700 && size >= 18.66);
export const requiredContrast = (size, weight) => (isLargeText(size, weight) ? 3 : 4.5);


/** A muted text colour for `bg`: the ink eased toward the page as far as it
 *  can go while still clearing 4.5:1, so small secondary text stays legible. */
export function softOf(ink, bg) {
  for (const t of [0.36, 0.3, 0.24, 0.18, 0.12, 0.06]) {
    const c = mix(ink, bg, t);
    if (contrastRatio(c, bg) >= 4.6) return c;
  }
  return ink;
}
