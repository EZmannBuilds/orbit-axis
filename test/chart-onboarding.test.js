// Orbit Axis :: Dev Update 1.4 — the chart form.
//
// The project has no DOM harness, so these assert over the shipped HTML, CSS,
// and controller source. That limits what they can prove: they cannot click
// anything, and the behaviours that only appear when the form actually runs
// were verified in a browser instead and recorded in the development log.
//
// What they DO protect is the set of properties that regress silently — a
// second chart form reappearing, a validation rule that exists on the client
// but not the server, a certainty option that stops mapping to a stored value,
// or a modal that goes back to being sized in `vh`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");

const html = read("public", "index.html");
const appJs = read("public", "app.js");
const componentsCss = read("public", "styles", "components.css");
const featuresCss = read("public", "styles", "features.css");
const authCss = read("public", "styles", "auth.css");
const chartService = read("lib", "charts", "service.js");
const chartApi = read("lib", "charts", "api.js");

/** The form's markup, isolated so assertions cannot pass on some other dialog. */
const chartModal = html.slice(html.indexOf('id="chart-modal"'), html.indexOf('id="confirm-modal"'));

// ── One form ────────────────────────────────────────────────────────────────

test("exactly one chart form ships", () => {
  const forms = [...html.matchAll(/<form[^>]*id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(forms.filter((f) => f.includes("chart")), ["chart-modal-form"]);
});

test("the duplicate forms Dev Update 1.4 removed cannot come back unnoticed", () => {
  // `ob-` was the first-run dialog; `oa-` was a third form injected into Home
  // that could never succeed for the signed-out audience that saw it.
  for (const relic of ["ob-place", "ob-date", "ob-accuracy", "onboarding-form", "onboarding-gate",
                       "oa-setup", "oa-place", "oa-date", "oa-accuracy"]) {
    assert.ok(!html.includes(`id="${relic}"`), `${relic} must not be in the markup`);
    assert.ok(!appJs.includes(`#${relic}"`), `${relic} must not be referenced by the controller`);
  }
  assert.ok(!appJs.includes("function wireOnboarding"), "the separate onboarding wiring is gone");
  assert.ok(!appJs.includes("forceMyChart"), "the first-chart special case is a mode now, not a flag");
});

test("the three modes differ only in copy, defaults, and what follows a save", () => {
  const block = appJs.slice(appJs.indexOf("const CHART_MODES = {"), appJs.indexOf("const chartForm = {"));
  for (const mode of ["first", "add", "edit"]) {
    assert.ok(new RegExp(`\\b${mode}: \\{`).test(block), `${mode} mode must be declared`);
  }
  // Every mode declares the same keys — a mode that quietly grows its own field
  // set is the beginning of a second form.
  const keys = [...block.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
  const counts = keys.reduce((acc, k) => ({ ...acc, [k]: (acc[k] || 0) + 1 }), {});
  for (const [key, n] of Object.entries(counts)) {
    assert.equal(n, 3, `${key} should be declared once per mode, saw ${n}`);
  }
});

test("first-run onboarding opens the same form every other entry point opens", () => {
  const resolver = appJs.slice(appJs.indexOf("async function resolveChartState"),
                               appJs.indexOf("function setStartupStatus"));
  assert.match(resolver, /STARTUP_VIEW\.ONBOARDING[\s\S]{0,200}openChartForm\("first"\)/);
  assert.equal((resolver.match(/openChartForm\(/g) || []).length, 1,
    "a form nobody asked for may have exactly one automatic trigger");
});

test("relationship is hidden for your own first chart", () => {
  // Asking who this chart is related to, while creating your own, implies it
  // might be somebody else's.
  assert.match(appJs, /first: \{[\s\S]{0,400}showRelationship: false/);
  assert.match(appJs, /\$\("#cm-relationship-field"\)\.hidden = !config\.showRelationship/);
});

// ── Validation, on both sides of the wire ───────────────────────────────────

test("the client rejects impossible and future birth dates", () => {
  assert.match(appJs, /function isRealCalendarDate/);
  assert.match(appJs, /function isFutureDate/);
  // Round-tripping through Date is what catches 31 February.
  assert.match(appJs, /probe\.getUTCFullYear\(\) === y/);
  assert.match(appJs, /can't be in the future/);
});

test("the server rejects them too, because the client is not the boundary", () => {
  // A request can arrive without ever passing through the browser. Before
  // Dev Update 1.4 this checked presence and nothing else.
  assert.match(chartService, /function assertUsableBirthDate/);
  assert.match(chartService, /assertUsableBirthDate\(out\.birth_date\)/);
  assert.match(chartService, /is not a real calendar date/);
  assert.match(chartService, /cannot be in the future/);
});

test("birth dates are compared as calendar dates, never as instants", () => {
  // Converting a birth date to an instant makes "today" wrong for roughly half
  // the planet for half of every day.
  for (const source of [appJs, chartService]) {
    assert.ok(!/new Date\(\s*value\s*\)\s*[<>]/.test(source),
      "a birth date must not be compared by constructing an instant from it");
  }
  assert.match(chartService, /tomorrowKey/, "the server allows a day of slack against UTC");
});

test("validation reports every bad field and focuses the first", () => {
  const fn = appJs.slice(appJs.indexOf("function validateChartForm"), appJs.indexOf("function chartFormPayload"));
  for (const field of ["nickname", "date", "time", "place"]) {
    assert.ok(fn.includes(`"${field}"`), `${field} must be validated`);
  }
  assert.match(fn, /if \(!firstBad\) firstBad = /, "the first offending field is remembered");
  assert.match(appJs, /firstBad\.focus\(/, "and focused");
});

test("a name is required and trimmed, and is never silently rewritten", () => {
  assert.match(appJs, /\$\("#cm-nickname"\)\.value\.trim\(\)/);
  assert.match(appJs, /Give this chart a name\./);
  assert.match(appJs, /const NAME_MAX = 80/);
  // The old flow forced every first chart to the literal "My Chart" regardless
  // of what was typed. It is now only a default value.
  assert.match(appJs, /defaultName: "My Chart"/);
  assert.ok(!/nickname: forceMyChart \? "My Chart"/.test(appJs));
});

test("a double submit cannot fire twice", () => {
  assert.match(appJs, /if \(chartForm\.submitting\) return;/);
  assert.match(appJs, /chartForm\.submitting = true/);
  assert.match(appJs, /finally \{[\s\S]{0,160}chartForm\.submitting = false/);
});

// ── Birth-time certainty ────────────────────────────────────────────────────

test("the three certainty choices map to values the server already stores", () => {
  const stored = /const TIME_ACCURACIES = new Set\(\[([^\]]+)\]\)/.exec(chartService)[1]
    .split(",").map((s) => s.trim().replace(/"/g, ""));
  const offered = [...chartModal.matchAll(/name="cm-accuracy" value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(offered, ["exact", "approximate", "unknown"]);
  for (const value of offered) {
    assert.ok(stored.includes(value), `${value} must be a value the server accepts`);
  }
  // No migration was needed, and none may be smuggled in.
  assert.ok(stored.includes("reported"), "the stored vocabulary is unchanged");
});

test("a stored 'reported' time presents as a known time, not as unknown", () => {
  // "reported" has no radio of its own. Falling back to the first radio rather
  // than to Unknown matters: it is a known time, and defaulting it to Unknown
  // would silently discard the user's birth time on their next edit.
  assert.match(appJs, /input\[name="cm-accuracy"\]\[value="\$\{accuracy\}"\][\s\S]{0,260}value="exact"/);
});

test("certainty is asked before the time it qualifies", () => {
  const fieldset = chartModal.indexOf("How sure are you of the birth time?");
  const timeField = chartModal.indexOf('id="cm-time-field"');
  assert.ok(fieldset > 0 && timeField > fieldset,
    "asking for a time first and then asking how sure you are invites a guess");
});

test("choosing Unknown hides the time field and states the consequences", () => {
  assert.match(appJs, /function syncTimeCertainty/);
  assert.match(appJs, /const unknown = chartAccuracy\(\) === "unknown"/);
  assert.match(appJs, /if \(field\) field\.hidden = unknown/);
  const notice = chartModal.slice(chartModal.indexOf('id="cm-unknown-notice"'));
  assert.match(notice, /House placements/);
  assert.match(notice, /Rising sign/);
  assert.match(notice, /rather than guessing/);
});

test("an unknown time is sent as null rather than as a guess", () => {
  assert.match(appJs, /birth_time: accuracy === "unknown" \? null :/);
  assert.match(chartService, /if \(acc === "unknown"\) out\.birth_time = null/);
});

test("the noon fallback stays flagged rather than presented as fact", () => {
  const timezone = read("lib", "locations", "timezone.js");
  assert.match(timezone, /time_known: false/, "the fallback marks itself");
  assert.match(chartService, /time_known: chart\.time_known/, "and that reaches the client");
});

// ── Birthplace ──────────────────────────────────────────────────────────────

test("the birthplace input is a real combobox", () => {
  const field = chartModal.slice(chartModal.indexOf('id="cm-place"'), chartModal.indexOf('id="cm-relationship-field"'));
  assert.match(field, /role="combobox"/);
  assert.match(field, /aria-expanded="false"/);
  assert.match(field, /aria-autocomplete="list"/);
  assert.match(field, /aria-controls="cm-place-results"/);
  assert.match(field, /role="listbox"/);
});

test("results are keyboard navigable and dismissible", () => {
  const fn = appJs.slice(appJs.indexOf("function setupPlaceSearch"));
  assert.match(fn, /event\.key === "ArrowDown"/);
  assert.match(fn, /event\.key === "ArrowUp"/);
  assert.match(fn, /event\.key === "Enter"/);
  assert.match(fn, /event\.key === "Escape"/);
  assert.match(appJs, /setAttribute\("aria-activedescendant"/);
});

test("Enter only belongs to the list when the list is open", () => {
  // Otherwise Enter would stop submitting the form.
  assert.match(appJs, /if \(!results\.hidden && choosePlaceActive\(prefix\)\) event\.preventDefault\(\)/);
});

test("Escape closes the results list before it closes the dialog", () => {
  // The dialog's Escape handler is registered in the CAPTURE phase, so without
  // an explicit check it wins the race against the combobox and throws away
  // everything the person typed when they only meant to dismiss the list.
  const open = appJs.slice(appJs.indexOf("function openModal"), appJs.indexOf("function closeModal"));
  assert.match(open, /\[role=listbox\]:not\(\[hidden\]\)/,
    "an open combobox must own Escape first");
  const escBlock = open.slice(open.indexOf('event.key === "Escape"'));
  assert.ok(escBlock.indexOf("role=listbox") < escBlock.indexOf("closeModal(el)"),
    "the check must come before the close");
});

test("the result count is announced, not just rendered", () => {
  assert.match(appJs, /\$\{items\.length\} \$\{items\.length === 1 \? "match" : "matches"\}/);
  assert.match(chartModal, /id="cm-place-status"[^>]*role="status"[^>]*aria-live="polite"/);
});

test("search is debounced and a slow answer cannot overwrite a fast one", () => {
  // Asserted as a RANGE, not a literal. Every search that gets through is a
  // billed Geoapify credit, so this number is a cost/latency dial someone will
  // legitimately turn — but both ends of it are real failures. Too low and a
  // slow typist pays one credit per keystroke; too high and the birthplace
  // field feels broken on the form that decides whether anyone signs up.
  const debounce = Number(appJs.match(/const PLACE_DEBOUNCE_MS = (\d+)/)?.[1]);
  assert.ok(Number.isFinite(debounce), "the debounce must be a plain literal we can audit");
  assert.ok(debounce >= 250, `debounce ${debounce}ms is low enough to bill a credit per keystroke`);
  assert.ok(debounce <= 600, `debounce ${debounce}ms makes birthplace search feel broken`);

  // The 3-character floor is deliberate: Ely, Rye, Ufa and Jos are real places.
  const minQuery = Number(appJs.match(/const PLACE_MIN_QUERY = (\d+)/)?.[1]);
  assert.equal(minQuery, 3, "raising this to save a request makes short place names unsearchable");

  assert.match(appJs, /state\.places\.controllers\[prefix\]\?\.abort\(\)/);
  assert.match(appJs, /if \(error\.name === "AbortError"\) return;/);
});

test("every place failure state is distinguishable and recoverable", () => {
  const fn = appJs.slice(appJs.indexOf("async function runPlaceSearch"), appJs.indexOf("function setupPlaceSearch"));
  assert.match(fn, /Searching…/);
  assert.match(fn, /No places matched/);
  assert.match(fn, /isn't available right now/, "provider-unconfigured reads differently from no-results");
  assert.match(fn, /You can try again/);
});

// ── Place-token safety ──────────────────────────────────────────────────────

test("editing the text after choosing a place clears the selection", () => {
  // Keeping the old token would save a chart for a city the user just deleted.
  assert.match(appJs, /if \(selected && input\.value\.trim\(\) !== selected\.label\) \{[\s\S]{0,120}clearPlaceSelection/);
});

test("a chart cannot be saved against a place the server did not sign", () => {
  assert.match(appJs, /if \(typed !== place\.label\) throw new Error/);
  assert.match(appJs, /if \(place\.selection_token\) return \{ birthplace: place \}/);
  // The server is the actual boundary.
  const geoapify = read("lib", "locations", "geoapify.js");
  assert.match(geoapify, /export function verifyPlaceSignature/);
  assert.match(geoapify, /timingSafeEqual/);
  assert.match(chartService, /verifyPlaceSignature\(normalized, place\.selection_token\)/);
  assert.match(chartService, /Choose a birthplace from the search results/);
});

test("a place-signing failure is a real status, not a bare 500", () => {
  // Verifying the signature needs the provider key. Without it the signer
  // raises a LocationError, which used to surface as "Chart operation failed".
  assert.match(chartApi, /import \{ LocationError \}/);
  assert.match(chartApi, /e instanceof LocationError/);
  assert.match(chartApi, /err\(e\.status \|\| 400, e\.message, \{ code: e\.code \}\)/);
});

// ── After the save ──────────────────────────────────────────────────────────

test("the first chart earns a destination rather than an empty shell", () => {
  const fn = appJs.slice(appJs.indexOf("async function afterChartSaved"));
  assert.match(fn, /if \(mode === "first"\)[\s\S]{0,220}navigate\("me"\)/);
  assert.match(fn, /refreshActiveExperience\(\)/);
  assert.match(fn, /mychart-title/, "focus lands on the heading, so arrival is announced");
  assert.ok(html.includes('id="mychart-title" tabindex="-1"'), "and the heading can take focus");
});

test("adding or editing refreshes the surfaces that depend on the chart", () => {
  const fn = appJs.slice(appJs.indexOf("async function afterChartSaved"));
  assert.match(fn, /await loadSavedCharts\(\)/);
  assert.match(fn, /await resolveChartState\(\)/);
  assert.match(fn, /refreshSecondaryRoute\(\)/, "Transits and the atlas re-render too");
});

test("focus returns to whatever opened the form", () => {
  assert.match(appJs, /chartForm\.openedBy = document\.activeElement/);
  const fn = appJs.slice(appJs.indexOf("async function afterChartSaved"));
  assert.match(fn, /opener && document\.contains\(opener\)/, "but only if it is still on screen");
});

test("editing keeps the chart's identity instead of creating a second record", () => {
  assert.match(appJs, /const id = chartForm\.chartId;/);
  assert.match(appJs, /id\s*\n?\s*\? await patch\(`\/api\/charts\/\$\{id\}`, payload\)\s*\n?\s*: await post\("\/api\/charts", payload\)/);
});

// ── Dialog and mobile ───────────────────────────────────────────────────────

test("the form dialog keeps real dialog semantics", () => {
  assert.match(chartModal, /role="dialog"/);
  assert.match(chartModal, /aria-modal="true"/);
  assert.match(chartModal, /aria-labelledby="chart-modal-title"/);
  assert.match(chartModal, /aria-describedby="chart-modal-intro"/);
  assert.match(appJs, /openModal\(modal, \{[\s\S]{0,200}initialFocus: \$\("#cm-nickname"\)/);
});

test("the dialog is sized so a mobile keyboard cannot cover Save", () => {
  // `vh` does not shrink when the keyboard opens; `dvh` does.
  assert.match(componentsCss, /\.o-modal__panel--form \{[\s\S]{0,220}100dvh/);
  assert.match(componentsCss, /\.o-modal__scroll \{[\s\S]{0,200}overflow-y: auto/);
  assert.match(componentsCss, /overscroll-behavior: contain/, "scrolling the form must not scroll the page behind it");
  assert.match(componentsCss, /@media \(max-height: 520px\)/, "a landscape phone with the keyboard up still fits");
});

test("the sticky action bar does not let the form show through beneath it", () => {
  const scroll = componentsCss.slice(componentsCss.indexOf(".o-modal__scroll {"), componentsCss.indexOf(".o-modal__panel--form .o-modal__actions"));
  assert.ok(!/padding-bottom/.test(scroll), "bottom padding here sits below the sticky bar");
  // Opaque, and the SAME fill as the panel it sits in — a translucent bar, or
  // one filled with a different surface token, lets the last field show through
  // underneath Save.
  assert.match(componentsCss, /\.o-modal__panel--form \.o-modal__actions \{[\s\S]{0,400}background: var\(--color-surface\)/);
  assert.match(componentsCss, /\.o-modal__panel \{[\s\S]{0,400}background: var\(--color-surface\)/,
    "the bar's fill has to match the panel's, so they are asserted together");
});

test("form controls meet the touch target and do not trigger iOS zoom", () => {
  assert.match(featuresCss, /\.chart-form input\[type="text"\][\s\S]{0,400}min-height: 44px/);
  assert.match(featuresCss, /font-size: 16px/, "anything smaller makes iOS zoom the page on focus");
  assert.match(featuresCss, /\.chart-choice__option \{[\s\S]{0,200}min-height: 44px/);
  assert.match(featuresCss, /\.place-result \{[\s\S]{0,200}min-height: 44px/);
  assert.match(componentsCss, /\.o-modal__close \{[\s\S]{0,120}width: 44px; height: 44px/);
  assert.match(componentsCss, /\.o-modal__panel--form \.o-modal__actions \.o-btn \{ min-height: 44px; \}/);
});

test("the password Show control no longer wraps onto its own row", () => {
  // Dev Update 1.3 known issue: a max-width rule dropped it below the field,
  // where it read as a second unlabelled button.
  assert.match(authCss, /\.password-row button \{[\s\S]{0,400}min-width: 68px/);
  const mobile = authCss.slice(authCss.indexOf("@media (max-width: 560px)"));
  assert.ok(!/\.password-row \{ grid-template-columns: 1fr; \}/.test(mobile));
});

test("focus never falls to the body after a dialog closes", () => {
  // "Falls back to the body" is not a fallback, it is focus loss: a keyboard
  // user lands nowhere and a screen reader announces nothing.
  assert.match(appJs, /function restoreFocusAfterClose/);
  const fn = appJs.slice(appJs.indexOf("function restoreFocusAfterClose"));
  assert.match(fn, /opener !== document\.body/);
  assert.match(fn, /offsetParent !== null/, "a hidden opener is not a usable target");
  assert.match(fn, /\.workspace-panel:not\(\[hidden\]\) h1/, "the visible heading is the fallback");
  assert.ok(!/entry\.restoreTo\.focus\(\);\s*\n\}/.test(appJs), "the old unguarded restore is gone");
});

test("errors are stated in words and not by colour alone", () => {
  assert.match(featuresCss, /\.chart-field__error::before[\s\S]{0,120}content: "! "/);
  assert.match(chartModal, /id="cm-date-error" role="alert"/);
  assert.match(appJs, /input\.setAttribute\("aria-invalid", "true"\)/);
});

// ── Trust copy ──────────────────────────────────────────────────────────────

test("privacy, terms, and support are reachable before birth data is submitted", () => {
  const privacy = chartModal.slice(chartModal.indexOf("chart-form__privacy"));
  for (const href of ["/privacy", "/terms", "/support"]) {
    assert.ok(privacy.includes(`href="${href}"`), `${href} must be linked from the form`);
  }
  assert.match(privacy, /private to your account/);
  assert.match(privacy, /does.{0,4}n.t depend on generative AI|Nothing here depends on generative AI/);
  assert.match(privacy, /export or delete/);
});

test("the form invents no legal facts", () => {
  for (const invented of [/support@/i, /\bInc\b|\bLLC\b|\bLtd\b/, /jurisdiction/i, /aged? \d+/i]) {
    assert.doesNotMatch(chartModal, invented, "legal facts stay in configuration, not in form copy");
  }
});

test("Home's no-chart state stopped being a third form, and is never a dead end", () => {
  const fn = appJs.slice(appJs.indexOf("function axisRenderSetup"), appJs.indexOf("// ── History"));
  assert.ok(!/<form/.test(fn), "it is a call to action now");
  assert.match(fn, /openChartForm\(/, "which opens the one real form");
  // The signed-out branch used to end at "Sign in first — your chart is saved
  // to your account". True, and a dead end: the highest-intent card in the app
  // stated our architecture and gave the visitor nothing to press.
  assert.doesNotMatch(fn, /Sign in first/,
    "signed-out visitors are offered the chart, not told what we require");
  assert.match(fn, /requireAccount\(/,
    "the account is asked for when the button is pressed, not implied by a missing button");
});

test("the chart form asks for an account at its one door", () => {
  // Four call sites reach the form and all of them go through openChartModal.
  // The guard belongs there: birthplace search is authenticated and per-user
  // rate limited, so a signed-out visitor who reaches the fields can only meet
  // a 401 under the Save button.
  const fn = appJs.slice(appJs.indexOf("function openChartModal"), appJs.indexOf("/* ── Chart identity editor"));
  assert.match(fn, /requireAccount\("chart"\)/, "the one door carries the one guard");
  assert.ok(
    fn.indexOf("requireAccount") < fn.indexOf("openChartForm"),
    "the guard runs before any form is opened",
  );
});
