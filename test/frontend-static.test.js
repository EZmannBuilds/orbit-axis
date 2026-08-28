// Orbit Axis :: static frontend regression checks.
// The project has no browser/DOM test harness (deliberately dependency-free),
// so these are lightweight structural assertions against the served HTML/JS
// source — cheap protection against silently reintroducing the removed
// global search bar, losing birthplace autocomplete, or dropping the new
// Home markup this branch adds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "public", "index.html"), "utf8");
const appJs = readFileSync(join(ROOT, "public", "app.js"), "utf8");
const fortuneCss = readFileSync(join(ROOT, "public", "styles", "fortune.css"), "utf8");

test("the search in the top nav is real, not a decorative button", () => {
  // The ORIGINAL guarantee here was that a fake search bar had been removed:
  // `#topnav-search` was a button that looked like a field and did nothing, and
  // deleting it was right.
  //
  // The redesign put search back — but as a working field over the three things
  // people actually look for (a page, one of their saved charts, a symbol they
  // did not recognise), all of it already in the browser. So the guarantee is
  // no longer "there is no search"; it is "the search is not a prop".
  assert.ok(!html.includes('id="topnav-search"'), "the old decorative button must not return");
  assert.ok(!appJs.includes("topnav-search"), "no leftover topnav-search listener");

  // A real input, with a real accessible name and a combobox contract.
  assert.match(html, /<input[^>]*type="search"[^>]*id="find-input"/s, "search is an input, not a button");
  assert.match(html, /id="find-input"[\s\S]{0,400}aria-label="[^"]+"/, "and it is named");
  assert.match(html, /id="find-input"[\s\S]{0,400}role="combobox"/);
  assert.match(html, /id="find-input"[\s\S]{0,400}aria-controls="find-results"/);
  assert.match(html, /id="find-results"[^>]*role="listbox"/, "results are a real listbox");

  // And a controller behind it that searches all three sources.
  assert.match(appJs, /function wireFind\(\)/, "the field is wired");
  const matches = appJs.slice(appJs.indexOf("function findMatches"), appJs.indexOf("function findRender"));
  assert.match(matches, /availableWorkspaces\(\)/, "it searches destinations");
  assert.match(matches, /state\.charts/, "it searches your saved charts");
  assert.match(matches, /searchAtlas/, "it searches the reference library");
  // Keyboard support, or it is a mouse-only feature wearing a combobox role.
  const wire = appJs.slice(appJs.indexOf("function wireFind"));
  for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
    assert.ok(wire.includes(`"${key}"`), `${key} must be handled`);
  }
});

test("the search reaches nothing over the network, so it cannot fail or leak", () => {
  // Everything it searches is already loaded: a constant, `state`, and a module
  // the Atlas lazy-loads for its own pages. No request means no spinner, no
  // failure mode, and no keystroke leaving the device.
  const block = appJs.slice(appJs.indexOf("const FIND = {"), appJs.indexOf("/** The hash as written"));
  assert.ok(!/\bfetch\(/.test(block) && !/\bget\(`?\/api/.test(block),
    "the search must not make a request");
  assert.ok(!/localStorage/.test(block), "and it must not store what was typed");
});

test("the command palette is gone, DOM and listeners together", () => {
  // Dev Update 1.3 retired it. Hidden DOM is not removal: an overlay left in
  // the page is still focusable, still readable to anyone inspecting it, and
  // still a maintenance cost for a feature nobody can reach.
  for (const relic of ['id="cmd-overlay"', 'id="cmd-input"', 'id="cmd-list"', 'id="rail-command"']) {
    assert.ok(!html.includes(relic), `${relic} should be gone from the markup`);
  }
  for (const relic of ["openCommand", "closeCommand", "renderCommand", "runCommand", "commandItems"]) {
    assert.ok(!appJs.includes(relic), `${relic} should be gone from the controller`);
  }
  assert.ok(!/metaKey \|\| e\.ctrlKey/.test(appJs), "the Cmd+K listener should be gone");
});

test("there is exactly one chart form, and it has birthplace autocomplete", () => {
  // Dev Update 1.4 collapsed three chart forms into one. The `ob-` onboarding
  // form and the `oa-` form injected into Home are gone; `cm-` is the only set
  // of chart field ids that ships.
  assert.ok(html.includes('id="cm-place"'), "the chart form keeps its birthplace input");
  assert.ok(html.includes('id="cm-place-results"'), "and its results list");
  assert.ok(appJs.includes("setupPlaceSearch"), "setupPlaceSearch wiring should still exist");
  for (const gone of ['id="ob-place"', 'id="ob-date"', 'id="onboarding-form"', 'id="oa-setup"', 'id="oa-place"']) {
    assert.ok(!html.includes(gone) && !appJs.includes(gone), `${gone} belonged to a duplicate form and must be gone`);
  }
  const forms = [...html.matchAll(/<form[^>]*id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(forms.filter((f) => f.includes("chart")), ["chart-modal-form"],
    "exactly one chart form may ship");
});

test("Home has a saved-chart selector wired to the activate endpoint", () => {
  assert.ok(html.includes('id="today-chart-picker"'));
  assert.ok(html.includes('id="today-chart-select"'));
  assert.ok(appJs.includes("axisWireChartPicker"));
  assert.ok(appJs.includes("/activate"));
  // Manage and "+" were REMOVED from the chip on 2026-08-08. They were two
  // routes to a screen the Chart tab reaches in one tap, competing for
  // attention with the reading they now sit under. What matters is unchanged
  // and still asserted above: the selector exists and activates a chart.
  assert.ok(!html.includes('id="today-chart-manage"'), "the Manage button is gone");
  assert.ok(!html.includes('id="today-chart-add"'), "the + button is gone");

  // And it sits BELOW the reading, which is the point of the move: the first
  // question on Today is what the day says, not whose chart it is.
  assert.ok(html.indexOf('id="today-fortune"') < html.indexOf('id="today-chart-picker"'),
    "the picker must come after the reading");
  assert.ok(html.indexOf('id="today-chart-picker"') < html.indexOf('id="today-moon"'),
    "…and before the Moon");
});

test("My Chart renders the eight-section reading hierarchy in order", () => {
  // Order is part of the design: identity and the reliability caution come
  // before any interpretation the reader would otherwise take at face value.
  const order = ["me-overview", "chart-limitation", "section-bigthree", "section-patterns",
                 "section-planets", "section-aspects", "section-houses", "section-data"];
  const positions = order.map((id) => {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > -1, `${id} is missing from My Chart`);
    return at;
  });
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1],
      `${order[i]} must come after ${order[i - 1]} in the markup`);
  }
});

test("My Chart has a header with identity, switcher, and edit action", () => {
  assert.ok(html.includes('id="mychart-title"'), "one page heading");
  assert.ok(html.includes('id="mychart-name"'), "active chart name");
  assert.ok(html.includes('id="chart-switcher-select"'), "chart switcher");
  assert.ok(html.includes('id="me-edit-chart"'), "edit action");
  assert.match(html, /<label[^>]*for="chart-switcher-select"/, "the switcher needs a real label");
  assert.ok(appJs.includes("renderChartSwitcher"), "the switcher is populated from state");
  // One <h1> on the page.
  const h1s = [...html.matchAll(/<h1\b/g)].length;
  const panelH1s = [...html.matchAll(/id="panel-me"[\s\S]*?<\/section>/g)].join("").match(/<h1\b/g) || [];
  assert.ok(h1s >= 1 && panelH1s.length <= 1, "My Chart must not introduce a second h1");
});

test("interpretation comes only from the composed reading, never from app.js", () => {
  // The whole point of lib/interpretation. If a second corpus grows here, the
  // two will disagree and only one of them has tests.
  assert.ok(!appJs.includes("PLACEMENT_ROLES"),
    "the old in-app interpretation table must be gone");
  assert.ok(appJs.includes("readingPayload"), "app.js renders a server-composed reading");
  assert.match(appJs, /renderChart called without a composed reading/,
    "rendering without a reading must fail loudly rather than invent text");
  // No authored interpretive sentences hiding in the client. These are the
  // phrasings the content modules own.
  for (const phrase of ["describes thinking and communication", "Core identity",
                        "Emotional nature", "expresses this"]) {
    assert.ok(!appJs.includes(phrase), `"${phrase}" is content and belongs in lib/interpretation`);
  }
});

test("the server composes the reading through the interpretation service", () => {
  const api = readFileSync(join(ROOT, "lib", "charts", "api.js"), "utf8");
  assert.match(api, /buildChartReading/, "the chart route attaches a composed reading");
  const svc = readFileSync(join(ROOT, "lib", "interpretation", "service.js"), "utf8");
  assert.match(svc, /composeChart/, "the service delegates to composeChart");
});

test("calculation context is read from the stored chart, never hardcoded", () => {
  const svc = readFileSync(join(ROOT, "lib", "interpretation", "service.js"), "utf8");
  assert.match(svc, /profile\?\.zodiac_system/, "zodiac comes from the profile");
  assert.match(svc, /profile\?\.house_system/, "house system comes from the profile");
  // The engine never states a geocentric frame, so no context row may claim
  // one. Checked against the rendered labels, not the file text — the module
  // comment explains the omission and should be allowed to say the word.
  const contextLabels = [...svc.matchAll(/label: "([^"]+)"|value: "([^"]+)"/g)]
    .flatMap((m) => [m[1], m[2]]).filter(Boolean);
  assert.ok(!contextLabels.some((l) => /geocentric/i.test(l)),
    "no geocentric claim: the engine does not report one");
  assert.ok(!appJs.includes("Placidus") && !appJs.includes("Tropical"),
    "the client must not hardcode calculation claims");
});

test("a house system is only named when houses were actually calculated", () => {
  const svc = readFileSync(join(ROOT, "lib", "interpretation", "service.js"), "utf8");
  assert.match(svc, /houses && chart\?\.time_known/,
    "naming a house system on an unknown-time chart describes a calculation that did not happen");
});

test("unknown birth time withholds Rising, houses, and angles", () => {
  assert.match(appJs, /!chart\?\.time_known \|\| !chart\?\.houses\?\.length/,
    "the houses section checks time_known before rendering anything");
  assert.match(appJs, /House placements, the Rising sign, and the Midheaven all need a reliable birth time/,
    "and explains the omission once");
  // The Rising-unavailable card is a designed state, not a blank.
  assert.match(appJs, /reading-card--unavailable/, "unavailable placements get their own card style");
  const compose = readFileSync(join(ROOT, "lib", "interpretation", "compose.js"), "utf8");
  assert.match(compose, /unavailable: true/, "composeBigThree withholds Rising rather than guessing");
});

test("the birth-time limitation is one page-level notice, not a badge per card", () => {
  assert.ok(appJs.includes("renderLimitation"), "one limitation renderer");
  assert.match(appJs, /chart-limitation__title/, "the notice is a titled region");
  // The old per-card warning chips are gone from the reading cards.
  assert.ok(!appJs.includes("placement-card__warning"),
    "per-card warning chips repeated the same sentence up to eleven times");
});

test("aspects are ranked, explained both ways, and never graded", () => {
  assert.ok(appJs.includes("aspects?.highlights"), "highlights come pre-ranked from the composer");
  // Both readings are always shown, so no aspect can be graded good or bad.
  // The labels are the plain ones: "constructive potential" is accurate and it
  // is the register of a textbook, not of someone finding out what a square is.
  assert.match(appJs, /What it can help with/, "each aspect shows a constructive reading");
  assert.match(appJs, /Where it can chafe/, "and a tension reading");
  const aspects = readFileSync(join(ROOT, "lib", "interpretation", "aspects.js"), "utf8");
  assert.match(aspects, /rankAspects/, "ranking is deterministic and lives in the content layer");
  // Applying/separating is absent from the NATAL response, so the natal aspect
  // renderer must not show it. Today's Transits legitimately has the field and
  // is not in scope here, so this is checked against the renderer only.
  const aspectRenderer = appJs.slice(appJs.indexOf("function aspectCardHtml"),
                                     appJs.indexOf("function renderHouses"));
  assert.ok(!/applying|separating/i.test(aspectRenderer),
    "the natal engine does not report applying/separating; showing it would invent a chart fact");
});

test("element dominance keeps the five-point gap rule", () => {
  const patterns = readFileSync(join(ROOT, "lib", "interpretation", "patterns.js"), "utf8");
  assert.match(patterns, /DOMINANCE_THRESHOLD_PERCENT = 5/, "the threshold is explicit");
  assert.match(patterns, /isMeaningfullyDominant/, "and enforced by a named guard");
  // The client renders whatever the composer decided; it does not re-derive.
  assert.ok(!appJs.includes("dominant ="), "the client must not compute dominance itself");
});

test("retrograde is visible text and never applies to the Sun or Moon", () => {
  assert.match(appJs, /placement\.retrograde \? "Retrograde" : ""/,
    "retrograde state is spelled out, not left to a glyph");
  const patterns = readFileSync(join(ROOT, "lib", "interpretation", "patterns.js"), "utf8");
  assert.match(patterns, /NEVER_RETROGRADE = Object\.freeze\(\["Sun", "Moon"\]\)/,
    "Sun and Moon never retrograde");
  const compose = readFileSync(join(ROOT, "lib", "interpretation", "compose.js"), "utf8");
  assert.match(compose, /!NEVER_RETROGRADE\.includes\(planetName\)/,
    "and the composer honours that when marking a placement retrograde");
});

test("glyphs are decorative and every placement has a text name", () => {
  assert.match(appJs, /class="reading-card__glyph" aria-hidden="true"/,
    "glyphs are hidden from assistive technology");
  assert.match(appJs, /reading-card__title">\$\{esc\(placement\.planet\)\}/,
    "the planet name is real text in the heading");
});

test("expandable readings use native disclosure, not custom widgets", () => {
  // <details> is keyboard operable and announces its own expanded state.
  assert.match(appJs, /<details class="reading-card__more">/);
  assert.match(appJs, /<summary><span>Read more about/);
  assert.ok(!appJs.includes("placement-detail-modal"),
    "the old modal-per-placement flow is gone");
});

test("collapsed and expanded content never repeat each other", () => {
  // summary renders `placement.summary`; the body renders `placement.detail`.
  // If these ever became the same field the reader would read it twice.
  assert.match(appJs, /reading-card__summary">\$\{esc\(placement\.summary\)\}/);
  assert.match(appJs, /\(placement\.detail \|\| \[\]\)\.map/);
});

test("My Chart states are explicit and a failed reading is never swallowed", () => {
  for (const s of ["loading", "empty", "error"]) {
    assert.ok(appJs.includes(`"${s}"`), `${s} is a real state`);
  }
  assert.ok(appJs.includes("renderChartPlaceholder"), "one placeholder renderer");
  assert.ok(appJs.includes('data-action="retry-reading"'), "errors offer a retry");
  // The 1.4 code hid render defects behind Home's chart-loading copy.
  assert.ok(!/catch \{ \/\* Home still owns the failure state \*\/ \}/.test(appJs),
    "the swallowed catch must be gone");
  assert.match(appJs, /stage: "render"/, "render failures are logged distinctly from fetch failures");
});

test("structured error logging carries no birth data", () => {
  const log = appJs.match(/console\.error\("\[orbit\] chart reading failed to render",[\s\S]{0,220}?\);/);
  assert.ok(log, "the render failure is logged");
  for (const leak of ["birth_date", "birth_time", "latitude", "longitude", "birthplace"]) {
    assert.ok(!log[0].includes(leak), `${leak} must never be logged`);
  }
});

test("chart switching cannot leave a previous chart's reading on screen", () => {
  assert.ok(appJs.includes("clearChartReading"), "there is an explicit clear");
  assert.match(appJs, /const token = \+\+reading\.token/,
    "each load takes a token so a slow response cannot paint over a newer chart");
  assert.match(appJs, /if \(token !== reading\.token\) return;/,
    "superseded responses are discarded");
  // Clearing must happen before the request, not after it returns.
  const fn = appJs.slice(appJs.indexOf("async function loadChartReading"));
  const clearAt = fn.indexOf("clearChartReading()");
  const fetchAt = fn.indexOf("await get(`/api/charts/");
  assert.ok(clearAt > -1 && clearAt < fetchAt,
    "stale content must be cleared before the new chart is fetched, not after");
});

test("switching charts reloads saved charts, not just the sky", () => {
  // Found in the browser: the switch handler called refreshData(), which
  // refreshes the current sky and nothing else. Activation succeeded server-
  // side while the page kept rendering the previous chart — showing a Rising
  // sign and full houses for a chart that has no birth time at all.
  // Anchored on Home's own select id: Dev Update 1.8 added a second chart
  // switcher on Transits, and a bare `select?.addEventListener("change"` match
  // now finds whichever appears first in the file.
  const from = appJs.indexOf('$("#chart-switcher-select")');
  assert.ok(from > -1, "Home's switcher change handler must exist");
  const handler = appJs.slice(from, appJs.indexOf("panel.addEventListener", from));
  assert.match(handler, /await loadSavedCharts\(\)/,
    "state.charts must be refreshed before the active chart is re-read");
  assert.match(handler, /await refreshActiveExperience\(\)/);
  assert.ok(!/await refreshData\(\)/.test(handler),
    "refreshData only refreshes the sky and cannot update the reading");
  // And the old reading is cleared the moment the switch starts.
  const clearAt = handler.indexOf("clearChartReading()");
  const activateAt = handler.indexOf("/activate");
  assert.ok(clearAt > -1 && clearAt < activateAt,
    "the previous chart's reading must be cleared before activation is requested");
  assert.match(handler, /state\.activeChartId = previousId/,
    "a failed switch must not leave the switcher claiming a chart that is not active");
});

test("added charts still do not steal the active slot", () => {
  // Dev Update 1.4 made this deliberate. My Chart must not quietly undo it.
  assert.ok(!/afterChartSaved[\s\S]{0,400}\/activate/.test(appJs),
    "saving a chart must not activate it");
});
test("the reading grid is responsive and never scrolls the page sideways", () => {
  const css = readFileSync(join(ROOT, "public", "styles", "features.css"), "utf8");
  // One column by default, more only when there is room for them.
  assert.match(css, /\.reading-grid \{[\s\S]*?grid-template-columns: 1fr/);
  assert.match(css, /min-width: 700px[\s\S]*?\.reading-grid--keys \{ grid-template-columns: repeat\(auto-fit/);
  assert.match(css, /min-width: 961px[\s\S]*?\.reading-grid--keys \{ grid-template-columns: repeat\(3/);
  // Short viewports and heavy zoom collapse back to one column.
  assert.match(css, /max-height: 460px[\s\S]*?grid-template-columns: 1fr/);
  // Wide tables scroll inside their own container, not the document.
  assert.match(css, /\.table-scroll \{[\s\S]*?overflow-x: auto/);
  assert.ok(css.includes("overflow-wrap: anywhere"), "long titles must wrap inside cards");
  const baseCss = readFileSync(join(ROOT, "public", "styles", "base.css"), "utf8");
  assert.ok(baseCss.includes("overflow-x: hidden"));
});

test("disclosure controls meet the 44px touch guidance", () => {
  const css = readFileSync(join(ROOT, "public", "styles", "features.css"), "utf8");
  assert.match(css, /\.reading-card__more > summary,[\s\S]*?min-height: 44px/,
    "expanders are the primary control on this page and must be thumb-sized");
  assert.match(css, /\.chart-switcher__select \{[\s\S]*?min-height: 44px/);
});

test("Me chart actions reuse the existing saved-chart endpoints and confirmation", () => {
  assert.match(appJs, /handleSavedChartAction/);
  assert.match(appJs, /\/api\/charts\/\$\{id\}\/activate/);
  assert.match(appJs, /state\.activeChartId = previousId/, "activation failure should roll back visible state");
  assert.match(appJs, /confirmDialog\(/, "delete should use shared accessible confirmation");
  assert.match(appJs, /confirmEmpty=true/, "final chart deletion should use existing confirmation path");
  assert.match(appJs, /openChartModal\(chart\)/, "edit should reuse shared chart modal");
});

test("Me saved-chart failure has Retry and is never an empty state", () => {
  const renderSaved = appJs.slice(appJs.indexOf("function renderSavedCharts"));
  assert.match(renderSaved, /retry-charts/);
  assert.match(renderSaved, /We couldn't load your saved charts/);
  const errorBranchStart = renderSaved.indexOf('chartsStatus === "error"');
  const emptyBranchStart = renderSaved.indexOf("if (!state.charts.length)", errorBranchStart);
  assert.ok(errorBranchStart >= 0 && emptyBranchStart > errorBranchStart, "error and empty branches should both exist");
  assert.doesNotMatch(renderSaved.slice(errorBranchStart, emptyBranchStart), /No saved charts yet/);
});

test("Today's Fortune is a deck that hides nothing", () => {
  // HISTORY, because this test has now argued both sides.
  //
  // Update 5.2 removed a carousel here, for a good reason: it "hid four of five
  // readings behind a swipe with only a row of dots to suggest it existed". A
  // deck was reinstated on 2026-08-08 at the owner's request, so this test
  // stopped forbidding the shape and started enforcing the conditions that
  // made the old one bad. Those conditions are the assertions below.
  //
  // The old JS relics must still be gone — the deck is CSS scroll-snap, not a
  // revived index-juggling carousel.
  for (const relic of ["fortune-carousel", "fortune-prev", "fortune-next",
                       "axisMoveCarousel", "axisSetCarouselIndex", "axisPaintCarouselCard"]) {
    assert.ok(!appJs.includes(relic), `${relic} should be gone`);
  }
  assert.ok(appJs.includes("axisFortuneCards"), "the card builder should exist");
  assert.ok(appJs.includes("fortune-deck__track"), "cards should sit in a deck track");

  // 1. NOTHING IS HIDDEN FROM ANYTHING BUT THE EYE. Every card is real markup,
  //    always present — so find-in-page and a screen reader still reach every
  //    word even when only one card is on screen.
  // The CARD rule itself, isolated. A looser search matched
  // `.fortune-card2__art:empty { display: none }` — the empty artwork slot,
  // which is exactly the kind of false positive that teaches people to delete
  // an assertion instead of reading it.
  const cardRule = /\n\.fortune-card2\s*\{([^}]*)\}/.exec(fortuneCss)?.[1] || "";
  assert.ok(cardRule.length > 0, "the card rule must exist to be checked");
  assert.ok(!/display:\s*none/.test(cardRule), "cards must never be display:none");

  // 2. THE SWIPE IS VISIBLE. The peek is what tells a reader there is more, and
  //    its absence is precisely what killed the last carousel.
  assert.match(fortuneCss, /grid-auto-columns:\s*8\d%/,
    "the track must show a peek of the next card, not a full-width slide");

  // 3. THE DOTS ARE NOT THE ONLY AFFORDANCE, and above phone widths the deck
  //    stops being a deck at all rather than hiding content that would fit.
  assert.match(fortuneCss, /\.fortune-deck__dots\s*\{\s*display:\s*none/,
    "the dots must disappear once every card fits");
});

test("the fortune title appears above the cards", () => {
  // Order in the source is order in the document: the day gets a name before
  // it gets detail.
  const head = appJs.indexOf("fortune-head__title");
  const deck = appJs.indexOf('<div class="fortune-deck">');
  assert.ok(head > 0 && deck > 0, "both the title and the deck should render");
  assert.ok(head < deck, "the title must be emitted before the cards");
});

test("the main fortune copy never names a planet", () => {
  // The readings come from mood / love_reading / luck_reading / watch_out,
  // which are plain language by construction. Technical phrasing belongs to
  // Technical Sky, which reads factors[].advanced instead.
  const start = appJs.indexOf("function axisFortuneCards");
  const end = appJs.indexOf("function axisFortuneDate");
  const cardSource = appJs.slice(start, end);
  // Word boundaries matter: without them "orb" matches inside "Orbit" and the
  // test fails on its own explanatory comment rather than on any real content.
  for (const term of ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "retrograde",
                      "house", "aspect", "degrees", "orb"]) {
    assert.ok(!new RegExp(`\\b${term}\\b`, "i").test(cardSource),
      `the fortune cards must not reference "${term}" — that belongs in Technical Sky`);
  }
});

test("no swipe or arrow-key handler remains for the fortune", () => {
  assert.ok(!appJs.includes("axisWireFortuneCarousel"));
  // The swipe threshold comment and handlers were the only touch wiring here.
  const fortuneRegion = appJs.slice(appJs.indexOf("Today's Fortune: cards"),
                                    appJs.indexOf("function axisRenderSky"));
  assert.ok(!/touchstart|touchend|ArrowLeft|ArrowRight/.test(fortuneRegion),
    "the fortune should need no gesture or key handling at all");
});

test("Tonight's Moon (the standalone Home card) is gone; Current Sky is unified", () => {
  // Dev Update 1.6 deliberately REVERSES the earlier merge. The Moon was folded
  // into Current Sky when Current Sky was one big card; now that Home is a
  // hierarchy, the Moon is its own section again — it is the fact people check
  // most and it does not belong buried in a technical card.
  assert.ok(html.includes('id="today-moon"'), "the Moon has its own section again");
  assert.ok(appJs.includes("axisRenderMoon"), "and its own renderer");
  assert.ok(appJs.includes("axisRenderSky"));
  assert.ok(html.includes('id="today-sky"'), "Technical Sky keeps its mount point");
  // What must NOT come back is a second Moon calculation.
  assert.ok(!appJs.includes("moon_phase_name"), "the client must not read the mirrored Moon fields");
  assert.match(appJs, /axisRenderMoon\(extras\.moon/, "the Moon comes from the server-composed moonState");
});

test("the procedural Moon module is imported and never calls an external image API", () => {
  assert.ok(appJs.includes('from "./moon-phase.js"'));
  const moonPhaseJs = readFileSync(join(ROOT, "public", "moon-phase.js"), "utf8");
  assert.ok(!/https?:\/\//.test(moonPhaseJs));
});

test("current-timezone handling never falls back to a manual UTC-offset field", () => {
  assert.ok(!html.includes('type="text" id="cf-tz-offset"'));
  assert.ok(appJs.includes("resolvedOptions().timeZone"), "should detect the device IANA timezone");
  assert.ok(appJs.includes("axisSyncCurrentTimezone"));
});

test("current-location is opt-in only (no geolocation call on load)", () => {
  const bootMatch = appJs.match(/async function boot\(\)[\s\S]*?\n}\n/);
  assert.ok(bootMatch, "boot() should be found");
  assert.ok(!bootMatch[0].includes("geolocation"), "boot() must not call geolocation directly");
  assert.ok(appJs.includes("navigator.geolocation"), "geolocation should still be used, just not on load");
  assert.ok(appJs.includes("current-sky-use-location"));
});

test("Home puts Today's Fortune above Technical Sky", () => {
  // The reading is what someone opened the app for; the technical section
  // explains it. Reversing them made Orbit open on planetary positions.
  const fortune = html.indexOf('id="today-fortune"');
  const sky = html.indexOf('id="today-sky"');
  assert.ok(fortune > 0 && sky > 0, "both Home mount points should exist");
  assert.ok(fortune < sky, "the fortune must be rendered before Technical Sky");
});

test("Technical Sky is named as such and shows positions without a mode switch", () => {
  assert.ok(appJs.includes("Technical Sky"), "the section should be named Technical Sky");
  // Dev Update 1.6 removes the full body-by-body table from Home. It is the
  // densest content in the product, it sat on the page opened first, and it is
  // the Positions workspace that Dev Update 1.7 owns.
  assert.ok(!appJs.includes("sky-technical__title"), "the duplicated positions table is gone from Home");
  // Scoped to the Home renderer: My Chart legitimately renders tables of its
  // own (Dev Update 1.5), and a whole-file scan would flag those instead.
  const techStart = appJs.indexOf("function axisRenderTechnicalSky(");
  assert.ok(techStart > -1, "Technical Sky has its own renderer");
  const techEnd = appJs.indexOf("\nfunction ", techStart + 40);
  const techSource = appJs.slice(techStart, techEnd > techStart ? techEnd : undefined);
  assert.ok(!techSource.includes("<table"), "Home emits no positions table");
  assert.ok(!techSource.includes("<tbody"), "and no table body");
  assert.ok(appJs.includes("tech-sky__more"), "Technical Sky is a folded disclosure");
  // Dev Update 1.7 built the workspace this was standing in for. Technical Sky
  // now points at Current Positions, which is where every position actually
  // lives; Today's Transits keeps the personal-chart interactions.
  assert.match(appJs, /See every position in Current Positions/,
    "and points at the workspace that carries the full list");
  assert.ok(!appJs.includes("See every position in Today’s Transits"),
    "the interim wording is retired now that Positions exists");
  // The old gate read AXIS.detail === "Advanced" before showing positions.
  assert.ok(!appJs.includes('AXIS.detail === "Advanced"'),
    "positions must not be gated behind a detail level any more");
});

test("the season is stated once, not twice", () => {
  // "Cancer Season" and "Sun in Cancer" were the same fact in two chips.
  // Still true, and now for a second component: Technical Sky states degrees
  // ("Sun 8°14′ Leo"), which is precision the season chip does not carry —
  // not the same fact told twice.
  assert.ok(!/Sun in \$\{esc\(sky\.sun\.sign\)\}/.test(appJs),
    "the redundant 'Sun in <sign>' chip should be gone");
  const highlights = readFileSync(join(ROOT, "lib", "home", "highlights.js"), "utf8");
  assert.match(highlights, /\$\{sky\.zodiac_season\} season/, "the season is stated once, in the highlights");
  assert.match(appJs, /Sun \$\{pos\(sky\.sun\)\}|pos\(sky\.sun\)/,
    "Technical Sky states the Sun by degree, not by sign name");
});

// ── One experience, and it is the complete one ──────────────────────────────
//
// Update 5.2 removed the Simple/Advanced switch. The A2 pass briefly restored a
// three-level selector; it was removed again on 2026-08-27 at Erik's direction,
// so 5.2's reasoning is once more the standing decision and these tests guard
// it. Depth is still disclosed — the fortune sheet explains any one card on
// demand — but never behind a global mode the reader has to find.

test("no detail-level control survives anywhere", () => {
  for (const relic of ['data-level="Simple"', 'data-level="Advanced"', "axis-detail", "data-detail-level"]) {
    assert.ok(!html.includes(relic), `${relic} should be gone from the markup`);
  }
  const css = readFileSync(join(ROOT, "public", "styles", "orbit-axis.css"), "utf8");
  assert.ok(!css.includes(".detail-segment"), "the segmented control's styles go with it");
});

test("a stored preference cannot hide content", () => {
  // Backward compatibility: the saved value is read but not obeyed, and is
  // deliberately not deleted.
  assert.match(appJs, /AXIS\.detail = "Advanced"/,
    "loading should resolve to the complete experience regardless of what is stored");
  assert.match(appJs, /return "advanced"/,
    "detailKeyFor should always select the advanced phrasing");
});

test("depth is disclosed per card instead, and costs no request", () => {
  // What replaced the switch: a sheet that explains ONE card, opened on demand.
  assert.match(appJs, /function axisOpenFortuneSheet\(/, "the per-card sheet exists");
  const body = appJs.slice(appJs.indexOf("function axisOpenFortuneSheet"), appJs.indexOf("function axisWireFortuneSheet"));
  for (const call of ["await get(", "await post(", "await put(", "fetch("]) {
    assert.ok(!body.includes(call), `opening the sheet must not call ${call}`);
  }
  assert.match(body, /AXIS\.lastFortune/, "it reads the fortune already in memory");
});