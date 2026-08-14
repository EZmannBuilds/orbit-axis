import { supabaseConfig } from "../local-llm/config.js";

export const SESSION_COOKIE = "oa_session";

function authBase() {
  const { url, anonKey } = supabaseConfig();
  if (!url || !anonKey) return { ready: false };
  return { ready: true, root: url.replace(/\/+$/, ""), anonKey };
}

function safeUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email || "" };
}

function encodeSession(session) {
  return Buffer.from(JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
    user: safeUser(session.user),
  }), "utf8").toString("base64url");
}

function decodeSession(value) {
  if (!value) return null;
  try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { return null; }
}

export function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(header.split(";").map(part => {
    const [name, ...rest] = part.trim().split("=");
    return [name, decodeURIComponent(rest.join("=") || "")];
  }).filter(([name]) => name));
}

export function getSessionCookie(req) {
  return decodeSession(parseCookies(req)[SESSION_COOKIE]);
}

// ── The native container's session (Update 1.1.2) ────────────────────────────
// The iOS app is served from capacitor://localhost and calls an API on another
// origin. Every request it makes is therefore CROSS-ORIGIN, and a cross-origin
// fetch with `credentials: "same-origin"` neither sends a cookie nor keeps the
// one a response sets. The app could sign in — the POST succeeded and returned
// a user — and then held nothing, so the next request was a 401. That is the
// whole defect: `/api/charts` answered 200 with the cookie and 401 without it.
//
// Loosening the cookie instead was considered and rejected. Sending it
// cross-site needs SameSite=None, which requires Secure, which a plain-HTTP
// local dev server cannot set — and WKWebView's tracking prevention may refuse
// the cookie anyway. It would trade a defect that is visible for one that
// depends on the platform's mood.
//
// So the native container carries the SAME opaque session blob in an
// Authorization header. Not a second session format: byte for byte the value
// the cookie holds, so refresh, expiry, and the Supabase check below are
// reached by one code path no matter which container asked.

const NATIVE_ORIGINS = ["capacitor://", "ionic://"];

/**
 * Is this request from the native app shell rather than a web page?
 *
 * `Origin` is set by the user agent and cannot be written by page script, so a
 * browser can never claim to be the container. That is what makes it safe to
 * hand this caller the session in a readable header: the guarantee that page
 * JavaScript cannot reach an HttpOnly cookie is preserved exactly, because the
 * only caller that gets a readable copy is one no browser can impersonate.
 */
export function isNativeOrigin(req) {
  const origin = String(req?.headers?.origin || "").toLowerCase();
  return NATIVE_ORIGINS.some(scheme => origin.startsWith(scheme));
}

/** The bearer token on a request, if it carries one. */
function bearerToken(req) {
  const header = String(req?.headers?.authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : "";
}

/**
 * The session on a request, from the cookie or the Authorization header.
 *
 * The cookie is preferred, so a browser behaves exactly as it did before this
 * existed — an unchanged code path, not a new one that happens to agree.
 */
export function readSessionToken(req) {
  const cookie = parseCookies(req)[SESSION_COOKIE];
  if (cookie) return decodeSession(cookie);
  return decodeSession(bearerToken(req));
}

/**
 * Decode a session blob, or null if the value is not one.
 *
 * Exported so the v1 API can tell Orbit's own session apart from the raw
 * Supabase access token its public contract also accepts. A JWT is not
 * base64url-encoded JSON with an access_token in it, so the two never collide.
 */
export function decodeSessionToken(value) {
  const session = decodeSession(value);
  return session?.access_token ? session : null;
}

/**
 * The blob out of a Set-Cookie string, so the native container can be handed
 * the same value the cookie carries without the session being encoded twice.
 *
 * Sign-out produces an empty value, which is the instruction to forget it.
 */
export function sessionTokenFromCookie(setCookie) {
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]*)`).exec(String(setCookie || ""));
  return match ? match[1] : "";
}

// ── Cookie security (Update 4.0.3) ───────────────────────────────────────────
// The session cookie carries a Supabase access token, so it must be Secure
// anywhere the connection is HTTPS. Orbit sits behind Vercel's proxy, which
// terminates TLS and forwards the original scheme in x-forwarded-proto — the
// socket itself is plain HTTP, so `req.socket.encrypted` would wrongly report
// an insecure connection and the flag would never be set.
//
// The forwarded header is only trusted when the resolved environment says this
// process really is a Vercel deployment. On a deployment we additionally set
// Secure unconditionally: a deployed Orbit is always served over HTTPS, so an
// absent or stripped header must not be able to downgrade the cookie.
//
// Local HTTP development deliberately does not set Secure, because a Secure
// cookie is discarded by browsers over http://localhost in some contexts and
// that would silently break sign-in locally.
export function isSecureRequest(req, env = null) {
  if (env?.isDeployed) return true;
  const forwarded = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (forwarded) {
    // Only a deployment context may speak for the original scheme. Anyone can
    // send this header to a local server.
    if (env?.isVercel) return forwarded === "https";
    return false;
  }
  return Boolean(req?.socket?.encrypted);
}

function cookieAttributes(req, env) {
  const attrs = ["HttpOnly", "SameSite=Lax", "Path=/"];
  if (isSecureRequest(req, env)) attrs.push("Secure");
  return attrs.join("; ");
}

// `context` is { req, env }. Both are optional so existing callers and tests
// that only pass a session keep working — they simply get the local, non-Secure
// attributes, which is the correct answer for a plain HTTP local server.
export function sessionCookie(session, context = {}) {
  const maxAge = Math.max(60, Number(session.expires_in || 3600));
  return `${SESSION_COOKIE}=${encodeSession(session)}; ${cookieAttributes(context.req, context.env)}; Max-Age=${maxAge}`;
}

export function clearSessionCookie(context = {}) {
  return `${SESSION_COOKIE}=; ${cookieAttributes(context.req, context.env)}; Max-Age=0`;
}

async function supabaseAuth(path, { method = "GET", token = "", body = null } = {}) {
  const base = authBase();
  if (!base.ready) return { ok: false, status: 503, data: { error: "Supabase is not configured." } };
  const headers = { apikey: base.anonKey, "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base.root}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  return { ok: res.ok, status: res.status, data };
}

export async function signUpWithPassword({ email, password, redirectTo = "" }) {
  const path = redirectTo
    ? `/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`
    : "/auth/v1/signup";
  const result = await supabaseAuth(path, { method: "POST", body: { email, password } });
  if (!result.ok) return result;
  const session = result.data.session || (result.data.access_token ? result.data : null);
  return { ...result, session, user: safeUser(result.data.user || session?.user) };
}

export async function signInWithPassword({ email, password }) {
  const result = await supabaseAuth("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
  if (!result.ok) return result;
  return { ...result, session: result.data, user: safeUser(result.data.user) };
}

export async function refreshSession(session) {
  if (!session?.refresh_token) return { ok: false, status: 401, data: { error: "No refresh token." } };
  const result = await supabaseAuth("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: session.refresh_token },
  });
  if (!result.ok) return result;
  return { ...result, session: result.data, user: safeUser(result.data.user) };
}

export async function getSupabaseUser(accessToken) {
  if (!accessToken) return { ok: false, status: 401, data: { error: "No access token." } };
  const result = await supabaseAuth("/auth/v1/user", { token: accessToken });
  if (!result.ok) return result;
  return { ...result, user: safeUser(result.data) };
}

export async function signOutSupabase(accessToken) {
  if (!accessToken) return { ok: true, status: 200, data: {} };
  return supabaseAuth("/auth/v1/logout", { method: "POST", token: accessToken });
}

// `env` is the resolved environment. It is threaded through so every cookie
// this function re-issues (on refresh, and on expiry) carries the same security
// attributes as the one issued at sign-in — otherwise a refresh silently
// downgrades a Secure cookie to a non-Secure one on a deployment.
export async function authenticateRequest(req, env = null) {
  const context = { req, env };
  const stored = readSessionToken(req);
  if (!stored?.access_token) return { ok: false, user: null, session: null, setCookie: null };

  const expiresAtMs = Number(stored.expires_at || 0) * 1000;
  if (expiresAtMs && expiresAtMs - Date.now() < 60000 && stored.refresh_token) {
    const refreshed = await refreshSession(stored);
    if (!refreshed.ok || !refreshed.session?.access_token) {
      return { ok: false, user: null, session: null, setCookie: clearSessionCookie(context), expired: true };
    }
    return {
      ok: true,
      user: refreshed.user,
      session: refreshed.session,
      setCookie: sessionCookie(refreshed.session, context),
    };
  }

  const user = await getSupabaseUser(stored.access_token);
  if (!user.ok) return { ok: false, user: null, session: null, setCookie: clearSessionCookie(context), expired: true };
  return { ok: true, user: user.user, session: stored, setCookie: null };
}

// ── Password reset ──────────────────────────────────────────────────────────
// Two steps, deliberately separate:
//
//   1. requestPasswordReset  — Supabase emails a recovery link.
//   2. updatePassword        — the token from that link authorises one change.
//
// Orbit never sees, stores, or transports the new password anywhere except the
// single request that sets it. No reset token is written to a cookie: a
// recovery token is a one-time credential, and persisting it would turn a
// forwarded email into a durable account takeover.

/**
 * Ask Supabase to email a recovery link.
 *
 * The caller is expected to return the SAME response whether or not the address
 * has an account. That is why this function reports transport success rather
 * than account existence — an endpoint that answers "no such user" lets anyone
 * test which email addresses are registered.
 */
export async function requestPasswordReset({ email, redirectTo = "" }) {
  const path = redirectTo
    ? `/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`
    : "/auth/v1/recover";
  return supabaseAuth(path, { method: "POST", body: { email } });
}

/**
 * Set a new password using the recovery access token from the emailed link.
 *
 * Supabase validates the token itself; an expired, reused, or forged token is
 * rejected upstream. Orbit does not try to second-guess that — it forwards the
 * token and translates the outcome.
 */
export async function updatePassword({ accessToken, password }) {
  if (!accessToken) return { ok: false, status: 401, data: { error: "This reset link is missing its token." } };
  const result = await supabaseAuth("/auth/v1/user", {
    method: "PUT",
    token: accessToken,
    body: { password },
  });
  if (!result.ok) return result;
  return { ...result, user: safeUser(result.data) };
}

/**
 * Exchange a recovery token_hash for a session.
 *
 * Newer Supabase recovery links carry `token_hash` and `type` as query
 * parameters rather than a session in the URL fragment. Both shapes reach the
 * same place, so the callback handles either.
 */
export async function verifyRecoveryToken({ tokenHash, type = "recovery" }) {
  if (!tokenHash) return { ok: false, status: 400, data: { error: "This reset link is incomplete." } };
  const result = await supabaseAuth("/auth/v1/verify", {
    method: "POST",
    body: { token_hash: tokenHash, type },
  });
  if (!result.ok) return result;
  return { ...result, session: result.data, user: safeUser(result.data.user) };
}
