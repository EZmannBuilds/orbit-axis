import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authenticateRequest,
  getSessionCookie,
  sessionCookie,
  SESSION_COOKIE_MAX_AGE,
  signInWithPassword,
} from "../lib/auth/supabase-auth.js";

function withEnv(values, fn) {
  const old = {};
  for (const [key, value] of Object.entries(values)) {
    old[key] = process.env[key];
    process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(values)) {
        if (old[key] === undefined) delete process.env[key];
        else process.env[key] = old[key];
      }
    });
}

function reqWithCookie(cookie) {
  return { headers: { cookie } };
}

test("returning after access-token expiry retains the cookie and refreshes the session", async () => {
  const issuedAt = Date.now() - 2 * 3600_000;
  const cookie = sessionCookie({ access_token: "expired-access", refresh_token: "refresh",
    expires_at: Math.floor(issuedAt / 1000) + 3600, expires_in: 3600 });
  const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)[1]);
  assert.equal(maxAge, SESSION_COOKIE_MAX_AGE);
  assert.ok(issuedAt + maxAge * 1000 > Date.now(), "the browser still has its refresh credential two hours later");
  await withEnv({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon" }, async () => {
    const original = globalThis.fetch;
    let refreshed = false;
    globalThis.fetch = async (url) => {
      assert.match(url, /grant_type=refresh_token/);
      refreshed = true;
      return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, user: { id: "synthetic" } }));
    };
    try {
      const result = await authenticateRequest(reqWithCookie(cookie));
      assert.equal(result.ok, true);
      assert.equal(refreshed, true);
      assert.match(result.setCookie, /HttpOnly; SameSite=Lax/);
    } finally { globalThis.fetch = original; }
  });
});

test("session cookie stores only session fields needed for restoration", () => {
  const cookie = sessionCookie({
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 3600,
    user: { id: "user-1", email: "test@example.com", app_metadata: { role: "ignored" } },
  });
  const parsed = getSessionCookie(reqWithCookie(cookie));
  assert.equal(parsed.access_token, "access-token");
  assert.equal(parsed.refresh_token, "refresh-token");
  assert.deepEqual(parsed.user, { id: "user-1", email: "test@example.com" });
  assert.equal(parsed.user.app_metadata, undefined);
});

test("signInWithPassword calls Supabase password grant without exposing credentials in result", async () => {
  await withEnv({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon" }, async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        user: { id: "user-1", email: "test@example.com" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const result = await signInWithPassword({ email: "test@example.com", password: "password123" });
      assert.equal(result.ok, true);
      assert.equal(result.user.email, "test@example.com");
      assert.equal(result.user.password, undefined);
      assert.equal(calls[0].url, "https://example.supabase.co/auth/v1/token?grant_type=password");
      assert.equal(calls[0].options.headers.apikey, "anon");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("authenticateRequest refreshes an expiring session and returns a Set-Cookie header", async () => {
  await withEnv({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon" }, async () => {
    const cookie = sessionCookie({
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_in: 1,
      user: { id: "user-1", email: "test@example.com" },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
      user: { id: "user-1", email: "test@example.com" },
    }), { status: 200, headers: { "content-type": "application/json" } });
    try {
      const auth = await authenticateRequest(reqWithCookie(cookie));
      assert.equal(auth.ok, true);
      assert.equal(auth.user.id, "user-1");
      assert.match(auth.setCookie, /oa_session=/);
      assert.equal(auth.session.access_token, "new-access");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("authenticateRequest clears invalid sessions", async () => {
  await withEnv({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon" }, async () => {
    const cookie = sessionCookie({
      access_token: "bad-access",
      refresh_token: "refresh",
      expires_in: 3600,
      user: { id: "user-1", email: "test@example.com" },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "invalid JWT" }), { status: 401 });
    try {
      const auth = await authenticateRequest(reqWithCookie(cookie));
      assert.equal(auth.ok, false);
      assert.equal(auth.expired, true);
      assert.match(auth.setCookie, /Max-Age=0/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
