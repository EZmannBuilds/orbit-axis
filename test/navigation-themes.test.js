// Orbit Axis :: Dev Update 1.3 — canonical navigation, themes, retired surfaces.
//
// The project deliberately has no browser test harness, so these are structural
// assertions over the shipped HTML, CSS, and controller source. That limits what
// they can prove — they cannot click anything — so each one pins a property that
// would otherwise regress *silently*: a sixth tab appearing, a retired page
// coming back, a theme resolving after first paint instead of before it.
//
// What they deliberately do NOT claim: that any of this was verified with a
// screen reader. Automated coverage and assistive-technology evidence are
// different things, and conflating them is how an accessibility claim becomes
// untrue.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

const html = read("public", "index.html");
const appJs = read("public", "app.js");
const navCss = read("public", "styles", "navigation.css");
const appCss = read("public", "styles", "app.css");
const tokensCss = read("public", "styles", "tokens.css");
const moreCss = read("public", "styles", "more.css");
const orbitAxisCss = read("public", "styles", "orbit-axis.css");

/** The five canonical destinations, in their canonical order.
 *
 *  The redesign changed this list, deliberately. Two of the five tabs used to be
 *  directories: "Tools" was four links to pages that exist elsewhere, and "More"
 *  was a settings drawer — while the reference library, the deepest finished
 *  thing in the app, sat two taps down.
 *
 *  So Tools was dissolved into the surfaces its links pointed at, Positions
 *  joined Transits under one "Sky" destination with a segmented control, and the
 *  Atlas took the freed tab. Nothing was deleted; the tests below check exactly
 *  that. */
const CANONICAL = [
  { id: "home", label: "Today" },
  { id: "me", label: "Chart" },
  { id: "transits", label: "Sky" },
  { id: "symbol-atlas", label: "Atlas" },
  { id: "more", label: "You" },
];

/** Parse the WORKSPACES registry entries in source order. */
function registry() {
  const block = appJs.slice(appJs.indexOf("const WORKSPACES = ["),
                            appJs.indexOf("];", appJs.indexOf("const WORKSPACES = [")));
  return [...block.matchAll(/\{ id: "([^"]+)", label: "([^"]+)"(.*)$/gm)].map((m) => ({
    id: m[1],
    label: m[2],
    primary: /primary: true/.test(m[3]),
    rest: m[3],
  }));
}

// ── One canonical navigation model ──────────────────────────────────────────

test("the primary navigation is exactly the five canonical destinations, in order", () => {
  const primary = registry().filter((ws) => ws.primary);
  assert.deepEqual(primary.map((ws) => ws.id), CANONICAL.map((d) => d.id));
  assert.deepEqual(primary.map((ws) => ws.label), CANONICAL.map((d) => d.label));
});

test("a sixth primary destination cannot be added without failing this test", () => {
  // The count is the point. Five labelled tabs fit a 375px phone; six do not,
  // and the failure mode is silent — labels truncate rather than break.
  assert.equal(registry().filter((ws) => ws.primary).length, 5);
});

test("mobile and desktop render from the same links, so they cannot disagree", () => {
  // One builder, one DOM. Two sets of markup would be two places for the order
  // and the labels to drift.
  const build = appJs.slice(appJs.indexOf("function buildRail()"), appJs.indexOf("function requestedRoute"));
  assert.match(build, /availableWorkspaces\(\)\.filter\(ws => ws\.primary\)/);
  assert.equal((html.match(/id="rail-nav"/g) || []).length, 1, "exactly one navigation container ships");
  // app.css owns WHERE the navigation sits (sidebar above 1024, bottom tab bar
  // below it); navigation.css owns what it SAYS. Both are asserted, because a
  // five-column bar with no current-tab signal is only half the contract.
  assert.match(appCss, /@media \(max-width: 1023px\)/, "the same container becomes the phone bar");
  assert.match(appCss, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/,
    "the phone bar must have exactly five columns");
});

test("the phone label is an abbreviation of the same name, never a different word", () => {
  for (const ws of registry().filter((ws) => ws.primary)) {
    const short = /mobileLabel: "([^"]+)"/.exec(ws.rest)?.[1];
    if (!short) continue;
    assert.ok(ws.label.includes(short),
      `"${short}" is not a shortening of "${ws.label}" — the two navigations would read differently`);
  }
});

test("Sky opens the transits view directly, with no page in between", () => {
  const entry = registry().find((ws) => ws.id === "transits");
  assert.ok(entry?.primary, "Sky must be primary navigation");
  assert.ok(html.includes('id="panel-transits"'), "and it must point at the real transits panel");
  // Arriving must also populate it, or a direct link lands on an empty page.
  const render = appJs.slice(appJs.indexOf("function renderRoute()"));
  assert.match(render, /id === "transits"[\s\S]{0,80}renderTransits\(\)/);
});

test("every routed destination has one page heading, tied to its panel", () => {
  const panels = [...html.matchAll(/id="(panel-[a-z-]+)"[^>]*aria-labelledby="([^"]+)"/g)];
  assert.ok(panels.length >= 5, `expected the routed panels, found ${panels.length}`);
  for (const [, panel, labelledBy] of panels) {
    assert.ok(new RegExp(`id="${labelledBy}"`).test(html),
      `${panel} points aria-labelledby at #${labelledBy}, which does not exist`);
  }
});

test("no panel claims to be a tab panel now that the navigation is links", () => {
  // role="tabpanel" without a tablist is a promise the markup does not keep.
  assert.ok(!/id="panel-[a-z-]+"[^>]*role="tabpanel"/.test(html));
  assert.ok(!html.includes('id="rail-nav" role="tablist"'));
});

test("the current page is stated in the accessibility tree and not by colour alone", () => {
  const render = appJs.slice(appJs.indexOf("function renderRoute()"));
  assert.match(render, /setAttribute\("aria-current", "page"\)/);
  assert.match(render, /removeAttribute\("aria-current"\)/,
    'inactive links must drop the attribute rather than set it to "false"');
  assert.match(appCss, /\.rail__link\[aria-current="page"\][\s\S]{0,220}font-weight/,
    "the current tab needs a weight signal, not only a tint");
  // And a shape signal: the solid icon weight, which is what still reads in
  // greyscale, at 10px, and for someone who cannot separate the tint from the
  // surface behind it.
  assert.match(navCss, /\.rail__link\[aria-current="page"\] \.rail__icon--fill \{ display: block; \}/,
    "the current tab swaps to the filled icon");
});

// ── Retired surfaces stay retired ───────────────────────────────────────────

test("Ask Orbit has no entry point anywhere in the shipped interface", () => {
  for (const relic of ['id="panel-ask"', 'href="#ask"', 'id="ask-input"', "axis-ask__btn"]) {
    assert.ok(!html.includes(relic), `${relic} must not ship`);
  }
  assert.ok(!appJs.includes("function wireAsk"), "the Ask wiring must be gone");
});

test("Overview, Research, and the old Charts page are gone as destinations", () => {
  for (const id of ["dashboard", "research", "charts"]) {
    assert.ok(!html.includes(`id="panel-${id}"`), `panel-${id} must not ship`);
    assert.ok(!new RegExp(`\\{ id: "${id}"`).test(appJs), `${id} must not be a workspace`);
  }
});

test("every retired route redirects somewhere that exists", () => {
  const block = appJs.slice(appJs.indexOf("const RETIRED_ROUTES"), appJs.indexOf("});", appJs.indexOf("const RETIRED_ROUTES")));
  const targets = [...block.matchAll(/to: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(targets.length >= 4, "the known retired routes should be declared");
  const known = new Set(registry().map((ws) => ws.id));
  for (const target of targets) {
    assert.ok(known.has(target), `a retired route points at "${target}", which is not a workspace`);
  }
});

test("an unknown route recovers instead of showing a blank surface", () => {
  const resolve = appJs.slice(appJs.indexOf("function resolveLegacyRoute()"));
  assert.match(resolve, /location\.replace/, "a retired route must not pile up in history");
  assert.match(resolve, /isn't part of Orbit Axis/, "an unknown route must say so plainly");
  assert.match(appJs, /workspaceAvailable\(hash\) \? hash : "home"/, "and must still land on a real page");
});

test("Tarot, Learn, and News remain absent from the shipped markup", () => {
  for (const id of ["tarot", "learn", "news"]) {
    assert.ok(!html.includes(`id="panel-${id}"`), `panel-${id} must not ship`);
    assert.ok(!new RegExp(`id: "${id}"[^}]*primary: true`).test(appJs), `${id} must not be primary navigation`);
  }
});

test("no engineering diagnostic is presented to an ordinary user", () => {
  // Model names, prompt versions, token counts, ports, and connection status
  // are answers to questions a reader never asked, and they age badly in public.
  for (const relic of ['id="llm-status"', 'id="llm-model"', 'id="llm-prompt-version"',
                       'id="intel-form"', 'id="proposal-panel"', 'id="rail-status"',
                       'id="set-service"', 'id="system-status"']) {
    assert.ok(!html.includes(relic), `${relic} is a developer surface and must not ship`);
  }
  for (const relic of ["loadLocalIntelligence", "runIntelGenerate", "renderProposal"]) {
    assert.ok(!appJs.includes(relic), `${relic} must be gone from the controller`);
  }
  assert.ok(!/port \$\{/.test(appJs), "a port number must never reach the interface");
});

// ── Theme system ────────────────────────────────────────────────────────────

test("the theme resolves before first paint, without a network request", () => {
  // The inline script has to run before the stylesheets, or a light-mode user
  // sees a dark flash on every load. Position in <head> is the guarantee.
  const script = html.indexOf("localStorage.getItem(\"orbit.theme\")");
  const firstSheet = html.indexOf('<link rel="stylesheet"');
  assert.ok(script > 0, "a pre-paint theme script must exist");
  assert.ok(script < firstSheet, "it must run before the first stylesheet");
  const head = html.slice(0, html.indexOf("</head>"));
  assert.ok(!/fetch\(|XMLHttpRequest/.test(head), "startup theming must not wait on the network");
});

test("System is the default, and an unrecognised stored value falls back to it", () => {
  assert.match(appJs, /THEME_CHOICES\.includes\(raw\) \? raw : "system"/);
  assert.match(html, /if \(stored !== "light" && stored !== "dark" && stored !== "system"\) stored = "system"/);
});

test("the pre-paint script and the controller resolve the theme identically", () => {
  // Two implementations of one rule will drift; this pins them to the same
  // media query and the same fallback direction.
  assert.match(html, /prefers-color-scheme: light/);
  assert.match(appJs, /matchMedia\?\.\("\(prefers-color-scheme: light\)"\)/);
  assert.match(html, /matches \? "light" : "dark"/);
  assert.match(appJs, /matches \? "light" : "dark"/);
});

test("the choice and the resolved theme are recorded separately", () => {
  // Collapsing them turns a "System" selection into a hard Light or Dark the
  // first time it is written back, and the device stops being followed.
  assert.match(appJs, /root\.dataset\.theme = resolved/);
  assert.match(appJs, /root\.dataset\.themePreference = choice/);
});

test("System keeps following the device; Light and Dark stop it", () => {
  const wire = appJs.slice(appJs.indexOf("function wireSettings()"));
  assert.match(wire, /readStoredTheme\(\) === "system"/, "only System reacts to a device change");
  assert.match(wire, /addEventListener\?\.\("change"/, "and it must actually subscribe");
});

test("the preference persists, and storage failure never breaks the app", () => {
  assert.match(appJs, /localStorage\.setItem\(THEME_STORAGE_KEY, choice\)/);
  // Safari private mode throws on setItem. A theme is not worth an exception.
  assert.match(appJs, /function storeTheme\(choice\) \{[\s\S]{0,160}catch/);
  assert.match(appJs, /function readStoredTheme\(\) \{[\s\S]{0,220}catch/);
});

test("color-scheme and the browser chrome colour both follow the theme", () => {
  assert.match(tokensCss, /:root\[data-theme="dark"\] \{[\s\S]{0,80}color-scheme: dark/);
  assert.match(tokensCss, /:root\[data-theme="light"\] \{[\s\S]{0,40}color-scheme: light/);
  assert.match(appJs, /meta\.setAttribute\("content", THEME_COLORS\[resolved\]/);
  assert.ok(html.includes('id="meta-theme-color"'), "the theme-color meta tag must exist to update");
});

test("the theme control offers three choices with visible text labels", () => {
  const control = html.slice(html.indexOf('id="set-theme"'), html.indexOf('id="set-theme-help"'));
  for (const value of ["system", "light", "dark"]) {
    assert.ok(control.includes(`data-value="${value}"`), `the ${value} choice must exist`);
  }
  for (const label of ["<span>System</span>", "<span>Light</span>", "<span>Dark</span>"]) {
    assert.ok(control.includes(label), `${label} must be visible text, not an icon alone`);
  }
  assert.match(control, /aria-pressed="(true|false)"/, "the selected state must be exposed");
  assert.match(control, /role="group" aria-labelledby="set-theme-label"/, "the group must be named");
  assert.ok(!/<svg[^>]*(?<!aria-hidden="true")>/.test(control.replace(/\n/g, "")) ||
            control.includes('aria-hidden="true"'), "the icons must be decorative");
});

test("the theme control meets the 44px target on every screen", () => {
  assert.match(moreCss, /\.o-segment--theme button \{[\s\S]{0,200}min-height: 44px/);
  assert.match(moreCss, /@media \(max-width: 480px\)[\s\S]{0,500}\.setting-row \.o-segment \{ width: 100%/,
    "three targets must go full width rather than shrink on a narrow phone");
});

test("high-contrast and forced-colors support survives the theme work", () => {
  assert.match(tokensCss, /@media \(prefers-contrast: more\)/, "the contrast preference must still be honoured");
  assert.match(tokensCss, /:root\[data-contrast="high"\]/, "the explicit high-contrast tokens must remain");
  assert.match(navCss, /@media \(forced-colors: active\)/, "navigation must survive forced colours");
  assert.match(moreCss, /@media \(forced-colors: active\)/, "so must the selected control state");
});

// ── Light mode is designed, not inverted ────────────────────────────────────
//
// These two used to check that light mode had its OWN celestial palette, and
// that the starfield and the gradient wordmark were withdrawn on a light page.
// Both were symptoms of the same thing: a decorative layer that only worked on
// one theme and had to be special-cased on the other.
//
// The redesign removed that layer entirely — one accent, no decorative
// gradients, no starfield — so there is nothing left to withdraw. What replaces
// these is the stronger property: both themes are complete definitions of the
// same system, and neither is a filter over the other.

test("both themes define the whole semantic palette, not a partial override", () => {
  const dark = tokensCss.slice(tokensCss.indexOf(':root[data-theme="dark"] {'),
                               tokensCss.indexOf(':root[data-theme="light"] {'));
  const light = tokensCss.slice(tokensCss.indexOf(':root[data-theme="light"] {'),
                                tokensCss.indexOf("/* ── 7. Modes"));
  const names = (block) => new Set([...block.matchAll(/^\s*(--color-[a-z-]+):/gm)].map((m) => m[1]));
  const darkNames = names(dark);
  const lightNames = names(light);
  assert.ok(darkNames.size >= 20, `expected a full dark palette, saw ${darkNames.size}`);
  for (const name of darkNames) {
    assert.ok(lightNames.has(name),
      `${name} is defined for dark but not for light — light would inherit a dark value`);
  }
  for (const name of lightNames) {
    assert.ok(darkNames.has(name), `${name} is defined for light but not for dark`);
  }
});

test("the decorative layer that only worked on a dark page is gone, not special-cased", () => {
  // The starfield, the atmospheric wash, and the gradient wordmark each needed
  // a light-mode escape hatch because they were decoration rather than content.
  assert.match(orbitAxisCss, /\.axis-starfield \{ display: none; \}/,
    "the starfield is withdrawn on every theme, not only the light one");
  assert.ok(!/#panel-home::before/.test(orbitAxisCss), "the atmospheric wash must be gone");
  assert.ok(!/-webkit-background-clip: text/.test(orbitAxisCss),
    "the wordmark is ordinary text, so it needs no forced-colors rescue");
  // And no second accent survives anywhere in the stylesheets.
  for (const name of ["--axis-lavender", "--axis-indigo", "--axis-periwinkle", "--axis-pink"]) {
    assert.ok(!orbitAxisCss.includes(name), `${name} was a second accent colour and must not be used`);
  }
});

test("the carried-over feature panels get light values for their legacy variables", () => {
  // These are hardcoded dark. Without light values, the chart form, the auth
  // gate, and every modal stay dark boxes on a light page.
  const features = read("public", "styles", "features.css");
  assert.match(features, /:root\[data-theme="light"\] #panel-me[\s\S]{0,400}--surface: #ffffff/);
  assert.match(features, /:root\[data-theme="light"\][\s\S]{0,500}--text: #12161c/);
});

// ── Tools is dissolved, and nothing it offered was lost ─────────────────────
//
// Tools was a page of four cards whose only job was to link to four pages that
// already existed. The redesign removed it and put each link on the surface it
// belongs to. That is only an improvement if every destination survived, which
// is what this checks — the failure mode of "we deleted the directory" is
// quietly deleting a room.

test("the Tools page is gone and every destination it offered is still reachable", () => {
  assert.ok(!html.includes('id="panel-tools"'), "the Tools page must not ship");
  assert.ok(!/\{ id: "tools"/.test(appJs), "and it must not be a workspace");

  // Each of Tools' four cards, and where it lives now.
  const rehomed = [
    { was: "History", now: 'href="#history"', on: "panel-more" },
    { was: "Symbol Atlas", now: 'href="#symbol-atlas"', on: "panel-more" },
    { was: "Saved Charts", now: 'href="#me"', on: "panel-more" },
    { was: "Compatibility", now: 'href="#compatibility"', on: "panel-me" },
  ];
  for (const { was, now, on } of rehomed) {
    const start = html.indexOf(`id="${on}"`);
    const panel = html.slice(start, html.indexOf('<section class="workspace-panel"', start + 10));
    assert.ok(panel.includes(now), `${was} used to be a Tools card and is no longer reachable from #${on}`);
  }

  // And the Atlas — the deepest finished feature — is now a tab of its own
  // rather than two taps down behind a directory.
  assert.ok(registry().find((ws) => ws.id === "symbol-atlas")?.primary,
    "the Atlas took the tab Tools gave up");
});

test("the retired Tools route explains where its contents went", () => {
  const block = appJs.slice(appJs.indexOf("const RETIRED_ROUTES"),
                            appJs.indexOf("});", appJs.indexOf("const RETIRED_ROUTES")));
  assert.match(block, /tools: \{ to: "more"/, "an old #tools bookmark must land somewhere real");
  const notice = /tools: \{ to: "more", notice: "([^"]+)"/.exec(block)?.[1] ?? "";
  for (const word of ["History", "Atlas", "Compatibility"]) {
    assert.ok(notice.includes(word),
      `the notice must name where things went; "${word}" is missing from "${notice}"`);
  }
});

// ── You is coherent ─────────────────────────────────────────────────────────

test("You carries the account and application actions, each with a visible label", () => {
  const panel = html.slice(html.indexOf('id="panel-more"'), html.indexOf('id="panel-history"'));
  for (const id of ["account-email", "account-export", "account-password-reset",
                    "account-signout", "account-delete-open"]) {
    assert.ok(panel.includes(`id="${id}"`), `You must carry ${id}`);
  }
  for (const href of ["/privacy", "/terms", "/support", "/source", "/account-deletion"]) {
    assert.ok(panel.includes(`href="${href}"`), `You must link to ${href}`);
  }
  assert.match(panel, /href="#settings"/, "and it must reach Appearance, where the theme lives");
  // Every row states itself in words. An icon column with no label is a puzzle.
  const rows = [...panel.matchAll(/class="o-row__title">([^<]+)</g)].map((m) => m[1].trim());
  assert.ok(rows.length >= 8, `expected a labelled row per action, saw ${rows.length}`);
  for (const label of rows) assert.ok(label.length > 0, "every row needs visible text");
});

test("deletion stays visually separated from the harmless actions", () => {
  const panel = html.slice(html.indexOf('id="panel-more"'), html.indexOf('id="panel-history"'));
  const exportAt = panel.indexOf('id="account-export"');
  const deleteAt = panel.indexOf('id="account-delete-open"');
  assert.ok(exportAt > 0 && deleteAt > exportAt, "delete must not sit beside the ordinary actions");
  assert.match(panel, /id="danger-zone"/, "and it must keep its own group");
  // Its own group means its own list: nothing harmless may share the container,
  // or a confident tap aimed at the row above lands on deletion.
  const zone = panel.slice(panel.indexOf('id="danger-zone"'));
  const buttons = [...zone.matchAll(/class="o-row o-row--link[^"]*"/g)];
  assert.equal(buttons.length, 1, "the danger group holds exactly one action");
});

// ── Dev Update 1.2 must survive ─────────────────────────────────────────────

test("authentication, export, and password reset are untouched", () => {
  for (const id of ["auth-gate", "auth-form", "auth-email", "auth-password", "auth-submit",
                    "account-export", "account-password-reset", "delete-account-modal"]) {
    assert.ok(html.includes(`id="${id}"`), `${id} is Dev Update 1.2 behaviour and must survive`);
  }
  assert.match(appJs, /function wireAccountExport/);
  assert.match(appJs, /function wireAccountPasswordReset/);
  assert.match(appJs, /function wireAccountDeletion/);
});

test("the authentication gate keeps its accessible dialog semantics", () => {
  const gate = html.slice(html.indexOf('id="auth-gate"'), html.indexOf('id="auth-gate"') + 600);
  assert.match(gate, /role="dialog"/);
  assert.match(gate, /aria-modal="true"/);
  assert.match(gate, /aria-labelledby="auth-gate-title"/);
  assert.match(appJs, /function setBackgroundInert/, "the shell must still go inert behind it");
});
