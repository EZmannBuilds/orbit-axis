// Orbit X :: the profile grid preview (Dev Update 6.2).
//
// Instagram's profile shows posts newest first, three across, each cropped to
// a 3:4 tile. A reviewer choosing among templates needs to see that rhythm,
// not one slide at a time, so this builds the 3x3 the next nine posts would
// make. The same tiles feed the desk panel and a standalone HTML page.

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** An SVG that fills its tile and crops like the profile does. */
export function coverFit(svg) {
  return String(svg).replace(/^<svg /, '<svg preserveAspectRatio="xMidYMid slice" ').replace(/ width="\d+" height="\d+"/, "");
}

/**
 * @param {Array<{ svg: string, label?: string, note?: string }>} tiles newest first, up to 9
 * @param {object} [opts] { title, subtitle }
 */
export function gridPage(tiles, { title = "Profile grid preview", subtitle = "" } = {}) {
  const cells = Array.from({ length: 9 }, (_, i) => tiles[i]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${esc(title)}</title><style>`
    + `body{margin:0;background:#fafafa;color:#1b1b1b;font:15px/1.45 -apple-system,"Helvetica Neue",Arial,sans-serif}`
    + `main{max-width:720px;margin:0 auto;padding:28px 16px 40px}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#555}`
    + `.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;background:#fafafa}`
    + `.tile{aspect-ratio:3/4;overflow:hidden;background:#e8e8e8;position:relative}`
    + `.tile svg{display:block;width:100%;height:100%}`
    + `.tile small{position:absolute;left:6px;bottom:6px;padding:1px 6px;border-radius:9px;background:rgba(255,255,255,.88);color:#222;font-size:11px}`
    + `.empty{display:flex;align-items:center;justify-content:center;color:#999;font-size:12px}`
    + `</style></head><body><main><h1>${esc(title)}</h1><p>${esc(subtitle)}</p><div class="grid">`
    + cells.map((t) => (t ? `<div class="tile">${coverFit(t.svg)}${t.label ? `<small>${esc(t.label)}</small>` : ""}</div>`
      : `<div class="tile empty">nothing queued</div>`)).join("")
    + `</div></main></body></html>`;
}
