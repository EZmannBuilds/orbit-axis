// The mobile redesign's contract, pinned.
//
// The Chart page at a phone width was one ~11,000px document with Compare at
// the very bottom of it. These tests hold the shape that replaced it: three
// chart views a tap apart, progressive disclosure for the heavy sections, a
// dense saved-chart list, and a document that never scrolls sideways.
//
// DOM-level where the behaviour lives in markup, source-level only where the
// behaviour is a render-time decision that static HTML cannot show.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../lib/local-llm/config.js";

const HTML = readFileSync(join(REPO_ROOT, "public", "index.html"), "utf8");
const APP = readFileSync(join(REPO_ROOT, "public", "app.js"), "utf8");
const APP_CSS = readFileSync(join(REPO_ROOT, "public", "styles", "app.css"), "utf8");
const COMPONENTS_CSS = readFileSync(join(REPO_ROOT, "public", "styles", "components.css"), "utf8");
const FEATURES_CSS = readFileSync(join(REPO_ROOT, "public", "styles", "features.css"), "utf8");
const ATLAS_CSS = readFileSync(join(REPO_ROOT, "public", "styles", "symbol-atlas.css"), "utf8");

// ── Chart navigation ────────────────────────────────────────────────────────

test("the three chart views exist as navigation links, not a tablist", () => {
  const subnavs = HTML.match(/<nav class="chart-subnav"[^>]*>/g) || [];
  assert.ok(subnavs.length >= 3, "each chart panel carries the views nav");
  for (const nav of subnavs) {
    assert.match(nav, /aria-label="Chart views"/);
  }
  // Links that navigate, with aria-current managed at route time — never a
  // role="tablist" wrapped around URL navigation.
  assert.ok(!/chart-subnav[^>]*role="tablist"/.test(HTML), "no tablist semantics on navigation");
  for (const view of ["#me", "#saved-charts", "#compatibility"]) {
    assert.ok(HTML.includes(`href="${view}"`), `${view} reachable from the subnav`);
  }
});

test("saved charts is a real route under the Chart tab", () => {
  assert.ok(HTML.includes('id="panel-saved-charts"'), "the panel exists");
  assert.match(APP, /id: "saved-charts"[^}]*tab: "me"/,
    "the workspace registry keeps Chart as the primary tab for it");
  assert.match(APP, /if \(id === "saved-charts"\) loadSavedCharts\(\)/,
    "a direct link or reload loads its data on arrival");
});

test("the subnav announces the current view with aria-current", () => {
  assert.match(APP, /\.chart-subnav a[\s\S]{0,200}aria-current/,
    "renderRoute sets aria-current on the matching link");
});

test("compare is not also buried at the bottom of the reading", () => {
  assert.ok(!HTML.includes("compat-entry"),
    "the old bottom-of-page Compare entry is gone; the subnav is the way in");
});

test("compatibility lost its duplicate heading and its Back button", () => {
  assert.ok(!HTML.includes("Back to your chart</a>"), "the Back button is gone");
  assert.match(HTML, /id="compatibility-title"[^>]*tabindex/,
    "the H1 still exists for assistive technology");
  assert.match(HTML, /class="u-title sr-only-mobile" id="compatibility-title"/,
    "on a phone it yields its pixels without leaving the document");
});

// ── Progressive disclosure ──────────────────────────────────────────────────

test("placements render as native disclosure rows, folded on mobile", () => {
  assert.match(APP, /function placementRowHtml/);
  assert.match(APP, /<details class="o-disclosure-row reading-row" data-desktop-open>/,
    "each placement is a details row");
  assert.match(APP, /function applyDisclosureDefaults/,
    "desktop opens them at render time; mobile starts folded");
  assert.match(APP, /min-width: 641px/,
    "the boundary matches the mobile breakpoint");
});

test("the collapsed placement row reads without the glyph", () => {
  // Name + sign in the title, degree/house/retrograde in the sub — the glyph
  // is aria-hidden decoration, so the words must carry everything.
  assert.match(APP, /o-flat-row__title">\$\{esc\(placement\.planet\)\}\$\{placement\.sign \? ` in \$\{esc\(placement\.sign\)\}` : ""\}/);
  assert.match(APP, /placement\.retrograde \? "Retrograde" : ""/);
});

test("chart data is folded on mobile and its table scrolls locally", () => {
  assert.match(APP, /<details class="chart-details" data-desktop-open>/,
    "no unconditional open attribute any more");
  assert.match(APP, /table-scroll" role="region" aria-label="Calculated positions table" tabindex="0"/,
    "the wide table is a labelled, keyboard-reachable scroll region");
});

// ── Saved charts ────────────────────────────────────────────────────────────

test("saved charts are rows with one visible action and a labelled menu", () => {
  assert.match(APP, /class="saved-chart-row"/);
  assert.match(APP, /aria-label="Actions for \$\{esc\(nickname\)\}"/,
    "the overflow trigger names its chart");
  assert.match(APP, /aria-haspopup="true" aria-expanded="false"/);
  // The active chart states its state in words and does not offer Set active.
  assert.match(APP, /· Active<\/span>/);
  assert.match(APP, /chart\.is_active \? "" : `<button[^`]*data-action="activate"/);
  // Delete stays behind the menu and behind its confirmation.
  assert.match(APP, /o-rowmenu__item--danger" data-action="delete"/);
  assert.match(APP, /dataset\.action === "delete"[\s\S]{0,400}confirmDialog/);
});

test("row menus dismiss on Escape and return focus to their trigger", () => {
  assert.match(APP, /function wireRowMenus/);
  assert.match(APP, /key !== "Escape"[\s\S]{0,300}openTrigger\.focus\(\)/);
});

// ── Signed-out chart ────────────────────────────────────────────────────────

test("signed out, the chart offers one primary create action", () => {
  const block = APP.slice(APP.indexOf("function renderSavedCharts"), APP.indexOf("function wireRowMenus"));
  const signedOut = block.slice(block.indexOf("authSignedIn()"), block.indexOf("chartsStatus"));
  const ctas = signedOut.match(/o-btn--primary/g) || [];
  assert.equal(ctas.length, 1, "exactly one primary CTA in the signed-out state");
});

// ── Responsive width ────────────────────────────────────────────────────────

test("the universal search cannot widen the document", () => {
  assert.match(COMPONENTS_CSS, /\.o-search \{[^}]*min-width: 0/,
    "the flex container releases its intrinsic minimum");
  assert.match(APP_CSS, /\.o-find__field:not\(:focus-within\) \.o-input \{[^}]*padding-left: 0/,
    "collapsed, the input sheds the icon inset that held it at 62px");
  assert.match(APP_CSS, /\.o-find__field:focus-within \{[^}]*position: absolute/,
    "expanded, it takes the bar instead of growing past the viewport edge");
});

// ── Bottom navigation ───────────────────────────────────────────────────────

test("bottom clearance is derived from the tab bar, not coincidence", () => {
  assert.match(APP_CSS, /calc\(var\(--tabbar-height\) \+ var\(--space-lg\) \+ var\(--space-md\) \+ env\(safe-area-inset-bottom\)\)/,
    "workspace padding states the bar's own height");
  assert.match(APP_CSS, /scroll-padding-bottom: calc\(var\(--tabbar-height\)/,
    "anchor and focus targets clear the bar too");
});

// ── Headings ────────────────────────────────────────────────────────────────

test("no page says its own name twice on a phone", () => {
  for (const id of ["symbol-atlas-title", "more-title", "compatibility-title", "saved-charts-title"]) {
    const tag = new RegExp(`class="u-title sr-only-mobile" id="${id}"`);
    assert.match(HTML, tag, `${id} yields to the sticky bar on mobile`);
  }
  // Context headings that differ from the bar title survive everywhere.
  assert.ok(HTML.includes(">Your sky today</h1>"), "Today keeps its contextual headline");
});

// ── One containment level, where the parent card was not the whole story ────

test("flattened collections put their override after the card rule they undo", () => {
  // Removing Sky's outer card left a section full of bordered transit boxes:
  // the letter of "one containment level" with none of the benefit. The rows
  // are dividers now — but only because the override sits BELOW the base rule
  // in the same stylesheet. Equal specificity, so source order decides, and an
  // earlier version of this change silently did nothing for exactly that
  // reason. These assertions pin the ordering, not just the declaration.
  for (const [css, base, override, name] of [
    [FEATURES_CSS, "\n.tr-card {", ".tr-card + .tr-card", "Sky transit rows"],
    [ATLAS_CSS, "\n.atlas-card {", ".atlas-card + .atlas-card", "Atlas featured rows"],
  ]) {
    const basePos = css.indexOf(base);
    const overridePos = css.indexOf(override);
    assert.ok(basePos > -1, `${name}: base rule missing`);
    assert.ok(overridePos > basePos,
      `${name}: the mobile override must come after the card rule it overrides, or it loses on source order`);
    // And it must be scoped to mobile, so the desktop grid keeps its edges.
    const media = css.lastIndexOf("@media (max-width: 640px)", overridePos);
    assert.ok(media > basePos, `${name}: the override must sit inside the 640px block`);
  }
});
