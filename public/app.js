/* ============================================================================
   Orbit — Application Controller
   ----------------------------------------------------------------------------
   Drives the app shell: workspace router, data loading, render functions,
   command palette, toasts, and persisted appearance settings. All business
   logic lives server-side and is untouched — this file only reads the existing
   JSON API and paints the design-system components.
   ========================================================================== */

import { renderMoonSVG } from "./moon-phase.js";
import {
  RELATIONSHIP_TYPES, RELATIONSHIP_LABELS, DEFAULT_FIRST_CHART_RELATIONSHIP,
  relationshipDisplay, chartInitials, validateName,
} from "./chart-identity.js";
import { normalizeAvatar, previewFor, decodeImage, releaseImage } from "./avatar-normalize.js";
import { validateSourceFile, validateSourceDimensions } from "./chart-avatar-limits.js";
import { createCropEditor } from "./avatar-crop.js";
import {
  starField, sceneInputs, illuminationLabel,
  SHOOTING_STAR_KEY, ORIENTATION_NOTE,
} from "./moon-scene.js";
import { decideStartupView, STARTUP_VIEW } from "./startup-state.js";
import { ICON_PATHS } from "./icons.js";
import { apiUrl, authHeaders, rememberSession } from "./platform.js";
import { cacheGet, cachePut, cacheClear, cacheStats, setCacheNamespace } from "./storage.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  symbols: [],
  chart: null,
  events: [],
  activeKind: "",
  atlasQuery: "",
  ready: false,
  activeChartName: "My Chart",
  auth: { restoring: true, user: null },
  charts: [],
  activeChartId: null,
  activeProfile: null,
  activeNatalChart: null,
  activeReading: null,
  // Saved-chart request outcome. This is what onboarding keys off — an empty
  // `charts` array is NOT enough, because a failed request also leaves it empty
  // and a returning user must never be mistaken for a new one.
  chartsStatus: "idle", // idle | loading | ready | error
  // Startup phase: loading -> ready. Onboarding may only appear once startup
  // has resolved, which is what prevents the setup form from flashing.
  startup: "loading", // loading | ready
  onboardingDismissed: false, // session-only; stops it reopening after a close
  places: { selections: {}, controllers: {} },
};

/**
 * Read an API response without ever handing non-JSON to JSON.parse.
 *
 * THIS EXISTS BECAUSE OF A REAL FAILURE. On the deployed Preview, every /api
 * request was redirected away by a routing rule and answered by Vercel's own
 * "The page could not be found" page. The old wrapper called response.json()
 * unconditionally, so the browser tried to parse that sentence as JSON and the
 * user was shown the parser's complaint:
 *
 *   Chromium: Unexpected token 'T', "The page c"... is not valid JSON
 *   WebKit:   The string did not match the expected pattern.
 *
 * Neither message tells anyone what went wrong, and both leak the shape of the
 * infrastructure. A response that is not JSON is an infrastructure failure, and
 * it should read like one.
 *
 * @returns {{ ok: boolean, status: number, data: object|null, kind: string }}
 */
async function readApiResponse(response) {
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  const isJson = type.includes("application/json") || type.includes("+json");

  // A redirect that survived to here means the request left the application —
  // a login wall or a rewrite — and whatever came back is not Orbit's answer.
  if (response.redirected && !isJson) {
    return { ok: false, status: response.status, data: null, kind: "redirected" };
  }

  if (!isJson) {
    // Read and DISCARD the body. It is HTML or prose from something that is not
    // Orbit, and putting it in front of a user would show them a stack trace, a
    // login page, or a hosting provider's 404 dressed as an Orbit error.
    await response.text().catch(() => "");
    return {
      ok: false,
      status: response.status,
      data: null,
      kind: response.status === 404 ? "missing-route" : (type ? "not-json" : "empty"),
    };
  }

  const body = await response.text();
  if (!body.trim()) return { ok: response.ok, status: response.status, data: null, kind: "empty" };
  try {
    return { ok: response.ok, status: response.status, data: JSON.parse(body), kind: "json" };
  } catch {
    // Claimed JSON, was not. Still not the user's problem to decode.
    return { ok: false, status: response.status, data: null, kind: "malformed-json" };
  }
}

/** What to tell a person when the response was not the application's. */
function apiTransportMessage(kind, status) {
  switch (kind) {
    case "missing-route":
      return "Orbit could not reach the sign-in service. Please refresh and try again.";
    case "redirected":
      return "Your session with the preview expired. Refresh the page and sign in again.";
    case "empty":
      return "Orbit did not receive a reply. Please check your connection and try again.";
    default:
      return `Orbit could not reach the service (status ${status}). Please refresh and try again.`;
  }
}

async function request(path, { method = "GET", body = null } = {}) {
  let response;
  try {
    // apiUrl() returns `path` UNCHANGED in a browser, so this is the same
    // relative request the web app has always made. Only the native container,
    // which is served from capacitor://localhost and has no same-origin API,
    // gets an absolute origin — and that origin is configuration, never a
    // domain written into source. See public/platform.js.
    //
    // This is the shared request wrapper, so every get()/post() in the app is
    // covered by this one call.
    response = await fetch(apiUrl(path), {
      method,
      // authHeaders() adds NOTHING in a browser. In the native container it
      // carries the session, which a cookie cannot: the app's requests are
      // cross-origin, and a cross-origin fetch neither sends a cookie nor
      // keeps one. See public/platform.js.
      headers: { "Content-Type": "application/json", ...authHeaders() },
      // same-origin keeps the Orbit session cookie AND, on a protected Vercel
      // Preview, the Vercel access cookie attached. A cross-origin call would
      // lose both and be answered by a login page instead of the application.
      credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined,
    });
    // The server rotates the session as it nears expiry, so this reads every
    // response and not only the one from sign-in.
    rememberSession(response);
  } catch {
    const error = new Error("Orbit could not be reached. Check your connection and try again.");
    error.status = 0;
    error.kind = "network";
    throw error;
  }

  const result = await readApiResponse(response);

  if (result.kind !== "json") {
    const error = new Error(apiTransportMessage(result.kind, result.status));
    error.status = result.status;
    error.kind = result.kind;   // diagnosable without exposing the body
    throw error;
  }

  const data = result.data ?? {};
  if (!result.ok) {
    const error = new Error(data.error || data.validation?.errors?.join("; ") || `HTTP ${result.status}`);
    error.data = data;
    error.status = result.status; // lets callers distinguish 401 from a real failure
    throw error;
  }
  return data;
}
async function get(path) { return request(path); }

/* ── Dev Update 4.2: cache-first plumbing ─────────────────────────────────
   The store itself lives in storage.js. These are the three small pieces the
   call sites share: a day key for cache keys, the muffler for early-started
   requests, and the one staleness note the Today page shows while cached
   content is on screen. */

/** The reader's calendar date in their own timezone, as YYYY-MM-DD. */
function localDayKey(tz) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}

/** Attached to early-started promises so a rejection that happens before its
 * consumer awaits it is not reported as unhandled. The consumer still receives
 * the rejection — this handler observes it, nothing more. */
const muffleEarly = () => {};

/**
 * The staleness label the roadmap requires: cached content says how old it is,
 * in text. One element, on Today, because Today is where cached content shows.
 * null hides it; a timestamp shows it; failed switches the second clause from
 * "refreshing" to the truth.
 */
function cacheNote(savedAt, { failed = false } = {}) {
  const el = $("#today-cache-note");
  if (!el) return;
  if (savedAt == null) { el.hidden = true; el.textContent = ""; return; }
  const when = new Date(savedAt).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  el.hidden = false;
  el.textContent = failed
    ? `Showing what loaded ${when} — Orbit couldn't refresh just now.`
    : `Showing what loaded ${when} — refreshing…`;
}

/** Sign-out and account deletion both land here. Fire-and-forget: leaving
 * must never wait on a database. */
async function resetDeviceCache() {
  try { await cacheClear(); await setCacheNamespace("anon"); }
  catch { /* the cache is a courtesy; a failed clear of an empty store harms nobody */ }
}
async function post(path, body) { return request(path, { method: "POST", body }); }
async function put(path, body) { return request(path, { method: "PUT", body }); }
async function patch(path, body) { return request(path, { method: "PATCH", body }); }
async function del(path, body = null) { return request(path, { method: "DELETE", body }); }

function esc(text) {
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}

/* ── Birthplace search ───────────────────────────────────────────────────
   A combobox over a server-backed place search. Three properties matter more
   than the markup:

   1. A CHART MAY ONLY BE SAVED AGAINST A PLACE THE SERVER SIGNED. The server
      returns a selection_token with each result and refuses a chart whose place
      lacks a valid one, so typed text can never become coordinates. Everything
      here is a convenience layer over that rule, not a substitute for it.

   2. A STALE SELECTION MUST NOT SURVIVE AN EDIT. Someone who picks "London,
      England" and then types over it has not chosen a place; keeping the old
      token would silently save a chart for a city they just deleted. Editing
      the field clears the selection.

   3. A SLOW ANSWER MUST NOT OVERWRITE A FAST ONE. Requests are sequenced and
      the in-flight one is aborted, so results from an abandoned query cannot
      replace results for what the user is actually typing. */

/* These two were raised to cut the Geoapify bill, and then measured, and the
   measurement said not to. Over 2000 simulated birthplace entries with
   Zipf-weighted city choice, the server-side cache in lib/locations/geoapify.js
   took 6146 billed credits down to 265; moving the debounce from 300ms to 400ms
   on top of that saved a further six. Six. The cache does effectively all of the
   work, because this is PREFIX traffic and prefixes are shared both between
   people and between cities — "lon" serves London and Londonderry, and after a
   few hundred visitors almost every prefix anyone types is already held.

   So the debounce stays where it was. It is worth 2% of a bill that caching has
   already paid, and it is spent on the highest-intent field in the app: 100ms of
   extra lag on birthplace search costs more in abandoned sign-ups than it saves
   in credits.

   The 3-character floor stays too. Ely, Rye, Ufa, Jos and Aba are real places,
   and a 4-character minimum would make them unsearchable to save one request —
   the exact request the cache serves for free, because short prefixes are the
   ones everybody types. Cheap to change, expensive to be wrong about. */
const PLACE_MIN_QUERY = 3;
const PLACE_DEBOUNCE_MS = 300;

function placeEls(prefix) {
  return {
    input: $(`#${prefix}-place`),
    results: $(`#${prefix}-place-results`),
    status: $(`#${prefix}-place-status`),
    clear: $(`#${prefix}-place-clear`),
  };
}

function setPlaceStatus(prefix, text) {
  const { status } = placeEls(prefix);
  if (status) status.textContent = text || "";
}

function closePlaceResults(prefix) {
  const { input, results } = placeEls(prefix);
  if (results) { results.hidden = true; results.innerHTML = ""; results._places = []; }
  if (input) { input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); }
}

function clearPlaceSelection(prefix, message = "") {
  delete state.places.selections[prefix];
  closePlaceResults(prefix);
  setPlaceStatus(prefix, message);
  const { clear, input } = placeEls(prefix);
  if (clear) clear.hidden = !(input?.value.trim());
}

function setPlaceSelection(prefix, place, { existing = false } = {}) {
  state.places.selections[prefix] = { ...place, existing, label: place.label || place.birthplace_name || "" };
  const { input, clear } = placeEls(prefix);
  if (input) input.value = state.places.selections[prefix].label;
  closePlaceResults(prefix);
  setPlaceStatus(prefix, existing
    ? "Saved birthplace will be reused."
    : "Birthplace selected. The timezone is worked out from it.");
  if (clear) clear.hidden = false;
}

function chartPlace(chart) {
  if (!chart?.birthplace_name || chart.latitude == null || chart.longitude == null) return null;
  return {
    label: chart.birthplace_name,
    latitude: chart.latitude,
    longitude: chart.longitude,
    provider: chart.geo_provider || "stored",
    provider_place_id: chart.geo_place_id || chart.id || "stored",
    city: chart.birthplace_city || "",
    region: chart.birthplace_region || "",
    country: chart.birthplace_country || "",
    country_code: chart.birthplace_country_code || "",
  };
}

/**
 * The place half of the submit payload, or a thrown error explaining what is
 * missing. An existing saved place is allowed through without a fresh token
 * only when the caller is editing a chart that already has one.
 */
function requireSelectedPlace(prefix, { allowExisting = false } = {}) {
  const place = state.places.selections[prefix];
  if (!place) throw new Error("Choose a birthplace from the list of results.");
  const typed = placeEls(prefix).input?.value.trim() || "";
  // The typed text having drifted from the selection is the stale-token case.
  if (typed !== place.label) throw new Error("Choose a birthplace from the list of results.");
  if (place.selection_token) return { birthplace: place };
  if (allowExisting && place.existing) return {};
  throw new Error("Choose a birthplace from the list of results.");
}

function renderPlaceResults(prefix, items) {
  const { input, results } = placeEls(prefix);
  if (!results) return;
  results._places = items;
  results.innerHTML = items.map((place, i) => `
    <li role="option" id="${prefix}-place-opt-${i}" class="place-result" data-index="${i}" aria-selected="false" tabindex="-1">
      ${esc(place.label)}
    </li>`).join("");
  results.hidden = items.length === 0;
  if (input) input.setAttribute("aria-expanded", String(items.length > 0));
  results._active = -1;
}

function movePlaceActive(prefix, delta) {
  const { input, results } = placeEls(prefix);
  const options = [...(results?.querySelectorAll("[role=option]") || [])];
  if (!options.length) return;
  const next = Math.max(0, Math.min(options.length - 1, (results._active ?? -1) + delta));
  results._active = next;
  options.forEach((el, i) => el.setAttribute("aria-selected", String(i === next)));
  options[next].scrollIntoView({ block: "nearest" });
  if (input) input.setAttribute("aria-activedescendant", options[next].id);
}

function choosePlaceActive(prefix) {
  const { results } = placeEls(prefix);
  const i = results?._active ?? -1;
  const place = i >= 0 ? results?._places?.[i] : null;
  if (place) { setPlaceSelection(prefix, place); return true; }
  return false;
}

async function runPlaceSearch(prefix, query) {
  const { results } = placeEls(prefix);
  if (!results) return;
  state.places.controllers[prefix]?.abort();
  const controller = new AbortController();
  state.places.controllers[prefix] = controller;
  setPlaceStatus(prefix, "Searching…");
  try {
    const response = await fetch(apiUrl(`/api/locations/search?q=${encodeURIComponent(query)}&limit=5`), {
      headers: { ...authHeaders() },
      credentials: "same-origin", signal: controller.signal,
    });
    rememberSession(response);
    const parsed = await readApiResponse(response);
    if (parsed.kind !== "json") throw new Error(apiTransportMessage(parsed.kind, parsed.status));
    const data = parsed.data ?? {};
    if (!parsed.ok) {
      // Distinguish "the search is not available" from "nothing matched": one
      // is worth retrying and the other is not.
      const message = data.code === "geoapify_unconfigured"
        ? "Birthplace search isn't available right now."
        : (data.error || "Birthplace search failed.");
      throw new Error(message);
    }
    const items = data.results || [];
    renderPlaceResults(prefix, items);
    setPlaceStatus(prefix, items.length
      ? `${items.length} ${items.length === 1 ? "match" : "matches"}. Use the arrow keys to choose one.`
      : `No places matched “${query}”. Try a nearby larger town.`);
  } catch (error) {
    if (error.name === "AbortError") return;   // a newer query owns the field now
    closePlaceResults(prefix);
    setPlaceStatus(prefix, `${error.message} You can try again.`);
  }
}

function setupPlaceSearch(prefix) {
  const { input, results, clear } = placeEls(prefix);
  if (!input || !results || input._wired) return;
  input._wired = true;
  let timer = null;

  input.addEventListener("input", () => {
    const selected = state.places.selections[prefix];
    if (selected && input.value.trim() !== selected.label) {
      clearPlaceSelection(prefix, "Choose a birthplace from the list of results.");
    }
    if (clear) clear.hidden = !input.value.trim();
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < PLACE_MIN_QUERY) {
      closePlaceResults(prefix);
      setPlaceStatus(prefix, q ? "Keep typing to search." : "");
      return;
    }
    timer = setTimeout(() => runPlaceSearch(prefix, q), PLACE_DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); movePlaceActive(prefix, 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); movePlaceActive(prefix, -1); }
    else if (event.key === "Enter") {
      // Only swallow Enter when it is actually choosing a result; otherwise it
      // belongs to the form.
      if (!results.hidden && choosePlaceActive(prefix)) event.preventDefault();
    } else if (event.key === "Escape") {
      if (!results.hidden) { event.stopPropagation(); closePlaceResults(prefix); }
    }
  });

  results.addEventListener("click", (event) => {
    const option = event.target.closest("[role=option]");
    if (!option) return;
    const place = results._places?.[Number(option.dataset.index)];
    if (place) { setPlaceSelection(prefix, place); input.focus(); }
  });

  clear?.addEventListener("click", () => {
    input.value = "";
    clearPlaceSelection(prefix, "");
    clear.hidden = true;
    input.focus();
  });
}

/* ── Icons ───────────────────────────────────────────────────────────────
   Phosphor, inlined at build time into ./icons.js — no icon font, no CDN, no
   network request to draw the app's own navigation. See scripts/build-icons.js.

   Two weights, and the difference carries meaning: the outline is the default,
   the solid marks the destination you are currently on. Everywhere else uses
   the outline.

   The icons SUPPLEMENT the labels. Every navigation item shows its name in
   text, on phone and desktop alike, so no glyph here has to carry meaning on
   its own — but they still have to be distinguishable at 25px, which is why
   Today (a sun on the horizon) and Sky (a planet) are not both a disc. */
const icon = (name, cls = "", { size = 0 } = {}) => {
  const d = ICON_PATHS[name];
  if (!d) return "";
  const solid = name.endsWith("-fill");
  const paint = solid
    ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"';
  const dims = size ? ` width="${size}" height="${size}"` : "";
  return `<svg class="${cls}" viewBox="0 0 256 256"${dims} ${paint} aria-hidden="true" focusable="false">${d}</svg>`;
};

/* ── Workspace registry — the single source of the navigation model ──────
   Five primary destinations, in this order, with ONE name each. Phone bottom
   bar, desktop sidebar, page heading, document title, and screen-reader name
   all read from these entries, so they cannot disagree with each other.

     Today · Chart · Sky · Atlas · You

   WHY THESE FIVE. The previous model spent two of its five tabs on directories:
   "Tools" was four links to pages that exist elsewhere, and "More" was a
   settings drawer. Meanwhile the reference library — the deepest finished thing
   in the app — was two taps down, and the moving sky was split across two
   destinations that answered nearly the same question.

   So: Tools is dissolved into the surfaces its links pointed at. Positions
   joins Transits under Sky, because "where are the planets" and "what does that
   mean for me" are one question asked at two zoom levels, and a segmented
   control is the honest way to switch between them. The Atlas takes the freed
   tab. Everything that was in More is still in You, and nothing was deleted.

   `tab` names the PRIMARY destination a secondary page belongs to, so opening
   Compatibility lights up Chart rather than lighting up nothing. A page you
   reached from somewhere should keep saying where you are.

   `mobileLabel` exists only where the full name will not fit a phone tab; it is
   an abbreviation of the same name, never a different word. */
const WORKSPACES = [
  { id: "home", label: "Today", crumb: "Your day", icon: "sun-horizon", primary: true },
  { id: "me", label: "Chart", crumb: "Your birth chart", icon: "compass-rose", primary: true },
  { id: "transits", label: "Sky", crumb: "The moving sky", icon: "planet", primary: true },
  { id: "symbol-atlas", label: "Atlas", crumb: "What the symbols mean", icon: "book-open-text", primary: true },
  { id: "more", label: "You", crumb: "Account & settings", icon: "user-circle", primary: true },

  // Secondary destinations. Real pages with real headings; they simply do not
  // earn a sixth tab, and each one lights the primary tab it belongs to.
  { id: "positions", label: "Current Positions", crumb: "The sky everyone shares", icon: "globe-hemisphere-west", primary: false, tab: "transits" },
  // Saved charts left the bottom of the Reading document to become a route.
  // Managing charts is a task, not a paragraph of the natal reading — and at a
  // phone width it sat eleven thousand pixels down, past every placement.
  { id: "saved-charts", label: "Saved charts", crumb: "The charts you keep", icon: "users", primary: false, tab: "me" },
  { id: "compatibility", label: "Compatibility", crumb: "Two charts compared", icon: "users", primary: false, tab: "me" },
  { id: "history", label: "History", crumb: "Past readings", icon: "clock-counter-clockwise", primary: false, tab: "more" },
  { id: "settings", label: "Appearance", crumb: "How Orbit Axis looks", icon: "gear", primary: false, tab: "more" },

  // Unfinished features. Absent from production entirely; a flag alone is not
  // enough, the markup has to be present too (see availableWorkspaces).
  // Tarot belongs to Today, not to You. It is the other half of the daily
  // ritual — a reflection surface beside the calculated sky — and filing it
  // under account settings said it was a preference. `tab: "home"` keeps Today
  // marked current on #tarot, so arriving there still says where you are.
  { id: "tarot", label: "Daily card", crumb: "A prompt, not a prediction", icon: "star", primary: false, tab: "home" },
  { id: "learn", label: "Learn", crumb: "Courses", icon: "book-open-text", primary: false, tab: "symbol-atlas", feature: "learn" },
  { id: "news", label: "News", crumb: "Verified articles", icon: "file-text", primary: false, tab: "more", feature: "news" },
];

/** The primary tab a workspace belongs to — itself, unless it says otherwise. */
function workspaceTab(id) {
  return WORKSPACES.find(w => w.id === id)?.tab || id;
}

/**
 * Draw every `data-icon="name"` element in a subtree.
 *
 * Icons are declared in the markup and painted here, rather than inlined as
 * SVG in the HTML. That keeps the document readable — `data-icon="trash"` says
 * what it is where a 40-character path does not — and it means the icon set has
 * exactly one definition, so changing a glyph is a rebuild rather than a search
 * across 1,100 lines of markup.
 *
 * Idempotent: an element that already holds its icon is skipped, so calling
 * this after a re-render cannot double up.
 */
/**
 * Force the TEXT presentation of an astrological glyph.
 *
 * Several of the glyphs Orbit Axis draws are Unicode characters that also have
 * an emoji presentation, and Apple platforms prefer it: "♈" rendered as a
 * purple-gradient emoji tile, and "☉" and "♌" like it. In an interface with one
 * accent colour, an OS-supplied purple gradient is not a small thing — it was
 * the loudest colour on the Atlas.
 *
 * U+FE0E is the variation selector that asks for the text presentation. The CSS
 * property that does the same (`font-variant-emoji: text`) is not supported
 * everywhere yet, so both are applied: the selector here, the property in
 * symbol-atlas.css. Appending it does not change what a screen reader announces,
 * and every one of these glyphs is aria-hidden beside its own visible name
 * anyway.
 */
function textGlyph(glyph) {
  const value = String(glyph ?? "");
  if (!value) return "";
  // Only characters that actually have an emoji presentation need it, but
  // appending unconditionally is harmless for the rest and is one rule instead
  // of a list to maintain.
  return value.endsWith("︎") ? value : `${value}︎`;
}

/* ── The visual viewport ──────────────────────────────────────────────────
   WHY THIS EXISTS, and it is not theoretical: on iOS Safari the chart form's
   Save button sat behind the on-screen keyboard, unreachable.

   The dialog was built on `100dvh`, on the understanding that the dynamic
   viewport shrinks when the keyboard opens. It does on Android Chrome. It does
   NOT on iOS Safari — there the keyboard overlays the page and the LAYOUT
   viewport is left at its full height, so `dvh` reports the same number with
   the keyboard up as with it down. A dialog sized to it keeps its bottom third
   underneath the keys.

   The visual viewport is the only thing that knows. It reports the region
   actually on screen, and it moves as the keyboard opens, closes, and as the
   page is pinch-zoomed. Publishing its height and offset as custom properties
   lets the dialog size and position against what the reader can see.

   Browsers without the API keep the `100dvh` fallback in the CSS, which is
   correct for every one of them — this is an iOS-shaped hole, patched where the
   hole is. */
function trackVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const apply = () => {
    root.style.setProperty("--vv-height", `${Math.round(vv.height)}px`);
    // offsetTop is how far the visible region has been pushed down, which is
    // what a fixed overlay has to be nudged by to stay inside it.
    root.style.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
  };
  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);
  apply();
}

function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    if (el.firstElementChild?.tagName?.toLowerCase() === "svg") continue;
    const markup = icon(el.dataset.icon);
    if (markup) el.insertAdjacentHTML("afterbegin", markup);
  }
}

/**
 * Retired routes, and where someone holding one should land instead.
 *
 * These hashes were real destinations in earlier versions, so bookmarks, notes,
 * and old links still carry them. Silently dropping someone on Today would look
 * like the app forgot the page; a redirect plus one plain sentence explains it
 * without an error page. The destination is always a working page that does the
 * nearest equivalent thing.
 */
const RETIRED_ROUTES = Object.freeze({
  ask: { to: "home", notice: "Ask Orbit has been retired. Your saved conversations are still yours — you can export or delete them from You." },
  dashboard: { to: "home", notice: "Overview is now simply Today." },
  research: { to: "symbol-atlas", notice: "Research is now the Atlas." },
  charts: { to: "me", notice: "Chart tools now live under Chart." },
  chat: { to: "home", notice: "That page has been retired." },
  intelligence: { to: "more", notice: "That page has been retired." },
  // Tools was a page of links to four pages that all still exist. Each link now
  // lives on the surface it belongs to, and History — the one thing Tools was
  // the only route to — is under You.
  tools: { to: "more", notice: "Tools has moved into the app: History and settings are here, the Atlas has its own tab, and saved charts and Compatibility are under Chart." },
});

/* ── Personal Transits (Update 5.2b) ───────────────────────────────────────
   The moving sky measured against the active saved chart.

   All geometry comes from the engine via the fortune's transit factors — the
   browser never computes an aspect. Viewing this page performs no write, so
   opening Transits cannot create a reading-history record. */

/* Transit ranking lives in lib/transits — server-side, tested, and shared with
   the API response. A second ranker in the browser was removed in Dev Update
   1.8: two rankers are one more than the number that can be right, and the
   page renders the order it is given. */


/**
 * Re-render whichever secondary destination is on screen.
 *
 * renderRoute() runs during boot, before restoreSession() and before the daily
 * fortune arrives. A refresh landing directly on #transits therefore rendered
 * the signed-out state and never corrected itself, telling a signed-in user to
 * sign in. Anything that fills in that data calls this afterwards.
 */
function refreshSecondaryRoute() {
  const id = currentWorkspace();
  if (id === "transits") renderTransits();
  if (id === "symbol-atlas") loadSymbolAtlas();
  // Positions describes the shared sky, so it loads for anyone who opens it —
  // no active chart, and no chart at all, are both fine.
  if (id === "positions") { wirePositions(); loadPositions(); }
  // Compatibility reads saved charts, so it has the same boot-order hazard the
  // note above describes: a refresh landing straight on #compatibility rendered
  // "Sign in to compare your saved charts" to a signed-in user and never
  // corrected itself. Verified in a browser, not inferred.
  if (id === "compatibility") { wireCompatibility(); loadCompatibility(); }
}

/* ── Today's Transits ───────────────────────────────────────────────────────
   Rebuilt in Dev Update 1.8. The previous renderer read AXIS.lastFortune.factors
   and filtered `type === "transit"` — but the fortune engine emits only its top
   three, so this page showed at most three contacts: a summary slice built for
   a daily reading, presented as a transits workspace.

   It now consumes GET /api/charts/:id/transits, which calculates the full set
   server-side. There is deliberately NO fallback to the old path: a hidden
   fallback would mask a broken endpoint behind three plausible-looking cards. */

const TRANSITS = { loading: false, token: 0, chartId: null, data: null };

function transitsClear() {
  TRANSITS.data = null;
  const body = $("#transits-body");
  if (body) body.innerHTML = "";
  const ctx = $("#transits-context");
  if (ctx) ctx.textContent = "";
  const explore = $("#transits-explore");
  if (explore) explore.hidden = true;
}

function transitsStatus(text) {
  const el = $("#transits-status");
  if (el) el.textContent = text || "";
}

function transitsChartName(nickname) {
  const el = $("#transits-chart-name");
  if (el) el.textContent = nickname || "your chart";
}

async function loadTransits() {
  // Same three-state session model as Positions: unresolved is not signed out,
  // and neither renders anything.
  if (state.auth.restoring || !authSignedIn()) { transitsClear(); transitsRenderSignedOut(); return; }
  const chart = activeChart();
  if (!chart) { transitsClear(); transitsRenderNoChart(); return; }

  // Rapid switching: a slower response for an abandoned chart must never paint
  // over a newer selection.
  const token = ++TRANSITS.token;
  TRANSITS.chartId = chart.id;
  TRANSITS.loading = true;
  transitsClear();
  // Name the INCOMING chart immediately. Leaving the previous name in the
  // subtitle while the status line announces a different one is the same
  // stale-attribution problem as showing its cards, in one line of text.
  transitsChartName(chart.nickname);
  transitsRenderLoading(chart.nickname);
  transitsStatus(`Loading transits for ${chart.nickname || "your chart"}…`);

  let data;
  try {
    const tz = axisResolveTimezone();
    data = await get(`/api/charts/${chart.id}/transits?tz=${encodeURIComponent(tz)}`);
  } catch (error) {
    if (token !== TRANSITS.token) return;
    TRANSITS.loading = false;
    transitsRenderError("We couldn't work out your transits just now. Your saved charts are safe.");
    return;
  }
  if (token !== TRANSITS.token) return;   // superseded by a newer chart

  TRANSITS.loading = false;
  TRANSITS.data = data;
  try {
    renderTransitsWorkspace(data, chart);
    transitsStatus(`Transits for ${chart.nickname || "your chart"} are ready.`);
  } catch (error) {
    // A render defect is ours. Reporting it as a network problem would hide it.
    console.error("[orbit] transits failed to render", { stage: "render", message: error?.message });
    transitsRenderError("We couldn't show your transits just now. This one is on us — please try again.");
  }
}

function transitsRenderSignedOut() {
  const body = $("#transits-body");
  if (body) body.innerHTML = "";
  transitsStatus("");
}

function transitsRenderLoading(name) {
  const body = $("#transits-body");
  if (body) {
    body.innerHTML = `<div class="axis-shimmer" style="height:280px" role="status" aria-live="polite"
      aria-label="Loading transits for ${esc(name || "your chart")}"></div>`;
  }
}

function transitsRenderError(message) {
  const body = $("#transits-body");
  // Announced through the persistent live region rather than a role="alert"
  // injected with the markup. A live region that already exists in the tree
  // announces reliably; one created at the same moment as its text does not,
  // and an unannounced failure is indistinguishable from a page that hung.
  // The visible block carries no role, so the message is spoken once.
  transitsStatus(message);
  if (!body) return;
  body.innerHTML = `<div class="axis-section-error">
    <p>${esc(message)}</p>
    <button type="button" class="o-btn o-btn--secondary o-btn--sm" data-action="retry-transits">Try again</button>
  </div>`;
}

function transitsRenderNoChart() {
  const body = $("#transits-body");
  transitsStatus("");
  if (!body) return;
  // No fabricated summary, no empty card grid — one explanation and one action.
  body.innerHTML = `<div class="tr-empty">
    <h2>Transits need a birth chart</h2>
    <p>Today’s Transits measures the current sky against your own placements, so it needs a saved chart to compare with.</p>
    <p>The sky itself is available to everyone — Current Positions shows where the planets are right now, with no chart required.</p>
    <div class="tr-empty__actions">
      <button type="button" class="o-btn o-btn--primary" data-action="add-chart">Create your chart</button>
      <a class="o-btn o-btn--secondary" href="#positions">View Current Positions</a>
    </div>
  </div>`;
}

function transitCardHtml(t, { background = false } = {}) {
  const r = t.reading;
  if (!r) return "";
  const facts = [
    t.motion ? `<span class="tr-badge">${esc(t.motion)}</span>` : "",
    t.intensityLabel ? "" : "",
    r.intensity ? `<span class="tr-badge tr-badge--soft">${esc(r.intensity)}</span>` : "",
    t.retrograde ? `<span class="tr-badge tr-badge--soft">Retrograde</span>` : "",
  ].filter(Boolean).join("");
  return `<article class="tr-card${background ? " tr-card--background" : ""}">
    <h3 class="tr-card__title">${esc(r.title)}</h3>
    <p class="tr-card__meta">${facts}<span class="tr-orb">${esc(t.orbLabel)} from exact</span></p>
    <p class="tr-card__lead">${esc(r.lead)}</p>
    <details class="reading-card__more">
      <summary><span>What this might look like</span></summary>
      <div class="reading-card__body">
        ${r.detail.map((d) => `<p>${esc(d)}</p>`).join("")}
        <div class="reading-card__aside"><h4>What it can help with</h4><p>${esc(r.constructive)}</p></div>
        <div class="reading-card__aside"><h4>Where it can chafe</h4><p>${esc(r.tension)}</p></div>
        ${r.technical ? `<p class="tr-technical-line">${esc(r.technical)}</p>` : ""}
        <dl class="tr-evidence">
          <div><dt>Transiting</dt><dd>${atlasBodyLinkHtml(t.transiting)} ${esc(t.transitingPosition)}</dd></div>
          <div><dt>Your natal ${atlasBodyLinkHtml(t.natal)}</dt><dd>${esc(t.natalPosition)}</dd></div>
          <div><dt>Aspect</dt><dd>${atlasLinkHtml("aspects", t.aspect)}</dd></div>
          <div><dt>Orb</dt><dd>${esc(t.orbLabel)}</dd></div>
          ${t.motion ? `<div><dt>Motion</dt><dd>${esc(t.motion)}</dd></div>` : ""}
          <div><dt>Duration</dt><dd>${esc(t.duration)}</dd></div>
        </dl>
      </div>
    </details>
  </article>`;
}

function renderTransitsWorkspace(data, chart) {
  const body = $("#transits-body");
  if (!body) throw new Error("renderTransitsWorkspace called without a mount point");
  if (!data) throw new Error("renderTransitsWorkspace called without transit data");

  transitsChartName(chart?.nickname);
  const ctx = $("#transits-context");
  if (ctx && data.localDate) {
    const day = formatLocalDateKey(data.localDate);
    const when = data.calculatedAt
      ? new Date(data.calculatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : "";
    ctx.textContent = [day, data.timezone ? `Based on ${data.timezone} local time` : "",
                       when ? `Sky calculated for ${when}` : ""].filter(Boolean).join(" · ");
  }

  const immediate = data.immediate || [];
  const background = data.background || [];
  const explore = $("#transits-explore");
  if (explore) explore.hidden = false;

  if (!immediate.length && !background.length) {
    body.innerHTML = `
      ${data.limitation ? transitLimitationHtml(data.limitation) : ""}
      <div class="tr-empty">
        <h2>No major transits are in range right now</h2>
        <p>No supported major aspect is currently within the orb Orbit Axis reports on. That is an ordinary state, not a problem — the sky is still moving.</p>
        <div class="tr-empty__actions">
          <a class="o-btn o-btn--secondary" href="#positions">View Current Positions</a>
          <a class="o-btn o-btn--secondary" href="#me">Review My Chart</a>
          <a class="o-btn o-btn--secondary" href="#home">Return Home</a>
        </div>
      </div>`;
    return;
  }

  const all = data.all || [];
  body.innerHTML = `
    ${data.summary ? `<section class="o-section tr-summary" aria-labelledby="tr-summary-title">
      <h2 class="axis-section-title" id="tr-summary-title">Your transit summary</h2>
      <p class="tr-summary__text">${esc(data.summary.text)}</p>
    </section>` : ""}

    ${data.limitation ? transitLimitationHtml(data.limitation) : ""}

    ${immediate.length ? `<section class="o-section" aria-labelledby="tr-immediate-title">
      <h2 class="axis-section-title" id="tr-immediate-title">Most active today</h2>
      <p class="axis-section-help">Faster-moving contacts — these are what changed recently.</p>
      <div class="tr-list">${immediate.map((t) => transitCardHtml(t)).join("")}</div>
    </section>` : ""}

    ${background.length ? `<section class="o-section" aria-labelledby="tr-background-title">
      <h2 class="axis-section-title" id="tr-background-title">Background influences</h2>
      <p class="axis-section-help">Slower contacts. These move gradually and stay relevant far longer — quieter day to day, not less significant.${
        data.summary && data.summary.backgroundCount > background.length
          ? ` Showing the ${background.length} closest of ${data.summary.backgroundCount}.`
          : ""}</p>
      <div class="tr-list tr-list--background">${background.map((t) => transitCardHtml(t, { background: true })).join("")}</div>
    </section>` : ""}

    <section class="o-section" aria-labelledby="tr-technical-title">
      <h2 class="axis-section-title" id="tr-technical-title">Complete technical details</h2>
      <details class="chart-details">
        <summary>All ${all.length} contact${all.length === 1 ? "" : "s"} within orb</summary>
        <div class="table-scroll">
          <table class="placements">
            <thead><tr><th scope="col">Transiting</th><th scope="col">Aspect</th><th scope="col">Natal</th><th scope="col">Orb</th><th scope="col">Motion</th><th scope="col">Group</th></tr></thead>
            <tbody>${all.map((t) => `<tr>
              <td>${esc(t.transiting)}</td><td>${esc(t.aspect)}</td><td>${esc(t.natal)}</td>
              <td>${esc(t.orbLabel)}</td><td>${esc(t.motion || "—")}</td>
              <td>${t.background ? "Background" : "Immediate"}</td></tr>`).join("")}</tbody>
          </table>
        </div>
        <p class="tech-sky__help">Positions come from the same shared sky as Current Positions. Orbit Axis does not publish exact-hit times or end dates for transits — those need timing it cannot calculate reliably.</p>
        <a class="o-btn o-btn--secondary o-btn--sm" href="#positions">View Current Positions</a>
      </details>
    </section>`;
}

function transitLimitationHtml(l) {
  return `<aside class="chart-limitation" role="note">
    <h2 class="chart-limitation__title">${esc(l.title)}</h2>
    <p>${esc(l.body)}</p>
  </aside>`;
}

function renderTransitsSwitcher() {
  const wrap = $("#transits-switcher");
  const select = $("#transits-chart-select");
  if (!wrap || !select) return;
  const charts = state.charts || [];
  wrap.hidden = charts.length < 2;
  if (charts.length < 2) { select.innerHTML = ""; return; }
  const active = activeChart();
  select.innerHTML = charts.map((c) =>
    `<option value="${esc(c.id)}"${c.id === active?.id ? " selected" : ""}>${esc(chartOptionLabel(c))}</option>`
  ).join("");
  renderPickerAvatar("#transits-chart-avatar");
}

/** Kept for the route to call; the workspace loads itself. */
function renderTransits() {
  renderTransitsSwitcher();
  loadTransits();
}

function wireTransits() {
  const panel = $("#panel-transits");
  if (!panel || panel._wiredTransits) return;
  panel._wiredTransits = true;

  const select = $("#transits-chart-select");
  select?.addEventListener("change", async (event) => {
    const id = event.target.value;
    const previousId = state.activeChartId;
    if (!id || id === previousId) return;
    select.disabled = true;
    // Clear before activating: the chart name updates as soon as the switch
    // lands, and the old reading must not be sitting under it.
    transitsClear();
    transitsRenderLoading("");
    try {
      await post(`/api/charts/${id}/activate`, {});
      await loadSavedCharts();
      renderTransitsSwitcher();
      await loadTransits();
      $("#transits-title")?.focus({ preventScroll: true });
      toast(`${activeChart()?.nickname || "Chart"} is active`);
    } catch {
      state.activeChartId = previousId;
      renderTransitsSwitcher();
      transitsRenderError("We couldn't switch charts just now. Your saved charts are safe.");
    } finally {
      select.disabled = false;
    }
  });

  panel.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="retry-transits"]')) loadTransits();
  });
  $("#transits-refresh")?.addEventListener("click", () => loadTransits());
}

/* ── Symbol Atlas (Update 5.2b) ────────────────────────────────────────────
   A reference for symbols already on screen elsewhere in Orbit — not a course.

   Every glyph is paired with a visible text name. A glyph alone is meaningless
   to anyone who has not already learned it, which is precisely the audience
   this page exists for, and a font that fails to load would otherwise leave a
   grid of empty boxes.

   Search runs entirely in the browser over data already fetched. No request
   leaves the page as somebody types. */

/* ── Symbol Atlas (Dev Update 1.12) ────────────────────────────────────────
   Orbit's reference library. Three views over one validated content module:

     #symbol-atlas                     home — search + the seven categories
     #symbol-atlas/<category>          one shelf, in canonical order
     #symbol-atlas/<category>/<slug>   one entry

   The content is authored, frozen data loaded lazily on first visit —
   app boot pays nothing, search never touches the network, and nothing a
   user types is stored anywhere. Every link is a real <a href="#…">, so
   history, Back/Forward, open-in-new-tab, and copy-link all work without a
   single click handler pretending to be a browser. */

let atlasModulePromise = null;
function atlasModule() {
  atlasModulePromise ||= import("/symbol-atlas/index.js");
  return atlasModulePromise;
}

// Route sequence guard: rapid navigation must let only the FINAL route render.
// Without it, a slow first load can paint an older entry over a newer one.
const atlasView = { seq: 0, query: "" };

/**
 * "#symbol-atlas/planets/moon" → { category, slug, deep } (all lowercased).
 *
 * "combinations" is a reserved first segment rather than a category: it takes
 * a type and a variable number of slugs, so it is parsed separately and
 * reported as `combination`. Nothing else in the Atlas accepts more than two
 * segments, and `deep` still refuses anything longer.
 */
function atlasRouteParts() {
  const parts = requestedRoute().split("/").slice(1)
    .map((p) => { try { return decodeURIComponent(p); } catch { return p; } })
    .map((p) => p.toLowerCase().trim())
    .filter(Boolean);
  if (parts[0] === "combinations") {
    return { category: null, slug: null, deep: false,
      combination: { type: parts[1] || null, parts: parts.slice(2) } };
  }
  return { category: parts[0] || null, slug: parts[1] || null, deep: parts.length > 2,
    combination: null };
}

function atlasStatus(message) {
  const el = $("#atlas-status");
  if (el) el.textContent = message || "";
}

/** Heading, subtitle, tab title, and (post-boot) focus — one place, per view. */
function atlasChrome({ title, subtitle, crumbs, focusHeading }) {
  const h1 = $("#symbol-atlas-title");
  if (h1) h1.textContent = title;
  const sub = $("#atlas-subtitle");
  if (sub) sub.textContent = subtitle || "";
  document.title = title === "Atlas" ? "Orbit Axis — Atlas" : `Orbit Axis — ${title} · Atlas`;
  const nav = $("#atlas-crumbs");
  if (nav) {
    nav.innerHTML = (crumbs || []).map((c, i, all) => i === all.length - 1 && !c.href
      ? `<span aria-current="page">${esc(c.label)}</span>`
      : `<a href="${esc(c.href)}">${esc(c.label)}</a>`).join('<span class="atlas-crumbs__sep" aria-hidden="true">›</span>');
    nav.hidden = !(crumbs || []).length;
  }
  // Moving focus on every render would fight the search box on home, and
  // moving it while signed out would fight the auth gate's own focus trap —
  // the same rule Positions follows, for the same reason. Entry and category
  // arrivals move it; everything else leaves focus where the person put it.
  if (focusHeading && authSignedIn()) h1?.focus({ preventScroll: false });
}

function atlasEntryCardHtml(entry, mod) {
  const category = mod.CATEGORY_BY_SLUG[entry.category];
  return `<a class="atlas-card" href="#symbol-atlas/${esc(entry.category)}/${esc(entry.slug)}">
    <span class="atlas-card__glyph" aria-hidden="true">${esc(textGlyph(entry.glyph))}</span>
    <span class="atlas-card__body">
      <span class="atlas-card__title">${esc(entry.title)}</span>
      <span class="atlas-card__kind">${esc(category?.shortName || entry.category)}</span>
      <span class="atlas-card__summary">${esc(entry.summary)}</span>
    </span>
  </a>`;
}

function atlasSearchBoxHtml() {
  return `<div class="atlas-search">
    <label class="atlas-search__label" for="atlas-search-input">Search the Atlas</label>
    <input class="o-input" id="atlas-search-input" type="search" autocomplete="off"
           placeholder="Try “Moon”, “first house”, or “MC”" value="${esc(atlasView.query)}" />
  </div>`;
}

function atlasHomeHtml(mod) {
  const categories = mod.ATLAS_CATEGORIES.map((c) => {
    const count = mod.categoryEntries(c.slug).length;
    return `<a class="atlas-category-card" href="#symbol-atlas/${esc(c.slug)}">
      <span class="atlas-category-card__glyph" aria-hidden="true">${esc(textGlyph(c.glyph))}</span>
      <span class="atlas-category-card__name">${esc(c.name)}</span>
      <span class="atlas-category-card__count">${count} entries</span>
      <span class="atlas-category-card__desc">${esc(c.description)}</span>
    </a>`;
  }).join("");

  // Contextually relevant: the active chart's Sun / Moon / rising signs are
  // already in memory from the saved-charts list — no request, no
  // recalculation, and nothing shown when signed out or chartless.
  const summary = activeChart()?.summary;
  const mine = [];
  if (summary?.sun && mod.atlasEntry("signs", String(summary.sun).toLowerCase())) {
    mine.push({ label: `Sun in ${summary.sun}`, href: `#symbol-atlas/signs/${String(summary.sun).toLowerCase()}` });
  }
  if (summary?.moon && mod.atlasEntry("signs", String(summary.moon).toLowerCase())) {
    mine.push({ label: `Moon in ${summary.moon}`, href: `#symbol-atlas/signs/${String(summary.moon).toLowerCase()}` });
  }
  if (summary?.rising && mod.atlasEntry("signs", String(summary.rising).toLowerCase())) {
    mine.push({ label: `${summary.rising} rising`, href: `#symbol-atlas/signs/${String(summary.rising).toLowerCase()}` });
  }
  const fromChart = mine.length ? `
    <section class="o-card atlas-block" aria-labelledby="atlas-mine-title">
      <h2 class="u-card-title" id="atlas-mine-title">From your chart</h2>
      <ul class="atlas-chip-list">
        ${mine.map((m) => `<li><a class="atlas-chip" href="${esc(m.href)}">${esc(m.label)}</a></li>`).join("")}
      </ul>
    </section>` : "";

  const featured = ["planets/sun", "planets/moon", "angles/ascendant", "aspects/square"]
    .map((ref) => mod.atlasEntry(...ref.split("/"))).filter(Boolean);

  return `
    ${atlasSearchBoxHtml()}
    <div id="atlas-search-results"></div>
    <div id="atlas-browse">
      <section class="atlas-block" aria-labelledby="atlas-browse-title">
        <h2 class="axis-section-title" id="atlas-browse-title">Browse the library</h2>
        <div class="atlas-category-grid">${categories}</div>
      </section>
      ${fromChart}
      <section class="atlas-block" aria-labelledby="atlas-featured-title">
        <h2 class="axis-section-title" id="atlas-featured-title">Good places to start</h2>
        <div class="atlas-card-grid">${featured.map((e) => atlasEntryCardHtml(e, mod)).join("")}</div>
      </section>
      <section class="atlas-block" aria-labelledby="atlas-comb-title">
        <h2 class="axis-section-title" id="atlas-comb-title">Two symbols together</h2>
        <p class="atlas-category-desc">A planet in a sign, a planet in a house, two planets in aspect,
          or a planet close to an angle — explained by composing the entries for each symbol.</p>
        <ul class="atlas-chip-list">
          <li><a class="atlas-chip" href="#symbol-atlas/combinations">Browse combinations</a></li>
          ${mod.COMBINATION_EXAMPLES.slice(0, 3).map((ex) => {
            const c = mod.composeCombination(ex.type, ex.parts);
            return c ? `<li><a class="atlas-chip" href="#symbol-atlas/combinations/${esc(ex.type)}/${ex.parts.map(esc).join("/")}">${esc(c.title)}</a></li>` : "";
          }).join("")}
        </ul>
      </section>
      <details class="o-card atlas-method">
        <summary>About this reference</summary>
        <div class="atlas-method__body">
          <p>${esc(mod.ATLAS_METHODOLOGY_NOTE)}</p>
          <ul>${mod.ATLAS_METHODOLOGY_POINTS.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
        </div>
      </details>
    </div>`;
}

function atlasCategoryHtml(mod, category) {
  const entries = mod.categoryEntries(category.slug);
  // The description is already the page subtitle (atlasChrome sets it from the
  // same field), so repeating it here printed the same sentence twice, four
  // lines apart. The count and the way back are what this line is for.
  return `
    <p class="u-meta">${entries.length} entries · <a href="#symbol-atlas">Search the Atlas</a></p>
    <div class="atlas-card-grid">
      ${entries.map((e) => atlasEntryCardHtml(e, mod)).join("")}
    </div>`;
}

/**
 * One entry, in the reading order Dev Update 3.1 settled on: definition, then
 * at-a-glance, then the four questions a reader actually arrives with (how
 * does this show up, what does it look like working, what does it look like
 * strained, what does it do in a chart), then something to sit with, then the
 * technical material behind a disclosure.
 *
 * Not every section is a card. Cards are for the parts a reader scans back to
 * — strengths, challenges, chart role, reflections, related. The prose runs as
 * prose, because eleven stacked cards is a filing cabinet, not a page.
 */
function atlasEntryHtml(mod, entry) {
  const category = mod.CATEGORY_BY_SLUG[entry.category];
  const related = mod.relatedEntries(entry);
  const factRows = Object.entries(entry.facts || {});
  const list = (items) => (items || []).map((t) => `<li>${esc(t)}</li>`).join("");
  const paras = (items) => (items || []).map((p) => `<p>${esc(p)}</p>`).join("");

  return `
    <article class="atlas-entry">
      <header class="atlas-entry__head">
        <span class="atlas-entry__glyph" aria-hidden="true">${esc(textGlyph(entry.glyph))}</span>
        <p class="atlas-entry__summary">${esc(entry.summary)}</p>
      </header>

      ${entry.overview?.length ? `
      <section class="atlas-block atlas-prose" aria-labelledby="atlas-glance-title">
        <h2 class="axis-section-title" id="atlas-glance-title">At a glance</h2>
        ${paras(entry.overview)}
      </section>` : ""}

      <section class="atlas-block" aria-labelledby="atlas-themes-title">
        <h2 class="axis-section-title" id="atlas-themes-title">Core themes</h2>
        <ul class="atlas-chip-list">${entry.themes.map((t) => `<li><span class="atlas-chip atlas-chip--static">${esc(t)}</span></li>`).join("")}</ul>
      </section>

      ${entry.everyday?.length ? `
      <section class="o-card atlas-block" aria-labelledby="atlas-everyday-title">
        <h2 class="u-card-title" id="atlas-everyday-title">How it may show up</h2>
        <ul class="atlas-list">${list(entry.everyday)}</ul>
      </section>` : ""}

      ${entry.constructive ? `
      <section class="atlas-block atlas-prose" aria-labelledby="atlas-constructive-title">
        <h2 class="axis-section-title" id="atlas-constructive-title">A constructive expression</h2>
        <p>${esc(entry.constructive)}</p>
      </section>` : ""}

      ${entry.difficult ? `
      <section class="atlas-block atlas-prose" aria-labelledby="atlas-difficult-title">
        <h2 class="axis-section-title" id="atlas-difficult-title">When it becomes difficult</h2>
        <p>${esc(entry.difficult)}</p>
      </section>` : ""}

      <div class="atlas-two-col">
        <section class="o-card atlas-block" aria-labelledby="atlas-strengths-title">
          <h2 class="u-card-title" id="atlas-strengths-title">Common strengths</h2>
          <ul class="atlas-list">${list(entry.strengths)}</ul>
        </section>
        <section class="o-card atlas-block" aria-labelledby="atlas-challenges-title">
          <h2 class="u-card-title" id="atlas-challenges-title">Common challenges</h2>
          <ul class="atlas-list">${list(entry.challenges)}</ul>
        </section>
      </div>

      <section class="o-card atlas-block" aria-labelledby="atlas-role-title">
        <h2 class="u-card-title" id="atlas-role-title">In a chart</h2>
        <p>${esc(entry.chartRole)}</p>
        ${entry.whenEmphasized ? `<p><b>When it is emphasised.</b> ${esc(entry.whenEmphasized)}</p>` : ""}
        ${entry.whenScarce ? `<p><b>When there is little of it.</b> ${esc(entry.whenScarce)}</p>` : ""}
      </section>

      ${entry.reflections?.length ? `
      <section class="o-card atlas-block atlas-reflect" aria-labelledby="atlas-reflect-title">
        <h2 class="u-card-title" id="atlas-reflect-title">Questions to sit with</h2>
        <p class="u-meta">Optional prompts for thinking with, not a questionnaire and not advice.</p>
        <ul class="atlas-list atlas-list--prompts">${list(entry.reflections)}</ul>
      </section>` : ""}

      ${(entry.advanced.length || factRows.length) ? `
      <details class="o-card atlas-advanced">
        <summary>Advanced</summary>
        <div class="atlas-advanced__body">
          ${paras(entry.advanced)}
          ${factRows.length ? `<dl class="atlas-facts">
            ${factRows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}
          </dl>` : ""}
        </div>
      </details>` : ""}

      ${related.length ? `
      <section class="o-card atlas-block" aria-labelledby="atlas-related-title">
        <h2 class="u-card-title" id="atlas-related-title">Related symbols</h2>
        <ul class="atlas-chip-list">
          ${related.map((r) => `<li><a class="atlas-chip" href="#symbol-atlas/${esc(r.category)}/${esc(r.slug)}">
            <span class="atlas-chip__glyph" aria-hidden="true">${esc(textGlyph(r.glyph))}</span> ${esc(r.title)}</a></li>`).join("")}
        </ul>
      </section>` : ""}

      <p class="atlas-note">${esc(mod.ATLAS_METHODOLOGY_NOTE)}</p>
      <p class="atlas-backlinks">
        <a href="#symbol-atlas/${esc(entry.category)}">Back to ${esc(category?.name || "category")}</a> ·
        <a href="#symbol-atlas">Atlas home</a>
      </p>
    </article>`;
}

/* ── Combination explanations (Dev Update 3.1) ─────────────────────────────
   Composed from canonical entries by public/symbol-atlas/combinations.js.
   This function renders; it decides nothing. A combination that does not
   compose never reaches here — the route falls back to the canonical
   entries instead, so a missing building block loses an explanation rather
   than producing a broken one. */

function atlasCombinationsIndexHtml(mod) {
  const counts = mod.combinationCounts();
  const types = mod.COMBINATION_TYPE_LIST.map((t) =>
    `<li><b>${esc(t.label)}</b> — ${counts[t.slug]} combinations</li>`).join("");
  const examples = mod.COMBINATION_EXAMPLES.map((ex) => {
    const composed = mod.composeCombination(ex.type, ex.parts);
    if (!composed) return "";
    return `<li><a class="atlas-chip" href="#symbol-atlas/combinations/${esc(ex.type)}/${ex.parts.map(esc).join("/")}">${esc(composed.title)}</a></li>`;
  }).join("");

  return `
    <p class="atlas-category-desc">Two symbols read together. Each explanation is composed from the
      Atlas entries for the symbols involved — the same authored material, arranged to answer what
      the pairing means rather than what each half means separately.</p>
    <section class="atlas-block" aria-labelledby="atlas-comb-types-title">
      <h2 class="axis-section-title" id="atlas-comb-types-title">What can be combined</h2>
      <ul class="atlas-list">${types}</ul>
    </section>
    <section class="atlas-block" aria-labelledby="atlas-comb-examples-title">
      <h2 class="axis-section-title" id="atlas-comb-examples-title">Worked examples</h2>
      <ul class="atlas-chip-list">${examples}</ul>
    </section>
    <p class="atlas-note">${esc(mod.ATLAS_METHODOLOGY_NOTE)}</p>
    <p class="atlas-backlinks"><a href="#symbol-atlas">Symbol Atlas home</a></p>`;
}

function atlasCombinationHtml(mod, composed) {
  const group = (g, i, kind) => `
    <section class="o-card atlas-block" aria-labelledby="atlas-${esc(kind)}-${i}-title">
      <h3 class="u-card-title" id="atlas-${esc(kind)}-${i}-title">${esc(g.heading)}</h3>
      <ul class="atlas-list">${g.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </section>`;

  return `
    <article class="atlas-entry atlas-combination">
      <header class="atlas-entry__head">
        <span class="atlas-entry__glyph" aria-hidden="true">${composed.glyphs.map(esc).join(" ")}</span>
        <p class="atlas-entry__summary">${esc(composed.composed)}</p>
      </header>

      ${composed.sections.map((s, i) => `
      <section class="atlas-block atlas-prose" aria-labelledby="atlas-comb-${i}-title">
        <h2 class="axis-section-title" id="atlas-comb-${i}-title">${esc(s.heading)}</h2>
        <p>${esc(s.body)}</p>
      </section>`).join("")}

      <div class="atlas-two-col">
        ${composed.contributions.map((g, i) => group(g, i, "brings")).join("")}
      </div>
      <div class="atlas-two-col">
        ${composed.tensions.map((g, i) => group(g, i, "strain")).join("")}
      </div>

      <section class="o-card atlas-block" aria-labelledby="atlas-comb-entries-title">
        <h2 class="u-card-title" id="atlas-comb-entries-title">The symbols in this combination</h2>
        <ul class="atlas-chip-list">
          ${composed.entries.map((r) => `<li><a class="atlas-chip" href="#symbol-atlas/${esc(r.category)}/${esc(r.slug)}">${esc(r.label)}</a></li>`).join("")}
        </ul>
      </section>

      <p class="atlas-note">${esc(composed.note)}</p>
      <p class="atlas-note">${esc(mod.ATLAS_METHODOLOGY_NOTE)}</p>
      <p class="atlas-backlinks">
        <a href="#symbol-atlas/combinations">All combinations</a> ·
        <a href="#symbol-atlas">Symbol Atlas home</a>
      </p>
    </article>`;
}

/** A combination that did not compose still owes the reader its two entries. */
function atlasCombinationFallbackHtml(mod, type, parts) {
  const entries = mod.combinationFallbackEntries(type, parts);
  return `<div class="atlas-empty" role="status">
    <p>That combination could not be explained on its own${entries.length ? ", but its symbols are here" : ""}.</p>
    ${entries.length ? `<ul class="atlas-chip-list">
      ${entries.map((e) => `<li><a class="atlas-chip" href="#symbol-atlas/${esc(e.category)}/${esc(e.slug)}">${esc(e.title)}</a></li>`).join("")}
    </ul>` : ""}
    <p><a href="#symbol-atlas/combinations">All combinations</a> · <a href="#symbol-atlas">Return to Symbol Atlas</a></p>
  </div>`;
}

function atlasNotFoundHtml(kind, categorySlug) {
  const backToCategory = categorySlug
    ? ` · <a href="#symbol-atlas/${esc(categorySlug)}">Browse that category</a>` : "";
  const message = kind === "category"
    ? "This Atlas category could not be found."
    : "This Atlas entry could not be found.";
  return `<div class="atlas-empty" role="status">
    <p>${esc(message)}</p>
    <p><a href="#symbol-atlas">Return to the Atlas</a>${backToCategory}</p>
  </div>`;
}

function renderAtlasSearch(mod) {
  const box = $("#atlas-search-results");
  const browse = $("#atlas-browse");
  if (!box) return;
  const query = atlasView.query.trim();
  if (!query) {
    box.innerHTML = "";
    if (browse) browse.hidden = false;
    atlasStatus("");
    return;
  }
  const results = mod.searchAtlas(query, { limit: 20 });
  if (browse) browse.hidden = true;
  atlasStatus(results.length
    ? `${results.length} symbol${results.length === 1 ? "" : "s"} found`
    : "No symbols matched your search.");
  box.innerHTML = results.length
    ? `<div class="atlas-card-grid">${results.map((r) => atlasEntryCardHtml(r.entry, mod)).join("")}</div>`
    : `<div class="atlas-empty">
        <p>No symbols matched your search.</p>
        <button type="button" class="o-btn o-btn--secondary" id="atlas-clear-search">Clear search</button>
        <p class="u-meta">Or browse: ${mod.ATLAS_CATEGORIES.map((c) =>
          `<a href="#symbol-atlas/${esc(c.slug)}">${esc(c.shortName)}</a>`).join(" · ")}</p>
      </div>`;
}

async function loadSymbolAtlas() {
  const seq = ++atlasView.seq;
  const root = $("#atlas-root");
  if (!root) return;

  if (!atlasModulePromise) atlasStatus("Loading the Atlas…");
  let mod;
  try {
    mod = await atlasModule();
  } catch {
    atlasModulePromise = null;               // a failed load must be retryable
    if (seq !== atlasView.seq) return;
    atlasStatus("");
    root.innerHTML = `<div class="atlas-empty" role="alert">
      <p>The Atlas could not be loaded. Check your connection and try again.</p>
      <button type="button" class="o-btn o-btn--secondary" id="atlas-retry">Try again</button>
    </div>`;
    return;
  }
  if (seq !== atlasView.seq) return;         // a newer route already took over
  atlasStatus("");

  const { category: categorySlug, slug, deep, combination } = atlasRouteParts();

  // Combinations — index, one explanation, or a fallback to the entries.
  if (combination) {
    if (!combination.type) {
      atlasChrome({ title: "Combinations", subtitle: "Two symbols read together.", focusHeading: true,
        crumbs: [{ label: "Symbol Atlas", href: "#symbol-atlas" }, { label: "Combinations" }] });
      root.innerHTML = atlasCombinationsIndexHtml(mod);
      return;
    }
    const composed = mod.composeCombination(combination.type, combination.parts);
    if (!composed) {
      atlasChrome({ title: "Combinations", subtitle: "", crumbs: [
        { label: "Symbol Atlas", href: "#symbol-atlas" },
        { label: "Combinations", href: "#symbol-atlas/combinations" },
        { label: "Not found" }] });
      atlasStatus("That Symbol Atlas combination could not be found.");
      root.innerHTML = atlasCombinationFallbackHtml(mod, combination.type, combination.parts);
      return;
    }
    atlasChrome({ title: composed.title, subtitle: composed.typeLabel, focusHeading: true,
      crumbs: [
        { label: "Symbol Atlas", href: "#symbol-atlas" },
        { label: "Combinations", href: "#symbol-atlas/combinations" },
        { label: composed.title }] });
    root.innerHTML = atlasCombinationHtml(mod, composed);
    root.scrollTop = 0;
    window.scrollTo({ top: 0 });
    return;
  }

  // Home
  if (!categorySlug) {
    atlasChrome({ title: "Atlas",
      subtitle: "Every symbol Orbit Axis uses, in plain language.",
      crumbs: [] });
    root.innerHTML = atlasHomeHtml(mod);
    renderAtlasSearch(mod);
    return;
  }

  const category = mod.CATEGORY_BY_SLUG[categorySlug];
  if (!category || deep) {
    atlasChrome({ title: "Atlas", subtitle: "", crumbs: [
      { label: "Atlas", href: "#symbol-atlas" }, { label: "Not found" }] });
    atlasStatus("This Atlas category could not be found.");
    root.innerHTML = atlasNotFoundHtml("category", null);
    return;
  }

  // Category page
  if (!slug) {
    atlasChrome({ title: category.name, subtitle: category.description, focusHeading: true,
      crumbs: [{ label: "Atlas", href: "#symbol-atlas" }, { label: category.name }] });
    root.innerHTML = atlasCategoryHtml(mod, category);
    return;
  }

  // Entry page
  const entry = mod.atlasEntry(categorySlug, slug);
  if (!entry) {
    atlasChrome({ title: category.name, subtitle: "", crumbs: [
      { label: "Atlas", href: "#symbol-atlas" },
      { label: category.name, href: `#symbol-atlas/${category.slug}` },
      { label: "Not found" }] });
    atlasStatus("This Atlas entry could not be found.");
    root.innerHTML = atlasNotFoundHtml("entry", category.slug);
    return;
  }

  // No subtitle on an entry page: the summary is the article's opening line,
  // and repeating it under the heading put the same sentence on screen twice
  // — visible the moment 3.1 added the overview paragraphs beneath it.
  atlasChrome({ title: entry.title, subtitle: "", focusHeading: true,
    crumbs: [
      { label: "Atlas", href: "#symbol-atlas" },
      { label: category.name, href: `#symbol-atlas/${category.slug}` },
      { label: entry.title }] });
  root.innerHTML = atlasEntryHtml(mod, entry);
  root.scrollTop = 0;
  window.scrollTo({ top: 0 });
}

function wireSymbolAtlas() {
  const panel = $("#panel-symbol-atlas");
  if (!panel || panel._wired) return;
  panel._wired = true;

  // Search input is re-rendered with the home view, so listen on the panel.
  panel.addEventListener("input", async (event) => {
    if (event.target.id !== "atlas-search-input") return;
    atlasView.query = event.target.value;
    renderAtlasSearch(await atlasModule());
  });
  panel.addEventListener("click", async (event) => {
    if (event.target.closest("#atlas-retry")) return loadSymbolAtlas();
    if (event.target.closest("#atlas-clear-search")) {
      atlasView.query = "";
      const input = $("#atlas-search-input");
      if (input) { input.value = ""; input.focus(); }
      renderAtlasSearch(await atlasModule());
    }
  });
}

/**
 * A contextual reference link into the Atlas, for other Orbit surfaces.
 * Returns plain text unchanged when no entry matches — a surface must never
 * mint a dead link out of a name the Atlas does not know.
 */
const ATLAS_LINKABLE = Object.freeze({
  planets: new Set(["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"]),
  signs: new Set(["aries", "taurus", "gemini", "cancer", "leo", "virgo", "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces"]),
  aspects: new Set(["conjunction", "opposition", "square", "trine", "sextile"]),
  elements: new Set(["fire", "earth", "air", "water"]),
  modalities: new Set(["cardinal", "fixed", "mutable"]),
  angles: new Set(["ascendant", "descendant", "midheaven", "imum-coeli"]),
});

/** A planet-or-angle name → Atlas link. "Rising"/"Ascendant" resolve to the
 *  Ascendant entry; anything unknown stays plain text. */
function atlasBodyLinkHtml(name, { label } = {}) {
  const plain = String(name || "").toLowerCase().trim();
  if (plain === "rising" || plain === "ascendant") {
    return atlasLinkHtml("angles", "ascendant", { label: label ?? name });
  }
  if (plain === "midheaven" || plain === "mc") {
    return atlasLinkHtml("angles", "midheaven", { label: label ?? name });
  }
  return atlasLinkHtml("planets", name, { label });
}

function atlasLinkHtml(category, name, { label } = {}) {
  const slug = String(name || "").toLowerCase().trim().replace(/\s+/g, "-");
  const text = label ?? name;
  if (!ATLAS_LINKABLE[category]?.has(slug)) return esc(text);
  return `<a class="atlas-ref" href="#symbol-atlas/${esc(category)}/${esc(slug)}">${esc(text)}</a>`;
}

/**
 * A contextual link to a combination explanation, for a pairing another Orbit
 * surface has already established and is already showing.
 *
 * Returns "" rather than a link when either half is unknown, so a surface can
 * call this unconditionally without minting a route that would land on a
 * fallback page. The check mirrors ATLAS_LINKABLE exactly — this function
 * cannot see the content module, and guessing would produce dead links.
 */
function atlasCombinationLinkHtml(type, parts, label) {
  const categories = { "planet-in-sign": ["planets", "signs"],
    "planet-in-house": ["planets", "houses"],
    "planet-aspect-planet": ["planets", "aspects", "planets"],
    "planet-with-angle": ["planets", "angles"] }[type];
  if (!categories || parts.length !== categories.length) return "";
  const slugs = parts.map((p) => String(p || "").toLowerCase().trim().replace(/\s+/g, "-"));
  const ok = categories.every((category, i) => category === "houses"
    ? /^(1st|2nd|3rd|[4-9]th|1[0-2]th)-house$/.test(slugs[i])
    : ATLAS_LINKABLE[category]?.has(slugs[i]));
  if (!ok) return "";
  return `<a class="atlas-ref atlas-ref--combination" href="#symbol-atlas/combinations/${esc(type)}/${slugs.map(esc).join("/")}">${esc(label)}</a>`;
}

/** House ordinal (1-12) → Atlas link, or plain text for anything unexpected. */
function atlasHouseLinkHtml(houseNumber, { label } = {}) {
  const n = Number(houseNumber);
  if (!Number.isInteger(n) || n < 1 || n > 12) return esc(label ?? String(houseNumber));
  const ordinal = `${n}${["st", "nd", "rd"][((n + 90) % 100 - 10) % 10 - 1] || "th"}`;
  return `<a class="atlas-ref" href="#symbol-atlas/houses/${ordinal}-house">${esc(label ?? `${ordinal} house`)}</a>`;
}

/* ── Feature flags ─────────────────────────────────────────────────────────
   Tarot, Learn, and News are built but unfinished, and are not part of version
   one. The server decides — this is a cache of its answer, defaulting to OFF so
   that a failed or slow /api/features never briefly reveals a feature that
   should be hidden. Failing open here would show an unfinished page for exactly
   as long as the request took, which is the one moment nobody is watching. */
const featureState = { learn: false, news: false };

async function loadFeatureFlags(pre = null) {
  try {
    const res = await (pre ?? fetch(apiUrl("/api/features")));
    const parsed = await readApiResponse(res);
    if (parsed.kind !== "json" || !parsed.ok) return;   // keep the safe defaults
    const data = parsed.data ?? {};
    for (const key of Object.keys(featureState)) {
      featureState[key] = data?.features?.[key] === true;   // strictly true
    }
  } catch {
    // Keep the safe defaults. Hiding an unfinished feature because the app
    // could not ask is the right way to be wrong.
  }
}

/**
 * Fetch and inject the markup for any enabled feature.
 *
 * The panels were moved out of public/ so they cannot reach the production
 * artifact. That makes them genuinely absent rather than removed-after-load,
 * and it means an enabled feature has to ask for its markup before the router
 * can render it.
 */
async function loadFeaturePanels() {
  const workspace = document.getElementById("workspace");
  if (!workspace) return;
  for (const [id, on] of Object.entries(featureState)) {
    if (!on || document.getElementById(`panel-${id}`)) continue;
    try {
      const res = await fetch(apiUrl(`/api/features/panel/${id}`));
      if (!res.ok) continue;                       // production answers 404; that is correct
      const markup = await res.text();
      const holder = document.createElement("div");
      holder.innerHTML = markup;
      const panel = holder.querySelector(`#panel-${id}`);
      if (panel) { panel.hidden = true; workspace.appendChild(panel); }
    } catch {
      // A feature that cannot load its own markup simply stays unavailable.
    }
  }
}

/**
 * Workspaces this environment may show. Ungated ones always pass.
 *
 * A gated workspace needs BOTH its flag and its markup. The fragments are kept
 * out of the deployed artifact entirely, so a deployment that switched a flag
 * on would otherwise show a navigation item leading to an empty panel. Tying
 * availability to the markup actually being present means the worst case is a
 * feature that stays hidden, rather than one that appears and does nothing.
 */
function availableWorkspaces() {
  return WORKSPACES.filter(ws => {
    // A reader who turned Tarot off gets an app without it: no tab entry, no
    // Today switch, no search result, and #tarot falls back to Home like any
    // other unavailable route. The server still serves it — this is a display
    // preference, not an entitlement — and nothing saved is touched.
    if (ws.id === "tarot" && typeof tarotEnabled === "function" && !tarotEnabled()) return false;
    if (!ws.feature) return true;
    return featureState[ws.feature] === true && Boolean(document.getElementById(`panel-${ws.id}`));
  });
}

function workspaceAvailable(id) {
  return availableWorkspaces().some(ws => ws.id === id);
}

/* ── Router ──────────────────────────────────────────────────────────────
   One registry, one rail builder, one render pass. The mobile bar and the
   desktop sidebar are the same DOM in different CSS, which is what guarantees
   they list the same destinations in the same order.

   The links are ordinary anchors with real hrefs, not tabs. Back, forward,
   refresh, open-in-new-tab, and copy-link all work because the hash IS the
   route rather than a side effect of a click handler. */
function buildRail() {
  // Both icon weights ship in the markup and CSS shows one. Swapping the SVG on
  // navigation would let the active glyph drift out of step with aria-current,
  // which is the attribute that actually tells a screen reader where you are.
  $("#rail-nav").innerHTML = availableWorkspaces().filter(ws => ws.primary).map(ws => `
    <a class="rail__link" id="tab-${ws.id}" href="#${ws.id}" data-ws="${ws.id}">
      ${icon(ws.icon, "rail__icon rail__icon--line")}${icon(`${ws.icon}-fill`, "rail__icon rail__icon--fill")}<span class="rail__label" data-mobile-label="${esc(ws.mobileLabel || ws.label)}">${esc(ws.label)}</span>
    </a>`).join("");
}

/* ── Universal search ─────────────────────────────────────────────────────
   ONE field over the three things a person actually looks for: a page, one of
   their own saved charts, and a symbol they saw somewhere and did not
   recognise.

   WHY IT IS LOCAL. Everything it searches is already in the browser — the
   workspace registry is a constant, the saved charts are in `state`, and the
   Atlas content is a module the app already lazy-loads for its own reference
   pages. So there is no request, no spinner, no debounce, and no failure mode
   where the search is "down". It searches what it has and says so.

   It is deliberately NOT the retired command palette. That was a keyboard
   shortcut over an interface that already had links; this is a visible field
   that answers the one question navigation cannot ("what is a stellium?"), and
   it works by touch. */
const FIND = { open: false, results: [], active: -1, atlas: null };

/** Load the Atlas content once, so the first keystroke is the only slow one. */
async function findEnsureAtlas() {
  if (FIND.atlas) return FIND.atlas;
  try {
    const mod = await atlasModule();
    FIND.atlas = mod;
  } catch {
    // The reference library is one of three sources. If it will not load, the
    // other two still work, and saying nothing is better than an error toast
    // for a search the user has not finished typing.
    FIND.atlas = null;
  }
  return FIND.atlas;
}

function findMatches(raw) {
  const q = String(raw || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const out = [];

  // 1. Destinations. Named by the same registry the navigation reads, so a
  //    search result and a tab can never call the same page two things.
  for (const ws of availableWorkspaces()) {
    if (ws.label.toLowerCase().includes(q) || ws.crumb.toLowerCase().includes(q)) {
      out.push({ kind: "Pages", icon: ws.icon, label: ws.label, sub: ws.crumb, href: `#${ws.id}` });
    }
  }

  // 2. Your saved charts.
  for (const chart of state.charts || []) {
    const name = chart.nickname || chart.name || "Chart";
    if (name.toLowerCase().includes(q)) {
      out.push({ kind: "Your charts", icon: "compass-rose", label: name, sub: relationshipDisplay(chart.relationship) || "Saved chart", href: "#me", chartId: chart.id });
    }
  }

  // 3. The reference library.
  if (FIND.atlas?.searchAtlas) {
    for (const hit of FIND.atlas.searchAtlas(q, { limit: 8 })) {
      out.push({
        kind: "Atlas",
        icon: "book-open-text",
        label: hit.entry.title,
        sub: hit.entry.summary,
        href: `#symbol-atlas/${hit.entry.category}/${hit.entry.slug}`,
      });
    }
  }

  return out.slice(0, 12);
}

function findRender() {
  const panel = $("#find-results");
  const input = $("#find-input");
  if (!panel || !input) return;

  if (!FIND.open || !FIND.results.length) {
    const typing = input.value.trim().length >= 2;
    if (FIND.open && typing) {
      panel.innerHTML = `<p class="o-find__empty">Nothing matches “${esc(input.value.trim())}”.</p>`;
      panel.hidden = false;
      input.setAttribute("aria-expanded", "true");
    } else {
      panel.hidden = true;
      panel.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
    }
    input.removeAttribute("aria-activedescendant");
    return;
  }

  let lastKind = "";
  panel.innerHTML = FIND.results.map((r, i) => {
    const head = r.kind !== lastKind ? `<p class="o-find__group u-eyebrow">${esc(r.kind)}</p>` : "";
    lastKind = r.kind;
    return `${head}<a class="o-find__option" id="find-opt-${i}" role="option" href="${esc(r.href)}"
      aria-selected="${i === FIND.active}" data-index="${i}">
      ${icon(r.icon)}
      <span class="o-find__label">${esc(r.label)}${r.sub ? `<span class="o-find__sub">${esc(r.sub)}</span>` : ""}</span>
    </a>`;
  }).join("");
  panel.hidden = false;
  input.setAttribute("aria-expanded", "true");
  if (FIND.active >= 0) input.setAttribute("aria-activedescendant", `find-opt-${FIND.active}`);
  else input.removeAttribute("aria-activedescendant");
}

function findClose() {
  FIND.open = false;
  FIND.active = -1;
  findRender();
}

function findMove(step) {
  if (!FIND.results.length) return;
  FIND.active = (FIND.active + step + FIND.results.length) % FIND.results.length;
  findRender();
  $(`#find-opt-${FIND.active}`)?.scrollIntoView({ block: "nearest" });
}

/**
 * Make a saved chart the active one, then repaint what depends on it.
 *
 * A failed activation leaves the previous chart active and says so, rather than
 * navigating to a page that would then be reading for someone else.
 */
async function findActivateChart(id) {
  const previousId = state.activeChartId;
  axisClearPersonalReading();
  try {
    await post(`/api/charts/${id}/activate`, {});
    await loadSavedCharts();
    await refreshActiveExperience();
  } catch {
    state.activeChartId = previousId;
    toast("We couldn't switch charts just now. Your saved charts are safe.");
  }
}

function findChoose(index) {
  const hit = FIND.results[index];
  if (!hit) return false;
  const input = $("#find-input");
  if (input) input.value = "";
  findClose();
  // A chart result switches to that chart AND opens the chart page, because
  // "find Mum's chart" means "show me it", not "take me to a list it is in".
  if (hit.chartId && hit.chartId !== state.activeChartId) findActivateChart(hit.chartId);
  location.hash = hit.href.replace(/^#/, "");
  return true;
}

function wireFind() {
  const input = $("#find-input");
  const panel = $("#find-results");
  if (!input || input._wired) return;
  input._wired = true;

  const run = async () => {
    await findEnsureAtlas();
    FIND.results = findMatches(input.value);
    FIND.active = FIND.results.length ? 0 : -1;
    FIND.open = true;
    findRender();
  };

  input.addEventListener("input", run);
  input.addEventListener("focus", () => { if (input.value.trim().length >= 2) run(); });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); findMove(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); findMove(-1); }
    else if (event.key === "Enter") {
      if (FIND.open && findChoose(FIND.active)) event.preventDefault();
    } else if (event.key === "Escape") {
      if (FIND.open) { event.stopPropagation(); findClose(); }
      else input.value = "";
    }
  });

  panel?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-index]");
    if (!option) return;
    event.preventDefault();
    findChoose(Number(option.dataset.index));
  });

  // Clicking away closes it. Focus leaving does too, but only after the click
  // that caused it has had a chance to land on an option.
  document.addEventListener("click", (event) => {
    if (!FIND.open) return;
    if (!event.target.closest("#find")) findClose();
  });
}

/** The hash as written, with the leading "#" and any query junk removed. */
function requestedRoute() {
  return location.hash.replace(/^#/, "").split("?")[0].trim();
}

function currentWorkspace() {
  const hash = requestedRoute();
  // Symbol Atlas owns nested reference routes (#symbol-atlas/planets/moon).
  // Only the Atlas: other workspaces keep the flat contract, so a stray
  // "me/anything" still resolves to Home exactly as before.
  if (hash.startsWith("symbol-atlas/") && workspaceAvailable("symbol-atlas")) return "symbol-atlas";
  // A disabled feature's hash falls back to Home rather than rendering a panel
  // that navigation deliberately hides. Someone with an old bookmark, or a
  // guessed URL, gets the working app instead of an unfinished shell.
  return workspaceAvailable(hash) ? hash : "home";
}

function navigate(id) {
  if (requestedRoute() !== id) { location.hash = id; return; }
  renderRoute();
}

/**
 * Resolve a retired or unknown hash before anything renders.
 *
 * Returns true when it redirected, in which case the hashchange it caused will
 * render the real destination and this pass should stop. An empty hash is not a
 * redirect — it is simply Home, and rewriting it would push a history entry for
 * opening the app.
 */
function resolveLegacyRoute() {
  const hash = requestedRoute();
  if (!hash) return false;
  if (workspaceAvailable(hash)) return false;
  // Atlas sub-routes are never "legacy": an unknown category or entry gets the
  // Atlas's own not-found state, with the URL intact — redirecting to Home
  // would eat the one clue to what the broken link meant to reach.
  if (hash.startsWith("symbol-atlas/")) return false;

  const retired = RETIRED_ROUTES[hash];
  const target = retired?.to ?? "home";
  // replaceState-style: retired routes must not accumulate in history, or Back
  // walks someone through pages that no longer exist.
  location.replace(`${location.pathname}${location.search}#${target}`);
  routeNotice = retired
    ? retired.notice
    : "That page isn't part of Orbit Axis. Here's your day instead.";
  return true;
}

// Set by resolveLegacyRoute(), shown once by renderRoute() on arrival.
let routeNotice = "";

function showRouteNotice() {
  if (!routeNotice) return;
  const message = routeNotice;
  routeNotice = "";
  toast(message);
}

function renderRoute() {
  if (resolveLegacyRoute()) return;

  const id = currentWorkspace();
  // Secondary destinations load their own data on arrival, so a direct link or
  // a refresh lands on a populated page rather than an empty one.
  if (id === "symbol-atlas") { wireSymbolAtlas(); loadSymbolAtlas(); }
  if (id === "transits") { wireTransits(); renderTransits(); }
  if (id === "positions") {
    wirePositions();
    loadPositions();
    // Focus the heading only for a signed-in user. Moving focus into a
    // workspace that is sitting behind the sign-in gate would fight the gate's
    // own focus trap.
    if (authSignedIn()) $("#positions-title")?.focus({ preventScroll: true });
  }
  if (id === "compatibility") { wireCompatibility(); loadCompatibility(); }
  if (id === "saved-charts") loadSavedCharts();
  if (id === "history") {
    const kind = historyKind();
    syncHistoryKinds(kind);
    if (kind === "tarot") axisLoadTarotHistory();
    else axisLoadHistory($("#history-scope")?.value || "active");
  }
  if (id === "tarot") enterTarot();
  if (id === "settings") {
    const section = $("#settings-tarot");
    // Present only when the feature exists on this instance at all — a setting
    // for something that is not here is a setting nobody can act on.
    // Tarot is always present now; the reader's own switch decides whether it
    // appears in navigation. The settings for it are therefore always shown.
    if (section) section.hidden = false;
  }
  // Today's two views. The switch is rendered in both panels, so whichever is
  // on screen has to say where you are — and it stays hidden entirely while
  // Tarot is unavailable.
  syncTodayViews(id);
  // The Chart views nav appears in each of its three panels; whichever is
  // visible must say where you are. aria-current="page" is the entire
  // mechanism — links, not tabs, because these controls navigate.
  document.querySelectorAll(".chart-subnav a").forEach((a) => {
    if (a.dataset.chartView === id) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const ws = WORKSPACES.find(w => w.id === id);

  // A disabled feature's panel is normally never in the document at all: the
  // markup lives outside public/ and is only fetched when the flag is on. This
  // stays as a safety net for a feature switched off during a session, so a
  // panel injected earlier cannot linger.
  for (const gated of WORKSPACES.filter(w => w.feature && !featureState[w.feature])) {
    $(`#panel-${gated.id}`)?.remove();
    $(`#tab-${gated.id}`)?.remove();
  }

  // The tab that should read as current. A secondary destination lights the
  // primary one it belongs to — arriving at Compatibility from Chart and being
  // told you are nowhere is worse than being told you are still in Chart.
  const activeTab = workspaceTab(id);

  WORKSPACES.forEach(w => {
    const panel = $(`#panel-${w.id}`);
    const link = $(`#tab-${w.id}`);
    if (panel) panel.hidden = w.id !== id;
    // aria-current is the whole current-page story for a list of links. It is
    // removed rather than set to "false" when inactive, because "false" is
    // still an announced value in some screen readers.
    if (link) {
      if (w.id === activeTab) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  });

  $("#workspace-title").textContent = ws.label;
  $("#workspace-crumb").textContent = `Orbit Axis · ${ws.crumb}`;
  document.title = `Orbit Axis — ${ws.label}`;
  $("#workspace").scrollTo?.({ top: 0 });
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  showRouteNotice();
}

/* ── Upcoming sky events → the Sky timeline ─────────────────────────────
   The API's `title` carries a trailing glyph ("Full Moon 🌕", "Sun enters Virgo
   ♍"). That field is a response contract other clients may read, so it is left
   alone — but a decorative character inside a sentence is presentation, and
   presentation is this function's job.

   So the glyph is stripped from the rendered title and replaced by an icon
   chosen from the event's own `kind`. That is strictly better than what the
   string gave us: one consistent icon column instead of a mix of full-colour
   emoji (🌕) and monochrome symbols (☿) whose rendering depends on the
   platform's emoji font — which is how a purple-gradient ♍ ended up as the
   loudest thing on a page with one accent colour. */
const EVENT_ICONS = Object.freeze({
  // The Moon's two weights carry the fact: a solid disc is full, an outline
  // crescent is new. Two crescents that differ only in their little stars is a
  // distinction nobody makes at 17px.
  full_moon: "moon-fill",
  new_moon: "moon",
  sun_ingress: "sun",
  mercury_rx: "arrow-clockwise",
  mercury_direct: "arrow-right",
});

/** The event title, with any trailing symbol or emoji removed. */
function eventTitleText(title) {
  return String(title ?? "")
    .replace(/[\s‍️︎]*[←-➿⬀-⯿\u{1f000}-\u{1faff}][‍️︎\u{1f000}-\u{1faff}]*\s*$/u, "")
    .trim();
}

function renderEvents(events) {
  $("#events-count").textContent = `${events.length} upcoming`;
  $("#events-timeline").innerHTML = events.map(e => `
    <div class="o-timeline__item">
      <div class="o-timeline__date">${esc(formatLocalDateKey(e.date))}</div>
      <div class="o-timeline__body">
        <div class="o-timeline__title">
          <span class="o-timeline__icon" aria-hidden="true">${icon(EVENT_ICONS[e.kind] || "sparkle")}</span>
          ${esc(eventTitleText(e.title))}
        </div>
        <div class="o-timeline__detail">${esc(e.detail)}</div>
      </div>
    </div>`).join("");
}

/* ── Global actions ──────────────────────────────────────────────────────
   Every in-page button that changes destination carries data-goto and is
   delegated from here, so a card action and a navigation link cannot drift
   apart. Bound once, after the first data load. */
function wireGlobalActions() {
  $("#transits-refresh")?.addEventListener("click", () => refreshData(true));
  $("#history-scope")?.addEventListener("change", (event) => axisLoadHistory(event.target.value));
  $$("[data-goto]").forEach(btn => btn.addEventListener("click", () => navigate(btn.dataset.goto)));
}

/* ── Auth + saved charts ───────────────────────────────────────────────── */

/**
 * Record which saved chart the app is currently reading for.
 *
 * The daily reading, the Home "Reading for" line, and Technical Sky's transit
 * list all name the active chart, so the name is held in one place rather than
 * re-derived at each call site.
 */
function setActiveChartName(name) {
  state.activeChartName = name || "My Chart";
}

/* ── Chart avatars (Dev Update 1.10) ─────────────────────────────────────
   One rendering for every surface: the deterministic initials fallback is
   ALWAYS painted, and the uploaded picture — when one exists — sits over it.
   A picture that fails to load is simply removed, so the fallback beneath
   shows with no relayout and no broken-image glyph. The whole component is
   aria-hidden because the adjacent text always names the chart; announcing
   the picture would read the name twice. */

function avatarUrl(chart) {
  // The version in the query string makes a replacement a NEW URL, so no
  // cached bytes from the previous picture can survive a change. The server
  // enforces freshness again with a version-keyed ETag.
  //
  // apiUrl(), NOT a bare path. Every fetch in the app already goes through it;
  // this one did not, and an <img src> is a request like any other. In a
  // browser the two are identical, which is why it looked fine — but the iOS
  // container is served from capacitor://localhost, where a bare "/api/..."
  // resolves to the app bundle rather than the server. Chart pictures simply
  // never appeared there.
  return apiUrl(`/api/charts/${encodeURIComponent(chart.id)}/avatar?v=${Number(chart.avatar_version) || 0}`);
}

function chartAvatarHtml(chart, { size = "" } = {}) {
  const cls = `chart-avatar${size ? ` chart-avatar--${size}` : ""}`;
  // Dev Update 4.2: no src in the markup. hydrateAvatars() fills it — from the
  // on-device cache when the picture has been seen before, from an
  // authenticated fetch when it has not. The initials underneath are the
  // designed fallback either way, exactly as before.
  const img = chart.has_avatar
    ? `<img class="chart-avatar__img" data-avatar-chart="${esc(chart.id)}" data-avatar-version="${Number(chart.avatar_version) || 0}" alt="" loading="lazy" decoding="async">`
    : "";
  if (chart.has_avatar) scheduleAvatarHydration();
  return `<span class="${cls}" aria-hidden="true">${esc(chartInitials(chart.nickname))}${img}</span>`;
}

/* ── Avatar hydration (Dev Update 4.2) ────────────────────────────────────
   Why hydration instead of a src: an <img src> is a request the cache cannot
   see, and in the native container it is a request that cannot carry the
   session header at all. Fetching the bytes ourselves fixes both — the blob
   is cached under chart id + avatar_version (a replaced picture is a new
   version, so a new key), and the fetch authenticates the same way every
   other request does.

   Scheduled, not called: chartAvatarHtml returns markup its caller has not
   inserted yet, so hydration runs one macrotask later, once per batch of
   renders, and touches only images still without a src. */
let avatarHydrationQueued = false;
function scheduleAvatarHydration() {
  if (avatarHydrationQueued) return;
  avatarHydrationQueued = true;
  setTimeout(() => { avatarHydrationQueued = false; void hydrateAvatars(); }, 0);
}

async function hydrateAvatars() {
  for (const img of document.querySelectorAll("img.chart-avatar__img[data-avatar-chart]:not([src])")) {
    const id = img.dataset.avatarChart;
    const version = img.dataset.avatarVersion || "0";
    const path = `/api/charts/${encodeURIComponent(id)}/avatar?v=${version}`;
    const key = `avatar::${id}::v${version}`;
    try {
      const hit = await cacheGet(key);
      let blob = hit && hit.value instanceof Blob ? hit.value : null;
      if (!blob) {
        const res = await fetch(apiUrl(path), { headers: { ...authHeaders() }, credentials: "same-origin" });
        // Every request that presents the session reads a rotated one back —
        // the same rule request() enforces for every other fetch in the app.
        rememberSession(res);
        if (!res.ok) throw new Error(String(res.status));
        blob = await res.blob();
        void cachePut(key, blob);
      }
      const url = URL.createObjectURL(blob);
      img.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
      img.src = url;
    } catch {
      // Last resort: the direct URL, which is exactly the pre-4.2 behaviour.
      img.src = apiUrl(path);
    }
  }
}

// 'error' does not bubble, so the fallback swap listens in the capture phase,
// once, for every avatar the app will ever render.
document.addEventListener("error", (event) => {
  if (event.target?.classList?.contains("chart-avatar__img")) event.target.remove();
}, true);

/**
 * What a chart is called inside a native <select>.
 *
 * A select option cannot carry a picture, so the words do the distinguishing:
 * two charts named Alex differ by their relationship label, and the active
 * one says so in text — never in colour, which an option doesn't have anyway.
 */
function chartOptionLabel(chart) {
  const rel = relationshipDisplay(chart.relationship_type ?? null);
  const parts = [chart.nickname || "Untitled Chart", rel.label];
  if (chart.id === state.activeChartId) parts.push("Active");
  return parts.join(" · ");
}

/** Fills a picker's avatar slot with the ACTIVE chart's face (or hides it). */
function renderPickerAvatar(slotSelector) {
  const slot = $(slotSelector);
  if (!slot) return;
  const active = state.charts.find((c) => c.id === state.activeChartId) || null;
  if (!active) {
    slot.hidden = true;
    slot.innerHTML = "";
    return;
  }
  slot.hidden = false;
  slot.innerHTML = `${esc(chartInitials(active.nickname))}${active.has_avatar
    ? `<img class="chart-avatar__img" data-avatar-chart="${esc(active.id)}" data-avatar-version="${Number(active.avatar_version) || 0}" alt="" decoding="async">`
    : ""}`;
  if (active.has_avatar) scheduleAvatarHydration();
}

/* ── Modal utility ─────────────────────────────────────────────────────────
   One shared dialog behavior for the chart form, the delete confirmation, and
   the onboarding gate: focus moves in, Tab is trapped, Escape closes, and focus
   returns to the element that opened it. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const modalStack = [];

function focusables(root) {
  return $$(FOCUSABLE, root).filter(el => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Everything the dialog is layered over.
 *
 * A focus trap stops Tab from LEAVING the dialog. It does nothing about the
 * other ways focus gets behind one: a screen reader's virtual cursor, a
 * browser's find-in-page, a touch-screen swipe through the reading order, or
 * simply clicking. `inert` is what actually removes those, and it takes the
 * subtree out of the accessibility tree at the same time, so a screen reader
 * cannot narrate the obscured application either.
 *
 * Deliberately excludes the dialogs themselves — they live outside .app-shell
 * — so opening one does not make it inert along with the page behind it.
 */
function backgroundRegions() {
  return $$(".app-shell");
}

function setBackgroundInert(on) {
  for (const region of backgroundRegions()) {
    if (on) {
      region.setAttribute("inert", "");
      region.setAttribute("aria-hidden", "true");
    } else {
      region.removeAttribute("inert");
      region.removeAttribute("aria-hidden");
    }
  }
}

/**
 * @param {object} options
 * @param {boolean} [options.dismissible=true]
 *   false for a dialog with nothing behind it to return to — the signed-out
 *   authentication gate. Escape there would dismiss the only usable surface on
 *   the page and leave the person on an inert shell. Every other dialog in
 *   Orbit closes on Escape.
 */
function openModal(el, { onClose = null, initialFocus = null, dismissible = true } = {}) {
  if (!el || modalStack.some(m => m.el === el)) return;
  const entry = { el, onClose, dismissible, restoreTo: document.activeElement };
  modalStack.push(entry);
  el.hidden = false;
  // Only the first dialog needs to do this; nested ones are already covered,
  // and clearing it on the inner close would expose the shell behind the outer.
  if (modalStack.length === 1) setBackgroundInert(true);

  entry.keydown = (event) => {
    if (modalStack[modalStack.length - 1]?.el !== el) return;
    if (event.key === "Escape") {
      if (!dismissible) return;
      // An open combobox inside the dialog owns Escape first: it means "close
      // this list", not "throw away everything I have typed". This listener is
      // registered in the capture phase, so without the check it wins the race
      // against the combobox's own handler and closes the whole form.
      if (el.querySelector("[role=listbox]:not([hidden])")) return;
      event.preventDefault();
      closeModal(el);
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(el);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", entry.keydown, true);

  entry.click = (event) => { if (event.target.closest("[data-modal-close]")) closeModal(el); };
  el.addEventListener("click", entry.click);

  (initialFocus || focusables(el)[0])?.focus();
}

function closeModal(el) {
  const index = modalStack.findIndex(m => m.el === el);
  if (index === -1) return;
  const [entry] = modalStack.splice(index, 1);
  document.removeEventListener("keydown", entry.keydown, true);
  el.removeEventListener("click", entry.click);
  el.hidden = true;
  // Released only when the last dialog closes. Restoring focus while the shell
  // is still inert silently drops it to the body, which is how "focus returns
  // to the button you opened this from" quietly stops being true.
  if (!modalStack.length) setBackgroundInert(false);
  entry.onClose?.();
  restoreFocusAfterClose(entry);
}

/**
 * Put focus somewhere real after a dialog closes.
 *
 * "Falls back to the body" is not a fallback — it is focus loss. A keyboard
 * user lands nowhere and has to Tab from the top of the document to get back to
 * what they were doing, and a screen reader announces nothing at all.
 *
 * The opener is preferred. When it is gone, hidden, or was never focused in the
 * first place (a programmatic open, or a click that did not move focus), the
 * heading of whatever is now on screen is the honest answer: it tells the
 * person where they are rather than dropping them into silence.
 */
function restoreFocusAfterClose(entry) {
  const opener = entry.restoreTo;
  const usable = opener
    && opener !== document.body
    && document.contains(opener)
    && opener.offsetParent !== null;
  if (usable) { opener.focus({ preventScroll: true }); return; }

  const heading = $(".workspace-panel:not([hidden]) h1") || $("#workspace-title");
  if (heading) {
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
}

// Accessible replacement for window.confirm — prevents accidental deletion and
// is fully keyboard operable. Resolves true only on an explicit confirm.
function confirmDialog({ title = "Are you sure?", body = "", confirmLabel = "Delete" } = {}) {
  const modal = $("#confirm-modal");
  if (!modal) return Promise.resolve(false);
  $("#confirm-modal-title").textContent = title;
  $("#confirm-modal-body").textContent = body;
  const accept = $("#confirm-accept");
  const cancel = $("#confirm-cancel");
  accept.textContent = confirmLabel;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      accept.removeEventListener("click", onAccept);
      cancel.removeEventListener("click", onCancel);
      resolve(value);
    };
    // Settle BEFORE closing: closeModal fires this dialog's onClose, whose
    // job is to catch Escape and the backdrop as "cancelled" — with the old
    // order it settled the promise false first and the explicit confirm was
    // a no-op, so no deletion through this dialog ever ran. Found by driving
    // the real dialog in a real browser, not by reading it.
    const onAccept = () => { finish(true); closeModal(modal); };
    const onCancel = () => { finish(false); closeModal(modal); };
    accept.addEventListener("click", onAccept);
    cancel.addEventListener("click", onCancel);
    // Escape / backdrop close resolve as "cancelled".
    openModal(modal, { onClose: () => finish(false), initialFocus: cancel });
  });
}

function authSignedIn() {
  return !!state.auth.user;
}

function activeChart() {
  return state.charts.find(chart => chart.id === state.activeChartId) || state.charts.find(chart => chart.is_active) || null;
}

function wireAuth() {
  const form = $("#auth-form");
  if (!form) return;
  const modeButtons = $$("[data-auth-mode]");
  let mode = "signin";

  const setMode = (next) => {
    mode = next;
    modeButtons.forEach(btn => btn.setAttribute("aria-pressed", String(btn.dataset.authMode === mode)));
    $("#auth-confirm-wrap").hidden = mode !== "signup";
    $("#auth-submit").textContent = mode === "signup" ? "Create account" : "Sign in";
    $("#auth-password").autocomplete = mode === "signup" ? "new-password" : "current-password";
    $("#auth-message").textContent = "";
    // Offering a password reset while someone is creating an account is noise.
    const forgot = $("#auth-forgot-wrap");
    if (forgot) forgot.hidden = mode === "signup";
  };

  modeButtons.forEach(btn => btn.addEventListener("click", () => setMode(btn.dataset.authMode)));
  // Hand the mode switch to openAuthGate, so a contextual prompt can open on
  // the tab that matches what was asked for. Everything mode-dependent — the
  // confirm field, the autocomplete hint, the submit label — moves together
  // because it all still goes through this one function.
  authGate.setMode = setMode;
  setMode("signup");
  $("#auth-close")?.addEventListener("click", () => hideAuthGate());

  // The signed-out half of the "You" panel. Static markup, so wired once here
  // rather than re-bound by every renderAccount().
  $("#account-create")?.addEventListener("click", () => openAuthGate("account"));
  $("#account-signin")?.addEventListener("click", () => openAuthGate("signin"));
  $("#auth-toggle-password")?.addEventListener("click", () => {
    const input = $("#auth-password");
    const button = $("#auth-toggle-password");
    // `showing` is the state BEFORE the click, so every assignment below is the
    // state after it. Reading it the other way round is how a visibility toggle
    // ends up announcing the opposite of what it did.
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.textContent = showing ? "Show" : "Hide";
    button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    button.setAttribute("aria-pressed", String(!showing));
    // Toggling visibility should not cost the person their place in the form.
    input.focus();
  });

  // Guards a double-click, an impatient second Enter, and a slow network from
  // sending the same credentials twice. Sign-up is the one that matters: two
  // in-flight requests race, and the loser reports "an account already exists"
  // for the account the winner just created.
  let submitting = false;
  const submitButton = $("#auth-submit");

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submitting) return;
    const message = $("#auth-message");
    submitting = true;
    if (submitButton) submitButton.disabled = true;
    const pendingLabel = mode === "signup" ? "Creating account…" : "Signing in…";
    message.innerHTML = `<span class="auth-pending">
      <img class="auth-pending__mark orbit-motion-mark" src="/brand/orbit-logo-motion-signal-lock.svg" alt="" />
      <span>${pendingLabel}</span>
    </span>`;
    try {
      const payload = {
        email: $("#auth-email").value,
        password: $("#auth-password").value,
        confirm_password: $("#auth-confirm").value,
      };
      const data = await post(mode === "signup" ? "/api/auth/signup" : "/api/auth/signin", payload);
      message.textContent = data.message || "Signed in.";
      if (data.signed_in) await applySignedIn(data.user);
    } catch (error) {
      message.textContent = error.message;
    } finally {
      // Always restored, including after applySignedIn throws — otherwise a
      // failure mid-sign-in leaves the form permanently unusable.
      submitting = false;
      if (submitButton) submitButton.disabled = false;
    }
  });

  // ── Forgot password ───────────────────────────────────────────────────────
  // The response is identical whether or not the address has an account, so
  // this cannot be used to discover who has one.
  $("#auth-forgot")?.addEventListener("click", async () => {
    const message = $("#auth-message");
    const email = $("#auth-email").value.trim();
    if (!email) {
      message.textContent = "Enter your email address above, then choose “Forgot your password?”.";
      $("#auth-email").focus();
      return;
    }
    const button = $("#auth-forgot");
    button.disabled = true;
    message.textContent = "Sending a reset link…";
    try {
      const data = await post("/api/auth/password/request", { email });
      message.textContent = data.message || "If an account exists for that email, a reset link is on its way.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  $("#account-signout")?.addEventListener("click", async () => {
    await post("/api/auth/signout", {});
    clearPrivateState();
    toast("Signed out");
  });

  wireAccountExport();
  wireAccountPasswordReset();
  wireAccountDeletion();
  wireCacheClear();
}

/* Dev Update 4.2. The roadmap control: a reader can empty the on-device cache
   themselves. The message states the count so the click visibly did
   something, and says plainly that nothing on the account is affected. */
function wireCacheClear() {
  const button = $("#cache-clear");
  const message = $("#cache-clear-message");
  if (!button) return;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const { entries } = await cacheStats();
      await cacheClear();
      cacheNote(null);
      if (message) message.textContent = entries
        ? `Cleared ${entries} cached item${entries === 1 ? "" : "s"} from this device.`
        : "Nothing was cached on this device.";
    } catch {
      if (message) message.textContent = "The cache couldn't be cleared just now.";
    } finally {
      button.disabled = false;
    }
  });
}

/* ── Export my data ────────────────────────────────────────────────────────
   Free, and reachable in two clicks from Settings. Deletion without a way to
   take your data first is not ownership, so this sits beside it rather than
   somewhere a person has to go looking. */
function wireAccountExport() {
  const button = $("#account-export");
  const message = $("#account-export-message");
  if (!button || !message) return;

  let running = false;
  button.addEventListener("click", async () => {
    if (running) return;
    running = true;
    button.disabled = true;
    message.textContent = "Gathering your data…";
    let url = null;
    try {
      // The timezone is a courtesy — it only decides the readable local
      // timestamp printed beside the UTC one inside the file.
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const res = await fetch(apiUrl(`/api/v1/account/export?timezone=${encodeURIComponent(timezone)}`), {
        headers: { Accept: "application/json", ...authHeaders() },
        credentials: "same-origin",
        cache: "no-store",
      });
      rememberSession(res);
      // Through the shared reader, so a login wall, a rewrite, or a hosting
      // provider's HTML 404 is reported as a transport problem rather than
      // being parsed as if it were the export.
      const result = await readApiResponse(res);
      if (result.kind !== "json") {
        message.textContent = apiTransportMessage(result.kind, result.status);
        return;
      }
      const payload = result.data || {};
      if (!result.ok || payload.error) {
        message.textContent = payload?.error?.message || "Your data could not be exported just now.";
        return;
      }

      // A 200 is not the same as an export. `JSON.stringify(undefined)` returns
      // undefined rather than throwing, so a success envelope with no `data`
      // used to save a nine-byte file containing the literal text "undefined"
      // and announce "Downloaded" — a failure wearing a success message, which
      // is the one outcome a data-export feature must never produce. Found by
      // driving the real button against a 200 with an empty envelope.
      const document_ = payload.data;
      if (!document_ || typeof document_ !== "object" || !document_.orbit_axis_export) {
        message.textContent = "Your data could not be exported just now. Please try again.";
        return;
      }

      // Serializing can still fail on a document this browser cannot handle.
      // Better to say so than to save whatever partial text came back.
      let serialized;
      try {
        serialized = JSON.stringify(document_, null, 2);
      } catch {
        message.textContent = "Your data could not be prepared for download. Please try again.";
        return;
      }

      // Named from the response header rather than rebuilt here, so the file a
      // person receives is the one the server said it was sending.
      const disposition = res.headers.get("content-disposition") || "";
      const named = /filename="([^"]+)"/.exec(disposition);
      const filename = named ? named[1] : "orbit-axis-export.json";

      const blob = new Blob([serialized], { type: "application/json" });
      url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      message.textContent = `Downloaded ${filename}.`;
    } catch {
      message.textContent = "Your data could not be exported just now. Check your connection and try again.";
    } finally {
      // The blob URL holds the whole export in memory and would keep it alive
      // for the life of the document. Revoked after the click has been handled.
      if (url) setTimeout(() => URL.revokeObjectURL(url), 0);
      running = false;
      button.disabled = false;
    }
  });
}

/* ── Reset password from a signed-in session ───────────────────────────────
   Reuses the same email flow as "Forgot your password?". Someone who is signed
   in but wants to change their password should not have to sign out and
   pretend to have forgotten it. */
function wireAccountPasswordReset() {
  const button = $("#account-password-reset");
  // Its OWN status line, in the Account card. This used to write into
  // #account-export-message, which lives two sections down under Data: the
  // confirmation was produced correctly and rendered somewhere the person
  // pressing the button could not see, so the button read as broken.
  const message = $("#account-password-message");
  if (!button || !message) return;

  button.addEventListener("click", async () => {
    const email = state.auth.user?.email;
    if (!email) {
      message.textContent = "Sign in first.";
      return;
    }
    button.disabled = true;
    message.textContent = "Sending a reset link…";
    try {
      const data = await post("/api/auth/password/request", { email });
      message.textContent = data.message || "A reset link is on its way to your email.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

/**
 * Return the app to a signed-out state, leaving nothing of the previous account
 * on screen or in memory.
 *
 * Shared by sign-out and deletion so the two can never drift — if a new piece
 * of private state is added and only one path clears it, that is exactly the
 * kind of leak nobody notices until someone else uses the same browser.
 *
 * @param {{ purgeLocalData?: boolean }} options
 *   purgeLocalData additionally clears locally cached birth details. Sign-out
 *   deliberately does NOT: the person is coming back, and wiping their cached
 *   chart on every sign-out would be hostile. Deletion always does.
 */
function clearPrivateState({ purgeLocalData = false } = {}) {
  state.auth.user = null;
  clearPositions();
  state.charts = [];
  state.activeChartId = null;
  state.activeProfile = null;
  state.activeNatalChart = null;
  state.chartsStatus = "idle";
  state.onboardingDismissed = false; // a fresh sign-in gets a fresh decision

  // Dev Update 4.2: cached readings are account content. Whoever uses this
  // device next must not inherit them. Fire-and-forget — leaving never waits
  // on a database.
  void resetDeviceCache();

  if (purgeLocalData) {
    // oa_birth holds birth date, time, and coordinates. It is the most personal
    // thing Orbit stores anywhere, and it lives in localStorage, which no
    // server-side deletion can reach. Missing it would leave a deleted user's
    // birth details sitting in the browser.
    try {
      localStorage.removeItem("oa_birth");
      localStorage.removeItem("oa_detail");
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("orbit.")) localStorage.removeItem(key);
      }
      sessionStorage.clear();
    } catch { /* storage can be unavailable; deletion still succeeded */ }
  }

  // In-memory caches of the account's own content. These survive a re-render,
  // so leaving them populated would keep a deleted account's reading on screen
  // until something happened to overwrite it.
  AXIS.lastFortune = null;
  AXIS.lastSky = null;
  AXIS.loadedOnce = false;

  renderAccount();
  renderSavedCharts();
  if (!$("#chart-modal").hidden) closeModal($("#chart-modal"));
  $("#today-chart-error").hidden = true;

  // Signing out drops you into the signed-out app, not onto a wall — the sky is
  // still there to read. It has to be *repainted*, though: the lines above just
  // cleared the cached reading, and nothing else is coming to fill it now that
  // a gate no longer covers the gap.
  //
  // Deliberately not awaited; this function is synchronous and its callers are
  // finishing a sign-out. Every section inside axisLoadToday renders its own
  // failure state, so the only thing this catch can see is an unexpected throw
  // — which must be reported, not left to surface as an unhandled rejection on
  // the way out of an account.
  axisLoadToday().catch(error => {
    console.error("[orbit] sign-out repaint failed", { message: error?.message });
  });
}

/* ── Permanent account deletion ────────────────────────────────────────────
   Typed confirmation, not a yes/no button. The friction is deliberate: this
   is the one action in Orbit that cannot be undone. */
function wireAccountDeletion() {
  const modal = $("#delete-account-modal");
  const form = $("#delete-account-form");
  if (!modal || !form) return;

  const input = $("#delete-account-confirm");
  const submit = $("#delete-account-submit");
  const message = $("#delete-account-message");
  const REQUIRED = "DELETE";
  let deleting = false;

  const reset = () => {
    input.value = "";
    submit.disabled = true;
    message.textContent = "";
    deleting = false;
  };

  // openModal already restores focus to whatever opened the dialog, so
  // cancelling returns the person to the Delete account button they came from.
  $("#account-delete-open")?.addEventListener("click", () => {
    reset();
    openModal(modal, { onClose: reset, initialFocus: input });
  });
  $("#delete-account-cancel")?.addEventListener("click", () => closeModal(modal));
  $("#delete-account-close")?.addEventListener("click", () => closeModal(modal));

  // The button stays disabled until the typed value is exactly right. Trimmed
  // so a trailing space from a paste is not a confusing dead end, but not
  // upper-cased — typing it in capitals is part of the deliberateness.
  input.addEventListener("input", () => {
    submit.disabled = input.value.trim() !== REQUIRED || deleting;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (deleting || input.value.trim() !== REQUIRED) return;

    deleting = true;
    submit.disabled = true;
    $("#delete-account-cancel").disabled = true;
    message.textContent = "Deleting your account…";

    try {
      const res = await fetch(apiUrl("/api/v1/account"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ confirmation: REQUIRED }),
      });
      rememberSession(res);
      const parsed = await readApiResponse(res);
      const payload = parsed.data;

      if (parsed.kind !== "json") {
        // Non-JSON from the deletion endpoint means the request never reached
        // Orbit. Saying so beats a parser error on the one screen where a
        // confusing message is least acceptable.
        message.textContent = apiTransportMessage(parsed.kind, parsed.status);
        deleting = false;
        submit.disabled = input.value.trim() !== REQUIRED;
        $("#delete-account-cancel").disabled = false;
        return;
      }

      if (!parsed.ok || !payload?.data?.deleted) {
        // Never a fake success. The person is told what actually happened and,
        // where it is worth retrying, given the request id to quote.
        const error = payload?.error;
        const reference = payload?.meta?.requestId ? ` (reference ${payload.meta.requestId})` : "";
        message.textContent = (error?.message || "Your account could not be deleted.") + reference;
        deleting = false;
        submit.disabled = input.value.trim() !== REQUIRED;
        $("#delete-account-cancel").disabled = false;
        return;
      }

      closeModal(modal);
      clearPrivateState({ purgeLocalData: true });
      // replaceState so the browser Back button cannot return to a private view
      // rendered before the account was deleted.
      if (history.replaceState) history.replaceState(null, "", "#home");
      navigate("home");
      toast("Your account has been permanently deleted.");
    } catch {
      message.textContent = "Could not reach Orbit. Your account was not deleted. Check your connection and try again.";
      deleting = false;
      submit.disabled = input.value.trim() !== REQUIRED;
      $("#delete-account-cancel").disabled = false;
    }
  });
}

/* ── The account prompt ────────────────────────────────────────────────────
   This used to be a wall. It opened on boot for every signed-out visitor, marked
   the whole shell inert, and refused Escape — so the first thing anyone saw of
   Orbit Axis was an empty password field, with the headline and every reason to
   care pushed under the fold on a laptop. We asked for a password before making
   a single promise.

   It is now a prompt, asked at the point an account starts paying for itself.
   Today's sky is calculated from astronomy alone — no account, no database — so
   a visitor reads the real product first. The ask arrives when they reach their
   own birth chart, which needs somewhere to keep birth details and a geocoder
   we pay for per lookup. Value first, ask second.

   It is dismissible now, because there is finally something behind it to go
   back to. That is the same reason Escape was refused before, read the other
   way round.

   `reason` is what turns a generic form into an answer to the question the
   visitor just asked. Each entry is the headline they earned by getting here,
   so the prompt never opens on "Sign in" for someone who has never heard of us —
   a returning user recognises their own name for this, and a new one is offered
   the thing they were reaching for. */
const AUTH_REASONS = {
  // Reached the account panel deliberately, or asked for it by name.
  account: {
    title: "Keep your sky",
    body: "A free account saves your birth chart and your daily readings, on every device you use.",
    mode: "signup",
  },
  // The big one: they want the reading to be about them, not about everyone.
  chart: {
    title: "Make this about you",
    body: "You're reading the sky everyone shares. Add your birth details and Orbit Axis reads today against the sky the day you were born.",
    mode: "signup",
  },
  // The one prompt that must not say "free". `free` has
  // "chart.compatibility": false in the v1 matrix (lib/entitlements/plans.js) —
  // confirmed as the intended boundary, not an oversight. So this surface sells
  // the CHART, which a free account really does get, and never the comparison,
  // which it does not.
  //
  // It also does not announce a price. Enforcement is still dark, so today a
  // free account can compare; saying "part of a paid plan" would be false in
  // the other direction. Describe the prerequisite, let the entitlement layer
  // speak for itself when it is switched on, and the copy stays true either way.
  compatibility: {
    title: "Start with your chart",
    body: "Compatibility reads two saved charts against each other, so Orbit Axis needs yours before it can compare anything.",
    mode: "signup",
  },
  history: {
    title: "Keep your readings",
    body: "Your past readings are saved to your account, so the week strip fills in as you go.",
    mode: "signup",
  },
  // Asked for by name, from the "Sign in" control. Opens on the sign-in tab.
  signin: {
    title: "Welcome back",
    body: "Sign in to restore your chart and your saved readings.",
    mode: "signin",
  },
};

/* Set by wireAuth so the prompt can open on the right tab. Held here rather
   than reaching into the DOM, because the mode also drives the confirm field,
   the autocomplete hint and the submit label, and clicking the tab button is
   how those three used to drift apart. */
const authGate = { setMode: null };

/**
 * Ask for an account, in the words of whatever the visitor was reaching for.
 * Safe to call when the prompt is already open — it re-points the copy.
 */
function openAuthGate(reason = "account") {
  const gate = $("#auth-gate");
  if (!gate) return;
  const copy = AUTH_REASONS[reason] || AUTH_REASONS.account;
  $("#auth-gate-title").textContent = copy.title;
  $("#auth-gate-description").textContent = copy.body;
  authGate.setMode?.(copy.mode);
  if (!gate.hidden) return;
  openModal(gate, { dismissible: true, initialFocus: $("#auth-email") });
}

function hideAuthGate() {
  const gate = $("#auth-gate");
  if (!gate || gate.hidden) return;
  closeModal(gate);
}

/**
 * Guard an action that genuinely needs an account. Returns true when the caller
 * may proceed; otherwise it has already asked, in that action's own words.
 *
 * Everything routed through here is something the server would refuse anyway —
 * saving a chart, comparing two, reading history. Nothing that merely *reads*
 * the sky belongs here; that is the whole point of the signed-out preview.
 */
function requireAccount(reason) {
  if (authSignedIn()) return true;
  openAuthGate(reason);
  return false;
}

// Startup runs in a fixed order: resolve auth -> load saved charts -> decide.
// Onboarding is only ever a *decision*, never a default, so a returning user is
// never asked to set up a chart they already have.
async function restoreSession(pre = null) {
  state.auth.restoring = true;
  setStartupStatus("Restoring your Orbit…");
  hideAuthGate();
  try {
    const data = await (pre ?? get("/api/auth/session"));
    if (data.signed_in) {
      await applySignedIn(data.user, { quiet: true });
    } else {
      // Signed-out preview. Not a stub and not a teaser: Today, Sky, Positions
      // and the Atlas are calculated from astronomy alone and are the same
      // pages a signed-in user reads. The only thing missing is the part that
      // is about *them*, which is exactly what we ask for later.
      state.auth.user = null;
      state.charts = [];
      state.activeChartId = null;
      state.activeProfile = null;
      state.activeNatalChart = null;
      state.chartsStatus = "idle";
      clearPositions();
      renderAccount();
      renderSavedCharts();
    }
  } catch {
    // Couldn't even resolve the session. Treat it as signed out rather than
    // blocking: the sky does not depend on knowing who is reading it, and a
    // failed session request is the worst possible moment to demand a password.
    state.auth.user = null;
  } finally {
    state.auth.restoring = false;
    finishStartup();
  }
}

async function applySignedIn(user, { quiet = false } = {}) {
  state.auth.user = user;
  // Dev Update 4.2: the cache is namespaced by account, and switching
  // namespaces deletes the one being left — two accounts on one device never
  // see each other's cache. Awaited so nothing below writes into the old one.
  await setCacheNamespace(String(user?.id || "anon"));
  // Auth is resolved the moment we have the user — record that before the chart
  // decision runs, otherwise it would still read as "loading".
  state.auth.restoring = false;
  hideAuthGate();
  renderAccount();
  setStartupStatus("Loading your charts…");
  await loadSavedCharts();
  await resolveChartState();
  if (!quiet) toast("Signed in");
}

// The single place that decides what a signed-in user sees after their charts
// resolve. The decision itself lives in startup-state.js so it can be unit
// tested; this function only paints the result.
async function resolveChartState() {
  const modal = $("#chart-modal");
  const errorBox = $("#today-chart-error");
  const formOpen = modal && !modal.hidden;

  const view = decideStartupView({
    authResolved: !state.auth.restoring,
    signedIn: authSignedIn(),
    chartsStatus: state.chartsStatus,
    chartCount: state.charts.length,
    onboardingDismissed: state.onboardingDismissed,
  });

  // Recoverable failure: offer a retry. NEVER claim the user has no chart.
  if (view === STARTUP_VIEW.ERROR) {
    if (formOpen && chartForm.mode === "first") closeModal(modal);
    if (errorBox) errorBox.hidden = false;
    await axisLoadToday(); // Current Sky still renders; Home is never left blank.
    return;
  }
  if (errorBox) errorBox.hidden = true;

  // Genuinely zero saved charts on a successful request → first-run onboarding.
  // It opens the same form every other entry point opens, in "first" mode.
  if (view === STARTUP_VIEW.ONBOARDING) {
    if (!formOpen) openChartForm("first");
    renderSavedCharts();
    return;
  }

  // Returning user. The server already resolved (and persisted) the active
  // chart, so we just load their experience. No popup, ever — and a form the
  // user opened deliberately is left alone.
  if (formOpen && chartForm.mode === "first") closeModal(modal);
  await refreshActiveExperience();
}

function setStartupStatus(text) {
  const el = $("#startup-status");
  if (el) el.textContent = text;
}

// Drop the startup gate once auth + charts have resolved. Guarded so it only
// runs once and can never re-block the interface.
function finishStartup() {
  if (state.startup === "ready") return;
  state.startup = "ready";
  const gate = $("#startup-gate");
  if (gate) gate.hidden = true;
  // The startup gate covers the auth gate during restore, so focus placed at
  // open time would land on a field nobody can see yet. Place it once the
  // cover is actually gone.
  const auth = $("#auth-gate");
  if (auth && !auth.hidden) $("#auth-email")?.focus();
}

function renderAccount() {
  const signedIn = authSignedIn();
  $("#account-email").textContent = state.auth.user?.email || "Not signed in";

  // The "You" panel is reachable without an account now. Every control below is
  // one the server would refuse, and two of them are worse than a refusal:
  // "Sign out" of nothing reads as a broken app, and "Delete your account"
  // offers to permanently destroy something the visitor does not have. They are
  // hidden rather than disabled — a greyed-out Delete still says we think you
  // might want to.
  const toggle = (id, shown) => { const el = $(id); if (el) el.hidden = !shown; };
  toggle("#account-signed-in", signedIn);
  toggle("#account-password-message", signedIn);
  toggle("#account-signed-out", !signedIn);
  toggle("#account-export-group", signedIn);
  toggle("#danger-zone", signedIn);

  renderAuthCta();
}

/**
 * The standing offer in the rail, for signed-out visitors only.
 *
 * Opening the app no longer demands an account, which leaves a real question:
 * how does someone who decides they want one actually say so? This is the
 * answer — one persistent, ignorable control, in the one place that is on
 * screen from every page. It states the price, because "free" unasked is the
 * objection people bring to a sign-up button, and answering it after they have
 * already hesitated is too late.
 */
function renderAuthCta() {
  const slot = $("#rail-cta");
  if (!slot) return;
  if (authSignedIn()) { slot.innerHTML = ""; slot.hidden = true; return; }
  slot.hidden = false;
  slot.innerHTML = `
    <button type="button" class="rail__cta-btn o-btn o-btn--primary" id="rail-cta-create">Create your chart</button>
    <p class="rail__cta-note">Free · no card</p>
    <button type="button" class="linklike rail__cta-signin" id="rail-cta-signin">Already have an account?</button>`;
  $("#rail-cta-create").addEventListener("click", () => openAuthGate("chart"));
  $("#rail-cta-signin").addEventListener("click", () => openAuthGate("signin"));
}

/* ── The chart form ──────────────────────────────────────────────────────
   One form, three modes. Dev Update 1.4 collapsed three separate forms into
   this: a first-run dialog with its own fields, this modal, and a third form
   injected into Home that could never succeed for the signed-out audience that
   saw it. Three forms meant three sets of ids for the same data, and three
   places for validation to drift apart.

   Only these three things vary by mode. Everything else — fields, validation,
   place search, dialog behaviour — is shared by construction. */
const CHART_MODES = {
  first: {
    title: "Create your birth chart",
    intro: "Orbit Axis uses your birth date, time, and place to calculate your chart. "
         + "Your information stays private and can be exported or deleted from your account.",
    save: "Create my chart",
    saving: "Calculating your chart…",
    done: "Your chart is ready.",
    defaultName: "My Chart",
    showRelationship: false,
    showNames: true,
    showAvatar: true,
  },
  add: {
    title: "Add a saved chart",
    intro: "Orbit Axis uses a birth date, time, and place to calculate this chart. "
         + "Saved charts are private to your account.",
    save: "Save chart",
    saving: "Saving chart…",
    done: "Chart added.",
    defaultName: "",
    showRelationship: true,
    showNames: true,
    showAvatar: true,
  },
  edit: {
    title: "Edit saved chart",
    intro: "Changing the date, time, or place recalculates this chart. "
         + "Placements may move as a result.",
    save: "Save changes",
    saving: "Saving changes…",
    done: "Chart updated.",
    defaultName: "",
    showRelationship: true,
    showNames: true,
    // Changing a picture is an identity edit; this form edits birth data.
    showAvatar: false,
  },
};

/** Live state of the open form. `mode` is what the copy and submit key off. */
const chartForm = { mode: "add", chartId: null, submitting: false, openedBy: null };

/* The form's optional picture. Normalized immediately on selection so the
   preview IS the bytes that will upload — never the original file, which is
   discarded (with its EXIF) as soon as the normalizer returns. */
const chartFormAvatar = { blob: null, preview: null };

function resetChartFormAvatar() {
  chartFormAvatar.preview?.release();
  chartFormAvatar.preview = null;
  chartFormAvatar.blob = null;
  renderChartFormAvatar();
  const note = $("#cm-avatar-note");
  if (note) note.textContent = "";
}

function renderChartFormAvatar() {
  const holder = $("#cm-avatar");
  if (!holder) return;
  const initials = chartInitials($("#cm-nickname")?.value?.trim() || "");
  const img = chartFormAvatar.preview
    ? `<img class="chart-avatar__img" src="${esc(chartFormAvatar.preview.url)}" alt="">`
    : "";
  holder.innerHTML = `${esc(initials)}${img}`;
  const discard = $("#cm-avatar-discard");
  if (discard) discard.hidden = !chartFormAvatar.preview;
}

async function onChartFormFileChosen(event) {
  const file = event.target.files?.[0];
  event.target.value = "";                       // never retain the original File
  if (!file) return;
  const note = $("#cm-avatar-note");
  if (note) note.textContent = "Preparing image…";
  try {
    const blob = await normalizeAvatar(file);
    chartFormAvatar.preview?.release();
    chartFormAvatar.blob = blob;
    chartFormAvatar.preview = previewFor(blob);
    renderChartFormAvatar();
    if (note) note.textContent = `Preview, ${Math.max(1, Math.round(blob.size / 1024))} KB — uploads after the chart is saved.`;
  } catch (error) {
    renderChartFormAvatar();
    if (note) note.textContent = error?.message || "Orbit couldn't prepare that image.";
  }
}

const NAME_MAX = 80;

/* ── Validation ──────────────────────────────────────────────────────────
   Shared by all three modes, and deliberately not delegated to the browser.
   `<input type="date">` will happily hand over a date in the year 3000, and on
   a browser without native date support it hands over free text. The server
   validates all of this again; this layer exists so the person finds out at the
   field rather than after a round trip. */

function isRealCalendarDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  // Round-tripping through Date catches the impossible days that range checks
  // miss — 31 February, 31 April, 29 February in a common year.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

function isFutureDate(value) {
  // Compared as calendar dates, not instants: a birth date is a date on a wall
  // calendar, and converting it to an instant would make "today" wrong for
  // roughly half the world.
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return String(value) > todayKey;
}

function fieldError(id, message) {
  const el = $(`#cm-${id}-error`);
  const input = $(`#cm-${id}`);
  if (el) { el.textContent = message || ""; el.hidden = !message; }
  if (input) {
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
}

function clearChartFormErrors() {
  for (const id of ["nickname", "date", "time", "place", "relationship"]) fieldError(id, "");
  const summary = $("#chart-modal-error");
  if (summary) { summary.textContent = ""; summary.hidden = true; }
}

function chartAccuracy() {
  return $('input[name="cm-accuracy"]:checked')?.value || "unknown";
}

/**
 * Validate every field and return the first offending input so focus can go to
 * it. Reporting all of them at once and focusing the first is the behaviour
 * that survives a keyboard-only pass.
 */
function validateChartForm() {
  clearChartFormErrors();
  let firstBad = null;
  const fail = (id, message) => {
    fieldError(id, message);
    if (!firstBad) firstBad = $(`#cm-${id}`);
  };

  const name = $("#cm-nickname").value.trim();
  if (!name) fail("nickname", "Give this chart a name.");
  else if (name.length > NAME_MAX) fail("nickname", `Keep the name under ${NAME_MAX} characters.`);

  const date = $("#cm-date").value;
  if (!date) fail("date", "Enter a birth date.");
  else if (!isRealCalendarDate(date)) fail("date", "That date doesn't exist. Check the day and month.");
  else if (isFutureDate(date)) fail("date", "A birth date can't be in the future.");

  const accuracy = chartAccuracy();
  const time = $("#cm-time").value;
  if (accuracy !== "unknown" && !time) {
    fail("time", "Enter a birth time, or choose Unknown above.");
  }

  // Additional charts must say how they relate — the server refuses the save
  // without it, and finding that out at the field beats a round trip. The
  // first chart's field is hidden and defaults to Self. In edit mode an empty
  // control means "a legacy value is stored"; leaving it empty preserves that
  // value, so it is not an error.
  const relationshipField = $("#cm-relationship-field");
  if (relationshipField && !relationshipField.hidden && chartForm.mode === "add"
      && !$("#cm-relationship").value) {
    fail("relationship", "Choose how this chart relates to you.");
  }

  try {
    requireSelectedPlace("cm", { allowExisting: chartForm.mode === "edit" });
  } catch (error) {
    fail("place", error.message);
  }

  return firstBad;
}

function chartFormPayload() {
  const accuracy = chartAccuracy();
  const placePayload = requireSelectedPlace("cm", { allowExisting: chartForm.mode === "edit" });
  const payload = {
    nickname: $("#cm-nickname").value.trim(),
    first_name: $("#cm-first").value.trim() || null,
    last_name: $("#cm-last").value.trim() || null,
    birth_date: $("#cm-date").value,
    // The server nulls this too when the time is unknown. Doing it here as well
    // means the request body never carries a time the user disclaimed.
    birth_time: accuracy === "unknown" ? null : ($("#cm-time").value || null),
    time_accuracy: accuracy,
    ...placePayload,
  };
  // The first chart is the account owner's own by definition. Every other
  // mode sends a relationship ONLY when one was chosen: an empty control in
  // edit mode means a legacy value is stored, and omitting the key is what
  // preserves it — sending null would ask the server to unset it, which the
  // server (correctly) refuses.
  const relationshipChoice = $("#cm-relationship").value || "";
  if (chartForm.mode === "first") payload.relationship_type = DEFAULT_FIRST_CHART_RELATIONSHIP;
  else if (relationshipChoice) payload.relationship_type = relationshipChoice;

  // A real calculation input, not a display preference: it is part of the
  // chart's input hash, so saving a different one recomputes the chart.
  const houseSystem = $("#cm-house-system")?.value;
  if (houseSystem) payload.house_system = houseSystem;
  return payload;
}

/** Show or hide the time field and its consequences to match the certainty. */
function syncTimeCertainty() {
  const unknown = chartAccuracy() === "unknown";
  const field = $("#cm-time-field");
  const notice = $("#cm-unknown-notice");
  if (field) field.hidden = unknown;
  if (notice) notice.hidden = !unknown;
  if (unknown) fieldError("time", "");
}

/**
 * @param {"first"|"add"|"edit"} mode
 * @param {object|null} chart  the chart being edited, for edit mode
 */
function openChartForm(mode, chart = null) {
  const modal = $("#chart-modal");
  if (!modal) return;
  const config = CHART_MODES[mode] || CHART_MODES.add;
  chartForm.mode = mode;
  chartForm.chartId = chart?.id || null;
  chartForm.openedBy = document.activeElement;

  $("#chart-modal-form").reset();
  clearChartFormErrors();
  $("#cm-id").value = chart?.id || "";
  $("#chart-modal-title").textContent = config.title;
  $("#chart-modal-intro").textContent = config.intro;
  $("#chart-modal-save").textContent = config.save;
  $("#chart-modal-hint").textContent = "";

  // Relationship is meaningless for your own first chart, and asking for it
  // there implies the chart might be someone else's.
  $("#cm-relationship-field").hidden = !config.showRelationship;

  // The optional picture is a create-time convenience; editing one later is
  // the identity editor's job. Any leftover selection from a previous open is
  // discarded with its object URL.
  resetChartFormAvatar();
  const avatarField = $("#cm-avatar-field");
  if (avatarField) avatarField.hidden = !config.showAvatar;

  if (chart) {
    $("#cm-nickname").value = chart.nickname || "";
    $("#cm-first").value = chart.first_name || "";
    $("#cm-last").value = chart.last_name || "";
    // A legacy value has no option to select, so the control falls back to the
    // empty "Choose one…" state. That is correct: it shows the relationship
    // needs choosing without pretending the stored value was one of the four,
    // and saving other fields leaves the stored value untouched.
    $("#cm-relationship").value =
      RELATIONSHIP_TYPES.includes(chart.relationship_type) ? chart.relationship_type : "";
    $("#cm-date").value = chart.birth_date || "";
    $("#cm-time").value = chart.birth_time ? String(chart.birth_time).slice(0, 5) : "";
    const accuracy = chart.time_accuracy || "unknown";
    const radio = $(`input[name="cm-accuracy"][value="${accuracy}"]`)
      // "reported" is a stored value with no radio of its own; it is a known
      // time, so it presents as Exact rather than silently becoming Unknown.
      || $('input[name="cm-accuracy"][value="exact"]');
    if (radio) radio.checked = true;
    const place = chartPlace(chart);
    if (place) setPlaceSelection("cm", place, { existing: true });
    else clearPlaceSelection("cm");
    const house = $("#cm-house-system");
    // An unrecognised stored value falls back to the visible default rather
    // than leaving the control blank — the chart was computed with something,
    // and the control should say which.
    if (house) {
      const stored = String(chart.house_system || "placidus").toLowerCase();
      house.value = [...house.options].some((o) => o.value === stored) ? stored : "placidus";
    }
  } else {
    $("#cm-nickname").value = config.defaultName;
    // "first" pre-answers Self (the field is hidden there); "add" starts at
    // the empty non-choice — no default Friend, no resurrected "other".
    $("#cm-relationship").value = mode === "first" ? "self" : "";
    if ($("#cm-house-system")) $("#cm-house-system").value = "placidus";
    clearPlaceSelection("cm");
  }

  syncTimeCertainty();
  setupPlaceSearch("cm");
  openModal(modal, {
    initialFocus: $("#cm-nickname"),
    // First-run onboarding is dismissible: someone who is not ready to hand
    // over birth details should be able to look around first.
    onClose: () => { if (chartForm.mode === "first") state.onboardingDismissed = true; },
  });
}

/** Kept as the old name so existing call sites read unchanged. */
function openChartModal(chart = null) {
  // The one door into the chart form, from four call sites — so it is the one
  // place the account has to be asked for. The form cannot succeed without one:
  // birthplace search is an authenticated, per-user rate-limited call to a
  // geocoder we pay for, and there is nowhere to save the result. Asking here
  // beats letting someone fill in their birth details and meet a 401.
  if (!requireAccount("chart")) return undefined;
  if (chart) return openChartForm("edit", chart);
  const first = authSignedIn() && state.charts.length === 0;
  return openChartForm(first ? "first" : "add");
}

/* ── Chart identity editor (Dev Update 1.10) ─────────────────────────────
   Name, picture, and relationship — never birth data. Saves are minimal by
   construction: only the fields that actually changed are sent, so a rename
   cannot rewrite a legacy relationship value and a picture change cannot
   touch the name. Avatar bytes go through the client normalizer (centre
   crop, 512×512 WebP, metadata stripped) and are uploaded with the version
   this editor read, so a concurrent change is a told-about conflict rather
   than a silent overwrite. */

const identityForm = {
  chart: null, openedBy: null, submitting: false,
  pendingBlob: null, preview: null, removeRequested: false,
  textDone: false,
  // The crop editor and the decoded source it is framing. Held so the image is
  // decoded once per chosen file rather than once per slider move.
  cropEditor: null, sourceImage: null, sourceFile: null,
};

function identityAvatarNote(text) {
  const el = $("#identity-avatar-note");
  if (el) el.textContent = text || "";
}

function identityHint(text) {
  const el = $("#identity-hint");
  if (el) el.textContent = text || "";
}

function showIdentityError(message, { retry = true } = {}) {
  const box = $("#identity-error");
  const text = $("#identity-error-text");
  const retryBtn = $("#identity-retry");
  if (!box) return;
  if (text) text.textContent = message;
  if (retryBtn) retryBtn.hidden = !retry;
  box.hidden = false;
  box.focus({ preventScroll: false });
}

function hideIdentityError() {
  const box = $("#identity-error");
  if (box) box.hidden = true;
}

function identityFieldError(message) {
  const el = $("#identity-nickname-error");
  const input = $("#identity-nickname");
  if (el) { el.textContent = message || ""; el.hidden = !message; }
  if (input) {
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
}

/** The editor's avatar: pending preview > stored picture > initials. */
function renderIdentityAvatar() {
  const holder = $("#identity-avatar");
  const chart = identityForm.chart;
  if (!holder || !chart) return;
  const initials = chartInitials($("#identity-nickname")?.value?.trim() || chart.nickname);
  let img = "";
  if (identityForm.preview) {
    img = `<img class="chart-avatar__img" src="${esc(identityForm.preview.url)}" alt="">`;
  } else if (chart.has_avatar && !identityForm.removeRequested) {
    img = `<img class="chart-avatar__img" src="${esc(avatarUrl(chart))}" alt="">`;
  }
  holder.innerHTML = `${esc(initials)}${img}`;
  const remove = $("#identity-avatar-remove");
  if (remove) {
    remove.hidden = !(identityForm.preview || (chart.has_avatar && !identityForm.removeRequested));
    remove.textContent = identityForm.preview ? "Discard new picture" : "Remove picture";
  }
}

/** The legacy relationship state, named honestly and never remapped. */
function renderIdentityLegacy(value) {
  const note = $("#identity-legacy");
  if (!note) return;
  const display = relationshipDisplay(value ?? null);
  if (value === "public_figure") {
    note.textContent = `${display.label}. ${display.help}`;
    note.hidden = false;
  } else if (display.status === "unset") {
    note.textContent = `${display.label}. Choose relationship when you're ready — saving other changes leaves it as it is.`;
    note.hidden = false;
  } else {
    note.textContent = "";
    note.hidden = true;
  }
}

function resetIdentityWorkingState() {
  releaseIdentitySource();
  showIdentityCrop(false);
  identityForm.preview?.release();
  identityForm.preview = null;
  identityForm.pendingBlob = null;
  identityForm.removeRequested = false;
  identityForm.textDone = false;
  identityForm.submitting = false;
}

function openIdentityEditor(chart, { pendingBlob = null, errorMessage = null } = {}) {
  const modal = $("#identity-modal");
  if (!modal || !chart) return;
  resetIdentityWorkingState();
  identityForm.chart = { ...chart };
  identityForm.openedBy = document.activeElement;
  $("#identity-form")?.reset();
  identityFieldError("");
  hideIdentityError();
  identityHint("");
  $("#identity-nickname").value = chart.nickname || "";
  // A legacy value has no option to select; the control shows "Choose one…"
  // while the note below names what is actually stored.
  $("#identity-relationship").value =
    RELATIONSHIP_TYPES.includes(chart.relationship_type) ? chart.relationship_type : "";
  renderIdentityLegacy(chart.relationship_type ?? null);
  // A blob handed over from the create form (its upload failed after the
  // chart saved) arrives already normalized; Retry re-uses it as-is.
  if (pendingBlob) {
    identityForm.pendingBlob = pendingBlob;
    identityForm.preview = previewFor(pendingBlob);
  }
  renderIdentityAvatar();
  identityAvatarNote(identityForm.pendingBlob
    ? "Preview — saved when you press Save."
    : chart.has_avatar
      ? "This chart has a picture."
      : "No picture yet — Orbit shows the chart's initials.");
  openModal(modal, {
    initialFocus: $("#identity-nickname"),
    // Cancelling restores the persisted state by discarding everything the
    // editor was holding: the pending blob, its preview URL, the removal
    // intent. Nothing was sent, so nothing needs undoing.
    onClose: resetIdentityWorkingState,
  });
  if (errorMessage) showIdentityError(errorMessage);
}

async function onIdentityFileChosen(event) {
  const file = event.target.files?.[0];
  // Clearing the input means choosing the same file again still fires change,
  // and the original File object is not retained anywhere.
  event.target.value = "";
  if (!file) return;
  hideIdentityError();
  identityAvatarNote("Preparing image…");
  try {
    // The file is decoded ONCE and handed to the editor, which keeps it for
    // live framing. Re-decoding on every slider move would make a 12 MP photo
    // stutter on a phone, and re-decoding on save could produce a different
    // result from the one being previewed.
    validateSourceFile({ size: file.size, type: file.type });
    const image = await decodeImage(file);
    validateSourceDimensions(image.width, image.height);

    releaseIdentitySource();
    identityForm.sourceFile = file;
    identityForm.sourceImage = image;
    ensureIdentityCropEditor();
    identityForm.cropEditor?.setImage(image);
    showIdentityCrop(true);
    await refreshIdentityCropPreview();
  } catch (error) {
    identityAvatarNote("");
    showIdentityCrop(false);
    releaseIdentitySource();
    renderIdentityAvatar();
    showIdentityError(error?.message || "Orbit couldn't prepare that image.", { retry: false });
  }
}

/** Build the editor once, lazily — the dialog exists before any photo does. */
function ensureIdentityCropEditor() {
  if (identityForm.cropEditor) return;
  const stage = $("#identity-crop-stage");
  const canvas = $("#identity-crop-canvas");
  const zoom = $("#identity-crop-zoom");
  if (!stage || !canvas || !zoom) return;
  identityForm.cropEditor = createCropEditor({
    stage, canvas, zoom,
    // Debounced, because onChange fires on every pointer move and encoding a
    // 512 square per frame would fight the drag it is trying to preview.
    onChange: () => scheduleIdentityCropPreview(),
  });
}

function showIdentityCrop(visible) {
  const crop = $("#identity-crop");
  if (crop) crop.hidden = !visible;
}

let identityCropTimer = null;
function scheduleIdentityCropPreview() {
  clearTimeout(identityCropTimer);
  identityCropTimer = setTimeout(() => { refreshIdentityCropPreview(); }, 180);
}

/**
 * Encode what the circle currently shows, and make it the pending upload.
 *
 * The SAME crop rectangle the editor is drawing is what gets encoded, so the
 * preview and the saved picture cannot disagree.
 */
async function refreshIdentityCropPreview() {
  const file = identityForm.sourceFile;
  const editor = identityForm.cropEditor;
  if (!file || !editor) return;
  try {
    const blob = await normalizeAvatar(file, { crop: editor.cropRect() });
    identityForm.preview?.release();
    identityForm.pendingBlob = blob;
    identityForm.preview = previewFor(blob);
    identityForm.removeRequested = false;
    renderIdentityAvatar();
    identityAvatarNote(`${Math.max(1, Math.round(blob.size / 1024))} KB — saved when you press Save.`);
  } catch (error) {
    identityAvatarNote("");
    showIdentityError(error?.message || "Orbit couldn't prepare that image.", { retry: false });
  }
}

/** Release the decoded source. The editor never closes a bitmap it was given. */
function releaseIdentitySource() {
  if (identityForm.sourceImage) releaseImage(identityForm.sourceImage);
  identityForm.sourceImage = null;
  identityForm.sourceFile = null;
}

function onIdentityRemoveClicked() {
  hideIdentityError();
  if (identityForm.preview) {
    // Discarding a not-yet-saved selection just returns to the stored state.
    identityForm.preview.release();
    identityForm.preview = null;
    identityForm.pendingBlob = null;
    identityAvatarNote(identityForm.chart?.has_avatar
      ? "This chart has a picture." : "No picture yet — Orbit shows the chart's initials.");
  } else {
    identityForm.removeRequested = true;
    identityAvatarNote("Picture will be removed when you press Save.");
  }
  renderIdentityAvatar();
}

async function uploadChartAvatar(chart, blob) {
  let response;
  try {
    response = await fetch(apiUrl(`/api/charts/${encodeURIComponent(chart.id)}/avatar?expectedVersion=${Number(chart.avatar_version) || 0}`), {
      method: "POST",
      credentials: "same-origin",
      // The BLOB's type, not a hardcoded one. The normalizer prefers WebP but
      // falls back to PNG on browsers that cannot encode it — and the server
      // refuses any upload whose declared type disagrees with its bytes, so a
      // hardcoded "image/webp" would turn that fallback into a rejection.
      headers: { "content-type": blob.type || "image/webp", ...authHeaders() },
      body: blob,
    });
    rememberSession(response);
  } catch {
    const error = new Error("Orbit could not be reached. Check your connection and try again.");
    error.kind = "network";
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || "We couldn't save that picture just now.");
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data.identity;
}

/**
 * The save, resumable on retry.
 *
 * Text and picture are two requests. `textDone` records that the PATCH
 * landed, so a Retry after a failed upload re-runs ONLY the upload — the
 * rename is not sent twice. A version conflict refreshes the chart row first,
 * so the retry carries the current version instead of repeating the stale one.
 */
async function saveIdentity() {
  if (identityForm.submitting || !identityForm.chart) return;
  const chart = identityForm.chart;
  hideIdentityError();
  identityFieldError("");

  const typed = $("#identity-nickname").value.trim();
  const nameChanged = typed !== (chart.nickname || "");
  if (nameChanged) {
    try { validateName(typed); }
    catch (error) {
      identityFieldError(error.message);
      $("#identity-nickname")?.focus();
      return;
    }
  }
  const chosen = $("#identity-relationship").value;
  const relationshipChanged = Boolean(chosen) && chosen !== chart.relationship_type;

  const textPatch = {};
  if (nameChanged) textPatch.nickname = typed;
  if (relationshipChanged) textPatch.relationship_type = chosen;

  const save = $("#identity-save");
  identityForm.submitting = true;
  if (save) { save.disabled = true; save.setAttribute("aria-busy", "true"); }

  try {
    if (!identityForm.textDone && Object.keys(textPatch).length) {
      identityHint("Saving…");
      const saved = await patch(`/api/charts/${chart.id}`, textPatch);
      if (saved?.profile) identityForm.chart = { ...identityForm.chart, ...saved.profile };
    }
    identityForm.textDone = true;

    if (identityForm.pendingBlob) {
      identityHint("Uploading picture…");
      const identity = await uploadChartAvatar(identityForm.chart, identityForm.pendingBlob);
      identityForm.chart = {
        ...identityForm.chart,
        has_avatar: Boolean(identity?.hasAvatar),
        avatar_version: Number(identity?.avatarVersion) || 0,
      };
      identityForm.preview?.release();
      identityForm.preview = null;
      identityForm.pendingBlob = null;
    } else if (identityForm.removeRequested && identityForm.chart.has_avatar) {
      identityHint("Removing picture…");
      const result = await del(`/api/charts/${chart.id}/avatar`, {
        expected_version: Number(identityForm.chart.avatar_version) || 0,
      });
      identityForm.chart = {
        ...identityForm.chart,
        has_avatar: Boolean(result?.identity?.hasAvatar),
        avatar_version: Number(result?.identity?.avatarVersion) || 0,
      };
      identityForm.removeRequested = false;
    }

    identityHint("Saved.");
    const editedId = identityForm.chart.id;
    closeModal($("#identity-modal"));
    toast("Chart identity saved.");
    await loadSavedCharts();
    // Renaming or re-picturing the ACTIVE chart updates the headline
    // experience; editing any other chart must not activate it.
    if (editedId === state.activeChartId) await refreshActiveExperience();
  } catch (error) {
    identityHint("");
    if (error?.code === "avatar_stale_write" || error?.status === 409) {
      // Someone (or another tab) changed this picture since the editor read
      // it. Refresh to the current version so Retry is a fresh attempt.
      try {
        await loadSavedCharts();
        const fresh = state.charts.find((c) => c.id === chart.id);
        if (fresh) {
          identityForm.chart = { ...identityForm.chart, has_avatar: fresh.has_avatar, avatar_version: fresh.avatar_version };
        }
      } catch { /* the retry will surface any load failure */ }
      renderIdentityAvatar();
      showIdentityError("This chart's picture changed somewhere else. Orbit refreshed it — Retry to apply your change to the current version.");
    } else {
      showIdentityError(error?.message || "We couldn't save those changes just now.");
    }
  } finally {
    identityForm.submitting = false;
    if (save) { save.disabled = false; save.removeAttribute("aria-busy"); }
  }
}

function wireIdentityEditor() {
  const modal = $("#identity-modal");
  if (!modal) return;
  $("#identity-modal-close")?.addEventListener("click", () => closeModal(modal));
  $("#identity-cancel")?.addEventListener("click", () => closeModal(modal));
  $("#identity-file")?.addEventListener("change", onIdentityFileChosen);
  $("#identity-avatar-remove")?.addEventListener("click", onIdentityRemoveClicked);
  $("#identity-retry")?.addEventListener("click", () => saveIdentity());
  $("#identity-nickname")?.addEventListener("input", () => {
    identityFieldError("");
    renderIdentityAvatar();          // initials preview follows the typing
  });
  $("#identity-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveIdentity();
  });
}

function wireChartModal() {
  const modal = $("#chart-modal");
  if (!modal) return;
  $("#chart-modal-close")?.addEventListener("click", () => closeModal(modal));
  $("#chart-modal-cancel")?.addEventListener("click", () => closeModal(modal));

  for (const radio of $$('input[name="cm-accuracy"]')) {
    radio.addEventListener("change", syncTimeCertainty);
  }
  // Re-validate a field once the user has had a go at fixing it, so the error
  // clears when it stops being true rather than at the next submit.
  for (const id of ["nickname", "date", "time"]) {
    $(`#cm-${id}`)?.addEventListener("input", () => fieldError(id, ""));
  }
  $("#cm-relationship")?.addEventListener("change", () => fieldError("relationship", ""));

  // The optional picture: normalized on selection, discardable, and the
  // initials preview follows the name as it is typed.
  $("#cm-avatar-file")?.addEventListener("change", onChartFormFileChosen);
  $("#cm-avatar-discard")?.addEventListener("click", resetChartFormAvatar);
  $("#cm-nickname")?.addEventListener("input", renderChartFormAvatar);

  $("#chart-modal-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (chartForm.submitting) return;             // double-submit guard

    const firstBad = validateChartForm();
    if (firstBad) {
      firstBad.focus({ preventScroll: false });
      const summary = $("#chart-modal-error");
      if (summary) { summary.textContent = "Check the highlighted fields."; summary.hidden = false; }
      return;
    }

    const config = CHART_MODES[chartForm.mode];
    const hint = $("#chart-modal-hint");
    const save = $("#chart-modal-save");
    const summary = $("#chart-modal-error");
    chartForm.submitting = true;
    save.disabled = true;
    save.setAttribute("aria-busy", "true");
    hint.textContent = config.saving;
    if (summary) summary.hidden = true;

    try {
      const payload = chartFormPayload();
      const id = chartForm.chartId;
      const saved = id
        ? await patch(`/api/charts/${id}`, payload)
        : await post("/api/charts", payload);

      // The chart exists from here on. A picture that fails to upload must
      // not un-save it, duplicate it, or read as a failed creation — the
      // retry is avatar-specific, in the identity editor, with the already
      // normalized bytes carried over so nothing needs re-picking.
      let avatarHandoff = null;
      const createdProfile = !id && chartFormAvatar.blob ? saved?.profile : null;
      if (createdProfile?.id) {
        const pendingBlob = chartFormAvatar.blob;
        hint.textContent = "Uploading picture…";
        try {
          await uploadChartAvatar(
            { id: createdProfile.id, avatar_version: createdProfile.avatar_version || 0 },
            pendingBlob,
          );
          resetChartFormAvatar();
        } catch {
          avatarHandoff = { chartId: createdProfile.id, blob: pendingBlob };
          chartFormAvatar.blob = null;             // ownership moves to the editor
          resetChartFormAvatar();
        }
      } else {
        resetChartFormAvatar();
      }

      hint.textContent = config.done;
      closeModal(modal);
      await afterChartSaved(chartForm.mode, saved?.chart || null);
      if (avatarHandoff) {
        const fresh = state.charts.find((c) => c.id === avatarHandoff.chartId);
        if (fresh) {
          openIdentityEditor(fresh, {
            pendingBlob: avatarHandoff.blob,
            errorMessage: "Your chart is saved. The picture didn't upload — Retry to try again.",
          });
        } else {
          toast("Your chart is saved. The picture didn't upload — add it from Identity.");
        }
      }
    } catch (error) {
      hint.textContent = "";
      if (summary) { summary.textContent = error.message; summary.hidden = false; }
      // The message is already announced by role="alert"; moving focus to it
      // would strand a keyboard user away from the field they need to fix.
    } finally {
      chartForm.submitting = false;
      save.disabled = false;
      save.removeAttribute("aria-busy");
    }
  });
}

/**
 * What happens once a chart is saved.
 *
 * The first chart earns a destination. Everything the person just typed exists
 * to produce a chart, and closing a dialog onto whatever screen they happened
 * to be on does not show them that it worked. My Chart is the direct answer —
 * it is where the Big Three lives, and it is the surface that says "this is
 * yours". Home leads with the daily reading, which is a different question than
 * "did my chart calculate?".
 */
async function afterChartSaved(mode, chart) {
  await loadSavedCharts();
  await resolveChartState();

  if (mode === "first") {
    navigate("me");
    await refreshActiveExperience();
    toast("Your chart is ready.");
    // Focus the heading rather than a control: the person is arriving somewhere
    // new and should hear where they are before what they can do.
    $("#mychart-title")?.focus?.();
    return;
  }

  await refreshActiveExperience();
  refreshSecondaryRoute();
  toast(CHART_MODES[mode]?.done || "Saved.");
  // Focus returns to whatever opened the form, when it is still on screen.
  const opener = chartForm.openedBy;
  if (opener && document.contains(opener) && opener.offsetParent !== null) {
    opener.focus({ preventScroll: true });
  }
}

// Home-level chart actions: add (+), manage, and retry after a load failure.
function wireHomeChartActions() {
  $("#today-chart-retry")?.addEventListener("click", () => retryLoadSavedCharts());
  // One listener, no loop: a hidden tab pauses the ambient scene rather than
  // compositing a sky nobody is looking at.
  document.addEventListener("visibilitychange", moonSyncPaused);
  moonSyncPaused();

  // "Right now" has to stay true without being asked. Coming back to the app is
  // the moment it stops being true — a phone can hold this screen for a day —
  // so returning is what re-reads the sky, rather than a button the reader has
  // to notice and think to press.
  //
  // Guarded by age rather than fired on every visibility change: flicking
  // between tabs would otherwise refetch constantly, and the Moon moves about
  // half a degree an hour, so anything fresher than a few minutes is already
  // the same answer.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    moonRefreshIfStale();
  });
  // Dispatched by native-shell.js when iOS resumes the app, which a WebView
  // does not always report as a visibility change.
  document.addEventListener("orbit:resumed", () => moonRefreshIfStale());
}

function moonSyncPaused() {
  document.body.classList.toggle("moon-paused", document.hidden === true);
}

function wireSavedCharts() {
  const routeChartClick = async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "retry-charts") {
      await retryLoadSavedCharts();
      return;
    }
    if (button.dataset.action === "retry-sky") {
      // Retries only the sky. The personal reading is a separate request and
      // must not be torn down because the sky failed.
      const tz = axisResolveTimezone();
      $("#today-sky").innerHTML = `<div class="axis-shimmer" style="height:180px"></div>`;
      try {
        const r = await get(`/api/sky/current?tz=${encodeURIComponent(tz)}`);
        AXIS.lastSky = r.sky;
        AXIS.lastHighlights = r.highlights || [];
        AXIS.lastMoon = r.moon || null;
        axisRenderSky(r.sky, { highlights: r.highlights, moon: r.moon });
      } catch {
        axisRenderSkyError("We still couldn't reach the current sky. Your reading above is unaffected.");
      }
      return;
    }
    if (button.dataset.action === "add-chart") {
      openChartModal(null);
      return;
    }
    const id = button.dataset.id;
    const chart = state.charts.find(item => item.id === id);
    if (!chart) return;
    await handleSavedChartAction(button, chart);
  };
  $("#me-saved-charts-list")?.addEventListener("click", routeChartClick);
  $("#me-overview")?.addEventListener("click", routeChartClick);
  $("#me-add-chart")?.addEventListener("click", () => openChartModal(null));
  $("#me-saved-chart-add")?.addEventListener("click", () => openChartModal(null));
}

async function handleSavedChartAction(button, chart) {
  const id = chart.id;
  if (button.dataset.action === "activate") {
    const previousId = state.activeChartId;
    button.disabled = true;
    button.textContent = "Activating…";
    try {
      await post(`/api/charts/${id}/activate`, {});
      await loadSavedCharts();
      await refreshActiveExperience();
      toast(`${chart.nickname} is active`);
      // The list just re-rendered under the finger that pressed the menu.
      // Handing focus back to this row's trigger keeps a keyboard user where
      // they were instead of at the top of the document.
      $(`[data-menu-trigger][data-id="${id}"]`)?.focus();
    } catch (error) {
      state.activeChartId = previousId;
      renderSavedCharts();
      toast(error.message);
    }
    return;
  }

  // Edit birth data opens the shared chart modal.
  if (button.dataset.action === "edit") {
    openChartModal(chart);
    return;
  }

  // Identity — name, picture, relationship — is its own editor, so an
  // identity change can never touch a birth field even by accident.
  if (button.dataset.action === "identity") {
    openIdentityEditor(chart);
    return;
  }

  if (button.dataset.action === "delete") {
    const isLast = state.charts.length === 1;
    const ok = await confirmDialog({
      title: `Delete ${chart.nickname}?`,
      body: isLast
        ? "This is your only chart. Deleting it means Orbit can't show your daily reading until you add a new one. This can't be undone."
        : "This chart and its saved readings will be removed. This can't be undone.",
      confirmLabel: "Delete chart",
    });
    if (!ok) return;
    button.disabled = true;
    try {
      await del(`/api/charts/${id}${isLast ? "?confirmEmpty=true" : ""}`, { confirmEmpty: isLast });
      // The server promotes a replacement active chart when the active one is
      // deleted, and reports an empty state only when nothing remains.
      await loadSavedCharts();
      await resolveChartState();
      toast(`${chart.nickname} deleted`);
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  }
}

// Supabase (owner-scoped) is the source of truth for a signed-in user's charts.
// Critically, a failed request sets status "error" and leaves the previously
// known charts intact — it must never look like "this account has no charts",
// which is what caused returning users to be re-onboarded.
async function loadSavedCharts() {
  if (!authSignedIn()) {
    state.charts = [];
    state.activeChartId = null;
    state.activeProfile = null;
    state.activeNatalChart = null;
    state.chartsStatus = "idle";
    renderSavedCharts();
    return state.chartsStatus;
  }
  state.chartsStatus = "loading";
  try {
    const data = await get("/api/charts");
    state.charts = data.charts || [];
    // The server resolves and persists the active chart (including healing a
    // missing or stale one), so we trust it rather than guessing locally.
    state.activeChartId = data.active_chart_id || state.charts.find(chart => chart.is_active)?.id || null;
    state.chartsStatus = "ready";
    const active = activeChart();
    setActiveChartName(active?.nickname || "My Chart");
    renderSavedCharts();
  } catch {
    state.chartsStatus = "error";
    renderSavedCharts();
  }
  return state.chartsStatus;
}

// Retry entry point for the recoverable error state.
async function retryLoadSavedCharts() {
  const errorBox = $("#today-chart-error");
  const button = $("#today-chart-retry");
  if (button) { button.disabled = true; button.textContent = "Trying…"; }
  try {
    await loadSavedCharts();
    await resolveChartState();
  } finally {
    if (button) { button.disabled = false; button.textContent = "Try again"; }
    if (errorBox && state.chartsStatus !== "error") errorBox.hidden = true;
  }
}

// Home's "Viewing" selector — lists only the signed-in owner's charts
// (already server-scoped by /api/charts) and mirrors the active one. A single
// chart still shows its identity via a disabled select rather than hiding it.
function axisRenderChartPicker() {
  const picker = $("#today-chart-picker");
  const select = $("#today-chart-select");
  const label = picker?.querySelector('label[for="today-chart-select"]');
  if (!picker || !select) return;

  // Signed-out (local preview) keeps the picker out of the way entirely.
  if (!authSignedIn()) {
    picker.hidden = true;
    return;
  }

  // Signed in with zero charts: the "+" stays reachable so a user who dismissed
  // onboarding still has an obvious way to create their chart.
  if (!state.charts.length) {
    picker.hidden = state.chartsStatus !== "ready";
    select.hidden = true;
    if (label) label.hidden = true;
    return;
  }

  picker.hidden = false;
  select.hidden = false;
  if (label) label.hidden = false;
  select.innerHTML = state.charts.map(chart =>
    `<option value="${esc(chart.id)}" ${chart.id === state.activeChartId ? "selected" : ""}>${esc(chartOptionLabel(chart))}</option>`
  ).join("");
  renderPickerAvatar("#today-chart-avatar");
  // One chart still shows its name via a disabled select; "+" remains active.
  select.disabled = state.charts.length <= 1;
}

function renderSavedCharts() {
  const statusTargets = [$("#me-saved-charts-status")].filter(Boolean);
  const listTargets = [$("#me-saved-charts-list")].filter(Boolean);
  axisRenderChartPicker();
  renderChartSwitcher();
  if (!statusTargets.length || !listTargets.length) return;
  const setStatus = (text) => statusTargets.forEach((status) => { status.textContent = text; });
  const setLists = (html) => listTargets.forEach((list) => { list.innerHTML = html; });
  if (!authSignedIn()) {
    // These two used to read "Sign in to save and restore charts." and "Sign in
    // to see your chart." — true, and useless. They stated our architecture to
    // someone who had just asked for their chart, and gave them nothing to
    // press. This panel is reachable without an account now, so it is a place
    // to make the offer, not to explain the refusal.
    setStatus("Your charts live in your account, so they follow you between devices.");
    setLists(`<div class="me-empty me-empty--compact">
      <button type="button" class="o-btn o-btn--primary" data-action="add-chart">Create your chart — free</button>
    </div>`);
    renderChartPlaceholder("empty", {
      message: "Add your birth date, time and place, and every placement below fills in.",
    });
    return;
  }
  if (state.chartsStatus === "loading" && !state.charts.length) {
    setStatus("Loading your charts…");
    setLists("");
    return;
  }
  // An error must not read as "you have no charts".
  if (state.chartsStatus === "error" && !state.charts.length) {
    setStatus("We couldn't load your saved charts. Check your connection and try again.");
    setLists(`<button type="button" class="o-btn o-btn--secondary" data-action="retry-charts">Retry</button>`);
    renderChartPlaceholder("error", { message: "We couldn't load your saved charts. Check your connection and try again.", retry: false });
    return;
  }
  if (!state.charts.length) {
    setStatus("No saved charts yet. Create your chart to begin.");
    setLists(`<div class="me-empty me-empty--compact"><p>No saved charts yet.</p><button type="button" class="o-btn o-btn--primary" data-action="add-chart">Create your chart</button></div>`);
    renderChartPlaceholder("empty");
    return;
  }
  setStatus(`${state.charts.length} saved chart${state.charts.length === 1 ? "" : "s"}`);
  setLists(`<div class="o-flat-list">${state.charts.map(savedChartCardHtml).join("")}</div>`);
}

/**
 * Open/close behaviour for row overflow menus (the "Actions for …" triggers).
 *
 * A disclosure, not an ARIA menu: aria-expanded on the trigger, ordinary
 * buttons inside, Tab to move between them. Full menu semantics demand arrow
 * keys, wrapping, and typeahead — implementing half of that grammar is worse
 * than not claiming it. Escape closes and returns focus to the trigger;
 * clicking elsewhere closes; opening one closes any other.
 */
function wireRowMenus() {
  const closeAll = (except = null) => {
    document.querySelectorAll("[data-menu-trigger][aria-expanded='true']").forEach((t) => {
      if (t === except) return;
      t.setAttribute("aria-expanded", "false");
      t.nextElementSibling?.setAttribute("hidden", "");
    });
  };
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-menu-trigger]");
    if (trigger) {
      const open = trigger.getAttribute("aria-expanded") === "true";
      closeAll(trigger);
      trigger.setAttribute("aria-expanded", String(!open));
      trigger.nextElementSibling?.toggleAttribute("hidden", open);
      return;
    }
    // An action inside the menu runs through the list's own delegation; the
    // menu just needs to get out of the way.
    if (event.target.closest(".o-rowmenu__item")) { closeAll(); return; }
    if (!event.target.closest(".o-rowmenu")) closeAll();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const openTrigger = document.querySelector("[data-menu-trigger][aria-expanded='true']");
    if (!openTrigger) return;
    closeAll();
    openTrigger.focus();
  });
}

function savedChartCardHtml(chart) {
  const summary = chart.summary || {};
  const rising = summary.time_known === false || !summary.rising ? "Rising needs birth time" : `Rising ${esc(summary.rising)}`;
  // The collapsed row carries identity, not the full birth record — the legal
  // name, birth date and birthplace live in the editors this row opens.
  // relationshipDisplay is the one honest namer of stored values: the four
  // current ones by label, 'other'/NULL as "Relationship not set", and
  // 'public_figure' as its legacy classification — never silently remapped.
  const timeInfo = timeAccuracyInfo(chart.time_accuracy || (summary.time_known === false ? "unknown" : "exact"));
  // A row, not a card, and one visible action instead of four. Five charts as
  // cards with four buttons each was ~1,800px of controls nobody was using at
  // that moment; the same five charts as rows is one screen. Set active is the
  // visible action because selecting a chart is why anyone is here; the rest —
  // identity, birth data, delete — live behind one labelled trigger. The
  // active row states its state in text ("Active"), never colour alone, and
  // its menu simply omits Set active rather than disabling it.
  const nickname = chart.nickname || "Untitled Chart";
  const subline = [
    relationshipDisplay(chart.relationship_type ?? null).label,
    timeInfo.label,
  ].filter(Boolean).join(" · ");
  return `<div class="saved-chart-row" data-active="${chart.is_active}">
    <span class="o-flat-row__lead">${chartAvatarHtml(chart)}</span>
    <div class="o-flat-row__main">
      <span class="o-flat-row__title">${esc(nickname)}${chart.is_active ? ' <span class="saved-chart-row__state">· Active</span>' : ""}</span>
      <span class="o-flat-row__sub">${esc(subline)}</span>
      <span class="o-flat-row__sub">Sun ${esc(summary.sun || "—")} · Moon ${esc(summary.moon || "—")} · ${rising}</span>
    </div>
    <div class="saved-chart-actions">
      ${chart.is_active
        ? ""
        : `<button type="button" class="o-btn o-btn--utility" data-action="activate" data-id="${esc(chart.id)}">Set active</button>`}
      <div class="o-rowmenu">
        <button type="button" class="o-icon-btn saved-chart-row__menu" data-menu-trigger data-id="${esc(chart.id)}"
                aria-haspopup="true" aria-expanded="false"
                aria-label="Actions for ${esc(nickname)}"><span aria-hidden="true">⋯</span></button>
        <div class="o-rowmenu__list" hidden>
          ${chart.is_active ? "" : `<button type="button" class="o-rowmenu__item" data-action="activate" data-id="${esc(chart.id)}">Set active</button>`}
          <button type="button" class="o-rowmenu__item" data-action="identity" data-id="${esc(chart.id)}">Identity</button>
          <button type="button" class="o-rowmenu__item" data-action="edit" data-id="${esc(chart.id)}">Edit birth data</button>
          <button type="button" class="o-rowmenu__item o-rowmenu__item--danger" data-action="delete" data-id="${esc(chart.id)}">Delete…</button>
        </div>
      </div>
    </div>
  </div>`;
}

async function refreshActiveExperience() {
  const active = activeChart();
  renderChartSwitcher();
  if (active) {
    setActiveChartName(active.nickname);
    axisShowReadingFor(active.nickname);
    // loadChartReading owns its own loading, stale, and failure states — the
    // previous `catch {}` here hid render defects behind Home's error copy.
    await loadChartReading(active);
  } else {
    renderChartPlaceholder("empty", { message: "No active chart yet." });
  }
  await axisLoadToday();
  if (currentWorkspace() === "history") await axisLoadHistory($("#history-scope")?.value || "active");
}


/* ── Compatibility (Dev Update 1.11) ───────────────────────────────────────
   Two SAVED charts, compared, with the relationship type on the other chart
   deciding which questions get asked.

   EVERY SENTENCE HERE CAME FROM THE SERVER. This module chooses layout and
   nothing else — no scoring, no thresholds, no copy. lib/interpretation and
   lib/transits follow the same rule, and the reason is that a second place
   composing the same evidence is how a product grows a second opinion about
   itself.

   The number is deliberately secondary to the band. A bare "73%" invites
   being read as a probability of the relationship working, which is the one
   misreading this feature must not encourage. */

const compat = { options: null, result: null, busy: false };

function compatStatus(message, { tone = "info" } = {}) {
  const el = $("#compat-status");
  if (!el) return;
  el.className = `compat-status${message ? ` compat-status--${tone}` : ""}`;
  el.innerHTML = message ? esc(message) : "";
}

/**
 * Fill both pickers from what the server says is comparable.
 *
 * A chart with a legacy relationship value stays in the list, disabled, with
 * the reason attached. Removing it would look like the app lost a chart; the
 * whole point of the 1.10 identity work is that the person can fix it.
 */
function renderCompatPickers() {
  const data = compat.options;
  const subject = $("#compat-subject");
  const other = $("#compat-other");
  if (!data || !subject || !other) return;

  // EVERY saved chart is offered on both sides. The first selector used to
  // list only charts saved as Self, which meant two friends could never be
  // compared with each other — the geometry between two charts does not
  // require the reader to be one of them.
  //
  // What does change is what the result may CLAIM. relationship_type records
  // how someone relates to the account holder, so a comparison between two
  // other people is read as a general Chart Comparison rather than as partner
  // or friend compatibility. The server decides that; this only stops hiding
  // the charts.
  const label = (o) => {
    const kind = o.relationship_type === "self" ? "Self" : o.relationship_type;
    return kind ? `${o.name} — ${kind}` : o.name;
  };
  subject.innerHTML = data.options.map((o) =>
    `<option value="${esc(o.id)}"${o.id === data.subject_id ? " selected" : ""}>${esc(label(o))}</option>`
  ).join("");

  const chosenSubject = subject.value || data.subject_id;
  const subjectIsSelf = data.options.find((o) => o.id === chosenSubject)?.relationship_type === "self";
  other.innerHTML = data.options
    .filter((o) => o.id !== chosenSubject)
    .map((o) => {
      // A missing relationship only blocks a comparison read OUTWARD from the
      // owner. Between two other charts there is no relationship to read, so
      // the chart is perfectly comparable and must not be disabled.
      const blocked = subjectIsSelf && o.unavailable_reason === "relationship_required";
      const suffix = blocked
        ? " — needs a relationship type"
        : o.relationship_type === "self" ? " — another Self chart"
          : o.relationship_type ? ` — ${o.relationship_type}` : "";
      return `<option value="${esc(o.id)}"${blocked ? " disabled" : ""}>${esc(o.name)}${esc(suffix)}</option>`;
    }).join("");

  $("#compat-pickers").hidden = false;
  $("#compat-run").disabled = !other.value;
}

/** The empty states, each of which explains the next step rather than the problem. */
function compatEmptyState(data) {
  if (!data.subject_id || !data.subject_available) {
    return "Compatibility is read from your own chart outward, so it needs a chart saved as Self. "
         + "Open My Chart to set one.";
  }
  const comparable = data.options.filter((o) => o.available);
  if (!comparable.length) {
    const blocked = data.options.filter((o) => o.unavailable_reason === "relationship_required");
    if (blocked.length) {
      return `You have ${blocked.length === 1 ? "a saved chart that needs" : `${blocked.length} saved charts that need`} `
           + "a relationship type before they can be compared. Open My Chart to set one.";
    }
    return "Save a second chart — a partner, a friend, or a family member — and Orbit Axis can compare it with yours.";
  }
  return "";
}

async function loadCompatibility() {
  // Reset the heading before anything loads. A previous Self Pattern
  // Comparison must not leave its title standing over a fresh, unrun page.
  $("#compatibility-title").textContent = "Compatibility";
  $("#compat-subtitle").textContent = "How two saved charts meet.";
  document.title = "Orbit Axis — Compatibility";

  // Reachable without an account now, so it makes the offer rather than
  // reporting the refusal. compatStatus escapes its message by design, so the
  // button is appended rather than passed through it.
  if (!authSignedIn()) {
    compatStatus("Compatibility reads two saved charts against each other, so it starts with yours.");
    const status = $("#compat-status");
    if (status) {
      const cta = document.createElement("button");
      cta.type = "button";
      cta.className = "o-btn o-btn--primary";
      // No "— free" here, unlike every other chart CTA in the app. Creating a
      // chart is free; comparing two is not (`free` has
      // "chart.compatibility": false in the v1 matrix). Pricing the chart on
      // the one page that exists to sell the comparison is how a sign-up button
      // becomes a bait-and-switch the day enforcement stops being dark.
      cta.textContent = "Create your chart";
      cta.addEventListener("click", () => openAuthGate("compatibility"));
      status.append(document.createElement("br"), cta);
    }
    return;
  }
  compatStatus("Loading your saved charts…");
  try {
    const data = await get("/api/compatibility/options");
    compat.options = data.options;
    const empty = compatEmptyState(data.options);
    if (empty) {
      $("#compat-pickers").hidden = true;
      $("#compat-result").hidden = true;
      compatStatus(empty);
      return;
    }
    renderCompatPickers();
    compatStatus("");
  } catch (error) {
    compatStatus(error.message || "Orbit could not load your charts.", { tone: "error" });
  }
}

async function runCompatibility() {
  const a = $("#compat-subject")?.value;
  const b = $("#compat-other")?.value;
  if (!a || !b || compat.busy) return;
  compat.busy = true;
  $("#compat-run").disabled = true;
  $("#compat-result").hidden = true;
  compatStatus("Comparing…");
  try {
    const data = await get(`/api/compatibility/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
    compat.result = data.comparison;
    renderCompatResult(data.comparison);
    compatStatus("");
  } catch (error) {
    // A refusal is an answer with a next step, not a failure. The server sends
    // the code and the chart to fix; the interface turns that into a link
    // rather than an apology.
    const code = error.data?.code;
    if (code === "relationship_required" || code === "subject_must_be_self") {
      $("#compat-result").hidden = true;
      const el = $("#compat-status");
      el.className = "compat-status compat-status--notice";
      el.innerHTML = `${esc(error.message)} <a class="compat-status__link" href="#me">Open My Chart</a>`;
      return;
    }
    compatStatus(error.message || "Orbit could not compare these charts.", { tone: "error" });
  } finally {
    compat.busy = false;
    $("#compat-run").disabled = false;
  }
}

function compatFactorHtml(factor) {
  // Reference links live on their own quiet line rather than inside the
  // authored sentence — the headline stays a sentence, not an ad break.
  // Scoring and mode are untouched; these are plain Atlas anchors.
  const refs = [
    ...(Array.isArray(factor.bodies) ? factor.bodies.map((b) => atlasBodyLinkHtml(b)) : []),
    factor.aspect ? atlasLinkHtml("aspects", factor.aspect) : "",
  ].filter(Boolean).join(" · ");
  return `<li class="compat-factor">
    <p class="compat-factor__headline">${esc(factor.headline)}</p>
    <p class="compat-factor__roles">${esc(factor.roles)}</p>
    <p class="compat-factor__technical">${esc(factor.technical)}</p>
    ${refs ? `<p class="compat-factor__refs">In the Atlas: ${refs}</p>` : ""}
  </li>`;
}

/**
 * One category, collapsed by default.
 *
 * <details> rather than a scripted accordion: it opens with a keyboard, it is
 * announced correctly, it survives Find-in-page, and it needs no JavaScript to
 * be usable. The score sits inside as supporting detail; the band is what the
 * summary line leads with.
 */
function compatCategoryHtml(category) {
  const groups = [
    ["What supports this", category.supporting],
    ["What strains this", category.straining],
    ["Both at once", category.mixed],
  ].filter(([, list]) => list.length);

  const evidence = groups.map(([label, list]) => `
    <div class="compat-evidence">
      <h4 class="compat-evidence__title">${esc(label)}</h4>
      <ul class="compat-factor-list">${list.map(compatFactorHtml).join("")}</ul>
    </div>`).join("");

  return `<details class="compat-category">
    <summary class="compat-category__summary">
      <!-- A real heading, not a styled span. Without it the outline jumped
           straight from "Every area, with its evidence" (h2) to "What supports
           this" (h4), so the category names were absent from a screen reader's
           heading list and there was no way to navigate between areas. Caught
           by walking the heading levels in a browser. -->
      <h3 class="compat-category__label">${esc(category.label)}</h3>
      <span class="compat-category__band">${category.hasEvidence ? esc(category.band.label) : "Limited evidence"}</span>
    </summary>
    <div class="compat-category__body">
      <p class="compat-category__question">${esc(category.question)}</p>
      <p class="compat-category__text">${esc(category.summary)}</p>
      ${category.hasEvidence
        ? `<p class="compat-category__score">Rating ${category.score} of 100 in this area.</p>`
        : ""}
      ${evidence}
    </div>
  </details>`;
}

function renderCompatResult(c) {
  const highlight = (items, empty) => items.length
    ? `<ul class="compat-highlight__list">${items.map((i) =>
      `<li>${esc(i.label)}</li>`).join("")}</ul>`
    : `<p class="compat-highlight__none">${esc(empty)}</p>`;

  const limitations = c.limitations.map((l) => `
    <div class="compat-limitation">
      <h3 class="compat-limitation__title">${esc(l.title)}</h3>
      <p>${esc(l.body)}</p>
    </div>`).join("");

  const prompts = c.framing.prompts.length ? `
    <section class="o-card compat-prompts" aria-labelledby="compat-prompts-title">
      <h2 class="axis-section-title" id="compat-prompts-title">Worth talking about</h2>
      <ul class="compat-prompts__list">${c.framing.prompts.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
    </section>` : "";

  // The VISIBLE heading, not just the tab title. Self mode is titled "Self
  // Pattern Comparison" because nobody is in a relationship with themselves,
  // and a page headed "Compatibility" above two of your own charts says they
  // are. Caught in a browser: the tab title was being set correctly while the
  // <h1> underneath it still read Compatibility.
  $("#compatibility-title").textContent = c.framing.title;
  $("#compat-subtitle").textContent = c.framing.subtitle;
  // Same shape as every other destination — the tab must not change format just
  // because a comparison finished. The value itself still comes from the result
  // rather than the registry, because comparing a chart with itself is titled
  // "Self Pattern Comparison": nobody is in a relationship with themselves, and
  // that is the whole reason this override exists.
  document.title = `Orbit Axis — ${c.framing.title}`;

  $("#compat-result").innerHTML = `
    <section class="o-card compat-overall" aria-labelledby="compat-overall-title">
      <h2 class="axis-section-title" id="compat-overall-title">
        ${esc(c.subject.name)} and ${esc(c.other.name)}
      </h2>
      ${c.overall.band ? `
        <p class="compat-overall__band">${esc(c.overall.band.label)}</p>
        <p class="compat-overall__score">Overall rating ${c.overall.score} of 100.</p>` : ""}
      <p class="compat-overall__summary">${esc(c.overall.summary)}</p>
      <p class="compat-note">${esc(c.methodology.note)}</p>
    </section>

    <div class="compat-highlights">
      <section class="o-card compat-highlight" aria-labelledby="compat-strengths-title">
        <h3 class="u-card-title" id="compat-strengths-title">Where this is strongest</h3>
        ${highlight(c.overall.strengths, "No single area stands out above the rest.")}
      </section>
      <section class="o-card compat-highlight" aria-labelledby="compat-growth-title">
        <h3 class="u-card-title" id="compat-growth-title">Where this asks for attention</h3>
        ${highlight(c.overall.growth, "No single area stands out as needing more than the rest.")}
      </section>
    </div>

    <section class="o-card compat-categories" aria-labelledby="compat-categories-title">
      <h2 class="axis-section-title" id="compat-categories-title">Every area, with its evidence</h2>
      <p class="u-meta">Open any area to see the exact contacts behind its rating.</p>
      ${c.categories.map(compatCategoryHtml).join("")}
    </section>

    ${limitations ? `<section class="o-card compat-limitations" aria-labelledby="compat-limits-title">
      <h2 class="axis-section-title" id="compat-limits-title">What this comparison cannot tell you</h2>
      ${limitations}
    </section>` : ""}

    ${prompts}

    <details class="o-card compat-method">
      <summary class="compat-method__summary">How this was worked out</summary>
      <div class="compat-method__body">
        <ul class="compat-method__list">${c.methodology.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
        <p class="u-meta">Rating method ${esc(c.methodology.ratingVersion)} · wording ${esc(c.methodology.contentVersion)}</p>
      </div>
    </details>`;

  $("#compat-result").hidden = false;
}

function wireCompatibility() {
  const panel = $("#panel-compatibility");
  if (!panel || panel._wiredCompat) return;
  panel._wiredCompat = true;

  // Changing your own chart re-filters the other list, so the same chart can
  // never appear on both sides.
  $("#compat-subject")?.addEventListener("change", () => {
    renderCompatPickers();
    $("#compat-result").hidden = true;
    compatStatus("");
  });
  $("#compat-other")?.addEventListener("change", () => {
    $("#compat-run").disabled = !$("#compat-other").value;
    $("#compat-result").hidden = true;
    compatStatus("");
  });
  $("#compat-run")?.addEventListener("click", runCompatibility);
}

/* ── Tarot ────────────────────────────────────────────────────────────────
   A reflection surface that sits beside the calculated sky and is careful
   never to borrow its authority. Two things keep that boundary honest here:
   the panel says what it is in its own lead sentence, and nothing in this
   module ever draws a card. Every card comes from the server.

   That last point is the whole architecture. The daily card is DERIVED from
   the local date rather than stored, so it is the same card on a refresh, on
   a second device, and after the tab has been closed all afternoon. If this
   file picked the card, "today's card" would mean "whatever this browser
   happened to roll", and the two devices would disagree forever.

   What IS local is whether the card has been turned over. A reveal is an act,
   not a fact about the day — and for a signed-out visitor there is nowhere
   else to keep it. See tarotRevealKey(). */

const TAROT_REVEAL_PREFIX = "orbit.tarot.revealed";

/**
 * Tarot preferences.
 *
 * Local, like the other appearance settings: they change how this device
 * presents the feature, not what the account owns. Switching Tarot off does
 * not delete a single saved reflection — turning it back on finds them all
 * where they were, which is why "off" is a display choice rather than a
 * destructive one.
 */
function tarotPref(key, fallback) {
  try { return localStorage.getItem(`orbit.${key}`) ?? fallback; }
  catch { return fallback; }
}

/** Is the reader showing Tarot at all? */
function tarotEnabled() {
  return tarotPref("tarot", "on") !== "off";
}

/** Which three-card labels this reader chose. */
function tarotPositionSet() {
  return tarotPref("tarotPositions", "reflective") === "timeline" ? "timeline" : "reflective";
}

/** Does this reader want reversed cards? Off by default. */
function tarotReversalsOn() {
  return tarotPref("tarotReversed", "off") === "on";
}

/** Does the meaning appear with the card, or on request? */
function tarotMeaningOnRequest() {
  return tarotPref("tarotMeaning", "ask") !== "always";
}

/** The labels for a three-card spread under this reader's setting. */
const TAROT_POSITION_SETS = {
  reflective: ["What shaped this", "What is present", "What to consider next"],
  timeline: ["Past", "Present", "Future"],
};

function tarotPositionLabel(index, total) {
  if (total !== 3) return null;
  return TAROT_POSITION_SETS[tarotPositionSet()][index] ?? null;
}


const tarotState = {
  status: "idle",      // idle | loading | ready | unavailable | error
  reading: null,       // the daily reading as the server returned it
  revealed: false,
  manual: null,        // the current manual draw, if any
  meaningShown: {},    // slug -> the reader asked to see this one
  manualBusy: false,
  saving: false,
  saved: false,
  error: null,
  unavailable: null,   // { code, message } when the deck is not ready
};

/**
 * Where a revealed day is remembered.
 *
 * Keyed by the local date so it expires on its own: yesterday's key is simply
 * never read again, which is a cheaper and more reliable expiry than a
 * timestamp somebody has to compare. Nothing about the CARD is stored — only
 * that the reader turned it over — so this cannot drift out of step with the
 * server's answer, and clearing it costs the reader nothing but one tap.
 */
function tarotRevealKey(localDate) {
  return `${TAROT_REVEAL_PREFIX}.${localDate}`;
}

/**
 * The day's card, as this browser remembers it.
 *
 * A drawn card cannot be recomputed, so somebody has to write it down. Signed
 * in, that is the server, and every device agrees. Signed out there is no
 * account to key a row to, so the browser keeps it — which means a second
 * device draws its own card, and that is the honest cost of having no account
 * rather than a bug.
 *
 * The slug is sent back on the next request and re-resolved against the
 * server's deck, so a tampered value yields a fresh draw rather than a card
 * the reader picked.
 */
const TAROT_DAILY_KEY = "orbit.tarot.daily";

function tarotRememberedDaily() {
  try { return JSON.parse(localStorage.getItem(TAROT_DAILY_KEY) || "null"); }
  catch { return null; }
}

function tarotRememberDaily(remember) {
  if (!remember?.local_date || !remember?.card_slug) return;
  try { localStorage.setItem(TAROT_DAILY_KEY, JSON.stringify(remember)); }
  catch { /* private mode: the card lasts for this page view only */ }
}

function tarotWasRevealed(localDate) {
  if (!localDate) return false;
  try { return localStorage.getItem(tarotRevealKey(localDate)) === "1"; }
  catch { return false; }   // private mode: the card simply starts face down
}

function tarotRememberReveal(localDate) {
  if (!localDate) return;
  try {
    localStorage.setItem(tarotRevealKey(localDate), "1");
    // Yesterday's markers are dropped on the way past. Left alone they would
    // accumulate one key per day forever, which is untidy rather than harmful
    // — but a storage quota error on a reflection app would be absurd.
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(TAROT_REVEAL_PREFIX) && key !== tarotRevealKey(localDate)) {
        localStorage.removeItem(key);
      }
    }
  } catch { /* private mode: the reveal lasts for this page view only */ }
}

/** The card face. Typographic, because there is no artwork and none is implied. */
function tarotCardFaceHtml(card, { faceDown = false, label = "Turn over today's card", index = null } = {}) {
  if (faceDown) {
    // The card IS the control. No separate reveal button: tapping or swiping
    // the card turns it over, which is what a physical card affords.
    //
    // It is a real <button>, so Enter and Space work, it takes focus in tab
    // order, and it carries an accessible name — "no reveal button" is about
    // the interface, not about excluding anyone who cannot tap. The face stays
    // aria-hidden inside it, because the button's own label says what pressing
    // it does and the artwork says nothing a screen reader can use.
    //
    // The back is a LOCAL asset. It is the first thing on screen for every
    // card, so it must not wait on a network request — see [[Tarot Card
    // Imagery]]. The front loads behind it.
    return `<button type="button" class="tarot-card o-object tarot-card--down"
        data-tarot-action="reveal"${index === null ? "" : ` data-tarot-index="${index}"`}
        aria-label="${esc(label)}">
      <span class="tarot-card__back" aria-hidden="true"></span>
    </button>`;
  }
  if (!card) return "";

  // With artwork, the image. Without it, the typographic face. Both are
  // complete cards — the image is additive, and a card whose artwork never
  // arrives is not a degraded state.
  //
  // width and height are attributes so the 2:3 box is reserved before the
  // bytes land and nothing shifts when they do. onerror drops the art class
  // and the text face underneath shows through, rather than leaving a broken
  // image frame inside the card.
  const reversed = card.orientation === "reversed";
  if (card.image?.url) {
    return `<div class="tarot-card o-object tarot-card--up tarot-card--art${reversed ? " tarot-card--reversed" : ""}" aria-hidden="true">
      <img class="tarot-card__art" src="${esc(card.image.url)}" alt=""
           width="${esc(String(card.image.width))}" height="${esc(String(card.image.height))}"
           decoding="async"
           onerror="this.closest('.tarot-card').classList.remove('tarot-card--art')" />
      <span class="tarot-card__rank">${esc(tarotRankLabel(card))}</span>
      <span class="tarot-card__name">${esc(card.name)}</span>
      <span class="tarot-card__suit">${esc(card.suit ? card.suit.charAt(0).toUpperCase() + card.suit.slice(1) : "Major Arcana")}</span>
    </div>`;
  }

  const rank = tarotRankLabel(card);
  const suit = card.suit ? card.suit.charAt(0).toUpperCase() + card.suit.slice(1) : "Major Arcana";
  // The face is decorative: every word on it is repeated as real text beside
  // the card, so a screen reader is never asked to read a layout.
  return `<div class="tarot-card o-object tarot-card--up${reversed ? " tarot-card--reversed" : ""}" aria-hidden="true">
    <span class="tarot-card__rank">${esc(rank)}</span>
    <span class="tarot-card__name">${esc(card.name)}</span>
    <span class="tarot-card__suit">${esc(suit)}</span>
  </div>`;
}

/**
 * Start loading a card's front while its back is on screen.
 *
 * The point of showing a back first — on a drawn card as much as on the daily
 * one — is that the face-down state IS the loading window. The reader is
 * looking at a card they have not turned over yet, and the bytes arrive during
 * a moment they were already spending.
 *
 * Fire and forget. Nothing waits on this and a failure is silent: the reveal
 * falls back to the typographic face, which is a complete card. A preload that
 * could block a reveal would be worse than no preload at all.
 */
function preloadTarotFronts(cards) {
  for (const entry of cards || []) {
    const url = entry?.card?.image?.url;
    if (!url) continue;
    const img = new Image();
    img.decoding = "async";
    img.src = url;   // the browser cache is the destination; the object is not kept
  }
}

/** What belongs in the corner of a card face, if anything. */
function tarotRankLabel(card) {
  if (!Number.isInteger(card.number)) return "";
  if (card.arcana === "major") return romanNumeral(card.number);
  if (card.number === 1) return "A";
  if (card.number >= 2 && card.number <= 10) return String(card.number);
  return "";   // Page, Knight, Queen, King — the name is the rank
}

/** Majors are numbered in roman on every deck anyone has ever printed. */
function romanNumeral(value) {
  if (!Number.isInteger(value) || value < 0 || value > 3999) return String(value ?? "");
  if (value === 0) return "0";
  const table = [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],
                 [50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
  let out = "", n = value;
  for (const [num, sym] of table) while (n >= num) { out += sym; n -= num; }
  return out;
}

/** The authored text for one card. Never depends on the artwork. */
function tarotMeaningHtml(entry, { headingLevel = 3, showPosition = true, step = null, index = null, shown = true } = {}) {
  const card = entry?.card;
  if (!card) return "";
  const H = `h${headingLevel}`;

  // The meaning is offered rather than pushed. Turning a card over shows the
  // card; reading what it is usually taken to mean is a second, separate
  // choice — which is the difference between a prompt and an answer, and it
  // gives the image a moment to be looked at before it is explained.
  //
  // The card name and position always show: those identify what is on the
  // table, and hiding them would make the button a guessing game.
  if (!shown) {
    return `<div class="tarot-meaning">
      ${showPosition && entry.position ? `<p class="tarot-meaning__position">${esc(entry.position)}${
        step ? ` <span class="tarot-meaning__step">· ${esc(step)}</span>` : ""}</p>` : ""}
      <${H} class="tarot-meaning__name" tabindex="-1">${esc(card.name)}</${H}>
      <p class="u-meta tarot-meaning__kind">${esc(card.suit
        ? card.suit.charAt(0).toUpperCase() + card.suit.slice(1) : "Major Arcana")}${
        card.orientation === "reversed" ? ` · <span class="tarot-meaning__reversed">Reversed</span>` : ""}</p>
      <button type="button" class="o-btn o-btn--secondary tarot-meaning__ask"
        data-tarot-action="show-meaning"${index === null ? "" : ` data-tarot-index="${index}"`}
        aria-expanded="false">What does this card mean?</button>
    </div>`;
  }
  // A position label is the meaning in a three-card spread — "What shaped this"
  // says how to read the card under it. On a single card it is only the
  // section heading repeated a line lower in a louder colour, so it is dropped
  // rather than styled down.
  // In a carousel the position label also carries the reader's place in the
  // sequence, because only one card is on screen at a time and "2 of 3" is the
  // only thing that says the other two exist.
  const position = showPosition && entry.position
    ? `<p class="tarot-meaning__position">${esc(entry.position)}${
        step ? ` <span class="tarot-meaning__step">· ${esc(step)}</span>` : ""}</p>` : "";
  const suit = card.suit
    ? `${esc(card.suit.charAt(0).toUpperCase() + card.suit.slice(1))}`
    : "Major Arcana";
  return `<div class="tarot-meaning tarot-meaning--shown">
    ${position}
    <${H} class="tarot-meaning__name" tabindex="-1">${esc(card.name)}</${H}>
    <p class="u-meta tarot-meaning__kind">${suit}${
      entry.card.orientation === "reversed" ? ` · <span class="tarot-meaning__reversed">Reversed</span>` : ""}</p>
    <p class="tarot-meaning__body" tabindex="-1">${esc(card.upright_meaning)}</p>
    <p class="tarot-meaning__prompt"><span class="tarot-meaning__prompt-label">To reflect on</span>
      ${esc(card.reflection_prompt)}</p>
  </div>`;
}

/**
 * Turn today's card over.
 *
 * One path, reached by tapping the card, swiping across it, or pressing Enter
 * or Space while it has focus — the card is a real button, so the keyboard
 * case costs nothing. Idempotent: a swipe that also registers as a click
 * cannot reveal twice.
 */
function revealTarotDaily() {
  if (tarotState.revealed || !tarotState.reading) return;
  tarotState.revealed = true;
  tarotRememberReveal(tarotState.reading?.draw?.local_date);
  renderTarotDaily();
  // Announced rather than left to the artwork, and focus moves to the card's
  // name so a keyboard reader lands on what just appeared. The heading carries
  // tabindex="-1" so this actually lands: focus() on a bare <h3> silently does
  // nothing, which announces a reveal to everyone except the people who need
  // it most.
  const name = tarotState.reading?.cards?.[0]?.card?.name;
  tarotSay(name ? `Today's card is ${name}.` : "Card revealed.");
  $("#tarot-daily-reading .tarot-meaning__name")?.focus({ preventScroll: true });
}

function tarotSay(message, { assertive = false } = {}) {
  const el = $("#tarot-status");
  if (!el) return;
  el.textContent = message || "";
  el.setAttribute("aria-live", assertive ? "assertive" : "polite");
  el.hidden = !message;
}

function tarotLoadingCardHtml() {
  return `<div class="tarot-card-loader" aria-hidden="true">
    <img class="tarot-card-loader__mark orbit-motion-mark"
         src="/brand/orbit-logo-motion-deep-scan.svg" alt="" />
  </div>`;
}

/* ── Daily card ─────────────────────────────────────────────────────────── */

async function loadTarotDaily() {
  const slot = $("#tarot-daily-slot");
  const reading = $("#tarot-daily-reading");
  if (!slot || !reading) return;

  tarotState.status = "loading";
  tarotSay("Loading today's card…");
  // Deep Scan makes the draw feel deliberate without pretending the result is
  // already known. The live status next to it carries the actual progress.
  slot.innerHTML = tarotLoadingCardHtml();
  reading.innerHTML = "";

  try {
    const timezone = axisResolveTimezone();
    const held = tarotRememberedDaily();
    const query = new URLSearchParams({
      timezone,
      reversals: tarotReversalsOn() ? "on" : "off",
    });
    if (held?.card_slug && held?.local_date) {
      query.set("remembered_slug", held.card_slug);
      query.set("remembered_date", held.local_date);
      query.set("remembered_orientation", held.orientation || "upright");
    }
    const data = await get(`/api/tarot/daily?${query}`);
    // Whatever came back is today's card — a fresh draw on the first open of
    // the day, or the one already held. Stored either way, so a refresh a
    // minute later asks for the same card rather than drawing another.
    tarotRememberDaily(data.reading?.remember);
    tarotState.reading = data.reading;
    // Known now, turned over later — which is exactly the gap the front loads in.
    preloadTarotFronts(data.reading?.cards);
    tarotState.status = "ready";
    tarotState.unavailable = null;
    tarotState.revealed = tarotWasRevealed(data.reading?.draw?.local_date);
    renderTarotDaily();
  } catch (error) {
    // A deck that is not ready is a STATE, not a failure: it has a real
    // explanation and no retry would help, so it must not be dressed as one.
    const code = error?.data?.code;
    if (code === "empty_deck" || code === "incomplete_deck" || code === "unreviewed_deck") {
      tarotState.status = "unavailable";
      tarotState.unavailable = { code, message: error.message };
      renderTarotUnavailable();
      return;
    }
    tarotState.status = "error";
    tarotState.error = error.message || "Today's card could not be loaded.";
    renderTarotDailyError();
  }
}

function renderTarotUnavailable() {
  const slot = $("#tarot-daily-slot");
  const reading = $("#tarot-daily-reading");
  const manual = $("#tarot-manual");
  if (slot) slot.innerHTML = "";
  if (reading) {
    reading.innerHTML = `<div class="tarot-empty">
      <h3>The deck is not ready yet</h3>
      <p>${esc(tarotState.unavailable?.message || "The Tarot deck has not been authored yet.")}</p>
      <p class="u-meta">Orbit Axis will not show cards it has not written. Nothing here is
        generated automatically, and nothing is copied from a published guidebook.</p>
    </div>`;
  }
  // Controls that cannot succeed are removed, not disabled. A greyed-out
  // "Draw one card" still says we think it might work.
  if (manual) manual.hidden = true;
  tarotSay("Tarot is not available yet on this instance.");
}

function renderTarotDailyError() {
  const slot = $("#tarot-daily-slot");
  const reading = $("#tarot-daily-reading");
  if (slot) slot.innerHTML = "";
  if (reading) {
    reading.innerHTML = `<div class="tarot-error" role="alert">
      <h3>Today's card could not be loaded</h3>
      <p>${esc(tarotState.error)}</p>
      <button class="o-btn o-btn--secondary" type="button" data-tarot-action="retry-daily">Try again</button>
    </div>`;
  }
  tarotSay("Today's card could not be loaded.", { assertive: true });
}

function renderTarotDaily() {
  const slot = $("#tarot-daily-slot");
  const reading = $("#tarot-daily-reading");
  const entry = tarotState.reading?.cards?.[0];
  if (!slot || !reading || !entry) return;

  // The load is over by the time anything renders, so the loading line goes
  // here rather than in each branch below. Returning to an ALREADY-REVEALED
  // card otherwise left "Loading today's card…" sitting under the header
  // permanently — the card was right there and the page still claimed to be
  // fetching it. The reveal handler sets its own announcement after this runs.
  tarotSay("");

  const dateEl = $("#tarot-date");
  if (dateEl && tarotState.reading?.draw?.local_date) {
    dateEl.textContent = formatLocalDateKey(tarotState.reading.draw.local_date);
  }

  if (!tarotState.revealed) {
    slot.innerHTML = tarotCardFaceHtml(null, { faceDown: true });
    reading.innerHTML = `<div class="tarot-facedown">
      <h3>Your card is face down</h3>
      <p>One card, drawn for today. It stays the same card until tomorrow —
        refreshing will not change it.</p>
      <p class="u-meta">Tap the card, or swipe across it, to turn it over.</p>
    </div>`;
    return;
  }

  slot.innerHTML = tarotCardFaceHtml(entry.card);
  // Boolean(), not the raw expression: `false || undefined` is undefined, and
  // a default parameter treats undefined as "not passed" — so `shown:
  // undefined` fell back to the default of true and every meaning showed
  // immediately regardless of the setting.
  const showMeaning = Boolean(!tarotMeaningOnRequest() || tarotState.meaningShown[entry.card.slug]);
  reading.innerHTML = `${tarotMeaningHtml(entry, { headingLevel: 3, showPosition: false, shown: showMeaning })}
    <div class="tarot-actions" id="tarot-daily-actions"></div>`;
  renderTarotDailySave();
}

/** Save is offered to everyone; the account is asked for only on the press. */
function renderTarotDailySave() {
  const holder = $("#tarot-daily-actions");
  if (!holder) return;
  if (tarotState.saved) {
    holder.innerHTML = `<p class="tarot-saved" role="status">Saved to your reflections.
      <a href="#history">See your history</a></p>`;
    return;
  }
  const busy = tarotState.saving;
  holder.innerHTML = `<button class="o-btn o-btn--secondary" type="button"
      data-tarot-action="save-daily" ${busy ? "disabled" : ""}>
      ${busy ? "Saving…" : "Save this reflection"}</button>
    ${authSignedIn() ? "" : `<p class="u-meta">Saving keeps a reflection to your account.
      Today's card itself needs no account — it is already yours for the day.</p>`}`;
}

/* ── Manual reflections ─────────────────────────────────────────────────── */

async function drawTarotSpread(spreadType) {
  if (tarotState.manualBusy) return;
  tarotState.manualBusy = true;
  tarotState.saved = false;

  const spread = $("#tarot-spread");
  const save = $("#tarot-save");
  // The drawn reading takes over the card surface. The daily card is not
  // destroyed — it is derived, so returning to it costs one request — but two
  // live readings on one screen would leave the reader deciding which is
  // today's, and that is not a decision worth handing them.
  setTarotDailyHidden(true);
  if (save) save.innerHTML = "";
  if (spread) {
    spread.hidden = false;
    const count = spreadType === "three_card" ? 3 : 1;
    spread.innerHTML = `<div class="tarot-spread__loading">${Array.from({ length: count },
      () => tarotLoadingCardHtml()).join("")}</div>`;
  }
  tarotSay(spreadType === "three_card" ? "Drawing three cards…" : "Drawing a card…");
  setTarotFormBusy(true);

  try {
    // No question is sent. The field was removed from this surface — a written
    // question belongs to Ask Orbit, not to a card draw — and the endpoint
    // keeps accepting an optional one so that feature can supply it later
    // without a second contract.
    const data = await post("/api/tarot/draw", {
      spread_type: spreadType,
      timezone: axisResolveTimezone(),
      reversals: tarotReversalsOn(),
    });
    tarotState.manual = data.reading;
    preloadTarotFronts(data.reading?.cards);
    // Drawn cards start FACE DOWN, like the daily one. Turning a card over is
    // the gesture this surface is built on, and it is also what gives the
    // artwork time to arrive — a spread that appeared already revealed would
    // be the one place a reader could watch an image load.
    tarotState.manualRevealed = data.reading.cards.map(() => false);
    renderTarotManual();
    // The rendered spread states what it is in its own label, so the status
    // line stands down rather than saying it a second time three lines above.
    // The "Drawing…" message it replaces did the announcing.
    tarotSay("");
  } catch (error) {
    const code = error?.data?.code;
    if (code === "empty_deck" || code === "incomplete_deck" || code === "unreviewed_deck") {
      tarotState.unavailable = { code, message: error.message };
      renderTarotUnavailable();
      return;
    }
    if (spread) {
      spread.innerHTML = `<div class="tarot-error" role="alert">
        <h3>That draw did not complete</h3>
        <p>${esc(error.message || "Please try again.")}</p>
        <button class="o-btn o-btn--secondary" type="button"
          data-tarot-action="retry-draw" data-spread="${esc(spreadType)}">Try again</button>
      </div>`;
    }
    tarotSay("That draw did not complete.", { assertive: true });
  } finally {
    tarotState.manualBusy = false;
    setTarotFormBusy(false);
  }
}

function setTarotFormBusy(busy) {
  for (const button of document.querySelectorAll("#tarot-form button[type=submit]")) {
    button.disabled = busy;
  }
}

/**
 * A drawn reading, in the surface the daily card was using.
 *
 * Three cards are a CAROUSEL: one card at a time, swipeable, with the next
 * partially visible. That is a deliberate departure from the vertical stack —
 * see the note on the carousel below — and it is why every card keeps a
 * position label and a number ("2 of 3"), so the sequence survives being shown
 * one at a time.
 */
/**
 * Rewrite ONE card of the spread, leaving the carousel alone.
 *
 * Turning a card over, or asking what it means, used to call
 * renderTarotManual() — which rebuilds the whole carousel with innerHTML. That
 * destroys the scrolled element and takes the reader back to card one, so
 * flipping the third card threw them to the first. It also replayed the reveal
 * animation on every other card.
 *
 * Replacing one <li>'s contents keeps the scroll position, the observer, and
 * the other two cards exactly where they were.
 */
function updateTarotSpreadCard(index) {
  const reading = tarotState.manual;
  const item = document.getElementById(`tarot-card-${index}`);
  if (!reading || !item) return false;

  const entry = reading.cards[index];
  const total = reading.cards.length;
  const revealed = (tarotState.manualRevealed || [])[index];
  const step = total > 1 ? `${index + 1} of ${total}` : null;

  const card = revealed
    ? tarotCardFaceHtml(entry.card)
    : tarotCardFaceHtml(null, { faceDown: true, index, label: `Turn over ${entry.position}` });

  const meaning = revealed
    ? tarotMeaningHtml(entry, {
        headingLevel: total > 1 ? 4 : 3,
        showPosition: total > 1,
        step, index,
        shown: Boolean(!tarotMeaningOnRequest() || tarotState.meaningShown[entry.card.slug]),
      })
    : `<p class="tarot-meaning__position">${esc(entry.position)}${
        step ? ` <span class="tarot-meaning__step">· ${esc(step)}</span>` : ""}</p>
       <p class="u-meta">Tap the card to turn it over.</p>`;

  item.querySelector(".tarot-card-slot").innerHTML = card;
  item.querySelector(".tarot-reading").innerHTML = meaning;
  renderTarotManualSave();
  return true;
}

function renderTarotManual() {
  const spread = $("#tarot-spread");
  const reading = tarotState.manual;
  if (!spread || !reading) return;

  const multi = reading.cards.length > 1;
  spread.hidden = false;
  spread.className = `tarot-spread${multi ? " tarot-spread--carousel" : ""}`;

  const back = `<div class="tarot-spread__head">
      <p class="tarot-spread__label">${multi ? "Three cards drawn" : "One card drawn"}</p>
      <button type="button" class="o-btn o-btn--utility" data-tarot-action="back-to-daily">Back to today's card</button>
    </div>`;

  // Position labels follow the reader's setting. This is presentation only:
  // the server records its own labels when a reading is saved, because the
  // stored reading is what Orbit means by those three cards, not how one
  // device happened to word it.
  const total = reading.cards.length;
  reading.cards.forEach((entry, i) => {
    const label = tarotPositionLabel(i, total);
    if (label) entry.position = label;
  });

  const revealed = tarotState.manualRevealed || [];
  const cardHtml = (entry, i) => revealed[i]
    ? tarotCardFaceHtml(entry.card)
    : tarotCardFaceHtml(null, { faceDown: true, index: i, label: `Turn over ${entry.position}` });
  // The meaning appears with the card, not before it. Printing the
  // interpretation beside a face-down card would answer the question the
  // gesture exists to ask.
  const meaningHtml = (entry, i, opts) => revealed[i]
    ? tarotMeaningHtml(entry, { ...opts, index: i,
        shown: Boolean(!tarotMeaningOnRequest() || tarotState.meaningShown[entry.card.slug]) })
    : `<p class="tarot-meaning__position">${esc(entry.position)}${
        opts.step ? ` <span class="tarot-meaning__step">· ${esc(opts.step)}</span>` : ""}</p>
       <p class="u-meta">Tap the card to turn it over.</p>`;

  if (!multi) {
    const entry = reading.cards[0];
    spread.innerHTML = `${back}
      <div class="tarot-layout">
        <div class="tarot-card-slot">${cardHtml(entry, 0)}</div>
        <div class="tarot-reading">${meaningHtml(entry, 0, { headingLevel: 3, showPosition: false })}</div>
      </div>`;
    renderTarotManualSave();
    return;
  }

  // The carousel. An ordered list underneath, because the order IS the meaning
  // — "What shaped this" before "What is present" is not a layout preference —
  // and CSS scroll-snap does the swiping, so there is no gesture handler, no
  // threshold, and no drag state to get wrong. Keyboard and screen-reader users
  // scroll it like any other list; the dots below are real buttons.
  spread.innerHTML = `${back}
    <ol class="tarot-carousel" id="tarot-carousel" tabindex="0"
        aria-label="Three cards, in reading order">
      ${reading.cards.map((entry, i) => `<li class="tarot-carousel__item" id="tarot-card-${i}">
          <p class="tarot-carousel__step" aria-hidden="true">${i + 1} of ${reading.cards.length}</p>
          <div class="tarot-card-slot">${cardHtml(entry, i)}</div>
          <div class="tarot-reading">${meaningHtml(entry, i, { headingLevel: 4, showPosition: true, step: `${i + 1} of ${reading.cards.length}` })}</div>
        </li>`).join("")}
    </ol>
    <div class="tarot-carousel__dots" role="group" aria-label="Go to card">
      ${reading.cards.map((entry, i) =>
        `<button type="button" class="tarot-carousel__dot${i === 0 ? " is-current" : ""}"
           data-tarot-card-index="${i}" aria-label="Card ${i + 1}: ${esc(entry.position)}"></button>`).join("")}
    </div>`;

  wireTarotCarousel();
  renderTarotManualSave();
}

/**
 * Keep the dots in step with the scroll position.
 *
 * IntersectionObserver rather than a scroll handler: the question is "which
 * card is on screen", which is exactly what it answers, and it does not fire
 * sixty times a second while a finger is moving.
 */
function wireTarotCarousel() {
  const track = $("#tarot-carousel");
  if (!track || !window.IntersectionObserver) return;
  const dots = [...document.querySelectorAll(".tarot-carousel__dot")];

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const index = [...track.children].indexOf(entry.target);
      dots.forEach((dot, i) => dot.classList.toggle("is-current", i === index));
    }
  }, { root: track, threshold: 0.6 });

  for (const item of track.children) observer.observe(item);

  for (const dot of dots) {
    dot.addEventListener("click", () => {
      const index = Number(dot.dataset.tarotCardIndex);
      track.children[index]?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "nearest", inline: "start",
      });
    });
  }
}

/**
 * Turn over one card of a drawn spread.
 *
 * Per card rather than all at once: a three-card reading is a sequence, and
 * turning them in order is how the sequence is read. It also means each card's
 * front has until the reader reaches it to arrive.
 */
function revealTarotSpreadCard(index) {
  const revealed = tarotState.manualRevealed;
  if (!revealed || revealed[index]) return;
  revealed[index] = true;
  if (!updateTarotSpreadCard(index)) renderTarotManual();
  const entry = tarotState.manual?.cards?.[index];
  if (entry) tarotSay(`${entry.position}: ${entry.card.name}.`);
  // Focus lands on the card's name, which is what just appeared.
  document.querySelector(`#tarot-card-${index} .tarot-meaning__name`)?.focus?.({ preventScroll: true });
}

/** Respect the system preference rather than animating and apologising. */
function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Show or hide the daily card surface without discarding its state. */
function setTarotDailyHidden(hidden) {
  const layout = $("#tarot-daily-layout");
  const hint = $("#tarot-daily-hint");
  const title = $("#tarot-daily-title");
  if (layout) layout.hidden = hidden;
  if (hint) hint.hidden = true;
  if (title) title.hidden = hidden;
}

/** Return to today's card, discarding the drawn reading. */
function backToTarotDaily() {
  const spread = $("#tarot-spread");
  const save = $("#tarot-save");
  if (spread) { spread.hidden = true; spread.innerHTML = ""; }
  if (save) save.innerHTML = "";
  tarotState.manual = null;
  tarotState.manualRevealed = null;
  tarotState.saved = false;
  setTarotDailyHidden(false);
  renderTarotDaily();
  $("#tarot-daily-title")?.focus?.({ preventScroll: true });
}

function renderTarotManualSave() {
  const holder = $("#tarot-save");
  if (!holder) return;
  if (tarotState.saved) {
    holder.innerHTML = `<p class="tarot-saved" role="status">Saved to your reflections.
      <a href="#history">See your history</a></p>`;
    return;
  }
  holder.innerHTML = `<button class="o-btn o-btn--secondary" type="button"
      data-tarot-action="save-manual" ${tarotState.saving ? "disabled" : ""}>
      ${tarotState.saving ? "Saving…" : "Save this reflection"}</button>`;
}

/* ── Saving ─────────────────────────────────────────────────────────────── */

/**
 * Save a reading, asking for an account only at the moment it is needed.
 *
 * This is the [[Signed-Out Experience]] rule applied exactly: the card was
 * free, keeping it is what costs an account. The guard runs BEFORE the request
 * so nobody meets a 401 under a button they just pressed.
 */
async function saveTarotReading(which) {
  const reading = which === "daily" ? tarotState.reading : tarotState.manual;
  if (!reading || tarotState.saving) return;
  if (!authSignedIn()) { requireAccount("history"); return; }

  tarotState.saving = true;
  which === "daily" ? renderTarotDailySave() : renderTarotManualSave();
  tarotSay("Saving your reflection…");

  try {
    await post("/api/tarot/readings", {
      reading: {
        spread_type: reading.spread_type,
        question: reading.question,
        // Slugs only. The server re-resolves each card from its own deck, so a
        // client cannot save a meaning the deck does not contain.
        // Slug AND orientation: a reversed card saved as upright would be the
        // same card saying something it did not say.
        cards: reading.cards.map((entry) => ({ slug: entry.card.slug, orientation: entry.card.orientation })),
        draw: reading.draw,
      },
    });
    tarotState.saved = true;
    tarotSay("Saved to your reflections.");
    toast("Reflection saved");
  } catch (error) {
    tarotSay(error.message || "That reflection could not be saved.", { assertive: true });
  } finally {
    tarotState.saving = false;
    which === "daily" ? renderTarotDailySave() : renderTarotManualSave();
  }
}

/* ── Wiring ─────────────────────────────────────────────────────────────── */

let tarotWired = false;

function wireTarot() {
  if (tarotWired) return;
  tarotWired = true;

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-tarot-action]");
    if (!trigger) return;
    const action = trigger.dataset.tarotAction;

    if (action === "reveal") {
      const index = trigger.dataset.tarotIndex;
      if (index === undefined) revealTarotDaily();
      else revealTarotSpreadCard(Number(index));
      return;
    }
    if (action === "show-meaning") {
      const index = trigger.dataset.tarotIndex;
      const entry = index === undefined
        ? tarotState.reading?.cards?.[0]
        : tarotState.manual?.cards?.[Number(index)];
      if (!entry) return;
      tarotState.meaningShown[entry.card.slug] = true;
      if (index === undefined) renderTarotDaily();
      else if (!updateTarotSpreadCard(Number(index))) renderTarotManual();
      // Focus the text that just appeared, so a keyboard reader is taken to
      // the answer rather than left on a button that is now gone.
      const scope = index === undefined ? "#tarot-daily-reading" : "#tarot-spread";
      $(`${scope} .tarot-meaning__body`)?.focus?.({ preventScroll: true });
      tarotSay(`${entry.card.name}: meaning shown.`);
      return;
    }
    if (action === "back-to-daily") { backToTarotDaily(); return; }
    if (action === "retry-daily") { loadTarotDaily(); return; }
    if (action === "retry-draw") { drawTarotSpread(trigger.dataset.spread || "one_card"); return; }
    if (action === "save-daily") { saveTarotReading("daily"); return; }
    if (action === "save-manual") { saveTarotReading("manual"); return; }
    if (action === "signin") { requireAccount("history"); return; }
    if (action === "retry-history") { axisLoadTarotHistory(); return; }
  });

  // Swipe across a face-down card to turn it over. Pointer events rather than
  // touch events, so a trackpad drag and a stylus work too; the threshold is
  // generous because this is a reveal, not a carousel, and there is nothing to
  // scroll past. A plain tap is handled by the click listener above — the
  // card is a real button, so this only has to add the gesture.
  let swipeStart = null;
  document.addEventListener("pointerdown", (event) => {
    const card = event.target.closest(".tarot-card--down");
    swipeStart = card ? { x: event.clientX, y: event.clientY, card } : null;
  });
  document.addEventListener("pointerup", (event) => {
    if (!swipeStart) return;
    const { x, y, card } = swipeStart;
    swipeStart = null;
    const dx = Math.abs(event.clientX - x);
    const dy = Math.abs(event.clientY - y);
    // A horizontal movement of any real distance counts. A tap (dx and dy both
    // tiny) is left to the click handler so a reveal never fires twice.
    if (dx > 24 && dx > dy && card.isConnected) {
      const index = card.dataset.tarotIndex;
      if (index === undefined) revealTarotDaily();
      else revealTarotSpreadCard(Number(index));
    }
  });

  const form = $("#tarot-form");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      // Which button submitted decides the spread. `submitter` is the honest
      // source; reading a stored "last clicked" value drifts the moment
      // somebody submits with the keyboard.
      const spread = event.submitter?.dataset?.spread || "one_card";
      drawTarotSpread(spread);
    });
  }
}

/** Called by the router when #tarot is entered. */
function enterTarot() {
  wireTarot();
  const manual = $("#tarot-manual");
  if (manual) manual.hidden = false;
  tarotState.saved = false;
  loadTarotDaily();
}

/**
 * Show the Today switch only when Tarot is genuinely available.
 *
 * "Available" means the flag is on AND the panel markup loaded — the same test
 * the router uses. A segmented control whose second half 404s is worse than no
 * control, and an unfinished feature must not appear in navigation at all.
 */
function syncTodayViews(currentId) {
  const holder = $("#today-views");
  const available = workspaceAvailable("tarot");
  if (holder) holder.hidden = !available;
  for (const link of document.querySelectorAll("[data-today-view]")) {
    if (link.dataset.todayView === currentId) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

/* ── Toasts ────────────────────────────────────────────────────────────── */
function toast(message) {
  const el = document.createElement("div");
  el.className = "o-toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  $("#toast-region").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 220); }, 2400);
}

/* ── Theme ───────────────────────────────────────────────────────────────
   Three choices — System, Light, Dark — with System as the default.

   PREFERENCE vs RESOLVED THEME. The stored preference is what the person chose;
   the resolved theme is what the pixels do. They differ only under "system",
   where the device decides. Both are on <html>: data-theme-preference records the
   choice (so the control can show it), data-theme drives every token in the
   stylesheets. Conflating the two is how a "System" selection silently becomes
   a hard "Dark" the first time it is written back.

   The FIRST resolution does not happen here. It happens in a tiny inline script
   in index.html, before the stylesheets paint, because a theme applied after
   first paint is a white flash for every dark-mode user (and vice versa). This
   module takes over afterwards, and must agree with it exactly. */
const THEME_CHOICES = ["system", "light", "dark"];
const THEME_STORAGE_KEY = "orbit.theme";
const THEME_COLORS = { light: "#f5f5f7", dark: "#080a12" };

/** Storage can throw in private mode. A theme is never worth an exception. */
function readStoredTheme() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_CHOICES.includes(raw) ? raw : "system";
  } catch { return "system"; }
}

function storeTheme(choice) {
  try { localStorage.setItem(THEME_STORAGE_KEY, choice); } catch { /* session-only */ }
}

const lightMediaQuery = window.matchMedia?.("(prefers-color-scheme: light)") ?? null;

function systemTheme() {
  return lightMediaQuery?.matches ? "light" : "dark";
}

function resolveTheme(choice) {
  return choice === "system" ? systemTheme() : choice;
}

/** Paint a resolved theme. Also updates the browser chrome colour. */
function applyResolvedTheme(choice) {
  const resolved = resolveTheme(choice);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = choice;
  const meta = document.getElementById("meta-theme-color");
  if (meta) meta.setAttribute("content", THEME_COLORS[resolved] || THEME_COLORS.dark);
  return resolved;
}

/* ── Persisted appearance settings ─────────────────────────────────────── */
const settings = {
  keys: {
    theme: { attr: "data-theme", default: "system" },
    text: { attr: "data-text", default: "default" },
    contrast: { attr: "data-contrast", default: "normal" },
    motion: { attr: "data-motion", default: "full" },
  },

  /**
   * Settings that change BEHAVIOUR rather than presentation.
   *
   * The five above paint an attribute on <html> and CSS does the rest. These
   * are read by code — tarotEnabled(), tarotPositionSet(), and so on — so they
   * have no attribute and must not be handed to the attribute path.
   *
   * They were absent from `keys` altogether, which meant apply() dereferenced
   * an undefined config and threw on the first click. Every Tarot setting
   * looked inert because the handler died before it reached the control.
   */
  prefs: {
    tarot: { default: "on", seg: "#set-tarot" },
    tarotPositions: { default: "reflective", seg: "#set-tarot-positions" },
    tarotMeaning: { default: "ask", seg: "#set-tarot-meaning" },
    tarotReversed: { default: "off", seg: "#set-tarot-reversed" },
  },
  load() {
    this.apply("theme", readStoredTheme());
    for (const [key, cfg] of Object.entries({ ...this.keys, ...this.prefs })) {
      if (key === "theme") continue;
      let val = cfg.default;
      try { val = localStorage.getItem(`orbit.${key}`) ?? cfg.default; } catch { /* private mode */ }
      this.apply(key, val);
    }
  },
  apply(key, val) {
    // A behavioural preference: store-and-reflect, no document attribute.
    const pref = this.prefs[key];
    if (pref) {
      $$(`${pref.seg} button`).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === val)));
      // Turning Tarot off has to take effect now, not on next load: the rail,
      // the Today switch and the route all read availability.
      if (key === "tarot") { buildRail(); syncTodayViews(currentWorkspace()); }
      // A changed reading preference re-renders whatever is on screen, so the
      // reader sees the setting take hold rather than wondering if it did.
      if (key !== "tarot" && currentWorkspace() === "tarot") enterTarot();
      return;
    }

    const cfg = this.keys[key];
    if (key === "theme") {
      applyResolvedTheme(THEME_CHOICES.includes(val) ? val : "system");
    } else if (val === cfg.default && (key === "text" || key === "contrast" || key === "motion")) {
      document.documentElement.removeAttribute(cfg.attr);
    } else {
      document.documentElement.setAttribute(cfg.attr, val);
    }
    // Reflect into the segmented control, so the selected state is visible,
    // announced, and never communicated by colour alone.
    const seg = { theme: "#set-theme", text: "#set-text",
      contrast: "#set-contrast", motion: "#set-motion" }[key];
    if (seg) $$(`${seg} button`).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === val)));
  },
  set(key, val) {
    if (key === "theme") storeTheme(THEME_CHOICES.includes(val) ? val : "system");
    else { try { localStorage.setItem(`orbit.${key}`, val); } catch { /* session-only */ } }
    this.apply(key, val);
  },
};

function wireSettings() {
  const map = { "#set-theme": "theme", "#set-text": "text", "#set-contrast": "contrast", "#set-motion": "motion",
    "#set-tarot": "tarot", "#set-tarot-positions": "tarotPositions", "#set-tarot-meaning": "tarotMeaning",
    "#set-tarot-reversed": "tarotReversed" };
  for (const [sel, key] of Object.entries(map)) {
    $(sel)?.addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      settings.set(key, btn.dataset.value);
    });
  }

  // While the choice is "system", a device switching to dark at sunset must be
  // followed live. Once someone picks Light or Dark explicitly, the device no
  // longer gets a vote — that is what "override" means.
  const onSystemChange = () => {
    if (readStoredTheme() === "system") applyResolvedTheme("system");
  };
  lightMediaQuery?.addEventListener?.("change", onSystemChange);
}

/* ── Global keyboard behaviour ──────────────────────────────────────────
   Dev Update 1.3 removed the command palette and its Cmd+K / number-key
   shortcuts. Nothing replaced them because nothing needed to: every
   destination is a real link in a real navigation landmark, reachable by Tab
   and by the skip link, which is the accessible path the shortcuts were
   shadowing rather than providing. */

/* ── Data ──────────────────────────────────────────────────────────────── */
async function refreshData(notify = false, pre = null) {
  const timezone = axisResolveTimezone();
  // Key fields per the 4.2 contract: these are shared sky data, so the key is
  // endpoint + timezone + local day. Chart-scoped keys (the daily reading)
  // additionally carry the chart id — see axisLoadToday.
  const kChart = `chart-now::${timezone}::${localDayKey(timezone)}`;
  const kEvents = `events::${timezone}`;

  const applyData = (chart, symbolsData, eventsData) => {
    state.chart = chart;
    state.symbols = symbolsData.symbols;
    state.events = eventsData.events;
    renderEvents(state.events);
    if (!state.ready) { wireGlobalActions(); state.ready = true; }
    $("#settings-disclaimer").textContent = chart.disclaimer
      ? `${chart.disclaimer} Sky timing is computed from mean cycles and is approximate.`
      : $("#settings-disclaimer").textContent;
  };

  // Cache first: the last-loaded answer paints immediately, labelled with its
  // age. The network refresh below repaints over it — same renderers, so a
  // second application is idempotent.
  let painted = false;
  let paintedAt = null;
  try {
    const [c, sym, ev] = await Promise.all([cacheGet(kChart), cacheGet("symbols"), cacheGet(kEvents)]);
    if (c && sym && ev) {
      applyData(c.value, sym.value, ev.value);
      painted = true;
      paintedAt = c.savedAt;
      cacheNote(paintedAt);
    }
  } catch { /* the cache is a courtesy; the network path below is the contract */ }

  try {
    const [chart, symbolsData, eventsData] = await Promise.all([
      pre?.chart ?? get(`/api/chart/now?tz=${encodeURIComponent(timezone)}`),
      pre?.symbols ?? get("/api/symbols"),
      pre?.events ?? get(`/api/events?count=9&tz=${encodeURIComponent(timezone)}`),
    ]);
    void cachePut(kChart, chart);
    void cachePut("symbols", symbolsData);
    void cachePut(kEvents, eventsData);
    applyData(chart, symbolsData, eventsData);
    cacheNote(null);
  } catch (error) {
    if (!painted) throw error; // nothing on screen — the old failure is the right one
    cacheNote(paintedAt, { failed: true });
    return;
  }

  if (notify) toast("Transits refreshed");
}

/* ── Boot ──────────────────────────────────────────────────────────────── */
async function boot() {
  settings.load();

  /* Dev Update 4.2. The measured waterfall (2026-08-18) showed startup as a
     strictly sequential chain: features, then session, then everything else —
     five network stages signed in, none of them overlapping. Every request
     below is independent of the others, so they all START now; each is
     CONSUMED at exactly the point in the sequence it always was, so ordering
     semantics are unchanged — only the waiting overlaps. */
  const tz0 = axisResolveTimezone();
  const early = {
    features: fetch(apiUrl("/api/features")),
    session: get("/api/auth/session"),
    chart: get(`/api/chart/now?tz=${encodeURIComponent(tz0)}`),
    symbols: get("/api/symbols"),
    events: get(`/api/events?count=9&tz=${encodeURIComponent(tz0)}`),
    sky: get(`/api/sky/current?tz=${encodeURIComponent(tz0)}`),
  };
  for (const p of Object.values(early)) p.catch(muffleEarly);
  AXIS.preSky = early.sky;

  // Flags first: the rail is built from them, and building it twice would make
  // hidden features flash on screen before disappearing.
  await loadFeatureFlags(early.features);
  await loadFeaturePanels();
  buildRail();
  // Icons are declared with data-icon in the markup and painted here, once the
  // feature panels have been injected so their icons are covered too.
  hydrateIcons();
  trackVisualViewport();
  wireFind();
  wireSettings();
  wireAuth();
  setupPlaceSearch("ob");
  setupPlaceSearch("cm");
  wireSavedCharts();
  wireRowMenus();
  wireChartModal();
  wireIdentityEditor();
  wireChartReading();
  wirePositions();
  wireHomeChartActions();

  $("#topnav-date").textContent = new Date().toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });

  window.addEventListener("hashchange", renderRoute);
  renderRoute();

  try {
    await restoreSession(early.session);
    refreshSecondaryRoute();
  } finally {
    // Belt and braces: whatever happens above, the startup gate comes down so
    // the interface is never permanently blocked.
    finishStartup();
  }

  // Orbit Axis daily experience (Today + History + detail levels).
  await axisInit();

  await refreshData(false, early);
}

// ── My Chart ─────────────────────────────────────────────────────────────────
const SIGN_GLYPH = {
  Aries: "♈", Taurus: "♉", Gemini: "♊", Cancer: "♋", Leo: "♌", Virgo: "♍",
  Libra: "♎", Scorpio: "♏", Sagittarius: "♐", Capricorn: "♑", Aquarius: "♒", Pisces: "♓",
};
// Keyed by the composer's stable `key`, never by display text.
const PLACEMENT_GLYPHS = {
  ascendant: "ASC", midheaven: "MC", Sun: "☉", Moon: "☾", Mercury: "☿",
  Venus: "♀", Mars: "♂", Jupiter: "♃", Saturn: "♄", Uranus: "♅", Neptune: "♆", Pluto: "♇",
};
const ELEMENT_CLASS = { Fire: "fire", Earth: "earth", Air: "air", Water: "water" };
const STANDARD_PLANET_ORDER = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const TIME_ACCURACY_COPY = {
  exact: { label: "Exact birth time", note: "Rising sign, houses, and angles can be read with confidence." },
  reported: { label: "Reported birth time", note: "Rising sign, houses, and angles use the saved reported time." },
  approximate: { label: "Approximate birth time", note: "Your Rising sign and houses may shift because the birth time is approximate." },
  unknown: { label: "Unknown birth time", note: "A birth time is needed to calculate your Rising sign and houses reliably." },
};

// Every word of interpretation on this page comes from the server-composed
// `reading` (lib/interpretation/). NOTHING below authors meaning. When you are
// tempted to add "a short explanatory sentence" here, add it to the content
// modules instead — otherwise there are two corpora and only one of them has
// tests.

function degLabel(p) {
  if (!p || p.unavailable) return "";
  return `${p.degrees}° ${String(p.minutes).padStart(2, "0")}′`;
}

function formatBirthDate(value) {
  if (!value) return "Birth date not set";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatBirthTime(profile) {
  if (!profile || profile.time_accuracy === "unknown" || !profile.birth_time) return "Time unknown";
  const time = String(profile.birth_time).slice(0, 5);
  const [hour, minute] = time.split(":").map(Number);
  if (Number.isFinite(hour) && Number.isFinite(minute)) {
    return new Date(2000, 0, 1, hour, minute).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return time;
}

function timeAccuracyInfo(value) {
  return TIME_ACCURACY_COPY[value] || TIME_ACCURACY_COPY.unknown;
}

function glyphFor(key) {
  return PLACEMENT_GLYPHS[key] || "";
}

/**
 * A glyph plus its name, where the glyph is decoration and the name is the
 * accessible label. Screen readers announce "Sun", never "black circle with
 * dot", and the reading stays understandable with images and symbols off.
 */
function glyphHtml(key) {
  const glyph = glyphFor(key);
  if (!glyph) return "";
  return `<span class="reading-card__glyph" aria-hidden="true">${esc(textGlyph(glyph))}</span>`;
}

// ── Reading state ───────────────────────────────────────────────────────────
// One place decides what My Chart is showing. `token` guards against a slow
// response for a chart the user has already switched away from: every request
// takes the next token and only the newest may paint.
const reading = {
  token: 0,
  state: "idle",   // idle | loading | ready | empty | error
  chartId: null,
};

const READING_SECTIONS = ["#section-bigthree", "#section-patterns", "#section-planets",
                          "#section-aspects", "#section-houses", "#section-data"];

function setReadingState(next) {
  reading.state = next;
  const root = $("#me-reading");
  if (root) root.dataset.state = next;
  // Sections are hidden rather than emptied while loading, so the page keeps
  // its shape and does not collapse and rebuild under the reader.
  const showSections = next === "ready";
  READING_SECTIONS.forEach((sel) => {
    const el = $(sel);
    if (el) el.hidden = !showSections;
  });
}

/**
 * Clear every rendered interpretation.
 *
 * Called before any chart load. This is the stale-content guard: after this
 * runs there is no sentence left on the page that belongs to the previous
 * chart, so a slow or failed load cannot leave one person's Rising sign
 * sitting under another person's name.
 */
function clearChartReading() {
  state.activeNatalChart = null;
  state.activeProfile = null;
  state.activeReading = null;
  ["#bigthree", "#chart-patterns", "#key-placements", "#chart-aspects",
   "#chart-houses", "#chart-placements", "#chart-limitation"].forEach((sel) => {
    const el = $(sel);
    if (el) el.innerHTML = "";
  });
}

// ── 1. Chart identity and calculation context ───────────────────────────────

function renderChartHeader(profile, chart, name, context) {
  const target = $("#me-overview");
  if (!target) return;
  const timeInfo = timeAccuracyInfo(profile?.time_accuracy || chart?.time_accuracy);
  const contextRows = (context || []).map((row) => `
    <div>
      <dt>${esc(row.label)}</dt>
      <dd>${esc(row.value)}${row.help ? `<span class="me-facts__help">${esc(row.help)}</span>` : ""}</dd>
    </div>`).join("");
  // The summary is what identifies the chart: name, when, where, how sure.
  // The zodiac-system explanation, house-system explanation, timezone, and
  // calculation metadata are reference, not identity — they moved behind one
  // "Chart details" disclosure, which took this surface from ~506px of card to
  // a handful of lines. Nothing was removed; it is one tap further away.
  target.innerHTML = `
    <div class="me-overview__top">
      <div>
        <p class="u-eyebrow">Active Chart</p>
        <h2>${esc(name || profile?.nickname || "My Chart")}</h2>
      </div>
    </div>
    <dl class="me-facts me-facts--compact">
      <div><dt>Birth date</dt><dd>${esc(formatBirthDate(profile?.birth_date))}</dd></div>
      <div><dt>Birthplace</dt><dd>${esc(profile?.birthplace_name || "Location not set")}</dd></div>
      <div><dt>Birth time</dt><dd>${esc(formatBirthTime(profile))}</dd></div>
      <div><dt>Time certainty</dt><dd>${esc(timeInfo.label)}</dd></div>
    </dl>
    ${contextRows ? `<details class="o-disclosure-row" data-desktop-open>
      <summary><span class="o-flat-row__title">Chart details</span></summary>
      <div class="o-disclosure-row__body"><dl class="me-facts">${contextRows}</dl></div>
    </details>` : ""}`;
  applyDisclosureDefaults(target);
}

// ── 7. Birth-time limitations (one page-level notice) ───────────────────────

function renderLimitation(limitation) {
  const target = $("#chart-limitation");
  if (!target) return;
  if (!limitation) { target.innerHTML = ""; return; }
  const details = (limitation.details || []).map((d) => `<li>${esc(d)}</li>`).join("");
  target.innerHTML = `
    <aside class="chart-limitation" role="note" aria-labelledby="chart-limitation-title">
      <h2 class="chart-limitation__title" id="chart-limitation-title">${esc(limitation.title)}</h2>
      <p>${esc(limitation.body)}</p>
      ${details ? `<ul class="chart-limitation__list">${details}</ul>` : ""}
      ${limitation.action ? `<p class="chart-limitation__action">${esc(limitation.action)}</p>` : ""}
    </aside>`;
}

// ── Shared card ─────────────────────────────────────────────────────────────

/**
 * One placement, with its reading behind a native disclosure.
 *
 * The summary line and the expanded body never repeat each other: the summary
 * is the one-sentence composition, the body is the layered detail. <details>
 * is used deliberately over a custom widget — it is keyboard operable and
 * announces its own expanded state without any ARIA of ours to get wrong.
 */
function readingCardHtml(placement, { role = null } = {}) {
  if (!placement) return "";
  if (placement.unavailable) {
    return `<article class="reading-card reading-card--unavailable">
      <div class="reading-card__head">
        ${glyphHtml(placement.key)}
        <div class="reading-card__ident">
          <h3 class="reading-card__title">${esc(placement.planet)} unavailable</h3>
          <p class="reading-card__meta">Birth time needed</p>
        </div>
      </div>
      <p class="reading-card__summary">${esc(placement.reason || "")}</p>
    </article>`;
  }
  // Meta pieces escape individually because the house becomes an Atlas
  // reference link — esc() over the joined string would flatten it to text.
  const meta = [esc(placement.position || ""),
                placement.house ? atlasHouseLinkHtml(placement.house, { label: `House ${placement.house}` }) : "",
                placement.retrograde ? "Retrograde" : ""].filter(Boolean).join(" · ");
  const body = (placement.detail || []).map((p) => `<p>${esc(p)}</p>`).join("");
  const extras = [
    placement.strength ? `<div class="reading-card__aside"><h4>Where this tends to work well</h4><p>${esc(placement.strength)}</p></div>` : "",
    placement.growth ? `<div class="reading-card__aside"><h4>A growing edge</h4><p>${esc(placement.growth)}</p></div>` : "",
    placement.retrogradeNote ? `<p class="reading-card__note">${esc(placement.retrogradeNote)}</p>` : "",
  ].join("");
  return `<article class="reading-card">
    <div class="reading-card__head">
      ${glyphHtml(placement.key)}
      <div class="reading-card__ident">
        <h3 class="reading-card__title">${atlasBodyLinkHtml(placement.planet)}${placement.sign ? ` in ${atlasLinkHtml("signs", placement.sign)}` : ""}</h3>
        <p class="reading-card__meta">${meta}</p>
        ${role ? `<p class="reading-card__role">${esc(role)}</p>` : ""}
        ${placement.sign ? (() => {
          const link = atlasCombinationLinkHtml("planet-in-sign", [placement.planet, placement.sign],
            `What ${placement.planet} in ${placement.sign} means`);
          return link ? `<p class="reading-card__atlas">${link}</p>` : "";
        })() : ""}
      </div>
    </div>
    <p class="reading-card__summary">${esc(placement.summary)}</p>
    ${body || extras ? `<details class="reading-card__more">
      <summary><span>Read more about ${esc(placement.planet)}</span></summary>
      <div class="reading-card__body">${body}${extras}</div>
    </details>` : ""}
  </article>`;
}

// ── 2. Big Three ────────────────────────────────────────────────────────────

function renderBigThree(bigThree) {
  const target = $("#bigthree");
  if (!target) return;
  target.innerHTML = (bigThree || []).map((p) => readingCardHtml(p, { role: p.role })).join("");
}

// ── 3. Chart patterns ───────────────────────────────────────────────────────

function balanceBarsHtml(percentages, classMap, atlasCategory = null) {
  return Object.entries(percentages || {}).map(([key, pct]) => `
    <div class="bar-row">
      <span class="bar-key">${atlasCategory ? atlasLinkHtml(atlasCategory, key) : esc(key)}</span>
      <span class="bar-track"><span class="bar-fill ${classMap ? (classMap[key] || "") : ""}" style="width:${Number(pct) || 0}%"></span></span>
      <span class="bar-pct">${esc(String(pct))}%</span>
    </div>`).join("");
}

function patternBlockHtml(pattern, { title, classMap, countsLabel, atlasCategory = null }) {
  if (!pattern) return "";
  const extra = [
    pattern.detail ? `<p>${esc(pattern.detail)}</p>` : "",
    pattern.lighter?.detail ? `<p>${esc(pattern.lighter.detail)}</p>` : "",
    pattern.growth ? `<p>${esc(pattern.growth)}</p>` : "",
  ].filter(Boolean).join("");
  return `<div class="pattern-block">
    <h3>${esc(title)}</h3>
    <p class="pattern-block__summary">${esc(pattern.summary)}</p>
    <div class="bars">${balanceBarsHtml(pattern.percentages, classMap, atlasCategory)}</div>
    ${extra ? `<details class="reading-card__more">
      <summary><span>What ${esc(title.toLowerCase())} means here</span></summary>
      <div class="reading-card__body">${extra}</div>
    </details>` : ""}
    <details class="reading-card__more">
      <summary><span>${esc(countsLabel)}</span></summary>
      <div class="reading-card__body"><p class="pattern-block__counts">${
        Object.entries(pattern.counts || {}).map(([k, v]) => `${esc(k)}: ${esc(String(v))}`).join(" · ")
      }</p></div>
    </details>
  </div>`;
}

function renderPatterns(patterns) {
  const target = $("#chart-patterns");
  if (!target) return;
  if (!patterns || (!patterns.element && !patterns.modality)) {
    target.innerHTML = `<p class="me-muted">Pattern information is not available for this chart.</p>`;
    return;
  }
  target.innerHTML = `<div class="pattern-row">
    ${patternBlockHtml(patterns.element, { title: "Element balance", classMap: ELEMENT_CLASS, countsLabel: "Counted placements", atlasCategory: "elements" })}
    ${patternBlockHtml(patterns.modality, { title: "Modality balance", classMap: null, countsLabel: "Counted placements", atlasCategory: "modalities" })}
  </div>
  <p class="pattern-note">Counts weigh the ten planets in this chart, with the Sun and Moon carrying extra weight.</p>`;
}

// ── 4. Planet placements ────────────────────────────────────────────────────

/**
 * One placement as an expandable flat row.
 *
 * Collapsed, the row is the fact: name, sign, degree, house, retrograde —
 * legible without the glyph, which is decoration here, not information. Open,
 * it is everything the old card held: summary, atlas links, the full read.
 *
 * Native details/summary on purpose. The expanded state is real browser
 * semantics — keyboard, screen reader, find-in-page on some engines — rather
 * than a class that only the mouse knows about.
 */
function placementRowHtml(placement) {
  if (!placement) return "";
  if (placement.unavailable) {
    return `<div class="o-flat-row reading-row reading-row--unavailable">
      <span class="o-flat-row__lead">${glyphHtml(placement.key)}</span>
      <span class="o-flat-row__main">
        <span class="o-flat-row__title">${esc(placement.planet)} unavailable</span>
        <span class="o-flat-row__sub">${esc(placement.reason || "Birth time needed")}</span>
      </span>
    </div>`;
  }
  const meta = [esc(placement.position || ""),
                placement.house ? `House ${placement.house}` : "",
                placement.retrograde ? "Retrograde" : ""].filter(Boolean).join(" · ");
  const body = (placement.detail || []).map((p) => `<p>${esc(p)}</p>`).join("");
  const extras = [
    placement.strength ? `<div class="reading-card__aside"><h4>Where this tends to work well</h4><p>${esc(placement.strength)}</p></div>` : "",
    placement.growth ? `<div class="reading-card__aside"><h4>A growing edge</h4><p>${esc(placement.growth)}</p></div>` : "",
    placement.retrogradeNote ? `<p class="reading-card__note">${esc(placement.retrogradeNote)}</p>` : "",
  ].join("");
  const atlas = placement.sign
    ? (atlasCombinationLinkHtml("planet-in-sign", [placement.planet, placement.sign],
        `What ${placement.planet} in ${placement.sign} means`) || "")
    : "";
  return `<details class="o-disclosure-row reading-row" data-desktop-open>
    <summary>
      <span class="o-flat-row__lead">${glyphHtml(placement.key)}</span>
      <span class="o-flat-row__main">
        <span class="o-flat-row__title">${esc(placement.planet)}${placement.sign ? ` in ${esc(placement.sign)}` : ""}</span>
        <span class="o-flat-row__sub">${meta}</span>
      </span>
    </summary>
    <div class="o-disclosure-row__body">
      <p>${esc(placement.summary)}</p>
      ${placement.sign ? `<p class="reading-card__atlas">${atlasBodyLinkHtml(placement.planet)} · ${atlasLinkHtml("signs", placement.sign)}${placement.house ? ` · ${atlasHouseLinkHtml(placement.house, { label: `House ${placement.house}` })}` : ""}</p>` : ""}
      ${atlas ? `<p class="reading-card__atlas">${atlas}</p>` : ""}
      ${body}${extras}
    </div>
  </details>`;
}

/**
 * Desktop keeps reading everything at once; a phone starts folded.
 *
 * Rows marked data-desktop-open get their open attribute at render time when
 * the viewport is past the mobile breakpoint. Set per render rather than by a
 * resize listener: someone rotating a tablet mid-read should not have their
 * open placements slammed shut under their finger.
 */
function applyDisclosureDefaults(scope) {
  if (!window.matchMedia || !window.matchMedia("(min-width: 641px)").matches) return;
  scope?.querySelectorAll("details[data-desktop-open]").forEach((d) => { d.open = true; });
}

function renderPlacements(placements, points = []) {
  const target = $("#key-placements");
  if (!target) return;
  if (!placements?.length) {
    target.innerHTML = `<p class="me-muted">No planet placements are available for this chart.</p>`;
    return;
  }
  // Points follow the planets and carry their own names and functions, so they
  // identify themselves without a divider being injected into the list.
  target.innerHTML = `<div class="o-flat-list">${[...placements, ...points].map((p) => placementRowHtml(p)).join("")}</div>`;
  applyDisclosureDefaults(target);
}

// ── 5. Major aspects ────────────────────────────────────────────────────────

function aspectCardHtml(aspect) {
  return `<article class="aspect-card">
    <div class="aspect-card__head">
      <h3 class="aspect-card__title">${atlasBodyLinkHtml(aspect.a)} ${atlasLinkHtml("aspects", aspect.aspect, { label: aspect.aspect.toLowerCase() })} ${atlasBodyLinkHtml(aspect.b)}</h3>
      ${aspect.orbLabel ? `<span class="aspect-card__orb">${esc(aspect.orbLabel)}</span>` : ""}
    </div>
    <p class="aspect-card__summary">${esc(aspect.headline)}</p>
    ${(() => {
      const link = atlasCombinationLinkHtml("planet-aspect-planet", [aspect.a, aspect.aspect, aspect.b],
        `What ${aspect.a} ${String(aspect.aspect).toLowerCase()} ${aspect.b} means`);
      return link ? `<p class="reading-card__atlas">${link}</p>` : "";
    })()}
    <details class="reading-card__more">
      <summary><span>What this pairing can look like</span></summary>
      <div class="reading-card__body">
        <p>${esc(aspect.detail)}</p>
        <div class="reading-card__aside"><h4>What it can help with</h4><p>${esc(aspect.constructive)}</p></div>
        <div class="reading-card__aside"><h4>Where it can chafe</h4><p>${esc(aspect.tension)}</p></div>
      </div>
    </details>
  </article>`;
}

function renderAspects(aspects) {
  const target = $("#chart-aspects");
  if (!target) return;
  const highlights = aspects?.highlights || [];
  const all = aspects?.all || [];
  if (!all.length) {
    target.innerHTML = `<p class="me-muted">This chart has no major aspects within the orbs Orbit Axis uses.</p>`;
    return;
  }
  const rest = all.slice(highlights.length);
  target.innerHTML = `
    <div class="aspect-list">${highlights.map(aspectCardHtml).join("")}</div>
    ${rest.length ? `<details class="chart-details">
      <summary>All ${all.length} major aspects</summary>
      <ul class="aspect-plain">${rest.map((a) => `<li><span>${esc(a.a)} ${esc(a.aspect.toLowerCase())} ${esc(a.b)}</span>${a.orbLabel ? `<span class="orb">${esc(a.orbLabel)}</span>` : ""}</li>`).join("")}</ul>
    </details>` : ""}`;
}

// ── 6. Houses and angles ────────────────────────────────────────────────────

function renderHouses(chart, bigThree, midheaven) {
  const target = $("#chart-houses");
  if (!target) return;
  // Houses and angles exist only with a usable birth time. When they do not,
  // this section says so once — it does not render an empty table.
  if (!chart?.time_known || !chart?.houses?.length) {
    target.innerHTML = `<p class="me-muted">House placements, the Rising sign, and the Midheaven all need a reliable birth time. Everything else on this page is calculated normally without one.</p>`;
    return;
  }
  const rising = (bigThree || []).find((p) => p.key === "ascendant" && !p.unavailable);
  const angleCards = [
    rising ? readingCardHtml(rising) : "",
    midheaven ? readingCardHtml(midheaven) : "",
  ].filter(Boolean).join("");
  const rows = chart.houses.map((h) => `<tr>
    <td>House ${esc(String(h.house))}</td>
    <td>${esc(h.sign)}</td>
    <td>${esc(String(h.degrees))}°${esc(String(h.minutes).padStart(2, "0"))}′</td>
    <td>${esc(planetsInHouse(chart, h.house) || "—")}</td>
  </tr>`).join("");
  target.innerHTML = `
    <div class="reading-grid reading-grid--keys">${angleCards}</div>
    <details class="chart-details">
      <summary>All twelve house cusps</summary>
      <div class="table-scroll">
        <table class="placements">
          <thead><tr><th>House</th><th>Sign on cusp</th><th>Cusp degree</th><th>Planets</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>`;
}

function planetsInHouse(chart, houseNumber) {
  return Object.entries(chart?.planet_houses || {})
    .filter(([, h]) => h === houseNumber)
    .map(([name]) => name)
    .join(", ");
}

// ── 8. Chart data and source information ────────────────────────────────────

function renderChartData(chart, readingPayload) {
  const target = $("#chart-placements");
  if (!target) return;
  const bodyRow = (p, label, house) =>
    `<tr><td>${esc(label)}</td><td>${esc(p.sign)}</td><td>${esc(degLabel(p))}</td><td>${p.retrograde ? "Retrograde" : "Direct"}</td><td>${house ? "House " + esc(String(house)) : "—"}</td></tr>`;
  const planetRows = STANDARD_PLANET_ORDER.map((name) => chart.planets?.[name]).filter(Boolean)
    .map((p) => bodyRow(p, p.name, chart.planet_houses?.[p.name])).join("");
  // Chiron and Lilith sit below the planets and are labelled as points, because
  // they are not part of the aspect set or the element balance shown elsewhere
  // on this page. Listing them among the planets would imply they were.
  // Lilith is shown as the true (osculating) apogee, which is what most charts
  // drawn elsewhere use; the mean apogee is available from the engine but two
  // Liliths a few degrees apart reads as an error rather than as a choice.
  // Labels avoid a trailing parenthesis: client-references.test.js scans this
  // file for called-but-undefined names and reads "Name (…)" inside a string as
  // a call, so "Lilith (true)" would fail that check.
  const POINT_LABELS = { Chiron: "Chiron", TrueLilith: "True Lilith" };
  const pointRows = Object.entries(POINT_LABELS)
    .filter(([key]) => chart.points?.[key])
    .map(([key, label]) => bodyRow(chart.points[key], label, chart.point_houses?.[key]))
    .join("");
  const rows = planetRows + pointRows;
  const retro = readingPayload?.retrogrades?.length ? readingPayload.retrogrades.join(", ") : "None";
  // Open on desktop, folded on a phone. This table alone added ~900px to the
  // mobile document, and it is the most technical thing on the page — the
  // reader who wants degrees can ask; the reader who does not never scrolls
  // past a table to finish the page. data-desktop-open + the shared
  // applyDisclosureDefaults() decide, at render time, which reader this is.
  target.innerHTML = `
    <details class="chart-details" data-desktop-open>
      <summary>Calculated positions</summary>
      <div class="table-scroll" role="region" aria-label="Calculated positions table" tabindex="0">
        <table class="placements">
          <thead><tr><th>Body</th><th>Sign</th><th>Degree</th><th>Motion</th><th>House</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>
    <dl class="me-facts me-facts--compact">
      <div><dt>Chart ruler</dt><dd>${esc(chart.chart_ruler || "—")}</dd></div>
      <div><dt>Retrograde at birth</dt><dd>${esc(retro)}</dd></div>
      <div><dt>Calculation</dt><dd>${esc(chart.calculation_version || "—")}</dd></div>
      <div><dt>Interpretation content</dt><dd>${esc(readingPayload?.contentVersion || "—")}</dd></div>
    </dl>
    <p class="me-muted">Orbit Axis writes these readings from your calculated chart using text written and reviewed in advance. Nothing on this page is generated by an AI model, and your birth details are never sent to one.</p>`;
  applyDisclosureDefaults(target);
}

// ── Composition ─────────────────────────────────────────────────────────────

/**
 * Render a complete chart reading.
 *
 * Throws rather than half-painting: a composition defect must surface as an
 * error state the reader can retry, not as a page that silently omits a
 * section. The caller catches and distinguishes it from a network failure.
 */
function renderChart(chart, name, profile = null, readingPayload = null) {
  if (!chart) throw new Error("renderChart called without a chart");
  if (!readingPayload) throw new Error("renderChart called without a composed reading");
  state.activeNatalChart = chart;
  state.activeProfile = profile;
  state.activeReading = readingPayload;

  renderChartHeader(profile, chart, name, readingPayload.context);
  renderLimitation(readingPayload.limitation);
  renderBigThree(readingPayload.bigThree);
  renderPatterns(readingPayload.patterns);
  renderPlacements(readingPayload.remainingPlacements, readingPayload.pointPlacements);
  renderAspects(readingPayload.aspects);
  renderHouses(chart, readingPayload.bigThree, readingPayload.midheaven);
  renderChartData(chart, readingPayload);

  const edit = $("#me-edit-chart");
  if (edit) {
    edit.hidden = !profile?.id;
    if (profile?.id) edit.dataset.id = profile.id;
  }
  setReadingState("ready");
}

/** The signed-out / no-chart / failed states all route through here. */
function renderChartPlaceholder(kind, { message = "", retry = false } = {}) {
  clearChartReading();
  setReadingState(kind);
  const target = $("#me-overview");
  const status = $("#me-status");
  const nameEl = $("#mychart-name");
  const edit = $("#me-edit-chart");
  const add = $("#me-add-chart");
  if (edit) edit.hidden = true;
  // With no chart to read, the empty state below is the whole page, and it
  // already carries the one primary action. Leaving the header's Add chart in
  // place put two primary buttons for the same task on one signed-out screen —
  // and made the header say "No active chart yet" directly above a heading
  // saying it again. The header goes quiet and the empty state speaks.
  const isEmpty = kind !== "loading" && kind !== "error";
  if (add) add.hidden = isEmpty;
  if (nameEl) nameEl.textContent = kind === "loading" ? "Loading your chart…" : isEmpty ? "" : "No active chart yet";
  $("#me-active-badge")?.setAttribute("hidden", "");
  if (status) status.textContent = message || "";
  if (!target) return;
  if (kind === "loading") {
    target.innerHTML = `<div class="me-loading"><p>Loading your chart…</p></div>`;
    return;
  }
  if (kind === "error") {
    target.innerHTML = `<div class="me-empty">
      <h2>We couldn't load this chart</h2>
      <p>${esc(message || "Something went wrong while preparing your reading.")}</p>
      ${retry ? `<button type="button" class="o-btn o-btn--primary" data-action="retry-reading">Try again</button>` : ""}
    </div>`;
    return;
  }
  target.innerHTML = `<div class="me-empty">
    <h2>No active chart yet</h2>
    <p>Create your chart and Orbit Axis will explain every placement in it.</p>
    <button type="button" class="o-btn o-btn--primary" data-action="add-chart">Create your chart</button>
  </div>`;
}

/**
 * Load and render the active chart.
 *
 * Failures are separated on purpose. A fetch that fails is a chart-loading
 * problem the reader can retry; a render that throws is our defect, and
 * reporting it as "check your connection" would hide it for ever. Neither is
 * swallowed.
 */
async function loadChartReading(chartProfile) {
  if (!chartProfile) { renderChartPlaceholder("empty"); return; }
  const token = ++reading.token;
  reading.chartId = chartProfile.id;

  clearChartReading();
  renderChartPlaceholder("loading", { message: `Loading ${chartProfile.nickname || "your chart"}…` });
  const nameEl = $("#mychart-name");
  if (nameEl) nameEl.textContent = chartProfile.nickname || "My Chart";
  const addChart = $("#me-add-chart");
  if (addChart) addChart.hidden = false;   // a chart exists: adding another is a real action again

  let data;
  try {
    data = await get(`/api/charts/${chartProfile.id}`);
  } catch (error) {
    if (token !== reading.token) return;   // superseded — say nothing
    renderChartPlaceholder("error", {
      message: "We couldn't reach your chart just now. Your saved charts are safe.",
      retry: true,
    });
    return;
  }
  if (token !== reading.token) return;     // a newer chart is already loading

  try {
    renderChart(data.chart, data.profile?.nickname || chartProfile.nickname, data.profile, data.reading);
    const status = $("#me-status");
    if (status) status.textContent = `${data.profile?.nickname || chartProfile.nickname || "Your chart"} is ready.`;
    $("#me-active-badge")?.removeAttribute("hidden");
  } catch (error) {
    // A composition or rendering defect. Structured, and carrying no birth data.
    console.error("[orbit] chart reading failed to render", {
      chartId: chartProfile.id, stage: "render", message: error?.message,
    });
    renderChartPlaceholder("error", {
      message: "We couldn't prepare the reading for this chart. This one is on us — please try again.",
      retry: true,
    });
  }
}

// ── Chart switcher ──────────────────────────────────────────────────────────

function renderChartSwitcher() {
  const wrap = $("#chart-switcher");
  const select = $("#chart-switcher-select");
  if (!wrap || !select) return;
  const charts = state.charts || [];
  // A switcher with one option is a control that cannot do anything.
  wrap.hidden = charts.length < 2;
  if (charts.length < 2) { select.innerHTML = ""; return; }
  const active = activeChart();
  select.innerHTML = charts.map((c) =>
    `<option value="${esc(c.id)}"${c.id === active?.id ? " selected" : ""}>${esc(chartOptionLabel(c))}</option>`
  ).join("");
  renderPickerAvatar("#chart-switcher-avatar");
}

function wireChartReading() {
  const panel = $("#panel-me");
  if (!panel || panel._readingWired) return;
  panel._readingWired = true;

  const select = $("#chart-switcher-select");
  select?.addEventListener("change", async (event) => {
    const id = event.target.value;
    const previousId = state.activeChartId;
    if (!id || id === previousId) return;
    select.disabled = true;
    // Clear immediately. Activation is a round trip, and until the new reading
    // arrives the page must not keep showing the previous person's chart under
    // a name the switcher has already changed.
    clearChartReading();
    renderChartPlaceholder("loading", { message: "Switching charts…" });
    try {
      await post(`/api/charts/${id}/activate`, {});
      // loadSavedCharts refreshes state.charts; refreshActiveExperience then
      // re-reads the active chart. refreshData() only refreshes the sky, and
      // calling it here left the previous chart's reading on screen.
      await loadSavedCharts();
      await refreshActiveExperience();
      // Move focus to the page heading so a keyboard or screen-reader user is
      // not left at a stale position in a page that changed underneath them.
      $("#mychart-title")?.focus({ preventScroll: true });
      toast(`${activeChart()?.nickname || "Chart"} is active`);
    } catch (error) {
      state.activeChartId = previousId;
      renderChartSwitcher();
      renderChartPlaceholder("error", {
        message: "We couldn't switch charts just now. Your saved charts are safe.",
        retry: true,
      });
      toast("We couldn't switch charts just now.");
    } finally {
      select.disabled = false;
    }
  });

  panel.addEventListener("click", (event) => {
    const retry = event.target.closest('[data-action="retry-reading"]');
    if (retry) { loadChartReading(activeChart()); return; }
    const edit = event.target.closest("#me-edit-chart");
    if (edit?.dataset.id) {
      // The form needs the chart RECORD; handing it the bare id string left
      // every field blank and, worse, saved as a brand-new chart.
      const chart = state.charts.find((c) => c.id === edit.dataset.id);
      if (chart) openChartForm("edit", chart);
    }
  });
}

// ══ Orbit Axis daily experience ═════════════════════════════════════════════
// Today workspace, Today's Fortune cards, Current Sky (with the procedural Moon),
// History, and the Simple/Advanced detail level. Deterministic fortune comes
// from the server; nothing here calculates astrology. Works in local dev via
// the stateless preview; upgrades to persisted fortunes when signed in.
const AXIS = {
  detail: "Simple",
  lastFortune: null,
  lastSky: null,
  lastHighlights: [],
  lastMoon: null,
  currentTimezoneOverride: null, // session-only, set by "Use my current location"
  // Set once Today has been loaded, so startup doesn't fetch the fortune twice
  // (session restore already loads it for a signed-in returning user).
  loadedOnce: false,
};
// Update Two removed "Balanced". Only two levels remain; Simple is the default.
// Update 5.2: there is one experience, and it is the complete one.
//
// "Simple" hid houses, degrees, retrograde marks, and transit detail behind a
// switch most people never found — so the app looked shallower than it is, and
// the people most likely to leave it on Simple were exactly the ones who needed
// the plain-language explanations that now sit BESIDE the technical facts.
//
// Advanced no longer means "more confusing". It means complete, with help text.
const DETAILS = ["Advanced"];

// Coerce any value (including a legacy "Balanced" left in localStorage, a stale
// cached API response, or an unknown string) to a supported level. Advanced is
// preserved; everything else becomes Simple. Never crashes on bad input.
function normalizeDetail(value) {
  return String(value ?? "").trim().toLowerCase() === "advanced" ? "Advanced" : "Simple";
}
// Which per-factor phrasing key a level reads. Balanced no longer exists, so any
// non-Advanced level (including stale "Balanced") maps to the plain wording.
// Kept as a function so the (many) call sites need no edit, and so a stored
// "Simple" preference from before Update 5.2 resolves to the full experience
// rather than hiding content. The saved value is not deleted — see
// axisLoadDetail — because destroying a user preference to remove a feature is
// worse than ignoring it.
function detailKeyFor(level) {
  void level;              // deliberately ignored: there is only one level now
  return "advanced";
}

// The user's *current* (browsing) timezone — always distinct from a saved
// chart's birth timezone. Never falls back to the server's machine timezone.
function axisResolveTimezone() {
  if (AXIS.currentTimezoneOverride) return AXIS.currentTimezoneOverride;
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch { return "UTC"; }
}

// Best-effort: tell the server the device timezone so /api/fortune/today and
// Current Sky can use it without a query param on every request. No-ops for
// signed-out users (their preview posts carry the timezone directly).
async function axisSyncCurrentTimezone() {
  if (!authSignedIn()) return;
  try { await put("/api/settings/current-timezone", { timezone_name: axisResolveTimezone(), source: "device" }); }
  catch { /* best effort */ }
}

// Request geolocation only on this explicit user action — never on load.
async function axisUseCurrentLocation() {
  const status = $("#current-sky-location-status");
  if (!("geolocation" in navigator)) {
    if (status) status.textContent = "Location isn't available in this browser.";
    return;
  }
  if (status) status.textContent = "Requesting your location…";
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const { timezone_name } = await post("/api/settings/current-location", {
          latitude: position.coords.latitude, longitude: position.coords.longitude,
        });
        AXIS.currentTimezoneOverride = timezone_name;
        if (status) status.textContent = `Using your current location's timezone (${timezone_name}).`;
        await axisLoadToday();
      } catch {
        if (status) status.textContent = "Could not resolve a timezone for that location.";
      }
    },
    () => { if (status) status.textContent = "Location permission denied — using your device timezone instead."; },
    { timeout: 8000 },
  );
}

function axisGetBirth() {
  try { return JSON.parse(localStorage.getItem("oa_birth") || "null"); } catch { return null; }
}
function axisSetBirth(b) { localStorage.setItem("oa_birth", JSON.stringify(b)); }

async function axisLoadDetail() {
  // Update 5.2: the stored preference is READ but no longer obeyed. Anyone who
  // saved "Simple" before this update gets the complete experience without
  // having to find a setting and change it.
  //
  // The stored value is left alone rather than rewritten or deleted. It costs
  // nothing to keep, and silently overwriting a preference somebody set is a
  // worse habit than ignoring one that no longer applies. The Supabase column
  // is likewise retained and simply unused — see the deprecation note in the
  // vault.
  AXIS.detail = "Advanced";
  axisApplyDetail(false);
}
function axisApplyDetail(rerender = true) {
  // The attribute stays: some CSS still keys off it, and pinning it to Advanced
  // is what makes those rules always apply.
  document.documentElement.setAttribute("data-detail", "Advanced");
  if (rerender) {
    if (AXIS.lastFortune) axisRenderFortune(AXIS.lastFortune);
    if (AXIS.lastSky) axisRenderSky(AXIS.lastSky, { highlights: AXIS.lastHighlights, moon: AXIS.lastMoon });
  }
}
async function axisSetDetail(level) {
  const next = normalizeDetail(level);
  AXIS.detail = next;
  axisApplyDetail(true);
  try {
    await put("/api/settings/detail", { astrology_detail_level: next });
  } catch { /* best effort */ }
}

/**
 * Clear only the chart-dependent half of Home.
 *
 * Sky-only sections stay exactly where they are. Blanking them on a chart
 * switch would make the whole page flash for a change that does not affect
 * them, and the Moon does not care whose chart is active.
 */
function axisClearPersonalReading() {
  AXIS.lastFortune = null;
  const el = $("#today-fortune");
  if (el) {
    el.innerHTML = `<div class="axis-shimmer" style="height:240px" role="status" aria-live="polite" aria-label="Loading your reading"></div>`;
  }
  const secondary = $("#today-secondary");
  if (secondary) secondary.hidden = true;
}

function axisWireChartPicker() {
  const select = $("#today-chart-select");
  if (!select || select._axisWired) return;
  select._axisWired = true;
  select.addEventListener("change", async (event) => {
    const id = event.target.value;
    const previousId = state.activeChartId;
    if (!id || id === previousId) return;
    select.disabled = true;
    // The chart NAME updates as soon as the new chart is active, but the
    // fortune is a second round trip. Without this the old reading sits under
    // the new name for as long as that takes — the same stale-content defect
    // My Chart had. Only the personal reading is cleared: the Moon and the sky
    // highlights describe the sky, not the chart, and must not flicker.
    axisClearPersonalReading();
    try {
      await post(`/api/charts/${id}/activate`, {});
      await loadSavedCharts();
      await refreshActiveExperience();
      toast(`${activeChart()?.nickname || "Chart"} is active`);
    } catch (error) {
      event.target.value = previousId;
      toast(error.message);
    } finally {
      select.disabled = state.charts.length <= 1;
    }
  });
}

// Event delegation on the (stable) mount points below — their innerHTML is
// replaced on every render, but the elements themselves persist, so wiring
// once here keeps working across re-renders without rebinding listeners.
//
// The fortune needs no wiring any more. Update 5.2 replaced the carousel with
// cards, so there are no arrows, dots, arrow-key handlers, or swipe thresholds
// left to bind — the whole interaction is scrolling, which the browser already
// does.

function axisWireSkyControls() {
  const root = $("#today-sky");
  if (!root || root._axisWired) return;
  root._axisWired = true;
  root.addEventListener("click", (event) => {
    if (event.target.closest("#current-sky-use-location")) axisUseCurrentLocation();
  });
}

async function axisInit() {
  if (!$("#panel-home")) return;
  const today = new Date();
  $("#today-date").textContent = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  for (const btn of $$(".axis-detail button")) {
    btn.addEventListener("click", () => axisSetDetail(btn.dataset.level));
  }
  const scope = $("#history-scope");
  if (scope) scope.addEventListener("change", () => axisLoadHistory(scope.value));
  // History loads from renderRoute(), and ONLY from renderRoute().
  //
  // There used to be a second hashchange listener here doing the same thing.
  // Both fired on the same navigation, both fetched, and both rendered into
  // #history-body — so whichever response landed second replaced the DOM the
  // first had already finished with. Harmless while nothing touched that DOM
  // afterwards; not harmless once the week strip started asking History to open
  // a specific entry, because the second render wiped it back shut.
  //
  // Two loaders for one page is one more than the number that can be right.

  axisWireChartPicker();
  axisWireSkyControls();
  wireDayStrip();
  await axisSyncCurrentTimezone();
  axisLoadDetail();
  // A signed-in returning user already had Today loaded during session restore;
  // loading it again here would double every startup request.
  if (!AXIS.loadedOnce) axisLoadToday();
  // One history request, two surfaces: the week strip on Today and the History
  // page itself. It runs whichever page you landed on, because the strip is
  // part of Today and Today is where most people land.
  axisLoadHistory($("#history-scope")?.value || "active");
}

// ── Today ────────────────────────────────────────────────────────────────────
async function axisLoadToday() {
  AXIS.loadedOnce = true;
  // Sky (incl. the Moon) always renders — it doesn't need a saved chart.
  const tz = axisResolveTimezone();
  // The sky and the personal reading fail independently. A sky failure used to
  // be swallowed by `.catch(() => {})`, which left the shimmer placeholder in
  // place for ever — an indefinite spinner that looked like a slow network and
  // was actually a dead section.
  const kSky = `sky::${tz}::${localDayKey(tz)}`;
  const applySky = (r) => {
    AXIS.lastSky = r.sky;
    AXIS.lastHighlights = r.highlights || [];
    AXIS.lastMoon = r.moon || null;
    try {
      axisRenderSky(r.sky, { highlights: r.highlights, moon: r.moon });
    } catch (error) {
      // A render defect is ours, and must not be reported as a network problem.
      console.error("[orbit] current sky failed to render", { stage: "render", message: error?.message });
      axisRenderSkyError("We couldn't show the current sky just now.");
    }
  };
  // Cache first — but only when nothing live is on screen yet. On a re-load
  // the previous live sky is still painted, and covering it with an older
  // cached one would move the page backwards.
  let skyFromCache = false;
  cacheGet(kSky)
    .then(hit => { if (hit && !AXIS.lastSky) { skyFromCache = true; applySky(hit.value); } })
    .catch(muffleEarly);
  // The boot-kicked request, consumed exactly once; every later refresh
  // fetches its own.
  const skyPre = AXIS.preSky; AXIS.preSky = null;
  (skyPre ?? get(`/api/sky/current?tz=${encodeURIComponent(tz)}`))
    .then(r => { void cachePut(kSky, r); applySky(r); })
    .catch(() => { if (!skyFromCache && !AXIS.lastSky) axisRenderSkyError("We couldn't reach the current sky just now."); });

  // Fortune: prefer the signed-in path; fall back to a local preview.
  // Skipped entirely when signed out. The endpoint is authenticated and a daily
  // reading is written against a saved chart, so there is nothing to find — the
  // catch below already handled the 401, but asking produced one logged failure
  // per page view for every visitor who has not signed up, which is now most of
  // them. Not asking is both quieter and faster.
  let fortuneCachedAt = null;
  try {
    if (!authSignedIn()) throw new Error("signed out");
    // The reading's cache key carries the chart, the reader's local day, and
    // the timezone — change any of them and this is a different reading.
    const kFortune = `fortune::${state.activeChartId || "active"}::${localDayKey(tz)}::${tz}`;
    try {
      const hit = await cacheGet(kFortune);
      if (hit?.value?.fortune) {
        fortuneCachedAt = hit.savedAt;
        AXIS.lastFortune = hit.value.fortune;
        axisShowReadingFor(hit.value.chart?.nickname || "My Chart");
        axisRenderFortune(hit.value.fortune);
        cacheNote(fortuneCachedAt);
        refreshSecondaryRoute();
      }
    } catch { /* the cache is a courtesy */ }
    const r = await get("/api/fortune/today");
    void cachePut(kFortune, r);
    AXIS.lastFortune = r.fortune;
    axisShowReadingFor(r.chart?.nickname || "My Chart");
    axisRenderFortune(r.fortune);
    cacheNote(null);
    refreshSecondaryRoute();
    return;
  } catch { /* signed out, no active chart, or a transient fortune failure */
    if (fortuneCachedAt != null) {
      // The cached reading is on screen and the refresh failed. Keeping it,
      // saying so, and NOT falling through to the setup messages below — a
      // reading must never be replaced by an apology for one.
      cacheNote(fortuneCachedAt, { failed: true });
      return;
    }
  }

  if (authSignedIn()) {
    // A failed *fortune* request says nothing about whether the account has a
    // chart. Onboarding is owned solely by resolveChartState() — never opened
    // from here, or a slow/failed fortune would re-onboard a returning user.
    if (state.chartsStatus === "error") {
      return axisRenderSetup("We couldn't load your charts just now. Use “Try again” above — your saved charts are safe.");
    }
    if (state.charts.length) {
      return axisRenderSetup("Your daily reading couldn't load just now. It will return on the next refresh.");
    }
    return axisRenderSetup("Save My Chart to unlock your daily reading. Your chart and reading history are stored in Supabase so they can follow your account.");
  }

  const birth = axisGetBirth();
  if (!birth) return axisRenderSetup();
  try {
    const r = await post("/api/fortune/preview", { ...birth, current_timezone_name: tz });
    AXIS.lastFortune = r.fortune;
    axisShowReadingFor(birth.nickname || "My Chart");
    axisRenderFortune(r.fortune);
    refreshSecondaryRoute();
  } catch (e) {
    $("#today-fortune").innerHTML = `<div class="fortune-card"><h2>Today’s Fortune</h2><p class="fortune-card__sub">${esc(e.message)}</p></div>`;
  }
}

/**
 * The sky section's own failure state.
 *
 * Separate from the fortune's, because they are separate requests: one can
 * fail while the other succeeds, and the whole page must not go down for
 * either. Carries a retry and no private data.
 */
function axisRenderSkyError(message) {
  const el = $("#today-sky");
  if (!el) return;
  el.innerHTML = `<div class="axis-section-error" role="status">
    <p>${esc(message)}</p>
    <button type="button" class="o-btn o-btn--secondary o-btn--sm" data-action="retry-sky">Try again</button>
  </div>`;
}

function axisShowReadingFor(name) {
  // The visible "Reading for" eyebrow is gone — the select beneath the reading
  // already names the chart. The screen-reader label stays, because the select
  // is the only thing naming it and a bare combobox announces nothing useful.
  const el = $("#today-chart-name");
  if (el) el.textContent = name;
  setActiveChartName(name);
}

/* ── Today's Fortune: cards, not slides ────────────────────────────────────
   The carousel is gone. It hid four of five readings behind a swipe nobody
   discovers, and on a phone the only affordance was a row of dots. Everything
   the fortune has to say is now visible by scrolling, which is the one
   interaction every user already knows.

   The split that makes this work already existed in the engine: `mood`,
   `love_reading`, `luck_reading`, and `watch_out` are plain-language readings,
   while `factors[].advanced` carries the technical phrasing. So the fortune
   says what the day may feel like, and Technical Sky below it says why —
   without the fortune ever naming a planet. */

/** The reading cards, in the order they are read. */
function axisFortuneCards(F) {
  return [
    {
      id: "mood",
      label: "Overall",
      lede: "What today may feel like",
      body: F.mood,
      primary: true,
    },
    { id: "love", label: "Connection", lede: "Relationships and communication", body: F.love_reading },
    { id: "luck", label: "Momentum", lede: "Where things may open up", body: F.luck_reading },
    { id: "watch", label: "Watch for", lede: "What may create friction", body: F.watch_out, caution: true },
  ].filter((card) => typeof card.body === "string" && card.body.trim().length > 0);
}

/**
 * A short closing direction, assembled from the readings themselves.
 *
 * Deliberately derived rather than generated: it restates what the deterministic
 * engine already produced. Inventing a new sentence here would be the one place
 * in Orbit where reading text was not traceable to engine evidence.
 */
function axisFortuneClosing(F) {
  const bits = [];
  if (F.lucky_number != null) bits.push(`Lucky number ${F.lucky_number}`);
  if (F.lucky_color?.name) bits.push(F.lucky_color.name);
  return bits.join(" · ");
}

function axisRenderFortune(F) {
  const cards = axisFortuneCards(F);
  const closing = axisFortuneClosing(F);
  const dateLabel = axisFortuneDate(F);

  // The title sits ABOVE the cards, so the day has a name before it has detail.
  const heading = `
    <header class="fortune-head">
      <p class="fortune-head__eyebrow">Today’s Fortune</p>
      <p class="fortune-head__date">${esc(dateLabel)}</p>
      <h2 class="fortune-head__title">${esc(F.mood_headline || axisFortuneTitle(F))}</h2>
      <p class="fortune-head__note">Symbolic reflection, never prediction.</p>
    </header>`;

  const slides = cards.map((card, index) => `
    <article class="fortune-card2${card.primary ? " fortune-card2--primary" : ""}${card.caution ? " fortune-card2--caution" : ""}"
             id="fortune-card-${esc(card.id)}"
             role="group"
             aria-roledescription="card"
             aria-label="${esc(card.label)}, ${index + 1} of ${cards.length}">
      <!-- Reserved for the artwork that is coming. Empty and zero-height until
           there is something to put in it, so the deck does not sit on a band
           of nothing in the meantime. -->
      <div class="fortune-card2__art" data-card="${esc(card.id)}" aria-hidden="true"></div>
      <h3 class="fortune-card2__label">${esc(card.label)}</h3>
      <p class="fortune-card2__lede">${esc(card.lede)}</p>
      <p class="fortune-card2__body">${esc(card.body)}</p>
    </article>`).join("");

  const dots = cards.map((card, index) => `
    <button type="button" class="fortune-dot${index === 0 ? " is-current" : ""}"
            data-goto="${index}" aria-label="${esc(card.label)}"></button>`).join("");

  $("#today-fortune").innerHTML = `
    <section class="fortune" aria-labelledby="fortune-title">
      ${heading.replace('class="fortune-head__title"', 'class="fortune-head__title" id="fortune-title"')}
      <div class="fortune-deck">
        <div class="fortune-deck__track" id="fortune-track"
             tabindex="0" role="region" aria-label="Your reading, ${cards.length} cards. Scroll sideways, or use the left and right arrow keys.">
          ${slides}
        </div>
        <div class="fortune-deck__dots" id="fortune-dots" role="tablist" aria-label="Reading cards">${dots}</div>
      </div>
      ${closing ? `<p class="fortune-closing">${esc(closing)}</p>` : ""}
    </section>`;

  wireFortuneDeck(cards.length);
}

/* ── The reading deck ──────────────────────────────────────────────────────
   Built on CSS scroll-snap rather than a JS drag implementation. That is not
   laziness: scroll-snap gets native momentum and rubber-banding on iOS, works
   with a trackpad, a mouse wheel, a screen reader's own scrolling, and the
   keyboard, all without a pointer handler that can drop a touch mid-gesture.

   THE OBJECTION THIS HAS TO ANSWER. A carousel lived here before and was
   removed for a stated reason: it "hid four of five readings behind a swipe
   nobody discovers, and on a phone the only affordance was a row of dots".
   That is a real failure and this is the same shape, so it is answered
   deliberately:

     · every card is REAL CONTENT in the DOM, always — nothing is created on
       demand, so find-in-page, a screen reader, and Reader-style tooling all
       still reach every word
     · the track shows a PEEK of the next card at every width, so the fact
       that there is more is visible rather than implied by dots
     · the dots are a secondary affordance, not the only one, and they are
       real buttons that move the track

   If the peek is ever removed, the objection comes straight back. */
function wireFortuneDeck(count) {
  const track = $("#fortune-track");
  const dots = $("#fortune-dots");
  if (!track || !dots || count <= 0) return;

  const cards = [...track.querySelectorAll(".fortune-card2")];

  const markCurrent = (index) => {
    [...dots.querySelectorAll(".fortune-dot")].forEach((dot, i) => {
      dot.classList.toggle("is-current", i === index);
      dot.setAttribute("aria-current", i === index ? "true" : "false");
    });
  };

  const scrollTo = (index) => {
    const card = cards[Math.min(Math.max(index, 0), cards.length - 1)];
    if (!card) return;
    // scrollIntoView would also scroll the PAGE to bring the deck into view,
    // which yanks the reader somewhere they did not ask to go. Setting
    // scrollLeft moves only the track.
    track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: "smooth" });
  };

  dots.addEventListener("click", (event) => {
    const dot = event.target.closest("[data-goto]");
    if (dot) scrollTo(Number(dot.dataset.goto));
  });

  // Which card is current follows the SCROLL rather than the taps, so a swipe,
  // a wheel, and a dot press all keep the dots honest.
  //
  // Computed synchronously rather than inside requestAnimationFrame. Orbit
  // bans rAF in the client outright — animation is CSS, paused by a class,
  // never JavaScript doing frame work — and a scroll throttle is close enough
  // to that shape to be worth not arguing about. It costs nothing: the loop is
  // four cards of arithmetic, and the browser already rate-limits scroll.
  track.addEventListener("scroll", () => {
    const middle = track.scrollLeft + track.clientWidth / 2;
    let nearest = 0;
    let best = Infinity;
    cards.forEach((card, i) => {
      const centre = card.offsetLeft - track.offsetLeft + card.clientWidth / 2;
      const distance = Math.abs(centre - middle);
      if (distance < best) { best = distance; nearest = i; }
    });
    markCurrent(nearest);
  }, { passive: true });

  track.addEventListener("keydown", (event) => {
    const current = [...dots.querySelectorAll(".fortune-dot")]
      .findIndex((dot) => dot.classList.contains("is-current"));
    if (event.key === "ArrowRight") { scrollTo(current + 1); event.preventDefault(); }
    if (event.key === "ArrowLeft") { scrollTo(current - 1); event.preventDefault(); }
  });

  markCurrent(0);
}

/** A human date, falling back to the raw value rather than showing nothing. */
function axisFortuneDate(F) {
  return formatLocalDateKey(F.fortune_date || "");
}

function formatLocalDateKey(raw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const [y, m, d] = raw.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * A short title for the day, taken from the opening clause of the overall
 * reading. Derived, never invented — and never technical, because `mood` is
 * already plain language.
 */
/**
 * The reading's title.
 *
 * Deliberately NOT derived from the mood text. The old version cut the mood at
 * its first comma, which works when the comma separates clauses and fails when
 * it separates coordinate adjectives: "A reflective, share-what-you've-learned
 * kind of day" became the headline "A reflective". Tightening the heuristic
 * only moved the failure — "A steady, grounded day" breaks the same way — and
 * the whole approach was trying to do grammar with string splitting.
 *
 * It was also a truncated copy of the Overall card immediately beneath it. So
 * the title names the reading, and the mood is printed once, in full, in the
 * card written for it. The engine supplies no headline field, and writing one
 * here would be the only place in Orbit where reading text is not traceable to
 * engine evidence.
 */
function axisFortuneTitle() {
  return "Your reading for today";
}

// ── Current Sky: one unified panel (Moon + Sun + season + local time) ──────
function axisRenderSky(sky, extras = {}) {
  if (!sky || !$("#today-sky")) return;

  // The visible day is the fortune's local-day key, never a UTC date.
  const localDateLabel = formatLocalDateKey(sky.local_date || "");
  if (localDateLabel) {
    $("#today-date").textContent = localDateLabel;
    $("#topnav-date").textContent = new Date(`${sky.local_date}T12:00:00.000Z`)
      .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  }
  const tzLabel = sky.timezone_name ? `Based on ${sky.timezone_name} local time` : "";
  const tzEl = $("#today-timezone");
  if (tzEl) { tzEl.textContent = tzLabel; tzEl.hidden = !tzLabel; }

  axisRenderMoon(extras.moon || null, sky);
  axisRenderHighlights(extras.highlights || []);
  axisRenderTechnicalSky(sky);
}

/**
 * The Moon, from the server-composed `moonState()`.
 *
 * This section is about the CURRENT transiting Moon and says so. The natal
 * Moon belongs to My Chart and depends on a birth time; this one depends on
 * nothing but the clock, so it stays available on every chart including
 * unknown-time ones.
 */
function axisRenderMoon(moon, sky) {
  const section = $("#today-moon");
  const body = $("#today-moon-body");
  if (!section || !body) return;
  if (!moon) { section.hidden = true; body.innerHTML = ""; return; }
  section.hidden = false;

  const scene = sceneInputs(moon);
  // No canonical phase means no Moon drawn. Rendering a default disc here
  // would look identical to a working scene while being wrong.
  const visual = scene ? moonSceneHtml(scene) : moonSceneUnavailableHtml();

  const illum = illuminationLabel(moon.illumination);
  const next = moon.nextEvent
    ? `<p class="moon-state__next">Next ${esc(moon.nextEvent.kind)} ${esc(moon.nextEvent.when)}.</p>`
    : `<p class="moon-state__next">The next lunar event isn’t available right now.</p>`;

  body.innerHTML = `
    <div class="moon-state">
      ${visual}
      <div class="moon-state__text">
        <p class="moon-state__phase">${
          // Without a phase name the " in Pisces" suffix used to render on its
          // own, leaving a heading that began mid-sentence.
          moon.phase
            ? `${esc(moon.phase)}${moon.sign ? ` in ${esc(moon.sign)}` : ""}`
            : (moon.sign ? `The Moon in ${esc(moon.sign)}` : "The Moon right now")
        }</p>
        ${moon.phase ? "" : `<p class="moon-state__facts">The phase name isn’t available right now.</p>`}
        <p class="moon-state__facts">${
          [illum, moon.direction].filter(Boolean).map(esc).join(" · ")
        }</p>
        <p class="moon-state__meaning">${esc(moon.meaning)}</p>
        ${next}
        <!-- Both caveats, in ONE line of small print rather than two
             paragraphs. Trimmed on request, but not dropped: the drawing shows
             a Moon that is not oriented the way you would actually see it, and
             saying so is the difference between a simplification and a picture
             that quietly misleads. -->
        <p class="moon-state__note">Not your birth chart's Moon. ${esc(ORIENTATION_NOTE)}</p>
        <div class="moon-state__actions">
          <a class="o-btn o-btn--secondary o-btn--sm" href="#positions">View Current Positions</a>
        </div>
      </div>
    </div>`;
  moonMaybeShootingStar();
}

/**
 * The scene. Every layer inside is decorative and hidden from assistive
 * technology: the phase, illumination and direction are all stated as text in
 * the panel beside it, so exposing forty-six stars and a clipped disc to a
 * screen reader would add noise and no information.
 */
function moonSceneHtml(scene) {
  const stars = starField().map((s) => `<span class="moon-scene__star" style="left:${s.x}%;top:${s.y}%;width:${s.r * 2}px;height:${s.r * 2}px;opacity:${s.o};animation-delay:${s.delay}ms"></span>`).join("");
  const svg = renderMoonSVG({
    illumination: scene.illumination, waxing: scene.waxing, phaseName: scene.phase,
  });
  return `
    <div class="moon-scene" aria-hidden="true">
      <div class="moon-scene__sky"></div>
      <div class="moon-scene__stars">${stars}</div>
      <div class="moon-scene__shoot" id="moon-shoot" hidden></div>
      <div class="moon-scene__moon">${svg}</div>
      <div class="moon-scene__earth" id="moon-earth"></div>
    </div>`;
}

/**
 * The scene keeps its shape when the Moon is unavailable, so the card does not
 * collapse and the page does not jump. It shows sky and Earth — the frame —
 * and deliberately no disc.
 */
function moonSceneUnavailableHtml() {
  return `
    <div class="moon-scene moon-scene--empty" aria-hidden="true">
      <div class="moon-scene__sky"></div>
      <div class="moon-scene__earth"></div>
    </div>`;
}

/**
 * One shooting star per browser session.
 *
 * Bound to sessionStorage rather than a module flag so that navigating away
 * and back does not replay it, and a refresh does not either. If storage is
 * unavailable — private modes, blocked storage — the effect is skipped
 * entirely rather than shown every time.
 */
function moonMaybeShootingStar() {
  const el = $("#moon-shoot");
  if (!el) return;
  // Two ways to ask for less motion, and both must count. The OS preference is
  // the obvious one; Orbit's own Motion setting is the one a user actually
  // clicked. Checking only the media query meant someone who chose "Reduced"
  // in Settings still had the star revealed — and, worse, silently spent their
  // one-per-session marker on an effect they had asked not to see.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  if (document.documentElement.dataset.motion === "reduced") return;
  let seen = true;
  try {
    seen = sessionStorage.getItem(SHOOTING_STAR_KEY) === "1";
    if (!seen) sessionStorage.setItem(SHOOTING_STAR_KEY, "1");
  } catch {
    return;   // storage unavailable: no marker means no way to show it once
  }
  if (seen) return;
  el.hidden = false;
  el.classList.add("is-flying");
}

/**
 * Refreshing the sky, with the Earth turn bound to the request lifecycle.
 *
 * The motion is evidence that something is happening, not decoration that runs
 * regardless: it starts when the request starts and is removed in a `finally`,
 * so a failure cannot leave the Earth turning for ever. `MOON.refreshing`
 * blocks a second request rather than queuing one, because two in-flight sky
 * loads can resolve out of order and paint the older one last.
 */
const MOON = { refreshing: false };

/** Milliseconds after which a rendered sky is worth re-reading on return. */
const MOON_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Re-read the sky if what is on screen has had time to stop being "now".
 *
 * Silent by design: this is not something the reader asked for, so it must not
 * announce itself, and a failure leaves the previous Moon in place — it is
 * still true as of its own timestamp.
 */
function moonRefreshIfStale() {
  if (MOON.refreshing) return;
  if ($("#today-moon")?.hidden) return;
  const age = Date.now() - (MOON.syncedAt || 0);
  if (age < MOON_STALE_AFTER_MS) return;
  void moonRefreshSky({ quiet: true });
}

async function moonRefreshSky({ quiet = false } = {}) {
  if (MOON.refreshing) return;
  const earth = $("#moon-earth");
  MOON.refreshing = true;
  earth?.classList.add("is-turning");
  if (!quiet) moonStatus("Refreshing the current sky…");
  try {
    const tz = axisResolveTimezone();
    const r = await get(`/api/sky/current?tz=${encodeURIComponent(tz)}`);
    AXIS.lastSky = r.sky;
    AXIS.lastHighlights = r.highlights || [];
    AXIS.lastMoon = r.moon || null;
    axisRenderSky(r.sky, { highlights: r.highlights, moon: r.moon });
    MOON.syncedAt = Date.now();
    if (!quiet) moonStatus("The current sky is up to date.");
    else moonStatus("");
  } catch {
    // The previously rendered Moon is still on screen and still true as of its
    // own timestamp, so it stays. Replacing it with an error would throw away
    // good data because a later request failed.
    if (!quiet) moonStatus("We couldn't refresh the sky just now. The Moon shown above is from the last successful reading.");
  } finally {
    MOON.refreshing = false;
    // Re-read: axisRenderSky replaces the scene, so the element may be new.
    $("#moon-earth")?.classList.remove("is-turning");
    earth?.classList.remove("is-turning");
  }
}

function moonStatus(text) {
  const el = $("#moon-status");
  if (el) el.textContent = text || "";
}

/** Ranked sky highlights, composed and ordered on the server. */
function axisRenderHighlights(highlights) {
  const section = $("#today-highlights");
  const body = $("#today-highlights-body");
  if (!section || !body) return;
  if (!highlights.length) { section.hidden = true; body.innerHTML = ""; return; }
  section.hidden = false;
  body.innerHTML = `<ul class="sky-highlights">${highlights.map((h) => `
    <li class="sky-highlight sky-highlight--${esc(h.kind)}">
      <span class="sky-highlight__label">${esc(h.label)}</span>
      <span class="sky-highlight__detail">${esc(h.detail)}</span>
      <a class="sky-highlight__link" href="${esc(h.href)}">${
        h.href === "#symbol-atlas" ? "Learn about this sign" : "See the transit details"
      }</a>
    </li>`).join("")}</ul>`;
}

/**
 * Technical Sky: a compact banner and a folded disclosure.
 *
 * The full body-by-body positions table used to render here. It is the densest
 * content in the product and it sat on the page people open first — and it is
 * the Positions workspace, which Dev Update 1.7 owns. Home now states the two
 * positions a reader actually asks for and links to the workspace that carries
 * the rest.
 */
function axisRenderTechnicalSky(sky) {
  const el = $("#today-sky");
  if (!el) return;
  // Degrees, not sign names. "Leo season" is already stated once in the
  // highlights above, and an earlier update deliberately removed the second
  // telling of that same fact. What a technical section adds is PRECISION —
  // 8°14′ Leo is a different statement from "Leo season", not a repeat of it.
  const pos = (b) => `${b.degrees}°${String(b.minutes).padStart(2, "0")}′ ${b.sign}`;
  const sun = sky.sun ? `Sun ${pos(sky.sun)}` : "";
  const moon = sky.moon ? `Moon ${pos(sky.moon)}` : "";
  const updated = sky.local_time_iso
    ? new Date(sky.local_time_iso).toLocaleString("en-US",
        { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
  const retro = (sky.retrogrades || []).filter(Boolean);
  el.innerHTML = `
    <section class="tech-sky" aria-labelledby="tech-sky-title">
      <div class="tech-sky__head">
        <div class="tech-sky__heading">
          <h2 class="axis-section-title" id="tech-sky-title">Technical Sky</h2>
          <p class="tech-sky__summary">${[sun, moon].filter(Boolean).map(esc).join(" · ")}</p>
        </div>
        <img class="orbit-instrument" src="/brand/orbit-axis-instrument.svg" alt="" aria-hidden="true" />
      </div>
      <details class="tech-sky__more">
        <summary><span>How this was calculated</span></summary>
        <div class="tech-sky__body">
          <dl class="tech-sky__facts">
            ${sun ? `<div><dt>Sun</dt><dd>${esc(pos(sky.sun))}</dd></div>` : ""}
            ${moon ? `<div><dt>Moon</dt><dd>${esc(pos(sky.moon))}</dd></div>` : ""}
            ${sky.timezone_name ? `<div><dt>Local time</dt><dd>${esc(sky.timezone_name)}</dd></div>` : ""}
            ${updated ? `<div><dt>Calculated</dt><dd>${esc(updated)}</dd></div>` : ""}
            ${retro.length ? `<div><dt>Retrograde</dt><dd>${esc(retro.join(", "))}</dd></div>` : ""}
          </dl>
          <p class="tech-sky__help">Every position on this page is calculated by Orbit’s own astronomy engine. Nothing here is written by an AI model.</p>
          <a class="o-btn o-btn--secondary o-btn--sm" href="#positions">See every position in Current Positions</a>
        </div>
      </details>
      <!-- The refine-by-location control resolves the timezone server-side,
           against an authenticated endpoint. Offered signed-out it would ask
           for the browser's location permission and then fail with "Could not
           resolve a timezone" — a permission prompt spent on nothing. The
           device timezone is already correct for almost everyone, so the
           sentence stands alone and the button waits for an account. -->
      <div class="current-sky__location">
        <span class="u-caption" id="current-sky-location-status">${authSignedIn()
          ? "Using your device timezone. Sharing your location can refine this to where you are right now."
          : "Using your device timezone."}</span>
        ${authSignedIn()
          ? `<button type="button" class="o-btn o-btn--ghost o-btn--sm" id="current-sky-use-location">Use my current location</button>`
          : ""}
      </div>
    </section>`;
}

/**
 * Home's "you have no chart yet" state.
 *
 * This used to be a third chart form, injected here with its own field ids. It
 * could not work for the audience that saw it most: a signed-out visitor has no
 * account to save a chart to, and birthplace search requires a session, so the
 * form's only possible outcome for them was an error under the Save button.
 *
 * It is now a call to action that opens the one real form. The signed-out
 * branch used to end the conversation here — "Sign in first" is a fact about
 * our architecture, not an offer, and it left the single highest-intent moment
 * in the app with nothing to click. Both branches now lead somewhere: signed in
 * to the form, signed out to the prompt that unlocks it.
 *
 * This card sits directly under a reading the visitor has just found accurate
 * about the shared sky, which is the whole argument for the personal one. It
 * says what they get, not what we require.
 */
function axisRenderSetup(message = "Orbit Axis reads today's sky against your birth chart. Create one and your daily reading appears here.") {
  const signedIn = authSignedIn();
  $("#today-fortune").innerHTML = `
    <div class="fortune-card">
      <h2>${signedIn ? "Create your birth chart" : "This is the sky everyone shares"}</h2>
      <div class="fortune-setup">
        <p>${esc(signedIn ? message : "Add your birth date, time and place, and Orbit Axis reads today against the sky the day you were born — not against your sun sign.")}</p>
        <button type="button" class="o-btn o-btn--primary" id="oa-open-chart-form">
          ${signedIn ? "Create your birth chart" : "Create my chart — free"}
        </button>
        ${signedIn ? "" : `<p class="fortune-card__sub">Takes about a minute. No card, and you can export or delete everything at any time.</p>`}
      </div>
    </div>`;
  $("#oa-open-chart-form")?.addEventListener("click", () => {
    // The account is what the chart form needs, so the ask happens here rather
    // than under a Save button the visitor can only reach by filling in a form
    // that was never going to succeed.
    if (!requireAccount("chart")) return;
    openChartForm(state.charts.length === 0 ? "first" : "add");
  });
}

/* ── The week strip ───────────────────────────────────────────────────────
   Seven days ending today, across the top of Today.

   WHAT IT IS BUILT FROM. Your own reading history, and nothing else. A day is
   shown as readable only when Orbit Axis actually wrote you a reading that day;
   the rest say so and are not tappable, because a control that opens nothing
   reads as a bug and teaches people to stop trusting the row.

   WHAT IT IS NOT. It is not a date picker for the chart engine. Orbit Axis
   calculates today's sky, not an arbitrary day's, so offering tomorrow would be
   offering something the app cannot deliver. Seven days back, ending now. */
const DAY_STRIP = { days: [], pendingDate: null };

/** Local-midnight date key, matching how the API stores fortune_date. */
function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function axisRenderDayStrip(fortunes = []) {
  const strip = $("#today-days");
  if (!strip) return;

  // The history endpoint returns entries for whichever charts the scope covers;
  // one reading per day per chart. A day counts as "read" if anything landed on
  // it for the chart currently being shown.
  const byDate = new Map();
  for (const f of fortunes) {
    const key = String(f.fortune_date || "").slice(0, 10);
    if (key && !byDate.has(key)) byDate.set(key, f);
  }

  const today = new Date();
  const todayKey = dayKey(today);
  DAY_STRIP.days = [];
  for (let back = 6; back >= 0; back -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - back);
    const key = dayKey(date);
    DAY_STRIP.days.push({
      key,
      isToday: key === todayKey,
      letter: date.toLocaleDateString("en-US", { weekday: "narrow" }),
      weekday: date.toLocaleDateString("en-US", { weekday: "long" }),
      number: date.getDate(),
      long: date.toLocaleDateString("en-US", { month: "long", day: "numeric" }),
      reading: byDate.get(key) || null,
    });
  }

  strip.innerHTML = DAY_STRIP.days.map((day) => {
    // Three states, and each one says what it is to a screen reader rather than
    // relying on the dot: today, a day you have a reading for, and a day you do
    // not.
    const state = day.isToday ? "today" : day.reading ? "read" : "empty";
    const label = day.isToday
      ? `Today, ${day.long}`
      : day.reading
        ? `${day.weekday} ${day.long} — open your reading`
        : `${day.weekday} ${day.long} — no reading saved`;
    const inner = `
      <span class="day-strip__letter" aria-hidden="true">${esc(day.letter)}</span>
      <span class="day-strip__num" aria-hidden="true">${day.number}</span>
      <span class="day-strip__dot" aria-hidden="true"></span>`;
    if (day.isToday) {
      return `<span class="day-strip__day" data-state="${state}" aria-current="date" aria-label="${esc(label)}">${inner}</span>`;
    }
    if (day.reading) {
      return `<button type="button" class="day-strip__day" data-state="${state}" data-date="${esc(day.key)}" aria-label="${esc(label)}">${inner}</button>`;
    }
    return `<span class="day-strip__day" data-state="${state}" aria-label="${esc(label)}">${inner}</span>`;
  }).join("");

  strip.hidden = false;
}

/** Opening a past day means opening that reading, not a list it appears in. */
function wireDayStrip() {
  const strip = $("#today-days");
  if (!strip || strip._wired) return;
  strip._wired = true;
  strip.addEventListener("click", (event) => {
    const day = event.target.closest("[data-date]");
    if (!day) return;
    DAY_STRIP.pendingDate = day.dataset.date;
    navigate("history");
  });
}

/**
 * Open and focus the entry the week strip asked for, once History has rendered.
 *
 * A date that is not in the rendered list is not an error worth reporting —
 * scope may have been switched to a different chart — so it is simply dropped.
 */
function openPendingHistoryEntry() {
  const key = DAY_STRIP.pendingDate;
  if (!key) return;
  DAY_STRIP.pendingDate = null;
  const entry = $(`#history-body [data-date="${CSS.escape(key)}"]`);
  if (!entry) return;
  entry.open = true;
  entry.scrollIntoView({ block: "center", behavior: "smooth" });
  entry.querySelector("summary")?.focus?.({ preventScroll: true });
}

// ── History ──────────────────────────────────────────────────────────────────
/* ── History: two kinds of reading ────────────────────────────────────────
   Astrology history and Tarot history answer different questions from
   different evidence, so they are separate views rather than one merged list.
   The seven-day strip is deliberately untouched: it makes a specific promise
   about saved daily SKY readings, and mixing Tarot completion markers into it
   would quietly change what a filled dot means. */

/** Which history view the hash asks for. Astrology unless Tarot is named. */
function historyKind() {
  const query = location.hash.split("?")[1] || "";
  const kind = new URLSearchParams(query).get("kind");
  return kind === "tarot" && workspaceAvailable("tarot") ? "tarot" : "astrology";
}

function syncHistoryKinds(kind) {
  const holder = $("#history-kinds");
  if (holder) holder.hidden = !workspaceAvailable("tarot");
  for (const link of document.querySelectorAll("[data-history-kind]")) {
    if (link.dataset.historyKind === kind) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  // The chart-scope select belongs to the astrology history; a Tarot
  // reflection is not cast for a chart, so offering to filter it by one would
  // be a control that cannot do anything.
  const controls = $(".history-controls");
  if (controls) controls.hidden = kind === "tarot";
}

async function axisLoadTarotHistory() {
  const body = $("#history-body");
  if (!body) return;
  body.innerHTML = `<div class="axis-shimmer" style="height:120px"></div>`;

  if (!authSignedIn()) {
    body.innerHTML = `<div class="history-empty">
      <h2>Your saved reflections live here</h2>
      <p>Tarot reflections are kept to an account, so there is nothing to show yet.
        Today's card needs no account — only saving one does.</p>
      <button class="o-btn o-btn--primary" type="button" data-tarot-action="signin">Create an account</button>
    </div>`;
    return;
  }

  try {
    const data = await get("/api/tarot/readings?limit=50");
    const readings = data.readings || [];
    if (readings.length === 0) {
      body.innerHTML = `<div class="history-empty">
        <h2>No saved reflections yet</h2>
        <p>When you save a card or a spread, it will be kept here with the question
          you asked and the date you drew it.</p>
        <a class="o-btn o-btn--primary" href="#tarot">Draw a card</a>
      </div>`;
      return;
    }
    body.innerHTML = `<ul class="o-flat-list tarot-history">
      ${readings.map(tarotHistoryRowHtml).join("")}
    </ul>`;
  } catch (error) {
    body.innerHTML = `<div class="tarot-error" role="alert">
      <h2>Your reflections could not be loaded</h2>
      <p>${esc(error.message || "Please try again.")}</p>
      <button class="o-btn o-btn--secondary" type="button" data-tarot-action="retry-history">Try again</button>
    </div>`;
  }
}

function tarotHistoryRowHtml(reading) {
  const when = reading.created_at ? formatLocalDateKey(String(reading.created_at).slice(0, 10)) : "";
  const label = reading.spread_type === "three_card" ? "Three cards"
    : reading.spread_type === "daily" ? "Daily card" : "One card";
  const names = (reading.cards || []).map((entry) => entry.card?.name).filter(Boolean);
  return `<li class="tarot-history__row">
    <p class="tarot-history__head"><span class="tarot-history__kind">${esc(label)}</span>
      <span class="u-meta">${esc(when)}</span></p>
    ${reading.question ? `<p class="tarot-history__question">${esc(reading.question)}</p>` : ""}
    <p class="tarot-history__cards">${esc(names.join(" · "))}</p>
  </li>`;
}

async function axisLoadHistory(scope = "active") {
  const body = $("#history-body");
  if (!body) return;
  // Same as the daily reading: history is per-account, so signed out there is
  // nothing to ask for. Falls through to the honest empty state below.
  try {
    if (!authSignedIn()) throw new Error("signed out");
    const r = await get(`/api/fortune/history?scope=${encodeURIComponent(scope)}&limit=30`);
    // The week strip reads the same response. One request feeds both surfaces,
    // so they can never disagree about which days you have a reading for.
    axisRenderDayStrip(r.fortunes || []);
    if (!r.fortunes || r.fortunes.length === 0) return axisRenderHistoryEmpty();
    axisRenderHistory(r.fortunes);
    openPendingHistoryEntry();
  } catch {
    // Not signed in → no persisted history yet. Honest empty state (no fabrication).
    axisRenderDayStrip([]);
    axisRenderHistoryEmpty();
  }
}

function axisRenderHistoryEmpty() {
  // Signed out, "come back tomorrow and your readings will collect" is a
  // promise the app cannot keep: history is written against an account, so
  // returning tomorrow without one produces this same empty page. The page is
  // reachable without an account now, so it has to say which of the two
  // situations the reader is actually in.
  const signedIn = authSignedIn();
  $("#history-body").innerHTML = `
    <div class="history-empty">
      <div class="history-empty__art"><div class="axis-moon" style="--moon-size:96px" aria-hidden="true"><span class="axis-moon__halo"></span></div></div>
      <h2>No readings yet</h2>
      ${signedIn
        ? `<p>Your daily readings will collect here as you return to Orbit Axis. Come back tomorrow to start your history.</p>`
        : `<p>Daily readings are written against your birth chart and kept in your account. Create one and your history starts with tomorrow's.</p>
           <button type="button" class="o-btn o-btn--primary" id="history-create">Create your chart — free</button>`}
    </div>`;
  $("#history-create")?.addEventListener("click", () => openAuthGate("history"));
}

function axisRenderHistory(entries) {
  const adv = true;   // Update 5.2: history always shows the full entry
  $("#history-body").innerHTML = `<div class="history-list">${entries.map(f => `
    <details class="history-entry" data-date="${esc(String(f.fortune_date || "").slice(0, 10))}">
      <summary>
        <div class="history-entry__top">
          <span class="history-entry__date">${esc(formatLocalDateKey(f.fortune_date))}</span>
          <span class="history-entry__chips">
            <span class="history-entry__num">#${esc(f.lucky_number)}</span>
            <span class="history-entry__swatch" style="background:${esc(f.lucky_color?.value || "#888")}"></span>
            <span class="history-entry__chart">${esc(f.chart_nickname || "")}</span>
          </span>
        </div>
        <div class="history-entry__mood">${esc(f.mood || "")}</div>
        <div class="history-entry__love">${esc((f.love_reading || "").slice(0, 90))}${(f.love_reading || "").length > 90 ? "…" : ""}</div>
      </summary>
      <div class="history-entry__detail">
        ${histRow("Love", f.love_reading)}
        ${histRow("Luck", f.luck_reading)}
        ${histRow("Watch-Out", f.watch_out)}
        ${histRow("Moon", `${f.sky_snapshot?.moon_phase || ""} in ${f.sky_snapshot?.moon_sign || ""} · ${f.sky_snapshot?.illumination_percent ?? ""}% lit`)}
        ${adv ? histRow("Engine", f.fortune_engine_version) : ""}
      </div>
    </details>`).join("")}</div>`;
}
function histRow(label, val) {
  return val ? `<div class="history-detail-row"><span class="lbl">${label}</span><span class="val">${esc(val)}</span></div>` : "";
}

boot().catch(err => {
  $("#workspace").insertAdjacentHTML("afterbegin",
    `<div class="o-card" style="border-color:var(--color-error);color:var(--color-error);">
       <strong>Orbit failed to load.</strong> ${esc(err.message)}
     </div>`);
});

/* ── Current Positions ──────────────────────────────────────────────────────
   The shared sky. No birth chart is involved and none is required, which is
   the whole distinction from Today's Transits — and the page says so in its
   own words rather than relying on the reader to infer it.

   Everything rendered here is composed server-side in lib/positions. The
   browser formats and lays out; it does not recalculate astrology and it does
   not author meaning. */

const POSITIONS = { loading: false, lastAt: null, data: null };

async function loadPositions({ manual = false } = {}) {
  // Current Positions is general sky data, but it is an AUTHENTICATED
  // workspace for now — making it public would change Orbit's public/private
  // boundary, which is a product decision this update does not own. So the
  // request is not made and nothing is rendered until the session resolves.
  // Rendering behind the gate would put a heading, a ten-row list, a live
  // region and a refresh button into the page for someone who has not signed
  // in, and `aria-modal` on the gate is not a reason to build that.
  if (state.auth.restoring || !authSignedIn()) { clearPositions(); return; }
  // A second click while the first request is in flight would race two
  // responses into the same DOM; the newer is not guaranteed to land last.
  if (POSITIONS.loading) return;
  POSITIONS.loading = true;
  const btn = $("#positions-refresh");
  const status = $("#positions-status");
  if (btn) { btn.disabled = true; btn.textContent = manual ? "Refreshing…" : "Refresh"; }
  if (status) status.textContent = manual ? "Refreshing the sky…" : "Loading the current sky…";
  if (!POSITIONS.data) positionsRenderSkeleton();

  try {
    const tz = axisResolveTimezone();
    const r = await get(`/api/sky/current?tz=${encodeURIComponent(tz)}`);
    POSITIONS.data = r;
    try {
      renderPositions(r);
      if (status) status.textContent = manual ? "Sky updated." : "";
    } catch (error) {
      // Ours, not the network's. Saying "check your connection" here would
      // hide a rendering defect behind a plausible excuse.
      console.error("[orbit] positions failed to render", { stage: "render", message: error?.message });
      positionsRenderError("We couldn't show the current positions just now.");
    }
  } catch {
    positionsRenderError(POSITIONS.data
      ? "We couldn't refresh the sky. The positions below are the last ones we loaded."
      : "We couldn't reach the current sky just now.");
  } finally {
    POSITIONS.loading = false;
    if (btn) { btn.disabled = false; btn.textContent = "Refresh"; }
  }
}

/**
 * Empty every Positions region.
 *
 * Called when signed out and on sign-out, so nothing survives in the DOM or
 * the accessibility tree for the next visitor to this tab.
 */
function clearPositions() {
  POSITIONS.data = null;

  for (const sel of ["#positions-summary-body", "#positions-list-body", "#positions-calc-body"]) {
    const el = $(sel);
    if (el) el.innerHTML = "";
  }
  for (const sel of ["#positions-summary", "#positions-calc"]) {
    const el = $(sel);
    if (el) el.hidden = true;
  }
  const time = $("#positions-time");
  if (time) time.textContent = "";
  const status = $("#positions-status");
  if (status) status.textContent = "";
}

function positionsRenderSkeleton() {
  const body = $("#positions-list-body");
  if (body) body.innerHTML = `<div class="axis-shimmer" style="height:320px" role="status" aria-live="polite" aria-label="Loading planetary positions"></div>`;
}

function positionsRenderError(message) {
  const status = $("#positions-status");
  if (status) status.textContent = "";
  // Keep any positions we already have — a failed refresh is not a reason to
  // blank data the reader was looking at. It is labelled as older instead.
  const target = POSITIONS.data ? $("#positions-status") : $("#positions-list-body");
  if (!target) return;
  target.innerHTML = `<div class="axis-section-error" role="alert">
    <p>${esc(message)}</p>
    <button type="button" class="o-btn o-btn--secondary o-btn--sm" data-action="retry-positions">Try again</button>
  </div>`;
}

function renderPositions(payload) {
  const sky = payload?.sky;
  const positions = payload?.positions || [];
  if (!sky) throw new Error("renderPositions called without a sky");

  const time = $("#positions-time");
  if (time) {
    const when = sky.local_time_iso
      ? new Date(sky.local_time_iso).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })
      : "";
    time.textContent = when && sky.timezone_name
      ? `Calculated for ${when} in ${sky.timezone_name}`
      : "";
  }

  const summary = payload.summary;
  const sumSection = $("#positions-summary");
  const sumBody = $("#positions-summary-body");
  if (sumSection && sumBody) {
    sumSection.hidden = !summary;
    if (summary) {
      sumBody.innerHTML = `<ul class="positions-summary">
        ${summary.sun ? `<li><span class="positions-summary__label">Sun</span><span>${esc(summary.sun)}</span></li>` : ""}
        ${summary.moon ? `<li><span class="positions-summary__label">Moon</span><span>${esc(summary.moon)}</span></li>` : ""}
        <li><span class="positions-summary__label">Retrograde</span><span>${esc(summary.retrogradeLabel)}</span></li>
        <li><span class="positions-summary__label">Stations</span><span>${esc(summary.nearStationLabel)}</span></li>
        <li><span class="positions-summary__label">Sign boundaries</span><span>${esc(summary.boundaryLabel)}</span></li>
      </ul>`;
    }
  }

  const listBody = $("#positions-list-body");
  if (listBody) {
    listBody.innerHTML = positions.length
      ? `<ul class="positions-list">${positions.map(positionRowHtml).join("")}</ul>`
      : `<p class="me-muted">No planetary positions are available from the current calculation.</p>`;
  }

  const calcSection = $("#positions-calc");
  const calcBody = $("#positions-calc-body");
  const rows = payload.calculation || [];
  if (calcSection && calcBody) {
    calcSection.hidden = !rows.length;
    calcBody.innerHTML = `<details class="tech-sky__more">
      <summary><span>How these positions were calculated</span></summary>
      <div class="tech-sky__body">
        <dl class="tech-sky__facts">
          ${rows.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join("")}
        </dl>
        <p class="tech-sky__help">Positions come from Orbit’s own astronomy engine. Movement descriptions are worked out from each planet’s speed relative to how fast it usually travels. Nothing on this page is written by an AI model.</p>
      </div>
    </details>`;
  }
}

function positionRowHtml(p) {
  const glyph = PLACEMENT_GLYPHS[p.name] || "";
  const signGlyph = SIGN_GLYPH[p.sign] || "";
  // Direction is always spelled out. A reader must never have to know that a
  // missing symbol means "direct".
  const movement = p.movement
    ? `<span class="positions-row__movement">${esc(p.movement.label)}</span>`
    : "";
  const boundary = p.approachingBoundary
    ? `<span class="positions-row__note">Approaching the end of ${esc(p.sign)}</span>` : "";
  return `<li class="positions-row${p.retrograde ? " is-retrograde" : ""}">
    <span class="positions-row__glyph" aria-hidden="true">${esc(textGlyph(glyph))}</span>
    <span class="positions-row__main">
      <span class="positions-row__name">${atlasBodyLinkHtml(p.name)}</span>
      <span class="positions-row__position">
        <span aria-hidden="true">${esc(signGlyph)}</span>
        ${p.sign ? `<a class="atlas-ref" href="#symbol-atlas/signs/${esc(String(p.sign).toLowerCase())}">${esc(p.position)}</a>` : `<span>${esc(p.position)}</span>`}
      </span>
      ${p.role ? `<span class="positions-row__role">${esc(p.role)}</span>` : ""}
      ${boundary}
    </span>
    <span class="positions-row__state">
      <span class="positions-row__direction${p.retrograde ? " is-retrograde" : ""}">${esc(p.direction)}</span>
      ${movement}
    </span>
  </li>`;
}

function wirePositions() {
  const panel = $("#panel-positions");
  if (!panel || panel._positionsWired) return;
  panel._positionsWired = true;
  $("#positions-refresh")?.addEventListener("click", () => loadPositions({ manual: true }));
  panel.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="retry-positions"]')) loadPositions({ manual: true });
  });
}
