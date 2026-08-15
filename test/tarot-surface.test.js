// Orbit Axis :: the Tarot surface — navigation, semantics, and the gate.
//
// Source-level where the behaviour lives in markup or in a render-time
// decision. The header of client-references.test.js is right that reading
// source cannot prove behaviour, so this file deliberately covers only
// structural facts a source read CAN establish, and the browser pass covers
// the rest.
//
// The load-bearing one is the last group: PRODUCTION CANNOT EXPOSE AN
// INCOMPLETE DECK. Three independent things have to fail simultaneously for a
// stranger to meet a half-built tarot page, and each is asserted separately.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../lib/local-llm/config.js";

import { featureEnabled, workspaceBlocked } from "../lib/features.js";
import { DECK_VERSION, PRODUCTION_CARDS, deckStatus, validateCard, validateDeck } from "../lib/tarot/deck.js";
import { FIXTURE_DECK_REVIEWED } from "./fixtures/tarot-deck.js";
import {
  EXPORT_SCHEMA_VERSION, EXPORT_SOURCES, EXPORT_TAROT_FIELDS,
  auditExportPrivacy, presentExportTarotReading, stripSecrets,
} from "../lib/account/export.js";
import { USER_OWNED_TABLES } from "../lib/account/deletion.js";

const APP = readFileSync(join(REPO_ROOT, "public", "app.js"), "utf8");
const HTML = readFileSync(join(REPO_ROOT, "public", "index.html"), "utf8");
const PANEL_RAW = readFileSync(join(REPO_ROOT, "features", "panels", "tarot.html"), "utf8");
// What the browser actually receives. The comments in this fragment discuss
// role="tabpanel" and predictive language in order to explain why neither is
// used — so a naive scan of the raw file finds both and fails on the
// explanation rather than on the markup.
const PANEL = PANEL_RAW.replace(/<!--[\s\S]*?-->/g, "");
const ICONS = readFileSync(join(REPO_ROOT, "public", "icons.js"), "utf8");
const PRIVACY = readFileSync(join(REPO_ROOT, "public", "privacy.html"), "utf8");
const SERVER = readFileSync(join(REPO_ROOT, "lib", "server", "create-app.js"), "utf8");

/* ── The five-tab ceiling ─────────────────────────────────────────────────── */

test("there are still exactly five primary destinations", () => {
  const primaries = APP.match(/\{ id: "[^"]+",[^}]*primary: true[^}]*\}/g) || [];
  assert.equal(primaries.length, 5, "five is a ceiling, not a starting point");
  const ids = primaries.map((entry) => entry.match(/id: "([^"]+)"/)[1]);
  assert.deepEqual(ids, ["home", "me", "transits", "symbol-atlas", "more"]);
});

test("Tarot is a secondary destination that lights Today", () => {
  const entry = APP.match(/\{ id: "tarot",[^}]*\}/)[0];
  assert.match(entry, /primary: false/, "Tarot must not become a sixth tab");
  assert.match(entry, /tab: "home"/, "#tarot must keep Today current, not You");
  assert.match(entry, /feature: "tarot"/, "and it stays behind its flag");
});

/* ── The Today switch ─────────────────────────────────────────────────────── */

test("the Today switch is real links, not a tablist", () => {
  for (const source of [HTML, PANEL]) {
    const nav = source.match(/<nav class="o-segment o-segment--block" aria-label="Today views">[\s\S]*?<\/nav>/);
    assert.ok(nav, "both Today routes carry the switch");
    assert.match(nav[0], /<a href="#home"/);
    assert.match(nav[0], /<a href="#tarot"/);
    // Links navigate; a tablist would be a promise the markup does not keep.
    assert.ok(!/role="tab(list)?"/.test(nav[0]));
    assert.ok(!/aria-selected/.test(nav[0]));
  }
});

test("the current Today view is announced with aria-current", () => {
  assert.match(APP, /function syncTodayViews/);
  assert.match(APP, /data-today-view[\s\S]{0,300}setAttribute\("aria-current", "page"\)/);
  // Removed rather than set to "false" — some screen readers still announce it.
  assert.match(APP, /removeAttribute\("aria-current"\)/);
});

test("the switch is hidden entirely while Tarot is unavailable", () => {
  // An unfinished feature must not appear in navigation. A segmented control
  // whose second half 404s is worse than no control at all.
  assert.match(APP, /const available = workspaceAvailable\("tarot"\)/);
  assert.match(APP, /holder\.hidden = !available/);
  assert.match(HTML, /<div class="subnav" id="today-views" hidden>/,
    "it starts hidden, so a slow flag check cannot flash it");
});

/* ── Panel semantics ──────────────────────────────────────────────────────── */

test("the panel is a region named by its own visible heading", () => {
  assert.match(PANEL, /<section class="workspace-panel" id="panel-tarot" role="region" aria-labelledby="tarot-title"/);
  assert.match(PANEL, /id="tarot-title"/);
  // The scaffold was role="tabpanel" pointing at a rail item with no tablist
  // anywhere. That is the exact defect Dev Update 1.3 repaired everywhere else.
  assert.ok(!/role="tabpanel"/.test(PANEL));
  assert.ok(!/aria-labelledby="tab-tarot"/.test(PANEL));
});

test("the panel has exactly one h1", () => {
  assert.equal((PANEL.match(/<h1/g) || []).length, 1);
});

test("the retired Ask Orbit action is gone from Tarot", () => {
  // Ask Orbit was removed from the product; the scaffold still pointed at it.
  // Scoped to the Tarot surface deliberately — features/panels/news.html still
  // carries one, which is a separate gated feature and a separate change.
  assert.ok(!/data-chat-prompt/.test(PANEL));
  assert.ok(!/Ask About This Reading/.test(PANEL));
  assert.ok(!/\bAsk Orbit\b/.test(PANEL));
});

test("the placeholder's dead states are replaced, not extended", () => {
  assert.ok(!/Coming soon/i.test(PANEL), "a disabled mode is not a state, it is an apology");
  assert.ok(!/aria-disabled="true"/.test(PANEL));
  assert.ok(!/tarot-modes|tarot-mode\b|tarot-hero/.test(PANEL));
});

test("the lead language is present and predictive language is not", () => {
  assert.match(PANEL, /A prompt, not a prediction/);

  // Sentence by sentence, because a NEGATED claim is the opposite of a
  // promise: "it does not tell you what will happen" is precisely the
  // sentence this rule wants to see, and a bare keyword scan fails it.
  const text = PANEL.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const forbidden = /\b(?:destiny|fated|guaranteed|will happen|your future)\b/i;
  const offenders = text.split(/(?<=[.?!])\s+/)
    .filter((sentence) => forbidden.test(sentence) && !/\b(?:not|never|no)\b/i.test(sentence));
  assert.deepEqual(offenders, [], "the panel must not promise an outcome");
});

test("the three-card positions appear nowhere as predictions", () => {
  // Past/Present/Future is the spread this deliberately is not.
  assert.ok(!/past,\s*present,\s*future/i.test(PANEL + APP));
});

/* ── Icons ────────────────────────────────────────────────────────────────── */

test("every workspace icon resolves in the built icon set", () => {
  const icons = [...APP.matchAll(/\{ id: "[^"]+",[^}]*icon: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(icons.length >= 8);
  for (const name of new Set(icons)) {
    assert.ok(ICONS.includes(`"${name}"`), `icon "${name}" is not in the generated set`);
  }
});

/* ── Accessibility surface ────────────────────────────────────────────────── */

test("the panel announces through one live region", () => {
  assert.match(PANEL, /id="tarot-status" role="status" aria-live="polite"/);
  assert.match(APP, /function tarotSay/);
});

test("a card's meaning never depends on its artwork", () => {
  // The face is aria-hidden decoration; every word on it is repeated as real
  // text beside the card. A screen reader must never be asked to read a layout.
  // Face down, the card IS the control: a real button with an accessible name,
  // and the artwork inside it aria-hidden. "No reveal button" is about the
  // interface, not about excluding anyone who cannot tap.
  assert.match(APP, /class="tarot-card o-object tarot-card--down"/);
  // The label is per card now — "Turn over today's card" for the daily one,
  // "Turn over What is present" for a card in a spread — so a screen reader is
  // never told to turn over "the card" when three are on screen.
  assert.match(APP, /aria-label="\$\{esc\(label\)\}"/);
  assert.match(APP, /label = "Turn over today's card"/);
  assert.match(APP, /label: `Turn over \$\{entry\.position\}`/);
  assert.match(APP, /tarot-card__back" aria-hidden="true"/);
  assert.match(APP, /class="tarot-card o-object tarot-card--up" aria-hidden="true"/);
  assert.match(APP, /function tarotMeaningHtml/);
  assert.match(APP, /tarot-meaning__name"[^>]*>\$\{esc\(card\.name\)\}/);
  // The heading is a focus target after a reveal, which needs tabindex="-1" —
  // focus() on a bare <h3> silently does nothing.
  assert.match(APP, /tarot-meaning__name" tabindex="-1"/);
});

test("the card is the one object allowed a shadow", () => {
  const css = readFileSync(join(REPO_ROOT, "public", "styles", "tarot.css"), "utf8");
  // .o-object carries the single object shadow; nothing here may define a
  // second. Declarations are extracted and judged individually — an inline
  // `\s*(?!…)` lookahead backtracks to zero width and passes on everything,
  // which is how an earlier version of this test guarded nothing at all.
  const declarations = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/box-shadow:\s*([^;}]+)/g)]
    .map((match) => match[1].trim());
  const shadows = declarations.filter((value) => !value.startsWith("var(--focus-ring"));
  assert.deepEqual(shadows, [],
    "cards, panels, buttons and rows around the object stay shadowless");
  // And the guard is not vacuous: every box-shadow here is a focus ring, and
  // there are several (the card button, the carousel, its dots).
  assert.ok(declarations.length >= 1);
  assert.match(css, /aspect-ratio:\s*2\s*\/\s*3/, "a tarot card is 2:3");
});

test("reduced motion shows the final state without losing feedback", () => {
  const css = readFileSync(join(REPO_ROOT, "public", "styles", "tarot.css"), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}animation: none/);
  // The reveal is still announced, so the state change survives the animation
  // being removed.
  assert.match(APP, /tarotSay\(name \? `Today's card is \$\{name\}\.`/);
});

test("forced colors keeps the card an object", () => {
  const css = readFileSync(join(REPO_ROOT, "public", "styles", "tarot.css"), "utf8");
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /border: 1px solid CanvasText/);
});

/* ── The daily card's promise ─────────────────────────────────────────────── */

test("the client never draws a card", () => {
  // The whole stability argument rests on this. A client-side pick would mean
  // "today's card" differed between a phone and a laptop.
  const block = APP.slice(APP.indexOf("/* ── Tarot ──"), APP.indexOf("/* ── Toasts"));
  assert.ok(block.length > 2000, "the tarot block should be substantial");
  assert.ok(!/Math\.random/.test(block), "the browser must not select a card");
  assert.match(block, /await get\(`\/api\/tarot\/daily/);
});

test("only the reveal is remembered locally, never the card", () => {
  const block = APP.slice(APP.indexOf("/* ── Tarot ──"), APP.indexOf("/* ── Toasts"));
  assert.match(block, /function tarotRevealKey/);
  assert.match(block, /localStorage\.setItem\(tarotRevealKey\(localDate\), "1"\)/);
  // Storing the card itself would let a stale local copy contradict the server.
  assert.ok(!/localStorage\.setItem\([^)]*card/i.test(block));
  // Private mode must not break the page.
  assert.match(block, /catch \{ return false; \}/);
});

test("returning to an already-revealed card does not still claim to be loading", () => {
  // Found by looking at the page, not by reading the code: on a return visit
  // the card rendered correctly and "Loading today's card…" stayed underneath
  // it forever, because only the face-down branch cleared the status. The
  // clear belongs to the render, which runs after the load either way.
  const fn = APP.slice(APP.indexOf("function renderTarotDaily()"));
  const body = fn.slice(0, fn.indexOf("\nfunction "));
  const guard = body.indexOf("if (!slot || !reading || !entry) return;");
  const revealedBranch = body.indexOf("if (!tarotState.revealed)");
  const clear = body.indexOf('tarotSay("")');
  assert.ok(clear > guard && clear < revealedBranch,
    "the loading line must be cleared once, before either branch renders");
});

test("saving asks for an account at the press, not before the card", () => {
  const block = APP.slice(APP.indexOf("/* ── Tarot ──"), APP.indexOf("/* ── Toasts"));
  assert.match(block, /if \(!authSignedIn\(\)\) \{ requireAccount\("history"\); return; \}/);
  // And the daily card itself is never gated.
  assert.ok(!/loadTarotDaily[\s\S]{0,200}requireAccount/.test(block));
});

/* ── History ──────────────────────────────────────────────────────────────── */

test("history gains explicit Astrology and Tarot views", () => {
  const nav = HTML.match(/<nav class="o-segment o-segment--block" aria-label="History views">[\s\S]*?<\/nav>/);
  assert.ok(nav);
  assert.match(nav[0], /data-history-kind="astrology"/);
  assert.match(nav[0], /data-history-kind="tarot"/);
  assert.match(APP, /function historyKind/);
  assert.match(APP, /async function axisLoadTarotHistory/);
});

test("the seven-day astrology strip keeps its original meaning", () => {
  // The strip promises saved daily SKY readings. Mixing Tarot completion into
  // it would silently change what a filled dot means.
  const tarotHistory = APP.slice(APP.indexOf("async function axisLoadTarotHistory"),
    APP.indexOf("function tarotHistoryRowHtml"));
  assert.ok(!/axisRenderDayStrip/.test(tarotHistory),
    "the Tarot view must not repaint the astrology week strip");
});

/* ── Export and deletion ──────────────────────────────────────────────────── */

test("saved Tarot readings are exported through an explicit allowlist", () => {
  assert.ok(EXPORT_SOURCES.some((s) => s.table === "tarot_readings" && s.column === "owner_id"));
  assert.deepEqual([...EXPORT_TAROT_FIELDS], ["question", "spread_type", "created_at"]);
  assert.equal(EXPORT_SCHEMA_VERSION, "1.3.0", "a new category is a MINOR bump");
});

test("an exported reading carries its meaning and no database identity", () => {
  const exported = presentExportTarotReading({
    id: "8f14e45f-ceea-4e29-9e3a-6d5f4a2b1c3d",
    owner_id: "11111111-1111-4111-8111-111111111111",
    source_note_path: "/vault/private/note.md",
    question: "What am I missing?",
    spread_type: "one_card",
    created_at: "2026-08-15T12:00:00Z",
    reading_data: {
      cards: [{ position: "Your card", card: { slug: "the-star", name: "The Star",
        arcana: "major", suit: null, upright_meaning: "m", reflection_prompt: "p" } }],
      draw: { deck_version: "1.0.0", contract_version: "1.0.0", local_date: "2026-08-15",
        timezone: "UTC", reproducible: false, seed: "deadbeef".repeat(8) },
    },
  });

  assert.equal(exported.id, undefined);
  assert.equal(exported.owner_id, undefined);
  assert.equal(exported.source_note_path, undefined);
  assert.equal(exported.cards[0].slug, "the-star");
  assert.equal(exported.cards[0].upright_meaning, "m");
  assert.equal(exported.drawn.deck_version, "1.0.0");
  // The seed is an internal of the draw, not the reader's content.
  assert.equal(exported.drawn.seed, undefined);

  // And it survives the export's own privacy audit, which forbids raw uuids in
  // server-written fields — the reason readings store slugs at all.
  const audit = auditExportPrivacy({ tarot_readings: [exported] });
  assert.deepEqual(audit.findings, []);
  assert.equal(audit.ok, true);
});

test("secret stripping still runs over tarot content", () => {
  const stripped = stripSecrets({ tarot_readings: [{ question: "q", access_token: "leaked" }] });
  assert.equal(stripped.tarot_readings[0].access_token, undefined);
  assert.equal(stripped.tarot_readings[0].question, "q");
});

test("account deletion still verifies tarot readings are gone", () => {
  assert.ok(USER_OWNED_TABLES.some((t) => t.table === "tarot_readings" && t.column === "owner_id"),
    "a table that can now hold content must stay in the deletion verification");
});

/* ── The production gate, from three directions ───────────────────────────── */

test("production cannot enable Tarot with an environment variable", () => {
  const production = { VERCEL_ENV: "production", ORBIT_ENVIRONMENT: "production", ORBIT_FEATURE_TAROT: "true" };
  assert.equal(featureEnabled("tarot", production), false);
  assert.equal(workspaceBlocked("tarot", production), true);
});

test("production cannot serve the Tarot API even if the flag were on", () => {
  // The route checks the flag itself rather than trusting the client's copy.
  assert.match(SERVER, /route\.startsWith\("\/api\/tarot\/"\)[\s\S]{0,200}featureEnabled\("tarot", process\.env\)/);
  assert.match(SERVER, /Unknown Orbit endpoint/);
});

test("production cannot expose an incomplete deck even with the routes open", () => {
  // The third and last gate: content readiness, independent of both flags.
  assert.equal(PRODUCTION_CARDS.length, 0);
  const status = deckStatus();
  assert.equal(status.ready, false);
  assert.equal(DECK_VERSION, "0.0.0-empty");
});

test("the panel markup cannot reach the production artifact", () => {
  // It lives outside public/, so the deployed static output has nothing to
  // serve — the gate is the filesystem, not a client-side removal.
  assert.ok(!HTML.includes("panel-tarot"),
    "the tarot panel must not be inlined into the shipped document");
});

/* ── Privacy copy ─────────────────────────────────────────────────────────── */

test("privacy copy matches what the feature actually stores", () => {
  assert.match(PRIVACY, /Saved Tarot readings/);
  assert.match(PRIVACY, /reflection prompt|reflection, not a prediction|not a\s*\n?\s*prediction/i);
  // The local marker is disclosed, and described as what it is.
  assert.match(PRIVACY, /whether you have turned over today's Tarot card/);
  assert.match(PRIVACY, /included in your data export and are deleted with your account/);
});


/* ── Reveal by gesture, and the carousel ──────────────────────────────────── */

test("the card is the control; there is no separate reveal button", () => {
  assert.ok(!/Reveal today's card<\/button>/.test(APP),
    "the standalone reveal button is gone");
  // But it is still a real button, so Enter and Space reveal it and it takes
  // focus in tab order. Removing the button was a visual decision, not a
  // decision to make the feature pointer-only.
  assert.match(APP, /<button type="button" class="tarot-card o-object tarot-card--down"/);
  assert.match(APP, /label = "Turn over today's card"/);
});

test("a swipe across the face-down card reveals it, without stealing the scroll", () => {
  assert.match(APP, /pointerdown[\s\S]{0,200}tarot-card--down/);
  assert.match(APP, /dx > 24 && dx > dy/, "horizontal intent only");
  const css = readFileSync(join(REPO_ROOT, "public", "styles", "tarot.css"), "utf8");
  assert.match(css, /touch-action: pan-y/,
    "vertical scrolling must survive, or the card traps the page");
});

test("revealing twice is impossible", () => {
  // A swipe that also registers as a click would otherwise fire both paths.
  const fn = APP.slice(APP.indexOf("function revealTarotDaily"));
  assert.match(fn.slice(0, 400), /if \(tarotState\.revealed \|\| !tarotState\.reading\) return;/);
});

test("a drawn reading replaces today's card rather than stacking beneath it", () => {
  assert.match(APP, /function setTarotDailyHidden/);
  assert.match(APP, /setTarotDailyHidden\(true\)/, "drawing hides the daily card");
  assert.match(APP, /function backToTarotDaily/, "and there is a way back");
  assert.match(APP, /data-tarot-action="back-to-daily"/);
});

test("three cards render as a carousel that keeps its reading order", () => {
  assert.match(APP, /<ol class="tarot-carousel"/, "still an ordered list underneath");
  assert.match(APP, /aria-label="Three cards, in reading order"/);
  // Each card says where it sits, because only one is on screen at a time.
  assert.match(APP, /\$\{i \+ 1\} of \$\{reading\.cards\.length\}/);
  // The dots are real buttons with real names, not decorative spans.
  assert.match(APP, /class="tarot-carousel__dot[^"]*"[\s\S]{0,120}aria-label="Card \$\{i \+ 1\}/);
});

test("the carousel is swiped by the browser, not by a drag handler", () => {
  const css = readFileSync(join(REPO_ROOT, "public", "styles", "tarot.css"), "utf8");
  assert.match(css, /scroll-snap-type: x mandatory/);
  assert.match(css, /scroll-snap-align: start/);
  // No threshold, no drag state, no pointermove bookkeeping for the carousel.
  const carousel = APP.slice(APP.indexOf("function wireTarotCarousel"));
  assert.ok(!/pointermove/.test(carousel.slice(0, 1200)));
  assert.match(carousel.slice(0, 800), /IntersectionObserver/);
});

test("the carousel dots keep a 44px target even with an 8px dot", () => {
  const css = readFileSync(join(REPO_ROOT, "public", "styles", "tarot.css"), "utf8");
  const dot = css.slice(css.indexOf(".tarot-carousel__dot {"), css.indexOf(".tarot-carousel__dot::before"));
  assert.match(dot, /width: 44px/);
  assert.match(dot, /height: 44px/);
});

test("the question field is gone, and nothing still reads it", () => {
  // Reserved for Ask Orbit. A field the client no longer renders but still
  // reads would send undefined and look like a bug in the API.
  assert.ok(!/tarot-question/.test(PANEL), "the field is out of the markup");
  assert.ok(!/\$\("#tarot-question"\)/.test(APP), "and out of the client");
});

test("the server still accepts an optional question, because the API is public", () => {
  // Removing the FIELD is an interface decision. The endpoint keeps accepting
  // and validating a question, so Ask Orbit can supply one later without a
  // second contract — and so a stray client cannot bypass the length check.
  const service = readFileSync(join(REPO_ROOT, "lib", "tarot", "service.js"), "utf8");
  assert.match(service, /export function validateQuestion/);
  assert.match(service, /MAX_QUESTION_LENGTH/);
});


/* ── Imagery: local back, remote fronts, loaded behind the back ──────────── */

test("a drawn card starts face down too, so nothing is watched loading", () => {
  // The face-down state is the loading window. A spread that arrived already
  // revealed would be the one place a reader could watch an image appear.
  assert.match(APP, /tarotState\.manualRevealed = data\.reading\.cards\.map\(\(\) => false\)/);
  assert.match(APP, /function revealTarotSpreadCard/);
  // Turned one at a time, because a three-card reading is a sequence.
  assert.match(APP, /revealed\[index\] = true/);
});

test("fronts are requested when the card is known, not when it is revealed", () => {
  assert.match(APP, /function preloadTarotFronts/);
  // Both paths: the daily card at load, a spread at draw.
  const daily = APP.slice(APP.indexOf("async function loadTarotDaily"), APP.indexOf("function renderTarotUnavailable"));
  assert.match(daily, /preloadTarotFronts\(data\.reading\?\.cards\)/);
  const draw = APP.slice(APP.indexOf("async function drawTarotSpread"), APP.indexOf("function setTarotFormBusy"));
  assert.match(draw, /preloadTarotFronts\(data\.reading\?\.cards\)/);
});

test("a preload can never block or break a reveal", () => {
  const fn = APP.slice(APP.indexOf("function preloadTarotFronts"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  // No await, no promise anyone waits on, no error path that could surface.
  assert.ok(!/await|then\(|catch\(/.test(body),
    "preloading must be fire-and-forget, or a slow image delays a card");
  assert.match(body, /if \(!url\) continue;/, "a deck with no artwork preloads nothing");
});

test("the back is local and the fronts are not", () => {
  // The back is on screen for every card before anything else; a network
  // request for it would put a loading state inside a face-down card.
  assert.match(APP, /class="tarot-card__back" aria-hidden="true"/);
  assert.ok(!/tarot-card__back[^>]*src=/.test(APP), "the back is not an <img> from storage");
  // Fronts come from a server-resolved URL the client never constructs.
  const deck = readFileSync(join(REPO_ROOT, "lib", "tarot", "deck.js"), "utf8");
  assert.match(deck, /export function imageUrl/);
  assert.match(deck, /ORBIT_TAROT_IMAGE_BASE_URL/);
  assert.ok(!/https?:\/\//.test(APP.slice(APP.indexOf("function tarotCardFaceHtml"), APP.indexOf("function preloadTarotFronts"))),
    "the client must not build a storage URL");
});

test("a card image is decoration, and its absence is not a failure", () => {
  assert.match(APP, /class="tarot-card__art" src="\$\{esc\(card\.image\.url\)\}" alt=""/,
    "empty alt: the meaning is stated in text beside the card");
  // Dimensions reserve the box so nothing shifts when the bytes land.
  assert.match(APP, /width="\$\{esc\(String\(card\.image\.width\)\)\}"/);
  assert.match(APP, /height="\$\{esc\(String\(card\.image\.height\)\)\}"/);
  // A failed image falls back to the typographic face rather than a broken frame.
  assert.match(APP, /onerror="this\.closest\('\.tarot-card'\)\.classList\.remove\('tarot-card--art'\)"/);
  // And a deck with no imagery renders the text face, which is a complete card.
  assert.match(APP, /if \(card\.image\?\.url\)/);
});

test("the image contract refuses what would make a card jump or go stale", () => {
  const base = { slug: "x", name: "X", arcana: "major", suit: null, number: 1,
    upright_meaning: "m", reflection_prompt: "p?",
    provenance: { author: "a", license: "l", reviewed: true } };
  const withImage = (image) => validateCard({ ...base, image });

  // Dimensions are required — they reserve the layout before the bytes land.
  assert.ok(withImage({ path: "a/b.webp", license: "public-domain" }).length > 0);
  // And must be 2:3, or the frame and the file disagree.
  assert.ok(withImage({ path: "a/b.webp", license: "public-domain", width: 600, height: 600 }).length > 0);
  // A URL in the deck would hardcode the bucket into content.
  assert.ok(withImage({ path: "https://cdn.example/b.webp", license: "public-domain", width: 600, height: 900 }).length > 0);
  assert.ok(withImage({ path: "a/b.webp", width: 600, height: 900 }).length > 0, "licence required");
  // A well-formed block passes.
  assert.deepEqual(withImage({ path: "waite-smith/1.0.0/x.webp", license: "public-domain", width: 600, height: 900 }), []);
  // And imagery stays optional: the deck today has none and is still valid.
  assert.deepEqual(validateCard(base), []);
});

test("two cards cannot share an image path", () => {
  // A reused path means overwritten artwork, which a one-year immutable cache
  // serves stale for up to a year. New artwork is a new path.
  const image = { path: "waite-smith/1.0.0/same.webp", license: "public-domain", width: 600, height: 900 };
  const deck = FIXTURE_DECK_REVIEWED.map((c, i) => (i < 2 ? { ...c, image } : c));
  assert.ok(validateDeck(deck).findings.some((f) => f.includes("image.path")));
});
