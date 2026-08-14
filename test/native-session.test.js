// Orbit Axis :: the native container's session (Update 1.1.2).
//
// THE DEFECT. The iOS app is served from capacitor://localhost and calls an API
// on another origin, so every request it makes is cross-origin. A cross-origin
// fetch with `credentials: "same-origin"` neither sends a cookie nor keeps one
// a response sets. Sign-in therefore succeeded — 200, with the user — and the
// app held nothing: the next request was a 401, which is what put "We couldn't
// load your saved charts" on screen while the account page still said "Signed
// in as". Measured, not inferred: /api/charts answered 200 with the cookie and
// 401 without it.
//
// THE FIX. The container carries the same opaque session blob in Authorization,
// and the server hands it out in a readable header — but ONLY to an Origin no
// browser can produce.
//
// THE INVARIANT THESE TESTS EXIST FOR. That last clause is the whole security
// argument. If the session header ever reaches a web origin, an XSS on the web
// app can read a refresh token that HttpOnly was there to protect. Every test
// below that names an origin is guarding that one sentence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  decodeSessionToken,
  isNativeOrigin,
  readSessionToken,
  sessionCookie,
  sessionTokenFromCookie,
} from "../lib/auth/supabase-auth.js";
import { isAllowedOrigin } from "../lib/api/v1/router.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const SESSION = {
  access_token: "access-token-value",
  refresh_token: "refresh-token-value",
  expires_in: 3600,
  user: { id: "user-1", email: "reader@example.com" },
};

/** A request object shaped like the bits these functions actually read. */
const req = (headers = {}) => ({ headers });

// ── Who counts as the container ─────────────────────────────────────────────

test("only a native scheme is treated as the app container", () => {
  for (const origin of ["capacitor://localhost", "ionic://localhost", "CAPACITOR://localhost"]) {
    assert.equal(isNativeOrigin(req({ origin })), true, `${origin} is the app shell`);
  }
});

test("no web origin can claim to be the container", () => {
  // The attack this prevents: a page that convinces the server to hand it the
  // session in a readable header. Origin is written by the user agent and is
  // not settable from page script, so the only defence needed is not being
  // fooled by something that merely LOOKS native.
  const impostors = [
    "https://orbit-axis.vercel.app",
    "http://localhost:3005",
    "https://capacitor.example.com",          // the word, in a real hostname
    "https://evil.test/capacitor://localhost", // the scheme, in a path
    "null",
    "",
  ];
  for (const origin of impostors) {
    assert.equal(isNativeOrigin(req({ origin })), false, `${origin} must not be trusted`);
  }
  assert.equal(isNativeOrigin(req()), false, "a request with no Origin is not the container");
});

// ── The session travels one way or the other, never in two formats ──────────

test("the bearer token is the same blob the cookie carries", () => {
  const cookie = sessionCookie(SESSION);
  const blob = sessionTokenFromCookie(cookie);

  assert.ok(blob, "a Set-Cookie must yield a token for the container");
  assert.deepEqual(
    readSessionToken(req({ authorization: `Bearer ${blob}` })),
    readSessionToken(req({ cookie })),
    "cookie and bearer must decode to one identical session");
});

test("sign-out yields an empty token, which is the instruction to forget it", () => {
  // clearSessionCookie() produces `oa_session=; ...`. The container must be
  // able to tell that apart from "no header", which means "leave it alone".
  assert.equal(sessionTokenFromCookie("oa_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"), "");
});

test("the cookie is preferred, so a browser's code path is unchanged", () => {
  // Not a style point. If the bearer won, the browser would start exercising a
  // path it never used, and the "web is untouched" claim would be untestable.
  const mine = sessionCookie(SESSION);
  const other = sessionTokenFromCookie(sessionCookie({ ...SESSION, access_token: "someone-else" }));
  const resolved = readSessionToken(req({ cookie: mine, authorization: `Bearer ${other}` }));
  assert.equal(resolved.access_token, "access-token-value");
});

test("a request carrying neither has no session", () => {
  assert.equal(readSessionToken(req()), null);
  assert.equal(readSessionToken(req({ authorization: "Bearer not-a-session" })), null);
  assert.equal(readSessionToken(req({ authorization: "Basic abc" })), null);
});

// ── The v1 API's two kinds of bearer ────────────────────────────────────────

test("a Supabase access token is not mistaken for an Orbit session", () => {
  // v1's public contract accepts a raw Supabase JWT. The container sends a
  // session blob. Both arrive as `Authorization: Bearer …`, so the only thing
  // separating them is that one decodes and the other does not.
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature";
  assert.equal(decodeSessionToken(jwt), null, "a JWT is not an Orbit session");
  assert.equal(decodeSessionToken(""), null);
  assert.equal(decodeSessionToken("bm90LWpzb24"), null, "base64 that is not JSON");

  const blob = sessionTokenFromCookie(sessionCookie(SESSION));
  assert.equal(decodeSessionToken(blob)?.access_token, "access-token-value");
});

test("v1 unwraps an Orbit session but passes a raw token through", () => {
  const account = read("lib/api/v1/handlers/account.js");
  assert.match(account, /decodeSessionToken\(raw\)\?\.access_token \|\| raw/,
    "an unrecognised bearer must still be forwarded as an access token");
});

// ── CORS: the container is allowed, and nothing else changed ────────────────

test("the v1 router allows the container's origin", () => {
  const env = {};
  assert.equal(isAllowedOrigin("capacitor://localhost", env), true);
  assert.equal(isAllowedOrigin("ionic://localhost", env), true);
});

test("allowing the container did not widen the origin allowlist", () => {
  // The new branch matches on PROTOCOL. A hostname or path that merely
  // contains the word must still be refused.
  const env = {};
  for (const origin of [
    "https://capacitor.evil.test",
    "http://capacitor.localhost",
    "capacitorx://localhost",
    "https://evil.test",
  ]) {
    assert.equal(isAllowedOrigin(origin, env), false, `${origin} must stay out`);
  }
});

test("the session header is exposed and Authorization is allowed", () => {
  // Without both of these the browser layer inside the WebView silently drops
  // what the server sent, and the fix would look like a server bug.
  const server = read("lib/server/create-app.js");
  assert.match(server, /"Access-Control-Expose-Headers": SESSION_HEADER/);
  assert.match(server, /"Access-Control-Allow-Headers": "Content-Type, Authorization"/);
});

test("every session response goes through the one helper", () => {
  // The header must not be attachable at 15 separate call sites, because the
  // origin check is what keeps it away from the web and one of them would
  // eventually forget it.
  const server = read("lib/server/create-app.js");
  const literals = server.match(/\{ "Set-Cookie":/g) || [];
  assert.equal(literals.length, 1,
    "only withSession() may build a Set-Cookie header");
  assert.match(server, /if \(isNativeOrigin\(req\)\) headers\[SESSION_HEADER\]/,
    "the session header must be behind the origin check");
});

// ── The browser build is untouched ──────────────────────────────────────────

test("every session function in the adapter is behind isNativeApp()", () => {
  // Read as source: the guarantee is structural. A browser must not read,
  // write, or send a token, so each of these returns early.
  const platform = read("public/platform.js");
  for (const fn of ["sessionToken", "rememberSession", "clearSession"]) {
    const body = new RegExp(
      `export function ${fn}\\([^)]*\\) \\{\\n  if \\(!isNativeApp\\(\\)\\) return`);
    assert.match(platform, body, `${fn}() must do nothing in a browser`);
  }
});

test("in a browser the adapter contributes no header and stores nothing", async () => {
  // Proven by RUNNING it, not by reading it. This process has no Capacitor
  // global, so isNativeApp() is false — which is exactly the browser case.
  // A structural test would have passed even if the early returns were wrong.
  const { authHeaders, sessionToken, rememberSession, clearSession } =
    await import("../public/platform.js");

  assert.deepEqual(authHeaders(), {}, "a browser request must gain no header");
  assert.equal(sessionToken(), "", "a browser must never hold a token");

  // If these touched storage in a browser, the calls below would throw here —
  // there is no localStorage in Node, and the early return is why they do not.
  let read = false;
  rememberSession({ headers: { get: () => { read = true; return "a-token"; } } });
  clearSession();
  assert.equal(read, false, "a browser must not even look for the header");
  assert.equal(sessionToken(), "", "and must still hold nothing afterwards");
});

test("the app reads the session off every response, not just sign-in", () => {
  // The server rotates the session near expiry. A container that only read the
  // header after sign-in would present a replaced token and be signed out
  // mid-use, which is the kind of bug that gets blamed on the network.
  const appJs = read("public/app.js");
  const calls = appJs.match(/rememberSession\(/g) || [];
  assert.ok(calls.length >= 5,
    `every authenticated fetch must read the header; found ${calls.length}`);

  const attaches = appJs.match(/\.\.\.authHeaders\(\)/g) || [];
  assert.equal(attaches.length, calls.length,
    "every request that sends the session must also read a rotated one back");
});
