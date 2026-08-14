// Orbit Axis :: compatibility served-surface contract (Dev Update 1.11).
//
// The endpoint suite boots the route and the scoring suite holds the numbers.
// This one pins the browser-side wiring that a real browser pass depended on,
// so a refactor that quietly undoes it fails in CI rather than in a manual
// pass nobody re-ran.
//
// EVERY ASSERTION HERE EXISTS BECAUSE THE BROWSER PASS FOUND THE BUG FIRST.
// None of them was written from imagination, and the comments say which defect
// each one is standing guard over. Reading source cannot prove behaviour — see
// the header of client-references.test.js — so this file deliberately covers
// only structural facts that a source read CAN establish.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const HTML = readFileSync(join(ROOT, "public", "index.html"), "utf8");
const APP = readFileSync(join(ROOT, "public", "app.js"), "utf8");
const CSS = readFileSync(join(ROOT, "public", "styles", "compatibility.css"), "utf8");

// ── The boot-order defect ───────────────────────────────────────────────────

test("compatibility re-renders once the session is restored", () => {
  // renderRoute() runs during boot, BEFORE restoreSession(). A refresh landing
  // directly on #compatibility therefore rendered "Sign in to compare your
  // saved charts" to a fully signed-in user and never corrected itself.
  //
  // Dev Update 1.8 hit this exact bug on #transits and added
  // refreshSecondaryRoute() for it. 1.11 reintroduced it by adding a new
  // secondary destination and not registering it there. Observed in a browser:
  // the API returned six charts while the panel said sign in.
  const fn = APP.slice(APP.indexOf("function refreshSecondaryRoute"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /id === "compatibility"/,
    "compatibility must re-render after restoreSession, or a refresh strands a signed-in user");
  assert.match(body, /loadCompatibility\(\)/);
});

// ── The self-mode titling defect ────────────────────────────────────────────

test("self mode retitles the visible heading, not only the tab", () => {
  // Self mode must be titled "Self Pattern Comparison": nobody is in a
  // relationship with themselves, and a page headed "Compatibility" over two
  // of your own charts says they are.
  //
  // The first pass set document.title correctly and left the <h1> alone, so
  // the tab read "Self Pattern Comparison" while the heading under it still
  // read "Compatibility".
  assert.match(APP, /\$\("#compatibility-title"\)\.textContent = c\.framing\.title/,
    "the visible <h1> must take the mode's title");
  // And it must reset, or a self comparison leaves its title standing over the
  // next, unrun page.
  assert.match(APP, /\$\("#compatibility-title"\)\.textContent = "Compatibility"/,
    "the heading must reset when the panel reloads");
});

// ── The heading-outline defect ──────────────────────────────────────────────

test("category names are real headings", () => {
  // With the label as a <span>, the outline jumped from "Every area, with its
  // evidence" (h2) straight to "What supports this" (h4). The category names
  // were absent from a screen reader's heading list entirely, so there was no
  // way to move between areas. Found by walking heading levels in a browser.
  assert.match(APP, /<h3 class="compat-category__label">/,
    "the category label must be an h3 so the heading outline has no gap");
  assert.match(APP, /<h4 class="compat-evidence__title">/,
    "evidence titles sit one level below the category they belong to");
});

// ── Width discipline, twice burned ──────────────────────────────────────────

test("the layout cannot be widened by its own content", () => {
  // 1.10 shipped a 375px page that grew to 522px on long <select> option
  // labels; 1.10.1 pushed one to 921px on a single unbroken token. Both were a
  // grid child refusing to shrink below its content.
  assert.match(CSS, /\.compat-picker__select\s*\{[^}]*min-width:\s*0/s,
    "a long option label must not set the page width");
  assert.match(CSS, /\.compat-status\s*\{[^}]*overflow-wrap:\s*anywhere/s,
    "an unbroken token in the status line must wrap, not widen the page");
  // Every multi-column track must be minmax(0, 1fr); a bare 1fr defaults to
  // min-width auto and reintroduces the bug.
  const tracks = CSS.match(/grid-template-columns:[^;]+;/g) || [];
  assert.ok(tracks.length > 0);
  for (const t of tracks) {
    assert.ok(!/(^|[\s(])1fr/.test(t.replace(/minmax\(0,\s*1fr\)/g, "")),
      `bare 1fr track reintroduces the width bug: ${t.trim()}`);
  }
});

// ── The served surface the browser pass drove ───────────────────────────────

test("the panel ships the states the interface depends on", () => {
  assert.match(HTML, /id="panel-compatibility"/);
  assert.match(HTML, /id="compat-status"[^>]*role="status"[^>]*aria-live="polite"/,
    "one live region must announce loading, empty, refusal and error alike");
  // Both selects need a real <label for>, not a placeholder option.
  for (const id of ["compat-subject", "compat-other"]) {
    assert.match(HTML, new RegExp(`<label[^>]*for="${id}"`), `${id} needs a real label`);
  }
  assert.match(HTML, /aria-labelledby="compatibility-title"/);
});

test("compatibility is reachable without a new navigation system", () => {
  // It is a secondary destination in the existing registry. It used to be
  // entered from Tools; now it is entered from Chart, beside the saved charts
  // it compares — which is where someone is standing when they want it.
  assert.match(APP, /\{ id: "compatibility", label: "Compatibility"[^}]*primary: false, tab: "me" \}/,
    "compatibility must be a secondary workspace that lights the Chart tab");
  const chart = HTML.slice(HTML.indexOf('id="panel-me"'), HTML.indexOf('id="panel-compatibility"'));
  assert.match(chart, /href="#compatibility"/, "Chart must offer a way in");
  assert.match(chart, /Compare two charts/, "and it must say what it does");
});

test("the browser composes no interpretation of its own", () => {
  // Same rule as the reading and the transits: the server writes every
  // sentence. Two places composing the same evidence is how a product grows a
  // second opinion about itself.
  const start = APP.indexOf("/* ── Compatibility (Dev Update 1.11)");
  assert.ok(start > -1, "the compatibility block is missing");
  const block = APP.slice(start, APP.indexOf("/* ── Toasts", start));
  assert.ok(block.length > 500);

  // No thresholds, no band names, no scoring arithmetic in the client.
  for (const banned of [
    /\bBANDS\b/, /Strongly Supportive/, /Growth-Heavy/, /Highly Challenging/,
    /Closely Aligned/, /Strongly Divergent/,
  ]) {
    assert.ok(!banned.test(block),
      `the client names a band or threshold (${banned}) — that belongs to lib/compatibility/weights.js alone`);
  }
  // The disclaimer is rendered from the server's methodology note rather than
  // retyped, so the two can never drift apart.
  assert.match(block, /c\.methodology\.note/);
  assert.ok(!/not guaranteed relationship outcomes/.test(block),
    "the disclaimer must come from the server, not a second copy in the client");
});

test("every text value rendered into markup is escaped", () => {
  // Chart nicknames are user-supplied and land in innerHTML, so an unescaped
  // one is stored XSS against the person's own account. The server's authored
  // copy is escaped too — not because the corpus is hostile, but because
  // "escape everything that becomes markup" is a rule you can actually check,
  // and "escape the untrusted ones" is a judgement call that eventually goes
  // wrong.
  //
  // Only interpolations that land in MARKUP count. `document.title = ...` and
  // `el.className = ...` assign to text properties and are not injection
  // sites; an earlier version of this test flagged them and was pure noise.
  const start = APP.indexOf("/* ── Compatibility (Dev Update 1.11)");
  const block = APP.slice(start, APP.indexOf("/* ── Toasts", start));

  const TEXT_FIELDS = /\.(name|label|summary|question|headline|roles|technical|body|note|subtitle)\b/;
  const offenders = [];
  const re = /\$\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(block))) {
    const expr = m[1];
    if (!TEXT_FIELDS.test(expr)) continue;
    if (/\besc\(/.test(expr)) continue;
    // Markup context: the nearest preceding characters open an HTML tag.
    const before = block.slice(Math.max(0, m.index - 200), m.index);
    if (!/<[a-z][^>]*$|<[a-z][\s\S]*>[^<]*$/i.test(before)) continue;
    offenders.push(expr.trim().slice(0, 60));
  }
  assert.deepEqual(offenders, [],
    `unescaped text interpolated into compatibility markup: ${offenders.join(" | ")}`);

  // And the escaper is genuinely in use, so the scan above is not vacuous.
  assert.ok((block.match(/esc\(/g) || []).length > 15,
    "esc() is barely used — the escaping scan would pass on markup that has none");
});
