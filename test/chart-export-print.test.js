// Orbit Axis :: the printed chart export.
//
// Structural facts a source read can establish, in the spirit of
// tarot-surface.test.js. What a stylesheet DOES on paper cannot be proved from
// here — that took a headless browser and a print preview, which is how the
// three defects below were found in the first place. What can be pinned is
// that each fix is still present, because every one of them is invisible on
// screen and silent when it breaks.
//
// THE THREE, all of which shipped a plausible-looking page with something
// missing from the PDF:
//
//   1. The chart panel carries a SECOND, legacy palette hardcoded dark. A
//      reader in dark mode printed near-white text onto white paper.
//   2. Simple is the default detail level and hides the positions table, the
//      exact degrees and the calculation metadata — so the "full chart" PDF
//      quietly had no data in it.
//   3. A closed <details> cannot be opened from CSS, so the table printed as
//      its summary line alone.
//
// None of the three produced an error, a warning, or a visibly broken page.

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

test("the export button exists, starts hidden, and does not print itself", () => {
  assert.match(INDEX, /id="me-export-pdf"[^>]*hidden/,
    "the button must start hidden — an export button above a placeholder saves nothing");
  assert.ok(PRINT_CSS.includes("#me-export-pdf"), "the button must be hidden on paper");
});

test("the wheel has a section on the page and is rendered from the tested module", () => {
  assert.match(INDEX, /id="section-wheel"/);
  assert.match(INDEX, /id="chart-wheel"/);
  assert.match(APP_JS, /import \{ renderChartWheel \} from "\.\/chart-wheel\.js"/);
  assert.match(APP_JS, /renderChartWheelPanel\(chart\)/);
});

/* ── Defect 1: the second palette ─────────────────────────────────────────── */

test("the legacy panel palette is overridden for print", () => {
  // features.css sets --text/--muted/--border/--accent ON #panel-me, hardcoded
  // dark, with light values only under :root[data-theme="light"]. Re-pointing
  // the --color-* tokens does not reach them: different names, higher
  // specificity. A dark-mode reader printed near-white text on white paper.
  const features = read("public/styles/features.css");
  assert.match(features, /#panel-me[^{]*\{[^}]*--text:\s*#e6e9ff/,
    "this test exists because features.css hardcodes a dark --text on #panel-me");

  const block = PRINT_CSS.slice(PRINT_CSS.indexOf("#panel-me,"));
  assert.ok(PRINT_CSS.includes("#panel-me,"), "print.css must target #panel-me directly");
  for (const name of ["--text", "--muted", "--border", "--accent", "--surface", "--bg"]) {
    assert.match(block.slice(0, 900), new RegExp(`${name}:`),
      `${name} must be re-pointed for paper`);
  }
  assert.match(block.slice(0, 900), /--text:\s*#000000/, "--text must be black on paper");
});

/* ── Defect 2: the full chart ─────────────────────────────────────────────── */

test("the printed chart is the full one, whatever the on-screen detail level", () => {
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

/* ── Paper ────────────────────────────────────────────────────────────────── */

test("the page is set up for paper, not for a screen", () => {
  assert.match(PRINT_CSS, /@page\s*\{[^}]*margin:/, "a printed page needs margins");
  assert.match(PRINT_CSS, /background:\s*#ffffff/, "paper is white whatever the theme");
  // The theme cannot be allowed to survive into the printer.
  assert.ok(PRINT_CSS.includes(':root[data-theme="dark"]'),
    "the dark theme's tokens must be overridden explicitly");
});

test("navigation and controls do not print", () => {
  for (const selector of [".chart-subnav", ".chart-switcher", ".o-btn", ".me-status"]) {
    assert.ok(PRINT_CSS.includes(selector), `${selector} must be hidden on paper`);
  }
});

test("only the chart panel prints", () => {
  assert.match(PRINT_CSS, /\.workspace-panel:not\(#panel-me\)\s*\{\s*display:\s*none/,
    "a single-page app has every other panel in the document too");
});

test("the wheel keeps its ink on paper", () => {
  // print-color-adjust, or the browser drops the aspect strokes as decoration.
  assert.match(PRINT_CSS, /print-color-adjust:\s*exact/);
  // And the structural strokes are restated in black rather than left to a
  // theme token that means something else on paper.
  for (const cls of [".ow-rim", ".ow-body-glyph", ".ow-cusp--angular"]) {
    assert.ok(PRINT_CSS.includes(cls), `${cls} needs a paper colour`);
  }
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
