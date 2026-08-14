// Orbit Axis :: reusable request handler (Update 4.0.3).
//
// This module holds everything the Orbit HTTP API does. It deliberately does
// NOT create a server, bind a port, or contact anything. Two thin entry points
// consume it:
//
//   server.js      — local development: creates an http server and listens.
//   api/index.js   — Vercel: exports the handler as a Node Function.
//
// Import safety is a tested contract (test/server-handler.test.js): importing
// this module must not listen, must not reach Supabase or Ollama, must not run
// a migration, create a user, seed data, or start a timer. All of that is why
// the environment guard runs inside createOrbitApp(), not at module scope —
// merely importing the module is always safe, and every entry point that
// actually intends to serve traffic passes through the same gate.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ORBIT_DISCLAIMER, ORBIT_SYMBOLS, ZODIAC_ORDER,
  answerPrompt, signSlugForDate, symbolBySlug, signGeometry, summarizeSign,
} from "../symbols.js";
import { sunSeason, symbolOfTheDay, upcomingEvents, CHAKRAS } from "../sky.js";
import { createCurrentSkyContext } from "../astro/current-sky-context.js";
import { orbitLlmReply, ollamaModelName } from "../llm.js";
import { createLocalLLMProvider } from "../local-llm/provider.js";
import { generateProjectAnswer } from "../local-llm/assistant.js";
import {
  applyProposal,
  collectProjectNotes,
  getProjectNoteById,
  listProposals,
  readProposal,
  updateProposalStatus,
} from "../local-llm/vault.js";
import { localLlmConfig, supabaseConfig, REPO_ROOT } from "../local-llm/config.js";
import { recordVaultProposalStatus, recordVaultVersion } from "../local-llm/supabase.js";
import { buildActiveChartContext } from "../local-llm/context.js";
import {
  normalizeChartFacts, normalizeSkyFacts,
  compactChartSummary, compactSkySummary, buildChatPrompt,
  chartSummaryCache, skySummaryCache, chartCacheKey, skyCacheKey,
} from "../local-llm/chat-context.js";
import {
  validateChatInput, cachedHealth, fastAnswer, fallbackAnswer,
} from "../local-llm/axis-chat.js";
import { chartInputHash } from "../astro/natal.js";
import { handleChartsRoute } from "../charts/api.js";
import { handleCompatibilityRoute } from "../compatibility/api.js";
import { handleFortuneRoute } from "../fortune/api.js";
import { handleAskRoute } from "../ask-orbit/api.js";
import { assertStartupSafe } from "../env/guard.js";
import { handleApiV1 } from "../api/v1/router.js";
import { resolveEnvironment } from "../env/environment.js";
import { featureFlags, featureEnabled, FEATURE_IDS } from "../features.js";
import { publicLegalConfig } from "../legal/config.js";
import { LocationError, searchGeoapify } from "../locations/geoapify.js";
import {
  authenticateRequest,
  clearSessionCookie,
  isNativeOrigin,
  sessionCookie,
  sessionTokenFromCookie,
  signInWithPassword,
  signOutSupabase,
  signUpWithPassword,
  requestPasswordReset,
  updatePassword,
  verifyRecoveryToken,
} from "../auth/supabase-auth.js";
import { describeForClient, withHolding } from "../entitlements/service.js";

const PUBLIC_DIR = path.join(REPO_ROOT, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

// ── Request-scoped state ─────────────────────────────────────────────────────
// These maps are rate-limit and concurrency bookkeeping, NOT storage. On a
// serverless platform each instance keeps its own copy and loses it when the
// instance ends. That is acceptable — the worst case is a slightly more
// generous rate limit across instances — but it is the reason nothing durable
// may ever be kept here. Ask Orbit history lives in Supabase (lib/ask-orbit).
const LOCATION_RATE = new Map();
const CHAT_RATE = new Map();
const chatActive = new Map();
let chatGlobalActive = 0;

function skyContext() {
  const context = createCurrentSkyContext({
    at: new Date(),
    timezoneName: "UTC",
    timezoneSource: "utc_fallback",
  });
  return `Sun in ${context.sun.sign}, ${context.moon.phase_name} moon at `
    + `${context.moon.illumination_percent}% illumination, Mercury `
    + `${context.planets.Mercury?.retrograde ? "retrograde" : "direct"}.`;
}

// When the deterministic engine has no match, let the local LLM try.
// Returns the (possibly upgraded) result plus which engine produced it.
async function resolveWithLlm(result, prompt) {
  if (result.intent !== "unresolved") {
    return { result, mode: "orbit_service", model: "orbit-engine" };
  }
  const llmReply = await orbitLlmReply(prompt, skyContext());
  if (!llmReply) {
    return { result, mode: "orbit_service", model: "orbit-engine" };
  }
  return {
    result: { ...result, reply: llmReply, intent: "llm_reflection", algorithm: "local_llm" },
    mode: "orbit_llm",
    model: ollamaModelName(),
  };
}

// ── Handing the native container its session ─────────────────────────────────
// Every response that sets the session cookie goes through withSession(). For a
// browser it returns exactly what it always returned: one Set-Cookie header,
// HttpOnly, unreadable by script.
//
// A caller from capacitor:// also gets the same value in a header it can read,
// because a cross-origin fetch discards Set-Cookie and it would otherwise hold
// nothing. `Origin` is written by the user agent, so no page can ask for this.
const SESSION_HEADER = "X-Orbit-Session";

function withSession(req, setCookie) {
  if (!setCookie) return {};
  const headers = { "Set-Cookie": setCookie };
  // An empty value is sign-out, and saying so explicitly is what tells the
  // container to forget the session rather than keep a stale one.
  if (isNativeOrigin(req)) headers[SESSION_HEADER] = sessionTokenFromCookie(setCookie);
  return headers;
}

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    // Authorization is how the native container carries its session; the
    // exposed header is how it is given one. Both are inert in a browser,
    // which authenticates with a cookie it never sees and never sends here.
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Expose-Headers": SESSION_HEADER,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    ...headers,
  });
  res.end(payload);
}

function rateLimitLocation(req, ownerId) {
  const key = `${ownerId}:${req.socket?.remoteAddress || "local"}`;
  const now = Date.now();
  const windowMs = 60_000;
  const max = 45;
  const item = LOCATION_RATE.get(key);
  if (!item || now - item.start > windowMs) {
    LOCATION_RATE.set(key, { start: now, count: 1 });
    return null;
  }
  item.count += 1;
  if (item.count > max) return { status: 429, retryAfter: Math.ceil((windowMs - (now - item.start)) / 1000) };
  return null;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
    });
  });
}

/**
 * Reads a request body as BYTES.
 *
 * readBody() concatenates into a string, which is correct for JSON and
 * destroys binary: a WebP run through UTF-8 decoding comes out corrupted and
 * would fail the server validator for the wrong reason. Avatars need the exact
 * bytes the browser encoded.
 *
 * The cap is an outer defence, deliberately larger than the 1 MB the validator
 * enforces: this one exists to stop unbounded buffering from a hostile client,
 * and the validator exists to decide what a valid avatar is. Content-Length is
 * checked first so an oversized upload is refused before a single chunk is
 * held, and the stream is checked again because Content-Length is a claim.
 */
function readBytes(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (Number.isFinite(declared) && declared > limit) {
      // Refuse WITHOUT destroying: no data handler is ever attached, so
      // nothing is buffered, and the caller can still deliver the 413 —
      // destroying here tore the socket down before the response left, so
      // the client saw a reset instead of the structured refusal. Node
      // closes the connection itself after an early reply to an unread body.
      resolve({ tooLarge: true, bytes: null });
      return;
    }
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) { req.destroy(); finish({ tooLarge: true, bytes: null }); return; }
      chunks.push(chunk);
    });
    req.on("end", () => finish({ tooLarge: false, bytes: Buffer.concat(chunks) }));
    // A client that disappears mid-upload resolves as aborted rather than
    // hanging the request or leaving a half-written object behind.
    req.on("error", () => finish({ aborted: true, bytes: null }));
    req.on("aborted", () => finish({ aborted: true, bytes: null }));
  });
}

/**
 * Sends bytes rather than JSON. Image responses must not carry a JSON
 * content type, and a 304 must not carry a body at all.
 */
function binary(res, status, bytes, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    // The avatar path also carries a rotated session (see withSession), and a
    // header the WebView is not told to expose is a header it cannot read —
    // the container would silently keep presenting a replaced token.
    "Access-Control-Expose-Headers": SESSION_HEADER,
    ...headers,
  });
  if (status === 304 || !bytes) { res.end(); return; }
  res.end(bytes);
}

function isLocalRequest(req) {
  const address = req.socket?.remoteAddress;
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}

function safeAuthError(data = {}) {
  const message = String(data.error_description || data.msg || data.error || "Authentication failed.");
  if (/invalid login/i.test(message)) return "Email or password did not match.";
  if (/already registered|already exists/i.test(message)) return "An account with that email may already exist. Try signing in.";
  if (/password/i.test(message)) return message;
  return message.length > 160 ? "Authentication failed." : message;
}

/**
 * Where Supabase should send someone after they click a recovery link.
 *
 * Built from server-side configuration and the request's own host — NEVER from
 * a client-supplied value. A caller-chosen redirect_to would send the recovery
 * token to whatever site the caller named, which is an account takeover with
 * extra steps. Supabase keeps its own allow-list too; this is the near side of
 * the same rule.
 */
function requestOrigin(req, env) {
  const host = String(req?.headers?.host || "").trim();
  if (!host || !/^[A-Za-z0-9.\-]+(:\d+)?$/.test(host)) return "";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  if (!local && !env?.isDeployed) return "";
  return `${local ? "http" : "https"}://${host}`;
}

/**
 * Where Supabase should return after confirming a new account.
 *
 * Like recovery, the origin is derived only from the request host after the
 * deployment guard has classified it. Passing a client-selected destination
 * would turn confirmation into an open redirect carrying a fresh session.
 */
function signupConfirmationRedirect(req, env) {
  const origin = requestOrigin(req, env);
  return origin ? `${origin}/` : "";
}

function passwordResetRedirect(req, env) {
  const configured = String(process.env.ORBIT_PASSWORD_RESET_URL || "").trim();
  if (configured) return configured;

  const origin = requestOrigin(req, env);
  if (!origin) return "";
  // The .html suffix is deliberate: it resolves identically for the local
  // static server and for Vercel's CDN, with no rewrite rule to keep in sync
  // between them. A reset link that works in one environment and 404s in the
  // other is the kind of thing nobody notices until a real user is locked out.
  return `${origin}/reset-password.html`;
}

function validateEmailPassword(body, { signup = false } = {}) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const confirm = String(body.confirm_password || body.confirmPassword || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (signup && password !== confirm) return { error: "Passwords do not match." };
  return { email, password };
}

function authContext(auth) {
  const cfg = supabaseConfig();
  if (!auth?.ok || !auth.session?.access_token || !auth.user?.id) return null;
  return { url: cfg.url, anonKey: cfg.anonKey, accessToken: auth.session.access_token, ownerId: auth.user.id };
}

async function requireAuth(req, res, env) {
  const auth = await authenticateRequest(req, env);
  if (!auth.ok) {
    json(res, 401, { ok: false, error: auth.expired ? "Session expired. Please sign in again." : "Sign-in required." },
      withSession(req, auth.setCookie));
    return null;
  }
  return auth;
}

// ── Static delivery ──────────────────────────────────────────────────────────
// On Vercel the static files are served directly by the CDN and never reach
// this function; this path is what makes `node server.js` work locally and what
// answers if a request slips through.
//
// A missing file returns a real 404. Orbit's frontend is hash-routed (#home,
// #me, #ask …), so `/` is the only document route — there are no server-side
// deep links that would need an index.html fallback. Returning index.html with
// status 200 for a missing asset (the pre-4.0.3 behaviour) hid typos in script
// and stylesheet paths behind a page that looked fine but silently lost the
// asset, and made broken bundles indistinguishable from working ones.
function serveStatic(res, urlPath) {
  const decoded = (() => { try { return decodeURIComponent(urlPath); } catch { return urlPath; } })();
  const clean = path.normalize(decoded === "/" ? "/index.html" : decoded).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, clean);

  // Extensionless resolution, so /privacy serves privacy.html. These pages get
  // linked from app stores, emails, and other people's sites, where a .html
  // suffix looks like an implementation detail leaking into a public URL.
  // vercel.json sets cleanUrls so the deployed CDN resolves them identically.
  if (!path.extname(filePath) && fs.existsSync(`${filePath}.html`)) filePath = `${filePath}.html`;
  const withinPublic = filePath === PUBLIC_DIR || filePath.startsWith(PUBLIC_DIR + path.sep);
  if (!withinPublic || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(filePath));
}

const MOON_GLYPHS = Object.freeze({
  "New Moon": "🌑",
  "Waxing Crescent": "🌒",
  "First Quarter": "🌓",
  "Waxing Gibbous": "🌔",
  "Full Moon": "🌕",
  "Waning Gibbous": "🌖",
  "Last Quarter": "🌗",
  "Waning Crescent": "🌘",
});

function legacyChartFromContext(context) {
  const localDay = new Date(`${context.local_date}T12:00:00.000Z`);
  const season = sunSeason(localDay);
  const sunSymbol = symbolBySlug(context.zodiac_season.toLowerCase());
  const mercuryRetrograde = Boolean(context.planets.Mercury?.retrograde);
  const daySymbol = symbolOfTheDay(localDay);
  return {
    generated_at: context.calculated_at_utc,
    context_version: context.context_version,
    timezone_name: context.timezone_name,
    timezone_source: context.timezone_source,
    local_date: context.local_date,
    local_time_iso: context.local_time_iso,
    sun: {
      ...season,
      sign: sunSymbol.slug,
      name: context.zodiac_season,
      glyph: sunSymbol.glyph,
      element: sunSymbol.element,
      modality: sunSymbol.modality,
      ruling_planet: sunSymbol.ruling_planet,
    },
    moon: {
      age_days: null,
      phase: context.moon.phase_name,
      phase_fraction: context.moon.phase_fraction,
      glyph: MOON_GLYPHS[context.moon.phase_name] || "☾",
      illumination_pct: context.moon.illumination_percent,
      waxing: context.moon.waxing,
      next_full_moon: context.next_full_moon.local_date,
      next_new_moon: context.next_new_moon.local_date,
      next_full_moon_utc: context.next_full_moon.instant_utc,
      next_new_moon_utc: context.next_new_moon.instant_utc,
      accuracy: "Swiss Ephemeris",
    },
    mercury: {
      retrograde: mercuryRetrograde,
      message: mercuryRetrograde ? "Mercury is retrograde." : "Mercury is direct.",
      accuracy: "Swiss Ephemeris",
    },
    symbol_of_the_day: daySymbol,
    zodiac_order: ZODIAC_ORDER,
    source: context.source,
  };
}

function stellaDaily(timezoneName = null) {
  const context = createCurrentSkyContext({
    at: new Date(),
    timezoneName,
    timezoneSource: "request",
  });
  const chart = legacyChartFromContext(context);
  const today = new Date(`${context.local_date}T12:00:00.000Z`)
    .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

  const reflection = [
    `${today}: the Sun is in ${context.zodiac_season}, and the Moon is a ${context.moon.phase_name.toLowerCase()} at ${context.moon.illumination_percent}% illumination.`,
    chart.mercury.retrograde
      ? "Mercury is retrograde — favor review, revision, and backups over launches."
      : "Mercury is direct — clear lanes for messaging and launches.",
    `Symbol of the day: ${chart.symbol_of_the_day.name} ${chart.symbol_of_the_day.glyph} — ${chart.symbol_of_the_day.interpretation}`,
    ORBIT_DISCLAIMER,
  ].join(" ");

  return { reflection, ...chart, mode: "orbit_service" };
}

// ── Ask Orbit Axis chat: concurrency, rate limit, observability ──────────────
// Conservative for local hardware (M-series, single large model): one active
// generation per user, small global cap. Extra requests are rejected with a
// clear message rather than queued indefinitely.
const CHAT_MAX_PER_USER = Number(process.env.ORBIT_CHAT_MAX_PER_USER || 1);
const CHAT_MAX_GLOBAL = Number(process.env.ORBIT_CHAT_MAX_GLOBAL || 2);
const CHAT_RATE_MAX = Number(process.env.ORBIT_CHAT_RATE_MAX || 20); // per minute per user

function chatOwnerKey(auth, req) {
  return auth?.user?.id || `local:${req.socket?.remoteAddress || "unknown"}`;
}
function chatRateLimited(ownerKey) {
  const now = Date.now();
  const item = CHAT_RATE.get(ownerKey);
  if (!item || now - item.start > 60_000) { CHAT_RATE.set(ownerKey, { start: now, count: 1 }); return false; }
  item.count += 1;
  return item.count > CHAT_RATE_MAX;
}
function chatAcquire(ownerKey) {
  if (chatGlobalActive >= CHAT_MAX_GLOBAL) return { ok: false, reason: "busy" };
  if ((chatActive.get(ownerKey) || 0) >= CHAT_MAX_PER_USER) return { ok: false, reason: "one_at_a_time" };
  chatActive.set(ownerKey, (chatActive.get(ownerKey) || 0) + 1);
  chatGlobalActive += 1;
  return { ok: true };
}
function chatRelease(ownerKey) {
  const n = (chatActive.get(ownerKey) || 1) - 1;
  if (n <= 0) chatActive.delete(ownerKey); else chatActive.set(ownerKey, n);
  chatGlobalActive = Math.max(0, chatGlobalActive - 1);
}

// Dev-safe timing log: only non-sensitive metadata, never message content,
// names, coordinates, prompts, or tokens.
function logChat(meta) {
  if (process.env.ORBIT_CHAT_LOG === "false") return;
  try { console.log(`[axis-chat] ${JSON.stringify(meta)}`); } catch { /* ignore */ }
}

// Minimal SSE frame writer.
function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Gather ONLY the compact, allow-listed facts chat may use. Uses the existing
// cached sky snapshot and the chart-calculation cache (no Swiss Ephemeris
// recompute for an unchanged active chart), and the in-memory summary caches.
async function gatherChatFacts(auth, detailLevel) {
  const authCtx = authContext(auth);
  let sky = null, skyFacts = null;
  try {
    const skyRes = await handleChartsRoute("GET", "/api/sky/current", new URLSearchParams(), {}, authCtx);
    sky = skyRes?.body?.sky || null;
    skyFacts = normalizeSkyFacts(sky);
  } catch { /* sky optional */ }

  let chartFacts = null, chartMeta = null;
  if (authCtx) {
    try {
      const list = await handleChartsRoute("GET", "/api/charts", new URLSearchParams(), {}, authCtx);
      const activeItem = list?.body?.charts?.find((c) => c.is_active);
      if (activeItem) {
        const full = await handleChartsRoute("GET", `/api/charts/${activeItem.id}`, new URLSearchParams(), {}, authCtx);
        const profile = full?.body?.profile || activeItem;
        const chart = full?.body?.chart || null;
        chartMeta = { chartId: activeItem.id, inputHash: chartInputHash(profile), nickname: profile.nickname };
        chartFacts = normalizeChartFacts({ profile, chart, summary: activeItem.summary });
      }
    } catch { /* chart optional; deterministic paths still work */ }
  }

  // Resolve summaries through the bounded caches (invalidation is key-based:
  // a new active chart, edited chart, changed detail mode, or refreshed sky
  // snapshot all produce a different key and thus a fresh summary).
  let chartHit = false, skyHit = false, chartSummary = "No active chart is selected.";
  if (chartFacts) {
    const key = chartCacheKey({ ownerId: auth?.user?.id, chartId: chartMeta?.chartId, inputHash: chartMeta?.inputHash, detailLevel });
    const cached = chartSummaryCache.get(key);
    if (cached !== undefined) { chartSummary = cached; chartHit = true; }
    else chartSummary = chartSummaryCache.set(key, compactChartSummary(chartFacts, detailLevel));
  }
  let skySummary = "Current sky is unavailable.";
  if (skyFacts) {
    const key = skyCacheKey({ skyVersion: skyFacts.version, snapshotHash: skyFacts.hash, detailLevel });
    const cached = skySummaryCache.get(key);
    if (cached !== undefined) { skySummary = cached; skyHit = true; }
    else skySummary = skySummaryCache.set(key, compactSkySummary(skyFacts, detailLevel));
  }

  return { chartFacts, skyFacts, chartMeta, chartSummary, skySummary, cache: { chart: chartHit ? "hit" : "miss", sky: skyHit ? "hit" : "miss" } };
}

async function handleChatStream(req, res, body, auth) {
  const requestId = randomUUID().slice(0, 8);
  const ownerKey = chatOwnerKey(auth, req);

  // Validate BEFORE opening the SSE stream so real errors get real status codes.
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const message = typeof body.message === "string" ? body.message
    : [...messages].reverse().find((m) => m?.role === "user")?.content ?? "";
  const valid = validateChatInput({ message, messages });
  if (!valid.ok) return json(res, 400, { ok: false, error: valid.error });
  if (chatRateLimited(ownerKey)) {
    return json(res, 429, { ok: false, error: "You're sending messages too quickly. Give it a moment." }, { "Retry-After": "20" });
  }
  const slot = chatAcquire(ownerKey);
  if (!slot.ok) {
    return json(res, 429, { ok: false, error: slot.reason === "one_at_a_time"
      ? "Orbit Axis is still answering your previous message."
      : "Orbit Axis is busy right now. Please try again in a moment." }, { "Retry-After": "5" });
  }

  const config = localLlmConfig();
  const detailFallback = "Simple";
  let released = false;
  const release = () => { if (!released) { released = true; chatRelease(ownerKey); } };
  const t0 = Date.now();

  try {
    // Detail level (already normalized by the fortune service).
    let detailLevel = detailFallback;
    if (auth?.ok) {
      try {
        const d = await handleFortuneRoute("GET", "/api/settings/detail", new URLSearchParams(), {}, authContext(auth));
        detailLevel = d?.body?.astrology_detail_level || detailFallback;
      } catch { /* default */ }
    }

    const facts = await gatherChatFacts(auth, detailLevel);
    // createLocalLLMProvider() returns a no-network stub whenever the resolved
    // environment forbids a local language provider, so on Vercel `health()`
    // below reports unreachable without a socket ever being opened.
    const provider = createLocalLLMProvider(config);
    const health = await cachedHealth(provider, config.healthCacheMs);
    const factBundle = { chart: facts.chartFacts, sky: facts.skyFacts, detailLevel, health };

    // Open the stream.
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });
    sse(res, "meta", { request_id: requestId, chart: facts.chartMeta?.nickname || null, detail_level: detailLevel });

    // 1) Fast deterministic path — no model needed.
    const fast = fastAnswer(message, factBundle);
    if (fast) {
      sse(res, "delta", { text: fast.text });
      sse(res, "done", { path: "fast", intent: fast.intent, stats: { total_ms: Date.now() - t0 } });
      logChat({ id: requestId, path: "fast", intent: fast.intent, detail: detailLevel, chart_cache: facts.cache.chart, sky_cache: facts.cache.sky, ctx_chars: facts.chartSummary.length + facts.skySummary.length, ms: Date.now() - t0 });
      res.end();
      return;
    }

    // 2) Ollama unreachable / model missing / disabled for this environment →
    //    deterministic fallback (fast). This is the normal path on Vercel.
    const modelReady = health?.reachable && (health.model_available ?? health.installed_model);
    if (!modelReady) {
      const fb = fallbackAnswer(message, factBundle);
      sse(res, "notice", { text: fb.notice });
      sse(res, "delta", { text: fb.text });
      sse(res, "done", { path: "fallback", reason: health?.disabled ? "language_model_disabled" : (health?.reachable ? "missing_model" : "ollama_offline"), stats: { total_ms: Date.now() - t0 } });
      logChat({ id: requestId, path: "fallback", reason: health?.disabled ? "language_model_disabled" : (health?.reachable ? "missing_model" : "ollama_offline"), detail: detailLevel, ms: Date.now() - t0 });
      res.end();
      return;
    }

    // 3) Stream from Ollama. Abort upstream if the client disconnects.
    const controller = new AbortController();
    req.on("close", () => controller.abort(new Error("client_closed")));
    const prompt = buildChatPrompt({
      chartFacts: facts.chartFacts, skyFacts: facts.skyFacts, detailLevel,
      messages: [...messages, { role: "user", content: message }],
      chartSummary: facts.chartSummary, skySummary: facts.skySummary,
    });

    let produced = 0;
    let terminal = null;
    for await (const ev of provider.streamChat({
      messages: prompt.messages,
      signal: controller.signal,
      timeoutMs: config.chatTimeoutMs,
      numPredict: 700,
      keepAlive: config.keepAlive,
    })) {
      if (ev.type === "delta") { produced += ev.text.length; sse(res, "delta", { text: ev.text }); }
      else if (ev.type === "done") { terminal = ev; break; }
      else if (ev.type === "error") { terminal = ev; break; }
    }

    if (terminal?.type === "done") {
      sse(res, "done", { path: "ollama", stats: { ...terminal.stats, context_chars: prompt.stats.prompt_chars } });
      logChat({ id: requestId, path: "ollama", model: terminal.stats.model, detail: detailLevel, chart_cache: facts.cache.chart, sky_cache: facts.cache.sky, ctx_chars: prompt.stats.prompt_chars, ttft_ms: terminal.stats.time_to_first_token_ms, ms: terminal.stats.total_ms });
    } else if (controller.signal.aborted) {
      // Client stopped / disconnected: keep whatever text already streamed.
      logChat({ id: requestId, path: "ollama", status: "cancelled", produced_chars: produced, ms: Date.now() - t0 });
    } else {
      // Mid-stream failure with no partial → deterministic fallback tail.
      if (produced === 0) {
        const fb = fallbackAnswer(message, factBundle);
        sse(res, "notice", { text: fb.notice });
        sse(res, "delta", { text: fb.text });
        sse(res, "done", { path: "fallback", reason: terminal?.status || "stream_failed", stats: { total_ms: Date.now() - t0 } });
        logChat({ id: requestId, path: "fallback", reason: terminal?.status || "stream_failed", detail: detailLevel, ms: Date.now() - t0 });
      } else {
        sse(res, "error", { message: "The response was interrupted.", retryable: true });
        logChat({ id: requestId, path: "ollama", status: terminal?.status || "interrupted", produced_chars: produced, ms: Date.now() - t0 });
      }
    }
    res.end();
  } catch (error) {
    // Stream may already be open; try to emit an error event, else 500.
    try {
      if (res.headersSent) { sse(res, "error", { message: "Something went wrong. Please try again.", retryable: true }); res.end(); }
      else json(res, 500, { ok: false, error: "Chat failed to start." });
    } catch { /* ignore */ }
    logChat({ id: requestId, path: "error", ms: Date.now() - t0 });
  } finally {
    release();
  }
}

// ── The handler ──────────────────────────────────────────────────────────────
// `env` is the resolved environment, passed in so the handler never re-resolves
// per request and so tests can drive a simulated Preview or Production.
function createRequestHandler(env) {
  // Development-only routes are gated on the resolved environment first and the
  // socket address second. Before 4.0.3 the socket address was the only gate;
  // that is not a safe test behind a proxy, where the peer is the platform's
  // own network rather than the caller.
  function requireDevRoute(req, res) {
    if (!env.allowsDevRoutes) {
      json(res, 404, { ok: false, error: "Unknown Orbit endpoint" });
      return false;
    }
    if (!isLocalRequest(req)) {
      json(res, 403, { ok: false, error: "Local intelligence routes are localhost-only by default." });
      return false;
    }
    return true;
  }

  return async function orbitRequestHandler(req, res) {
    // The base is only used so relative request targets parse; the hostname is
    // never trusted for routing or for building a redirect.
    const url = new URL(req.url, "http://orbit.local");
    const route = url.pathname;

    // ── Versioned API (Update 5.0) ────────────────────────────────────────
    // Checked before anything else so /api/v1/* owns its own method handling,
    // CORS, and error envelope rather than inheriting the legacy behaviour of
    // the routes below. Returns null for non-v1 paths, so ordinary routing
    // continues untouched.
    try {
      const v1 = await handleApiV1(req, route, { env: process.env });
      if (v1) {
        res.writeHead(v1.status, v1.headers);
        return res.end(v1.body === null ? "" : JSON.stringify(v1.body));
      }
    } catch (error) {
      // The v1 router handles its own errors; reaching here means the router
      // itself failed, which must not take down unrelated routes.
      console.error("[api/v1] router failure");
      return json(res, 500, { ok: false, error: "Something went wrong." });
    }

    if (req.method === "OPTIONS") return json(res, 204, {});

    try {
      // ── Auth/session endpoints ────────────────────────────────────────────
      if (route === "/api/auth/session" && req.method === "GET") {
        const auth = await authenticateRequest(req, env);
        if (!auth.ok) {
          return json(res, 200, { ok: true, signed_in: false, expired: !!auth.expired },
            withSession(req, auth.setCookie));
        }
        // The plan travels with the session so the interface can render a lock
        // rather than a button that will 403. It is a COPY of a server-side
        // decision, never the decision itself — every route re-checks, because
        // a response body is not an authorization boundary.
        return json(res, 200, {
          ok: true,
          signed_in: true,
          user: auth.user,
          entitlement: await describeForClient(authContext(auth)),
        }, withSession(req, auth.setCookie));
      }
      if (route === "/api/auth/signup" && req.method === "POST") {
        const body = await readBody(req);
        const input = validateEmailPassword(body, { signup: true });
        if (input.error) return json(res, 400, { ok: false, error: input.error });
        const result = await signUpWithPassword({
          ...input,
          redirectTo: signupConfirmationRedirect(req, env),
        });
        if (!result.ok) return json(res, result.status || 400, { ok: false, error: safeAuthError(result.data) });
        if (!result.session?.access_token) {
          return json(res, 200, { ok: true, signed_in: false, message: "Account created. Check your email if confirmation is required, then sign in." });
        }
        return json(res, 200, { ok: true, signed_in: true, user: result.user, message: "Account created." },
          withSession(req, sessionCookie(result.session, { req, env })));
      }
      if (route === "/api/auth/signin" && req.method === "POST") {
        const body = await readBody(req);
        const input = validateEmailPassword(body);
        if (input.error) return json(res, 400, { ok: false, error: input.error });
        const result = await signInWithPassword(input);
        if (!result.ok || !result.session?.access_token) {
          return json(res, result.status || 400, { ok: false, error: safeAuthError(result.data) });
        }
        return json(res, 200, { ok: true, signed_in: true, user: result.user, message: "Signed in." },
          withSession(req, sessionCookie(result.session, { req, env })));
      }
      // ── Password reset ────────────────────────────────────────────────────
      // The response is deliberately identical whether or not the address has
      // an account. Telling an anonymous caller "no account with that email"
      // turns this endpoint into a way to test which addresses are registered,
      // which matters more here than elsewhere: an astrology account reveals
      // something personal about the person who holds it.
      if (route === "/api/auth/password/request" && req.method === "POST") {
        const body = await readBody(req);
        const email = String(body.email || "").trim().toLowerCase();
        const sameAnswer = {
          ok: true,
          message: "If an account exists for that email, a reset link is on its way. "
            + "Check your inbox, and your spam folder.",
        };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json(res, 400, { ok: false, error: "Enter a valid email address." });
        }
        // Failures are logged server-side and swallowed client-side, for the
        // same reason: an error that only appears for real accounts leaks them.
        const result = await requestPasswordReset({ email, redirectTo: passwordResetRedirect(req, env) })
          .catch((error) => ({ ok: false, data: { error: error.message } }));
        if (!result.ok) console.error(`[auth] password reset request failed status=${result.status || "?"}`);
        return json(res, 200, sameAnswer);
      }

      if (route === "/api/auth/password/update" && req.method === "POST") {
        const body = await readBody(req);
        const password = String(body.password || "");
        const confirm = String(body.confirm_password || body.confirmPassword || "");
        if (password.length < 8) {
          return json(res, 400, { ok: false, error: "Password must be at least 8 characters." });
        }
        if (password !== confirm) {
          return json(res, 400, { ok: false, error: "Passwords do not match." });
        }

        // The token comes from the emailed link. Either shape is accepted: a
        // recovery access token, or a token_hash that is exchanged for one.
        let accessToken = String(body.access_token || "").trim();
        if (!accessToken && body.token_hash) {
          const verified = await verifyRecoveryToken({ tokenHash: String(body.token_hash) });
          if (!verified.ok || !verified.session?.access_token) {
            return json(res, 400, {
              ok: false,
              error: "This reset link has expired or has already been used. Request a new one.",
            });
          }
          accessToken = verified.session.access_token;
        }
        if (!accessToken) {
          return json(res, 400, { ok: false, error: "This reset link is missing its token. Request a new one." });
        }

        const result = await updatePassword({ accessToken, password });
        if (!result.ok) {
          return json(res, result.status === 401 || result.status === 403 ? 400 : (result.status || 400), {
            ok: false,
            error: result.status === 401 || result.status === 403
              ? "This reset link has expired or has already been used. Request a new one."
              : safeAuthError(result.data),
          });
        }
        // No session is issued here. Changing a password should send the person
        // back through sign-in, so a leaked reset link cannot also hand over a
        // logged-in session.
        return json(res, 200, {
          ok: true,
          signed_in: false,
          message: "Password updated. You can sign in with your new password.",
        }, withSession(req, clearSessionCookie({ req, env })));
      }

      if (route === "/api/auth/signout" && req.method === "POST") {
        const auth = await authenticateRequest(req, env);
        if (auth.session?.access_token) await signOutSupabase(auth.session.access_token).catch(() => {});
        return json(res, 200, { ok: true, signed_in: false }, withSession(req, clearSessionCookie({ req, env })));
      }

      // ── Chart / daily / chakra contract endpoints ─────────────────────────
      if (route === "/api/chart" || route === "/api/chart/now") {
        const context = createCurrentSkyContext({
          at: new Date(),
          timezoneName: url.searchParams.get("tz"),
          timezoneSource: "request",
        });
        return json(res, 200, {
          ok: true,
          ...legacyChartFromContext(context),
          disclaimer: ORBIT_DISCLAIMER,
        });
      }
      if (route === "/api/stella/daily") {
        return json(res, 200, stellaDaily(url.searchParams.get("tz")));
      }
      if (route === "/api/stella/chat" && req.method === "POST") {
        const body = await readBody(req);
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const prompt = [...messages].reverse().find(message => message?.role === "user")?.content
          ?? body.prompt ?? "daily reflection";
        const t0 = Date.now();
        const { result, mode, model } = await resolveWithLlm(answerPrompt(String(prompt)), String(prompt));
        const response = `${result.reply}\n\n${ORBIT_DISCLAIMER}`;
        return json(res, 200, {
          response,
          intent: result.intent,
          matches: result.matches,
          algorithm: result.algorithm,
          details: result.details,
          mode,
          stats: {
            latency: Date.now() - t0,
            inputTokens: String(prompt).length,
            outputTokens: response.length,
            model,
          },
        });
      }
      if (route === "/api/chakra") {
        return json(res, 200, { ok: true, chakras: CHAKRAS });
      }
      if (route.startsWith("/api/chakra/")) {
        const chakra = CHAKRAS.find(entry => entry.id === route.slice("/api/chakra/".length));
        return chakra ? json(res, 200, { ok: true, chakra }) : json(res, 404, { ok: false, error: "Unknown chakra" });
      }

      if (route === "/api/locations/search" && req.method === "GET") {
        const auth = await requireAuth(req, res, env);
        if (!auth) return;
        const limited = rateLimitLocation(req, auth.user.id);
        if (limited) {
          return json(res, 429, { ok: false, error: "Location search is temporarily rate limited.", code: "rate_limited" },
            { "Retry-After": String(limited.retryAfter) });
        }
        try {
          const results = await searchGeoapify(url.searchParams.get("q") || "", {
            limit: Number(url.searchParams.get("limit")) || 5,
          });
          return json(res, 200, { ok: true, results }, withSession(req, auth.setCookie));
        } catch (error) {
          if (error instanceof LocationError) {
            return json(res, error.status || 400, { ok: false, error: error.message, code: error.code },
              withSession(req, auth.setCookie));
          }
          throw error;
        }
      }

      // ── Orbit's own app API ──────────────────────────────────────────────
      if (route === "/api/symbols") {
        const kind = url.searchParams.get("kind");
        const symbols = kind ? ORBIT_SYMBOLS.filter(symbol => symbol.kind === kind) : ORBIT_SYMBOLS;
        return json(res, 200, { ok: true, count: symbols.length, symbols, disclaimer: ORBIT_DISCLAIMER });
      }
      if (route === "/api/sign-for-date") {
        const month = parseInt(url.searchParams.get("month"), 10);
        const day = parseInt(url.searchParams.get("day"), 10);
        if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) {
          return json(res, 400, { ok: false, error: "Pass month=1-12 and day=1-31." });
        }
        const symbol = symbolBySlug(signSlugForDate(month, day));
        return json(res, 200, { ok: true, sign: symbol, summary: summarizeSign(symbol) });
      }
      if (route === "/api/compatibility") {
        const a = url.searchParams.get("a");
        const b = url.searchParams.get("b");
        if (!ZODIAC_ORDER.includes(a) || !ZODIAC_ORDER.includes(b)) {
          return json(res, 400, { ok: false, error: "Pass a and b as zodiac sign slugs.", signs: ZODIAC_ORDER });
        }
        const geometry = signGeometry(a, b);
        const aspect = geometry.aspect ? symbolBySlug(geometry.aspect) : null;
        return json(res, 200, {
          ok: true,
          a: symbolBySlug(a), b: symbolBySlug(b),
          steps_apart: geometry.steps, aspect,
          harmony_score: geometry.score, note: geometry.note,
          disclaimer: ORBIT_DISCLAIMER,
        });
      }
      if (route === "/api/events") {
        const context = createCurrentSkyContext({
          at: new Date(),
          timezoneName: url.searchParams.get("tz"),
          timezoneSource: "request",
        });
        return json(res, 200, {
          ok: true,
          context_version: context.context_version,
          timezone_name: context.timezone_name,
          local_date: context.local_date,
          events: upcomingEvents(
            new Date(`${context.local_date}T12:00:00.000Z`),
            Number(url.searchParams.get("count")) || 8,
            { currentSkyContext: context },
          ),
          source: context.source,
          disclaimer: ORBIT_DISCLAIMER,
        });
      }
      if (route === "/api/query" && req.method === "POST") {
        const body = await readBody(req);
        const prompt = String(body.prompt ?? "");
        const { result, mode, model } = await resolveWithLlm(answerPrompt(prompt), prompt);
        return json(res, 200, { ok: true, ...result, mode, model, disclaimer: ORBIT_DISCLAIMER });
      }
      if (route === "/api/local-llm/status") {
        if (!requireDevRoute(req, res)) return;
        const health = await createLocalLLMProvider().health();
        return json(res, 200, { ok: true, prompt_version: localLlmConfig().promptVersion, ...health });
      }
      if (route === "/api/local-llm/models") {
        if (!requireDevRoute(req, res)) return;
        return json(res, 200, { ok: true, models: await createLocalLLMProvider().listModels() });
      }
      if (route === "/api/local-llm/generate" && req.method === "POST") {
        if (!requireDevRoute(req, res)) return;
        const body = await readBody(req);
        const auth = await authenticateRequest(req, env);
        let context = "";
        if (auth.ok) {
          const handled = await handleChartsRoute("GET", "/api/charts", new URLSearchParams(), {}, authContext(auth));
          const active = handled?.body?.charts?.find(chart => chart.is_active);
          const detail = await handleFortuneRoute("GET", "/api/settings/detail", new URLSearchParams(), {}, authContext(auth));
          context = buildActiveChartContext({
            activeChart: active || null,
            currentSky: skyContext(),
            detailLevel: detail?.body?.astrology_detail_level || "",
          });
        }
        const result = await generateProjectAnswer({
          prompt: `${context ? `${context}\n\n` : ""}${String(body.prompt || "")}`,
          query: String(body.query || body.prompt || ""),
        });
        return json(res, result.ok ? 200 : 422, result);
      }
      // ── Ask Orbit Axis streamed chat (SSE) ──────────────────────────────
      // Available to authenticated users; also usable on localhost without a
      // session for local dev. Never exposes Ollama to arbitrary remote callers.
      if (route === "/api/axis/chat/stream" && req.method === "POST") {
        const auth = await authenticateRequest(req, env);
        // The unauthenticated localhost convenience is a development
        // affordance, so it follows allowsDevRoutes rather than the socket
        // address alone. On a deployment, a session is always required.
        if (!auth.ok && !(env.allowsDevRoutes && isLocalRequest(req))) {
          return json(res, 401, { ok: false, error: "Sign-in required." },
            withSession(req, auth.setCookie));
        }
        const body = await readBody(req);
        return handleChatStream(req, res, body, auth.ok ? auth : null);
      }

      if (route === "/api/vault/project-notes") {
        if (!requireDevRoute(req, res)) return;
        const notes = collectProjectNotes({
          query: url.searchParams.get("q") || "",
          type: url.searchParams.get("type") || "",
          folder: url.searchParams.get("folder") || "",
          limit: Number(url.searchParams.get("limit")) || 20,
        });
        return json(res, 200, { ok: true, notes });
      }
      if (route.startsWith("/api/vault/project-notes/")) {
        if (!requireDevRoute(req, res)) return;
        const id = decodeURIComponent(route.slice("/api/vault/project-notes/".length));
        const note = getProjectNoteById(id);
        return note ? json(res, 200, { ok: true, note }) : json(res, 404, { ok: false, error: "Project note not found" });
      }
      if (route === "/api/vault/edit-proposals" && req.method === "GET") {
        if (!requireDevRoute(req, res)) return;
        return json(res, 200, { ok: true, proposals: listProposals() });
      }
      if (route === "/api/vault/edit-proposals" && req.method === "POST") {
        if (!requireDevRoute(req, res)) return;
        const body = await readBody(req);
        const result = await generateProjectAnswer({
          prompt: String(body.prompt || body.reason || "Create a vault edit proposal."),
          query: String(body.query || body.title || body.prompt || "Orbit"),
          propose: {
            operation: body.operation || "create",
            path: body.path,
            title: body.title || "Untitled Orbit Note",
            type: body.type || "app_update",
            reason: body.reason || body.prompt || "",
            content: body.content,
            appendContent: body.appendContent,
            tags: body.tags,
          },
        });
        return json(res, result.ok ? 200 : 422, result);
      }
      if (route.startsWith("/api/vault/edit-proposals/")) {
        if (!requireDevRoute(req, res)) return;
        const parts = route.slice("/api/vault/edit-proposals/".length).split("/");
        const id = decodeURIComponent(parts[0]);
        const action = parts[1] || "";
        if (req.method === "GET" && !action) {
          const proposal = readProposal(id);
          return proposal ? json(res, 200, { ok: true, proposal }) : json(res, 404, { ok: false, error: "Proposal not found" });
        }
        if (req.method === "POST" && action === "approve") {
          const proposal = updateProposalStatus(id, "approved");
          return json(res, 200, { ok: true, proposal, supabase: await recordVaultProposalStatus(proposal) });
        }
        if (req.method === "POST" && action === "reject") {
          const proposal = updateProposalStatus(id, "rejected");
          return json(res, 200, { ok: true, proposal, supabase: await recordVaultProposalStatus(proposal) });
        }
        if (req.method === "POST" && action === "apply") {
          let applied;
          try {
            applied = applyProposal(id);
          } catch (error) {
            const proposal = readProposal(id);
            if (proposal?.status === "stale") {
              await recordVaultProposalStatus(proposal);
              return json(res, 409, { ok: false, error: error.message, proposal });
            }
            throw error;
          }
          const [versionRecord, proposalRecord] = await Promise.all([
            recordVaultVersion(applied),
            recordVaultProposalStatus(applied.proposal),
          ]);
          return json(res, 200, { ok: true, ...applied, supabase: { version: versionRecord, proposal: proposalRecord } });
        }
      }
      // Which unfinished features are visible in THIS environment. Public and
      // uninteresting on purpose: it reports booleans, nothing about why.
      if (route === "/api/features") {
        return json(res, 200, { ok: true, features: featureFlags(process.env) });
      }

      // Markup for an unfinished feature, served ONLY when that feature is
      // enabled. The fragments live outside public/ precisely so they cannot be
      // copied into the production static output, which means production has
      // nothing to serve here even if this route were somehow reached.
      if (route.startsWith("/api/features/panel/")) {
        const id = route.slice("/api/features/panel/".length);
        if (!FEATURE_IDS.includes(id) || !featureEnabled(id, process.env)) {
          return json(res, 404, { ok: false, error: "Unknown Orbit endpoint" });
        }
        const fragment = path.join(REPO_ROOT, "features", "panels", `${id}.html`);
        // Defence in depth: the id is already checked against a fixed list, but
        // a path that escapes the fragments directory must never be served.
        const withinFragments = fragment.startsWith(path.join(REPO_ROOT, "features", "panels") + path.sep);
        if (!withinFragments || !fs.existsSync(fragment)) {
          return json(res, 404, { ok: false, error: "Unknown Orbit endpoint" });
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(fs.readFileSync(fragment));
      }

      // Facts the legal pages refuse to hardcode. Values only — never the
      // environment-variable names that produced them, and never a list of what
      // is missing, which is useful to the owner rather than to a visitor.
      if (route === "/api/legal/config") {
        return json(res, 200, publicLegalConfig(process.env));
      }

      if (route === "/api/health") {
        // Deliberately minimal. A health probe is reachable without a session,
        // so it must not describe the database, the deployment, or the
        // environment beyond confirming the service answered.
        return json(res, 200, { ok: true, service: "orbit" });
      }

      // Relationship-aware compatibility between two SAVED charts. Owner-scoped:
      // every request requires a Supabase Auth session, and both chart ids are
      // resolved through the owner's own service. Read-only and never persisted
      // — a comparison is derived per request and kept nowhere.
      //
      // Registered ahead of /api/charts because it is its own namespace; the
      // older public /api/compatibility (sun-sign distance) is an exact-match
      // route further up and is unaffected.
      if (route.startsWith("/api/compatibility/")) {
        const auth = await requireAuth(req, res, env);
        if (!auth) return;
        const handled = await handleCompatibilityRoute(req.method, route, url.searchParams, {}, await withHolding(authContext(auth)));
        if (handled) return json(res, handled.status, handled.body, withSession(req, auth?.setCookie));
      }

      // Saved charts, current sky, and Moon. User-owned chart data requires a
      // Supabase Auth session; current-sky/Moon are public astronomy.
      if (route === "/api/charts" || route.startsWith("/api/charts/")
        || route === "/api/chart/preview"
        || route === "/api/sky/current" || route === "/api/moon/current") {
        let auth = null;
        if (route.startsWith("/api/charts")) {
          auth = await requireAuth(req, res, env);
          if (!auth) return;
        }
        // Avatar uploads are the one chart route carrying bytes rather than
        // JSON, so they take the bytes reader. Everything else is unchanged.
        const isAvatarUpload = req.method === "POST" && /\/api\/charts\/[^/]+\/avatar$/.test(route);
        let body = {};
        let raw = {};
        if (isAvatarUpload) {
          const read = await readBytes(req);
          if (read.aborted) return;                       // client vanished; nothing was written
          if (read.tooLarge) {
            return json(res, 413, { ok: false, error: "That image is too large to upload.", code: "avatar_request_too_large" });
          }
          raw = {
            body: read.bytes,
            contentType: String(req.headers["content-type"] || "").split(";")[0].trim(),
            headers: req.headers,
          };
        } else {
          body = (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE")
            ? await readBody(req) : {};
          raw = { headers: req.headers };
        }
        const handled = await handleChartsRoute(req.method, route, url.searchParams, body, await withHolding(authContext(auth)), raw);
        if (handled) {
          const cookie = withSession(req, auth?.setCookie);
          // An avatar read returns image bytes and its own cache headers. JSON
          // encoding them would corrupt the image and mislabel the response.
          if (handled.binary || handled.status === 304) {
            return binary(res, handled.status, handled.body, { ...(handled.headers || {}), ...cookie });
          }
          return json(res, handled.status, handled.body, cookie);
        }
      }

      // Daily fortune + astrology detail-level / current-timezone / current-location
      // settings. Owner-scoped user data requires a Supabase Auth session; the
      // stateless preview needs no owner.
      if (route.startsWith("/api/fortune") || route.startsWith("/api/settings/")) {
        const publicPreview = route === "/api/fortune/preview";
        let auth = null;
        if (!publicPreview) {
          auth = await requireAuth(req, res, env);
          if (!auth) return;
        }
        const body = (req.method === "POST" || req.method === "PUT")
          ? await readBody(req) : {};
        const handled = await handleFortuneRoute(req.method, route, url.searchParams, body, await withHolding(authContext(auth)));
        if (handled) return json(res, handled.status, handled.body, withSession(req, auth?.setCookie));
      }

      // Ask Orbit — evidence-grounded astrology consultation + conversation
      // history. Owner-scoped: every request requires a Supabase Auth session.
      if (route === "/api/ask" || route.startsWith("/api/ask/")) {
        const auth = await requireAuth(req, res, env);
        if (!auth) return;
        const body = (req.method === "POST" || req.method === "PATCH")
          ? await readBody(req) : {};
        const handled = await handleAskRoute(req.method, route, url.searchParams, body, authContext(auth));
        if (handled) return json(res, handled.status, handled.body, withSession(req, auth?.setCookie));
      }

      if (route.startsWith("/api/")) return json(res, 404, { ok: false, error: "Unknown Orbit endpoint" });

      return serveStatic(res, route);
    } catch (err) {
      // A deployment must not return an internal message or a stack trace to
      // the browser. Locally the message is kept, because that is the whole
      // point of a development server.
      if (env.isDeployed || env.isProduction || env.isPreview) {
        console.error(`[orbit] unhandled error on ${route}`);
        return json(res, 500, { ok: false, error: "Something went wrong." });
      }
      return json(res, 500, { ok: false, error: err.message });
    }
  };
}

// ── Factory ──────────────────────────────────────────────────────────────────
// The single place every entry point goes through. The environment guard runs
// here — before a port is bound, before a service-role client could be built,
// before any database request — so an unsafe configuration stops at creation
// time with a readable message rather than at some later request.
//
// Throws EnvironmentSafetyError when the configuration is unsafe; callers
// decide whether to exit the process (server.js) or fail the invocation
// (api/index.js).
export function createOrbitApp({ env = null } = {}) {
  const info = assertStartupSafe(env ?? resolveEnvironment());
  const handler = createRequestHandler(info);
  handler.orbitEnvironment = info;
  return handler;
}

export { PUBLIC_DIR, requestOrigin, signupConfirmationRedirect, passwordResetRedirect };
