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
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../lib/local-llm/config.js";

import { featureEnabled, workspaceBlocked } from "../lib/features.js";
import { DECK_VERSION, PRODUCTION_CARDS, deckStatus, deckSupportsReversals, validateCard, validateDeck } from "../lib/tarot/deck.js";
import { DRAFT_CARDS } from "../lib/tarot/draft-deck.js";
import { FIXTURE_DECK_REVIEWED } from "./fixtures/tarot-deck.js";
import {
  EXPORT_SCHEMA_VERSION, EXPORT_SOURCES, EXPORT_TAROT_FIELDS,
  auditExportPrivacy, presentExportTarotReading, stripSecrets,
} from "../lib/account/export.js";
import { USER_OWNED_TABLES } from "../lib/account/deletion.js";

const APP = readFileSync(join(REPO_ROOT, "public", "app.js"), "utf8");
const HTML = readFileSync(join(REPO_ROOT, "public", "index.html"), "utf8");
// The panel graduated into public/index.html when Tarot stopped being gated.
// It is sliced out of the document so every assertion below still reads the
// panel rather than the whole page.
const DOC = readFileSync(join(REPO_ROOT, "public", "index.html"), "utf8");
const PANEL_RAW = DOC.slice(
  DOC.indexOf('<section class="workspace-panel" id="panel-tarot"'),
  DOC.indexOf('<!-- ══ APPEARANCE ══'),
);
// What the browser actually receives. The comments in this fragment discuss
// role="tabpanel" and predictive language in order to explain why neither is
// used — so a naive scan of the raw file finds both and fails on the
// explanation rather than on the markup.
const PANEL = PANEL_RAW.replace(/<!--[\s\S]*?-->/g, "");
const ICONS = readFileSync(join(REPO_ROOT, "public", "icons.js"), "utf8");
const PRIVACY = readFileSync(join(REPO_ROOT, "public", "privacy.html"), "utf8");
const SERVER = readFileSync(join(REPO_ROOT, "lib", "server", "create-app.js"), "utf8");
const TAROT_CSS = readFileSync(join(REPO_ROOT, "public", "styles", "tarot.css"), "utf8");

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
  // No `feature:` key any more — it graduated. What decides whether it appears
  // is the reader's own setting, and what decides whether it can serve a card
  // is the deck.
  assert.ok(!/feature:/.test(entry), "tarot is no longer flag-gated");
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
  // The class list now carries a conditional reversed modifier, so this
  // matches the stable prefix rather than an exact string.
  assert.match(APP, /class="tarot-card o-object tarot-card--up\$\{reversed \? " tarot-card--reversed" : ""\}" aria-hidden="true"/);
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
  assert.match(css, /aspect-ratio:\s*7\s*\/\s*12/, "a tarot card is 7:12 (70x120mm)");
});

test("reduced motion shows the final state without losing feedback", () => {
  const css = readFileSync(join(REPO_ROOT, "public", "styles", "tarot.css"), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,300}\.tarot-card--down::after \{ animation: none; \}/);
  assert.match(css, /:root\[data-motion="reduced"\] \.tarot-card--down,[\s\S]{0,180}animation: none/,
    "Orbit's own reduced-motion setting stops the card back too");
  // The reveal is still announced, so the state change survives the animation
  // being removed.
  assert.match(APP, /tarotSay\(name \? `Today's card is \$\{name\}\.`/);
});

test("the card back moves slowly enough to remain an object, not a loading state", () => {
  const css = readFileSync(join(REPO_ROOT, "public", "styles", "tarot.css"), "utf8");
  assert.match(css, /@keyframes tarot-card-back-breathe/);
  assert.match(css, /@keyframes tarot-card-back-light/);
  assert.match(css, /animation: tarot-card-back-breathe 18s ease-in-out infinite/);
  assert.match(css, /animation: tarot-card-back-light 18s ease-in-out infinite/);
  assert.match(css, /background-size: 101\.6% 101\.6%/,
    "the artwork breathes by less than two percent");
  assert.match(css, /38% \{ opacity: 0\.12; \}/,
    "the passing light never becomes an opaque gloss");
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

/* ── Auto-save, and the reader's draw default ─────────────────────────────── */

test("a signed-in reading keeps itself, and the automatic path never pops the account gate", () => {
  const block = APP.slice(APP.indexOf("/* ── Tarot ──"), APP.indexOf("/* ── Toasts"));
  // A manual draw saves right after it renders — behind its own signed-in
  // check, so a signed-out reader is never prompted by something they did not
  // press. The button they CAN press still asks at the press (asserted above).
  assert.match(block, /if \(authSignedIn\(\)\) saveTarotReading\("manual", \{ auto: true \}\)/);
  // The daily card logs itself on the revealed render, never face down.
  const start = block.indexOf("function autoSaveTarotDaily");
  const auto = block.slice(start, block.indexOf("\n}", start));
  assert.match(auto, /if \(!authSignedIn\(\)/);
  assert.ok(!/requireAccount/.test(auto),
    "an automatic save must never open the account dialog uninvited");
  assert.match(block, /autoSaveTarotDaily\(\)/);
});

test("the automatic save is quiet — confirmation is rendered, not announced", () => {
  // The reveal announcement ("Today's card is …") is still being read when an
  // auto save completes; a toast or live-region update on top of it would talk
  // over the card. The "Saved to your reflections." line is the confirmation.
  const fn = APP.slice(APP.indexOf("async function saveTarotReading"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /if \(!auto\) tarotSay\("Saving your reflection…"\)/);
  assert.match(body, /if \(!auto\) \{\s*\n\s*tarotSay\("Saved to your reflections\."\);\s*\n\s*toast\("Reflection saved"\)/);
});

test("the daily card is logged once per local day, on both sides of the wire", () => {
  const block = APP.slice(APP.indexOf("/* ── Tarot ──"), APP.indexOf("/* ── Toasts"));
  // The browser remembers only a DATE — the same shape as the reveal marker,
  // and it exists only to skip a redundant request.
  assert.match(block, /const TAROT_LOGGED_KEY = "orbit\.tarot\.logged"/);
  assert.match(block, /localStorage\.setItem\(TAROT_LOGGED_KEY, localDate\)/);
  // The server is the arbiter: the day's existing reading wins over an insert,
  // so a second device cannot double-log the day. Behaviour is proven in
  // tarot-api.test.js; this pins where the rule lives.
  const service = readFileSync(join(REPO_ROOT, "lib", "tarot", "service.js"), "utf8");
  assert.match(service, /reading_data->draw->>local_date=eq\./);
  assert.match(service, /spread_type=eq\.daily/);
});

test("the reader chooses which draw leads, and both draws survive the choice", () => {
  assert.match(HTML, /id="set-tarot-draw"/);
  assert.match(HTML, /id="set-tarot-draw"[\s\S]{0,200}data-value="one" aria-pressed="true"/,
    "one card is the default, chosen rather than arrived at");
  assert.match(APP, /tarotPref\("tarotDraw", "one"\)/);
  // The keyboard fallback follows the same default, not a hardcoded spread.
  assert.match(APP, /event\.submitter\?\.dataset\?\.spread \|\| tarotDefaultSpread\(\)/);
  // The setting reorders and restyles; it never removes a button.
  assert.match(APP, /function syncTarotDrawButtons/);
  assert.match(PANEL, /data-spread="one_card"/);
  assert.match(PANEL, /data-spread="three_card"/);
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

test("Tarot is no longer flag-gated, and the content gate is what remains", () => {
  const production = { VERCEL_ENV: "production", ORBIT_ENVIRONMENT: "production" };
  // The readiness flag graduated with the feature. Asserted rather than
  // deleted, so removing a gate stays a deliberate act with a test behind it.
  assert.equal(workspaceBlocked("tarot", production), false);
  assert.equal(featureEnabled("tarot", production), false, "unknown feature, not a gated one");
  // The content gate is still the gate — it now passes, because the deck was
  // approved. That it CAN refuse is proved against fixtures in
  // tarot-deck.test.js rather than by keeping production broken.
  assert.equal(deckStatus(PRODUCTION_CARDS).ready, true);
});

test("the Tarot routes are not gated on a flag that no longer exists", () => {
  // This shipped broken for one deploy. featureEnabled() answers false for an
  // unknown name, so the moment tarot left the registry every /api/tarot/*
  // route 404'd — the images and the panel went out fine, and nothing could
  // draw a card. Caught by checking production rather than by reading the diff.
  const block = SERVER.slice(SERVER.indexOf('route.startsWith("/api/tarot/")'));
  assert.ok(!/featureEnabled\("tarot"/.test(block.slice(0, 600)),
    "a graduated feature must not be gated on its removed flag");
  // The real gate, still in force on every read path.
  const service = readFileSync(join(REPO_ROOT, "lib", "tarot", "service.js"), "utf8");
  assert.match(service, /assertDeckReady/);
});

test("an incomplete deck could still not be exposed", () => {
  // The gate that held Tarot back for the whole build, still armed. Proved
  // against a partial deck rather than by leaving production empty.
  const partial = PRODUCTION_CARDS.slice(0, 9);
  const status = deckStatus(partial);
  assert.equal(status.ready, false);
  assert.equal(status.reason, "incomplete_deck");
  assert.equal(deckStatus([]).reason, "empty_deck");
  // And what production actually ships is complete.
  assert.equal(PRODUCTION_CARDS.length, 78);
  // A deliberate tripwire: any deck change must come here and say so.
  // 1.1.0 — every reversed meaning gained a grounding third sentence (4.0.1).
  assert.equal(DECK_VERSION, "1.1.0");
});

test("the panel ships in the document, like every other finished surface", () => {
  // It spent its unfinished life outside public/ so an incomplete version
  // could not reach the production artifact. That gate was about READINESS and
  // has done its job; what gates Tarot now is the deck's own state.
  assert.ok(HTML.includes('id="panel-tarot"'));
  assert.ok(!existsSync(join(REPO_ROOT, "features", "panels", "tarot.html")),
    "and no stale copy is left behind to drift from the one that ships");
});

/* ── Privacy copy ─────────────────────────────────────────────────────────── */

test("privacy copy matches what the feature actually stores", () => {
  assert.match(PRIVACY, /Saved Tarot readings/);
  assert.match(PRIVACY, /reflection prompt|reflection, not a prediction|not a\s*\n?\s*prediction/i);
  // The local marker is disclosed, and described as what it is.
  assert.match(PRIVACY, /whether you have turned over today's Tarot card/);
  assert.match(PRIVACY, /included in your data export and are deleted with your account/);
  // Saving is automatic for an account now, and the policy says so plainly —
  // "only when you choose to save one" would be a promise the feature no
  // longer keeps.
  assert.match(PRIVACY, /added to your reflections\s+automatically/);
  assert.ok(!/only when you choose to save/.test(PRIVACY));
  assert.match(PRIVACY, /recorded once per day/);
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
  assert.match(TAROT_CSS, /url\("\/brand\/orbit-tarot-card-back\.svg"\)/,
    "the face-down card uses the committed local artwork");
  const backPath = join(REPO_ROOT, "public", "brand", "orbit-tarot-card-back.svg");
  assert.ok(existsSync(backPath),
    "the local back cannot be missing from the shipped bundle");
  const back = readFileSync(backPath, "utf8");
  assert.match(back, /<svg[^>]+viewBox="0 0 700 1200"/,
    "the back keeps the exact 7:12 vector canvas");
  assert.ok(!/<image\b|data:image\//.test(back),
    "the SVG must remain native geometry, not a raster in a wrapper");
  assert.ok(!back.includes('d="M302 648 398 552"'),
    "the central calibration line must not cut across the eye and pyramid");
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
  // And must be card-shaped. A square is refused, and so is 2:3 — which the
  // frame was originally specified as, before the scans showed that a real
  // tarot card is 70x120mm.
  assert.ok(withImage({ path: "a/b.webp", license: "public-domain", width: 600, height: 600 }).length > 0);
  assert.ok(withImage({ path: "a/b.webp", license: "public-domain", width: 600, height: 900 }).length > 0);
  assert.ok(withImage({ path: "a/b.webp", license: "public-domain", width: 800, height: 464 }).length > 0,
    "landscape is not a card");
  // A URL in the deck would hardcode the bucket into content.
  assert.ok(withImage({ path: "https://cdn.example/b.webp", license: "public-domain", width: 600, height: 900 }).length > 0);
  assert.ok(withImage({ path: "a/b.webp", width: 600, height: 900 }).length > 0, "licence required");
  // A well-formed block passes.
  assert.deepEqual(withImage({ path: "waite-smith/1909/x.jpg", license: "public-domain", width: 464, height: 800 }), []);
  // And imagery stays optional: the deck today has none and is still valid.
  assert.deepEqual(validateCard(base), []);
});

test("two cards cannot share an image path", () => {
  // A reused path means overwritten artwork, which a one-year immutable cache
  // serves stale for up to a year. New artwork is a new path.
  const image = { path: "waite-smith/1909/same.jpg", license: "public-domain", width: 464, height: 800 };
  const deck = FIXTURE_DECK_REVIEWED.map((c, i) => (i < 2 ? { ...c, image } : c));
  assert.ok(validateDeck(deck).findings.some((f) => f.includes("image.path")));
});


/* ── Settings ─────────────────────────────────────────────────────────────── */

test("Tarot can be turned off, and turning it off is not destructive", () => {
  assert.match(HTML, /id="set-tarot"[\s\S]{0,200}data-value="off"/);
  assert.match(APP, /function tarotEnabled/);
  // Off removes it from navigation the same way an unavailable feature is
  // removed, so #tarot falls back to Home like any other absent route.
  assert.match(APP, /ws\.id === "tarot"[\s\S]{0,120}!tarotEnabled\(\)\) return false/);
  // And it says plainly that nothing is deleted.
  assert.match(HTML, /Saved reflections are kept/);
});

test("the timeline labels are opt-in, and change only the labels", () => {
  const deck = readFileSync(join(REPO_ROOT, "lib", "tarot", "deck.js"), "utf8");
  assert.match(deck, /timeline: Object\.freeze\(\["Past", "Present", "Future"\]\)/);
  // Reflective is the default — "Future" makes a claim the rest of the feature
  // is careful not to make, so it is chosen rather than arrived at.
  assert.match(deck, /export const DEFAULT_POSITION_SET = "reflective"/);
  assert.match(APP, /tarotPref\("tarotPositions", "reflective"\)/);
  // The copy says the reading itself does not change.
  assert.match(HTML, /cards and their\s*\n?\s*meanings are identical either way/);
});

test("the reader's labels are presentation, not what gets stored", () => {
  // A saved reading records Orbit's own labels. A device preference must not
  // rewrite what the account holds.
  const render = APP.slice(APP.indexOf("function renderTarotManual"));
  assert.match(render.slice(0, 1200), /presentation only/i);
  const service = readFileSync(join(REPO_ROOT, "lib", "tarot", "service.js"), "utf8");
  assert.match(service, /positions\[index\]/,
    "the server still writes its own position labels on save");
});

/* ── The meaning, on request ──────────────────────────────────────────────── */

test("the meaning waits behind a button, but the card still names itself", () => {
  assert.match(APP, /data-tarot-action="show-meaning"/);
  assert.match(APP, /What does this card mean\?/);
  // Name and position always show: hiding them would make the button a
  // guessing game rather than an offer.
  const start = APP.indexOf("if (!shown) {");
  const hidden = APP.slice(start, APP.indexOf('data-tarot-action="show-meaning"', start) + 200);
  assert.match(hidden, /tarot-meaning__name/);
  assert.match(hidden, /tarot-meaning__position/);
  assert.ok(!/tarot-meaning__body/.test(hidden), "the meaning itself is what waits");
});

test("shown is passed as a real boolean", () => {
  // `false || undefined` is undefined, and a default parameter treats
  // undefined as "not passed" — so `shown: undefined` fell back to true and
  // every meaning displayed regardless of the setting. Found by looking at the
  // page, not by reading the code.
  assert.match(APP, /const showMeaning = Boolean\(/);
  assert.match(APP, /shown: Boolean\(/);
});

test("the meaning animates in, and reduced motion still shows it", () => {
  const css = readFileSync(join(REPO_ROOT, "public", "styles", "tarot.css"), "utf8");
  assert.match(css, /@keyframes tarot-meaning-in/);
  assert.match(css, /\.tarot-meaning--shown \.tarot-meaning__body[\s\S]{0,200}animation: tarot-meaning-in/);
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /tarot-meaning__body[\s\S]{0,120}animation: none/);
});

/* ── Artwork ──────────────────────────────────────────────────────────────── */

test("a tarot card is 7:12, not 2:3", () => {
  // The frame was specified as 2:3 before there was artwork to put in it. A
  // physical card is 70x120mm, and the scans agreed with the card rather than
  // with the spec.
  const css = readFileSync(join(REPO_ROOT, "public", "styles", "tarot.css"), "utf8");
  assert.match(css, /aspect-ratio: 7 \/ 12/);
  assert.ok(!/aspect-ratio: 2 \/ 3/.test(css));
});

test("every card in the draft deck has public-domain artwork", () => {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "lib", "tarot", "image-manifest.json"), "utf8"));
  assert.equal(Object.keys(manifest).length, 78);
  for (const [slug, meta] of Object.entries(manifest)) {
    assert.equal(meta.license, "public-domain", `${slug} is not public domain`);
    assert.match(meta.source, /Wikimedia Commons/);
    assert.match(meta.source_licence_as_stated, /public domain/i,
      `${slug}: Commons does not state public domain`);
    // The ratio band, per card: portrait and card-shaped.
    const ratio = meta.width / meta.height;
    assert.ok(ratio > 0.52 && ratio < 0.65, `${slug}: ${meta.width}x${meta.height} is not card-shaped`);
  }
});

test("the fronts ship with the app", () => {
  // Capacitor bundles public/ into the iOS binary, so cards under public/ are
  // local files on a phone: instant, available with no signal, no egress.
  // They were briefly served from object storage, which made the phone fetch
  // over the network something it could simply have carried.
  const cards = join(REPO_ROOT, "public", "images", "tarot", "cards");
  assert.ok(existsSync(cards), "card artwork must ship with the app");
  assert.equal(readdirSync(cards).filter((f) => f.endsWith(".jpg")).length, 78);
  // And no staging copy left behind to go stale beside it.
  assert.ok(!existsSync(join(REPO_ROOT, "assets", "tarot-cards")));
});

test("a card image resolves to the app's own origin by default", () => {
  const deck = readFileSync(join(REPO_ROOT, "lib", "tarot", "deck.js"), "utf8");
  assert.match(deck, /\/images\/tarot\/cards\//);
  // An explicit base still wins, so the artwork can move to a CDN later
  // without a client release.
  assert.match(deck, /ORBIT_TAROT_IMAGE_BASE_URL/);
});


/* ── Reversals ────────────────────────────────────────────────────────────── */

test("reversals are opt-in and off by default", () => {
  assert.match(HTML, /id="set-tarot-reversed"/);
  assert.match(APP, /tarotPref\("tarotReversed", "off"\)/);
  // The copy states what a reversal means here, because "reversed" is read
  // several different ways and the deck only implements one of them.
  assert.match(HTML, /same\s*\n?\s*idea turned inward, blocked, or overdone/);
  assert.match(HTML, /not as its opposite/);
});

test("turning reversals on never changes which card was drawn", () => {
  // The orientation runs off its own labelled stream. If it shared the draw
  // stream, toggling the setting would hand the reader a different card
  // halfway through their day.
  const draw = readFileSync(join(REPO_ROOT, "lib", "tarot", "draw.js"), "utf8");
  assert.match(draw, /orientation-\$\{position\}/);
  assert.match(draw, /draw-\$\{position\}/);
  assert.notEqual(draw.indexOf("orientation-"), draw.indexOf("draw-"));
});

test("orientation is decided where the draw is, not by the client", () => {
  const deck = readFileSync(join(REPO_ROOT, "lib", "tarot", "deck.js"), "utf8");
  // presentCard resolves ONE meaning from the orientation. A client choosing
  // between two fields would eventually disagree with what was saved.
  assert.match(deck, /upright_meaning: reversed \? card\.reversed_meaning : card\.upright_meaning/);
  assert.match(deck, /reflection_prompt: reversed \? card\.reversed_prompt : card\.reflection_prompt/);
  // The client never picks reversed text for itself.
  assert.ok(!/reversed_meaning/.test(APP), "the browser must not hold two meanings per card");
});

test("a reversal is stated in words, never by rotation alone", () => {
  // An upside-down illustration is not something a screen reader can report
  // and not something every reader will notice.
  assert.match(APP, /tarot-meaning__reversed">Reversed/);
  const css = readFileSync(join(REPO_ROOT, "public", "styles", "tarot.css"), "utf8");
  assert.match(css, /\.tarot-card--reversed \{ transform: rotate\(180deg\); \}/);
});

test("a saved reading keeps the orientation it was drawn at", () => {
  // Saving a reversed card as upright would be the same card saying something
  // it did not say.
  assert.match(APP, /orientation: entry\.card\.orientation/);
  const service = readFileSync(join(REPO_ROOT, "lib", "tarot", "service.js"), "utf8");
  assert.match(service, /entry\?\.orientation === "reversed"/);
  assert.match(service, /presentCard\(card, \{ orientation \}\)/);
});

test("every draft card carries both halves of a reversal", () => {
  // A reversed meaning with no prompt leaves a paragraph and no question,
  // which is the one shape this feature is not.
  for (const card of DRAFT_CARDS) {
    assert.ok(card.reversed_meaning, `${card.slug}: no reversed meaning`);
    assert.ok(card.reversed_prompt?.trim().endsWith("?"), `${card.slug}: reversed prompt is not a question`);
  }
  assert.equal(deckSupportsReversals(DRAFT_CARDS), true);
});

test("reversed content obeys the same language rules as upright", () => {
  for (const card of DRAFT_CARDS) {
    assert.deepEqual(validateCard(card), [], `${card.slug} failed content review`);
  }
});

/* ── The card frame ───────────────────────────────────────────────────────── */

test("the card takes a printed-card corner, not a UI tile corner", () => {
  const css = readFileSync(join(REPO_ROOT, "public", "styles", "tarot.css"), "utf8");
  // 18px is this design system's CARD radius — an interface surface — and it
  // made a tarot card read as a tile with a picture in it. Square left the
  // scan's own white corners standing proud of the plate's printed curve.
  assert.match(css, /--tarot-radius: 9px/);
  assert.ok(!/border-radius: var\(--radius-lg\)/.test(css));
  // The Deep Scan loader matches, or the corners visibly change on load.
  assert.match(css, /\.tarot-card-loader \{[\s\S]{0,400}border-radius: 9px/);
  assert.match(APP, /function tarotLoadingCardHtml\(\)[\s\S]{0,300}orbit-logo-motion-deep-scan\.svg/);
  assert.match(APP, /slot\.innerHTML = tarotLoadingCardHtml\(\)/,
    "the daily draw uses the promoted Deep Scan state");
  assert.match(APP, /Array\.from\(\{ length: count \}[\s\S]{0,120}tarotLoadingCardHtml\(\)/,
    "manual spreads use one Deep Scan state per card being drawn");
});
