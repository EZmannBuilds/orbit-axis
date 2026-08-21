// Orbit Axis :: the saved chart export.
//
// The export is a FILE SOMEONE KEEPS, in the product's own night-sky palette —
// not a printout. It runs through @media print because that is the pipeline
// "Save as PDF" uses, and nothing more should be read into the name.
//
// Structural facts a source read can establish, in the spirit of
// tarot-surface.test.js. What a stylesheet actually DOES cannot be proved from
// here; that took a headless browser, which is how every defect below was
// found. What can be pinned is that each fix is still present, because all of
// them are invisible on screen and silent when they break.
//
// THE FOUR, each of which produced a plausible-looking document that was
// wrong or incomplete:
//
//   1. The chart panel carries a SECOND, legacy palette set on #panel-me
//      itself, which the --color-* tokens cannot reach.
//   2. Simple is the DEFAULT detail level and hides the positions table, the
//      exact degrees and the calculation metadata — so the "full chart" file
//      quietly had no chart data in it.
//   3. A closed <details> cannot be opened from CSS, so the table exported as
//      its summary line alone.
//   4. Without print-color-adjust the browser drops every background as
//      "economy", and the whole design evaporates into pale text on white.
//
// None of them produced an error, a warning, or a visibly broken page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../lib/local-llm/config.js";

const read = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8");
const INDEX = read("public/index.html");
const PRINT_CSS = read("public/styles/print.css");
const WHEEL_CSS = read("public/styles/chart-wheel.css");
const APP_JS = read("public/app.js");

/* ── Wiring ───────────────────────────────────────────────────────────────── */

test("the print stylesheet is linked last, so it can override without !important", () => {
  const sheets = [...INDEX.matchAll(/<link rel="stylesheet" href="\/styles\/([a-z-]+)\.css"/g)]
    .map((m) => m[1]);
  assert.ok(sheets.includes("print"), "print.css must be linked");
  assert.equal(sheets[sheets.length - 1], "print",
    `print.css must be the last stylesheet; it is followed by ${sheets.slice(sheets.indexOf("print") + 1).join(", ")}`);
  assert.ok(sheets.includes("chart-wheel"), "chart-wheel.css must be linked");
});

test("nothing in the print stylesheet escapes onto the screen", () => {
  // Every declaration must sit inside the single @media print block. A rule
  // that leaked would restyle the live app, which is the one thing this file
  // must never do.
  // Comments stripped first: the file's own header talks ABOUT @media print,
  // and counting that would be counting prose.
  const code = PRINT_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal((code.match(/@media/g) || []).length, 1, "expected exactly one @media block");
  const before = code.slice(0, code.indexOf("@media print {"));
  assert.equal(before.trim(), "",
    "every declaration must be inside @media print, or it restyles the live app");
});

test("the export button exists, starts hidden, and is not in the file itself", () => {
  assert.match(INDEX, /id="me-export-pdf"[^>]*hidden/,
    "the button must start hidden — an export button above a placeholder saves nothing");
  assert.ok(PRINT_CSS.includes("#me-export-pdf"), "the button must not appear in the export");
});

test("the wheel has a section on the page and is rendered from the tested module", () => {
  assert.match(INDEX, /id="section-wheel"/);
  assert.match(INDEX, /id="chart-wheel"/);
  assert.match(APP_JS, /import \{ renderChartWheel \} from "\.\/chart-wheel\.js"/);
  assert.match(APP_JS, /renderChartWheelPanel\(chart\)/);
});

/* ── Defect 1: the second palette ─────────────────────────────────────────── */

test("the legacy panel palette is set explicitly for the export", () => {
  // features.css sets --text/--muted/--border/--accent ON #panel-me, and only
  // supplies light values under :root[data-theme="light"]. Re-pointing the
  // --color-* tokens does not reach them: different names, higher specificity.
  // Left alone they decide most of the document, and a reader in light mode
  // would export the light palette onto the dark canvas.
  const features = read("public/styles/features.css");
  assert.match(features, /#panel-me[^{]*\{[^}]*--text:\s*#e6e9ff/,
    "this test exists because features.css sets a hardcoded --text on #panel-me");

  const block = PRINT_CSS.slice(PRINT_CSS.indexOf("#panel-me,"), PRINT_CSS.indexOf("#panel-me,") + 900);
  assert.ok(PRINT_CSS.includes("#panel-me,"), "print.css must target #panel-me directly");
  for (const name of ["--text", "--muted", "--border", "--accent", "--surface", "--bg"]) {
    assert.match(block, new RegExp(`${name}:`), `${name} must be set for the export`);
  }
  // Both themes are named, so the export does not depend on which one the
  // reader happens to be in.
  assert.ok(PRINT_CSS.includes(':root[data-theme="light"] #panel-me')
    && PRINT_CSS.includes(':root[data-theme="dark"] #panel-me'),
    "the export must not depend on the reader's theme");
});

/* ── Defect 2: the full chart ─────────────────────────────────────────────── */

test("the saved chart is the full one, whatever the on-screen detail level", () => {
  // Simple is the DEFAULT — the rule is :root:not([data-detail="Advanced"]) —
  // and it hides the positions table, the exact degrees and the calculation
  // metadata. Without this override the export silently omits all of it.
  const orbit = read("public/styles/orbit-axis.css");
  assert.match(orbit, /:root:not\(\[data-detail="Advanced"\]\) #panel-me \.me-panel--advanced \{ display: none; \}/,
    "this test exists because Simple hides the advanced panel by default");

  assert.ok(PRINT_CSS.includes(".me-panel--advanced"),
    "print.css must re-show the advanced panel");
  assert.ok(PRINT_CSS.includes(".advanced-only"),
    "print.css must re-show inline advanced detail such as exact degrees");
  const rule = PRINT_CSS.slice(PRINT_CSS.indexOf(':root[data-detail="Simple"] #panel-me .advanced-only'));
  assert.match(rule.slice(0, 400), /display:\s*revert/,
    "the advanced content must be restored, not merely mentioned");
});

/* ── Defect 3: folded sections ────────────────────────────────────────────── */

test("folded sections are opened by script, because CSS cannot open them", () => {
  // A closed <details> hides its content through the user-agent shadow tree,
  // so `details > *:not(summary) { display: revert }` looks like a fix and does
  // nothing. The positions table printed as its summary line alone.
  assert.match(APP_JS, /function openDisclosuresForPrint\(\)/);
  assert.match(APP_JS, /#panel-me details:not\(\[open\]\)/);
  assert.match(APP_JS, /addEventListener\?\.\("beforeprint", openDisclosuresForPrint\)/);
  assert.match(APP_JS, /addEventListener\?\.\("afterprint", restoreDisclosuresAfterPrint\)/);
  assert.match(APP_JS, /bindPrintHooks\(\);/, "the hooks must actually be bound");

  // And the stylesheet must not claim to do it, or the next reader will delete
  // the JavaScript as redundant.
  assert.ok(!/details\s*>\s*\*:not\(summary\)\s*\{[^}]*display:\s*revert/.test(PRINT_CSS),
    "print.css must not pretend a display rule can open a <details>");
});

test("only sections the export opened are folded back afterwards", () => {
  // A reader who had already expanded the table should find it still expanded.
  assert.match(APP_JS, /disclosuresOpenedForPrint/);
  assert.match(APP_JS, /disclosuresOpenedForPrint\.clear\(\)/);
});

/* ── The look ─────────────────────────────────────────────────────────────── */

test("the export is the Orbit night sky, whatever theme the reader is in", () => {
  // This is a file someone keeps and sends on, so it looks like the product
  // rather than like a setting. It is NOT a printout: the canvas is void
  // black, full bleed.
  assert.match(PRINT_CSS, /@page\s*\{[^}]*margin:\s*0/,
    "a zero page margin is what lets the dark canvas reach the edge");
  assert.match(PRINT_CSS, /background:\s*#080a12/, "the canvas is Orbit's void black");
  assert.ok(PRINT_CSS.includes(':root[data-theme="light"]'),
    "a reader in light mode must still get the night-sky export");
});

test("backgrounds are forced, or the export arrives as pale text on white", () => {
  // Browsers drop backgrounds as "economy" by default. print-color-adjust is
  // an INHERITED property, so declaring it on :root carries the dark canvas
  // through every descendant — without it this whole design evaporates.
  const root = PRINT_CSS.slice(PRINT_CSS.indexOf(":root {"), PRINT_CSS.indexOf(":root {") + 400);
  assert.match(root, /print-color-adjust:\s*exact/,
    "print-color-adjust: exact must be set on :root so it inherits everywhere");
  assert.match(root, /-webkit-print-color-adjust:\s*exact/,
    "the prefixed property is still what Safari reads");
});

test("navigation and controls do not print", () => {
  for (const selector of [".chart-subnav", ".chart-switcher", ".o-btn", ".me-status"]) {
    assert.ok(PRINT_CSS.includes(selector), `${selector} must not appear in the export`);
  }
});

test("only the chart panel prints", () => {
  assert.match(PRINT_CSS, /\.workspace-panel:not\(#panel-me\)\s*\{\s*display:\s*none/,
    "a single-page app has every other panel in the document too");
});

test("the wheel gets a page to itself", () => {
  // The cover's height varies with the birth data, the limitation notice and
  // the chart-details rows, so a wheel sized to fit underneath it on one chart
  // is a wheel half off the page on another.
  const rule = PRINT_CSS.slice(PRINT_CSS.indexOf("#section-wheel {"));
  assert.match(rule.slice(0, 900), /break-before:\s*page/);
  assert.match(rule.slice(0, 900), /break-after:\s*page/);
});

test("the wheel takes the one shadow the design system has", () => {
  // DESIGN_SYSTEM.md: exactly one drop shadow, and it belongs to the chart
  // wheel and the Moon — objects resting on a surface, not interface. Cards
  // never take it.
  assert.match(WHEEL_CSS, /\.orbit-wheel\b[^}]*drop-shadow/s,
    "the wheel is one of the two things entitled to the shadow");
  const cards = PRINT_CSS.slice(PRINT_CSS.indexOf(".reading-card,"), PRINT_CSS.indexOf(".reading-card,") + 500);
  assert.ok(!/box-shadow:\s*[^n]/.test(cards), "cards must not take a shadow");
});

test("the wheel stylesheet uses tokens that exist", () => {
  // The first version of both stylesheets used --color-text-primary and
  // friends, which appear nowhere in tokens.css. They overrode nothing, and
  // the headings printed pale grey on white.
  const tokens = read("public/styles/tokens.css");
  const used = new Set([...`${WHEEL_CSS}${PRINT_CSS}`.matchAll(/var\((--color-[a-z-]+)/g)].map((m) => m[1]));
  assert.ok(used.size > 0, "expected the stylesheets to use design tokens");
  for (const name of used) {
    assert.ok(tokens.includes(`${name}:`), `${name} is used but defined nowhere in tokens.css`);
  }
});

test("the table repeats its header across a page break", () => {
  assert.match(PRINT_CSS, /thead\s*\{\s*display:\s*table-header-group/,
    "a second page of numbers with no column names is unreadable");
});

/* ── The native app ───────────────────────────────────────────────────────── */

test("the app does not offer a button that silently does nothing", () => {
  // window.print exists inside an iOS WKWebView and is inert, so a feature test
  // passes and the button dies quietly. The platform is asked instead.
  assert.match(APP_JS, /function exportChartAsPdf\(\)/);
  const fn = APP_JS.slice(APP_JS.indexOf("function exportChartAsPdf()"));
  assert.match(fn.slice(0, 700), /isNativeApp\(\)/,
    "the native app must be detected rather than feature-tested");
  assert.match(APP_JS, /import \{[^}]*isNativeApp[^}]*\} from "\.\/platform\.js"/,
    "isNativeApp must actually be imported");
});
