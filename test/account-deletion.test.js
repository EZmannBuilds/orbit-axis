// Orbit Axis :: account deletion.
//
// Every destructive path is exercised with injected doubles rather than against
// the hosted database. Failure modes matter more than the happy path here — the
// happy path is verified end-to-end against the real project by
// scripts/deletion-check.js, but "what happens when Supabase is down halfway
// through" cannot be tested by breaking a real database on purpose.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deleteAccount, DELETION_CONFIRMATION, AccountDeletionError, USER_OWNED_TABLES,
} from "../lib/account/deletion.js";
import { remove, bearerToken } from "../lib/api/v1/handlers/account.js";
import { handleApiV1, ROUTE_TABLE, createLimiters } from "../lib/api/v1/router.js";
import { SESSION_COOKIE } from "../lib/auth/supabase-auth.js";

const USER_ID = "11111111-2222-3333-4444-555555555555";

const okUser = async () => ({ ok: true, user: { id: USER_ID } });

/** A fetch double whose behaviour per URL fragment is declared by the test. */
function fakeFetch(routes) {
  return async (url, init = {}) => {
    for (const [fragment, reply] of Object.entries(routes)) {
      if (String(url).includes(fragment)) {
        const r = typeof reply === "function" ? await reply(url, init) : reply;
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          headers: { get: (h) => (h.toLowerCase() === "content-range" ? r.contentRange ?? "0-0/0" : null) },
          // Storage listing (Dev Update 1.10) reads bodies; an undeclared
          // route answers "empty bucket" so pre-avatar tests stay honest.
          json: async () => r.json ?? [],
        };
      }
    }
    return { ok: true, status: 200, headers: { get: () => "0-0/0" }, json: async () => [] };
  };
}

const CLEAN = { "/auth/v1/logout": { status: 204 }, "/auth/v1/admin/users/": { status: 200 } };

test("billing cancellation completes before avatar removal or identity deletion", async () => {
  const order = [];
  await withServiceKey(() => deleteAccount({
    accessToken: "t", confirmation: DELETION_CONFIRMATION, verifyUser: okUser,
    cancelBilling: async ({ ownerId }) => { assert.equal(ownerId, USER_ID); order.push("billing"); },
    fetchImpl: async (url, init) => { order.push(url); return fakeFetch(CLEAN)(url, init); },
  }));
  assert.equal(order[0], "billing");
  assert.ok(order.some((url) => url.includes("/auth/v1/admin/users/")));
});

test("a failed billing cancellation leaves the identity, avatars, and session untouched", async () => {
  let touched = false;
  const error = await withServiceKey(() => caught(() => deleteAccount({
    accessToken: "t", confirmation: DELETION_CONFIRMATION, verifyUser: okUser,
    cancelBilling: async () => { throw new Error("Stripe unavailable"); },
    fetchImpl: async () => { touched = true; throw new Error("unexpected request"); },
  })));
  assert.equal(error.stage, "billing");
  assert.equal(error.retryable, true);
  assert.equal(touched, false);
});

function withServiceKey(run) {
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const savedUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://exampleprojectref000.supabase.co";
  return Promise.resolve(run()).finally(() => {
    if (saved === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
    if (savedUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = savedUrl;
  });
}

const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ── Confirmation ────────────────────────────────────────────────────────────

test("deletion refuses without the typed confirmation", async () => {
  for (const attempt of ["", "delete", "Delete", "yes", "DELETE ", null, undefined, true]) {
    const error = await caught(() => deleteAccount({ cancelBilling: async () => {}, accessToken: "t", confirmation: attempt }));
    assert.ok(error instanceof AccountDeletionError, `"${attempt}" must not delete an account`);
    assert.equal(error.stage, "confirmation");
  }
});

test("the confirmation is checked before anything else happens", async () => {
  // If confirmation were checked after identity lookup, a mistyped confirmation
  // would still cost a network round trip and, worse, imply the order of checks
  // is negotiable.
  let touched = false;
  await caught(() => deleteAccount({ cancelBilling: async () => {},
    accessToken: "t",
    confirmation: "nope",
    verifyUser: async () => { touched = true; return okUser(); },
    fetchImpl: async () => { touched = true; return { ok: true, status: 200 }; },
  }));
  assert.equal(touched, false, "nothing may be contacted before the confirmation is valid");
});

// ── Identity ────────────────────────────────────────────────────────────────

test("deletion refuses without a token", async () => {
  const error = await caught(() => deleteAccount({ cancelBilling: async () => {}, accessToken: "", confirmation: DELETION_CONFIRMATION }));
  assert.equal(error.stage, "authentication");
});

test("an unverifiable token deletes nothing", async () => {
  let deleteAttempted = false;
  const error = await caught(() => deleteAccount({ cancelBilling: async () => {},
    accessToken: "stolen-or-expired",
    confirmation: DELETION_CONFIRMATION,
    verifyUser: async () => ({ ok: false }),
    fetchImpl: async (url, init) => {
      if (init?.method === "DELETE") deleteAttempted = true;
      return { ok: true, status: 200, headers: { get: () => "0-0/0" } };
    },
  }));
  assert.equal(error.stage, "authentication");
  assert.equal(deleteAttempted, false, "no delete may be issued for an unverified token");
});

test("the id comes from the verified token, never from the caller", async () => {
  const victim = "99999999-9999-9999-9999-999999999999";
  const urls = [];
  await withServiceKey(() => deleteAccount({ cancelBilling: async () => {},
    accessToken: "attacker-token",
    confirmation: DELETION_CONFIRMATION,
    // The attacker owns this identity...
    verifyUser: okUser,
    fetchImpl: fakeFetch({
      "/auth/v1/logout": { status: 204 },
      "/auth/v1/admin/users/": (url, init) => { urls.push(`${init.method} ${url}`); return { status: 200 }; },
      "/rest/v1/": { status: 200, contentRange: "*/0" },
    }),
  }));
  const deletes = urls.filter((u) => u.startsWith("DELETE"));
  assert.equal(deletes.length, 1);
  assert.ok(deletes[0].includes(USER_ID), "must delete the token's own user");
  assert.ok(!deletes[0].includes(victim), "must never delete an id supplied by the caller");
});

// ── The cascade is verified, not trusted ────────────────────────────────────

test("surviving rows are reported as an incomplete deletion, not as success", async () => {
  const error = await withServiceKey(() => caught(() => deleteAccount({ cancelBilling: async () => {},
    accessToken: "t",
    confirmation: DELETION_CONFIRMATION,
    verifyUser: okUser,
    fetchImpl: fakeFetch({
      "/auth/v1/logout": { status: 204 },
      "/auth/v1/admin/users/": { status: 200 },
      // One table still holds rows after the cascade should have cleared it.
      "/rest/v1/birth_profiles": { status: 200, contentRange: "0-0/3" },
      "/rest/v1/": { status: 200, contentRange: "*/0" },
    }),
  })));
  assert.ok(error instanceof AccountDeletionError);
  assert.equal(error.stage, "verification");
  assert.equal(error.retryable, true, "the person must be able to try again");
});

test("a table that cannot be checked counts as a survivor, not as clean", async () => {
  // "I could not verify" must never be reported as "verified empty", or the
  // verification step is decoration.
  const error = await withServiceKey(() => caught(() => deleteAccount({ cancelBilling: async () => {},
    accessToken: "t",
    confirmation: DELETION_CONFIRMATION,
    verifyUser: okUser,
    fetchImpl: fakeFetch({
      "/auth/v1/logout": { status: 204 },
      "/auth/v1/admin/users/": { status: 200 },
      "/rest/v1/ask_messages": { status: 500 },
      "/rest/v1/": { status: 200, contentRange: "*/0" },
    }),
  })));
  assert.equal(error.stage, "verification");
});

test("a clean cascade reports success and says how much was checked", async () => {
  const result = await withServiceKey(() => deleteAccount({ cancelBilling: async () => {},
    accessToken: "t",
    confirmation: DELETION_CONFIRMATION,
    verifyUser: okUser,
    fetchImpl: fakeFetch({ ...CLEAN, "/rest/v1/": { status: 200, contentRange: "*/0" } }),
  }));
  assert.equal(result.deleted, true);
  assert.equal(result.tablesVerified, USER_OWNED_TABLES.length);
  assert.ok(USER_OWNED_TABLES.length >= 16, "the schema has at least sixteen user-owned tables");
});

// ── Partial failure and retry ───────────────────────────────────────────────

test("a failed identity delete does not claim success", async () => {
  const error = await withServiceKey(() => caught(() => deleteAccount({ cancelBilling: async () => {},
    accessToken: "t",
    confirmation: DELETION_CONFIRMATION,
    verifyUser: okUser,
    fetchImpl: fakeFetch({ "/auth/v1/logout": { status: 204 }, "/auth/v1/admin/users/": { status: 503 } }),
  })));
  assert.equal(error.stage, "auth_delete");
  assert.equal(error.retryable, true, "a 503 is worth retrying");
});

test("a network failure mid-delete does not claim already-swept data was preserved", async () => {
  const error = await withServiceKey(() => caught(() => deleteAccount({ cancelBilling: async () => {},
    accessToken: "t",
    confirmation: DELETION_CONFIRMATION,
    verifyUser: okUser,
    fetchImpl: async (url, init) => {
      if (init?.method === "DELETE") throw new Error("ECONNRESET");
      return { ok: true, status: 204, headers: { get: () => "0-0/0" } };
    },
  })));
  assert.equal(error.stage, "auth_delete");
  assert.doesNotMatch(error.message, /Nothing was removed/);
});

test("retrying after the identity is already gone succeeds", async () => {
  // A 404 means a previous attempt got there. The caller asked for the account
  // not to exist, and it does not — that is success, not an error to show
  // someone who has already deleted their account.
  const result = await withServiceKey(() => deleteAccount({ cancelBilling: async () => {},
    accessToken: "t",
    confirmation: DELETION_CONFIRMATION,
    verifyUser: okUser,
    fetchImpl: fakeFetch({
      "/auth/v1/logout": { status: 204 },
      "/auth/v1/admin/users/": { status: 404 },
      "/rest/v1/": { status: 200, contentRange: "*/0" },
    }),
  }));
  assert.equal(result.deleted, true);
  assert.equal(result.alreadyGone, true);
});

test("a failed session revocation does not abort the deletion", async () => {
  // Deleting the identity invalidates tokens anyway. Aborting here would strand
  // someone who has already been told their account is going away.
  const result = await withServiceKey(() => deleteAccount({ cancelBilling: async () => {},
    accessToken: "t",
    confirmation: DELETION_CONFIRMATION,
    verifyUser: okUser,
    fetchImpl: fakeFetch({
      "/auth/v1/logout": { status: 500 },
      "/auth/v1/admin/users/": { status: 200 },
      "/rest/v1/": { status: 200, contentRange: "*/0" },
    }),
  }));
  assert.equal(result.deleted, true);
  assert.equal(result.sessionsRevoked, false, "but the failure is reported honestly");
});

test("sessions are revoked before the identity is destroyed", async () => {
  const order = [];
  await withServiceKey(() => deleteAccount({ cancelBilling: async () => {},
    accessToken: "t",
    confirmation: DELETION_CONFIRMATION,
    verifyUser: okUser,
    fetchImpl: fakeFetch({
      "/auth/v1/logout": () => { order.push("revoke"); return { status: 204 }; },
      "/auth/v1/admin/users/": (url, init) => {
        if (init.method === "DELETE") order.push("delete");
        return { status: 200 };
      },
      "/rest/v1/": { status: 200, contentRange: "*/0" },
    }),
  }));
  assert.deepEqual(order, ["revoke", "delete"],
    "once the identity is gone there is nobody left to revoke sessions for");
});

test("a missing service-role key fails closed", async () => {
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const error = await caught(() => deleteAccount({ cancelBilling: async () => {},
      accessToken: "t", confirmation: DELETION_CONFIRMATION, verifyUser: okUser,
    }));
    assert.equal(error.stage, "configuration");
  } finally {
    if (saved !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
  }
});

// ── The HTTP surface ────────────────────────────────────────────────────────

const mockReq = ({ method = "DELETE", url = "/api/v1/account", headers = {}, body = null } = {}) => {
  const chunks = body === null ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method, url,
    headers: { host: "localhost:3001", "content-type": "application/json", ...headers },
    socket: {},
    async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; },
    on(event, handler) {
      if (event === "data") chunks.forEach((c) => handler(c));
      if (event === "end") handler();
      return this;
    },
    destroy() {},
  };
};

test("an anonymous deletion request is refused", async () => {
  const error = await caught(() => remove({ confirmation: DELETION_CONFIRMATION }, { req: mockReq() }));
  assert.equal(error.code, "UNAUTHORIZED");
  assert.equal(error.status, 401);
});

test("the token is read from either a cookie or a bearer header", async () => {
  assert.equal(bearerToken(mockReq({ headers: { authorization: "Bearer abc123" } })), "abc123");
  const encoded = Buffer.from(JSON.stringify({ access_token: "cookie-token" })).toString("base64url");
  assert.equal(bearerToken(mockReq({ headers: { cookie: `${SESSION_COOKIE}=${encoded}` } })), "cookie-token");
  assert.equal(bearerToken(mockReq()), "");
});

test("a userId in the body is ignored entirely", async () => {
  // Not rejected with a special message — simply never read. The only id this
  // endpoint can act on is the one the token proves.
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../lib/api/v1/handlers/account.js", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /body\??\.\s*(userId|user_id|ownerId|owner_id)/,
    "the handler must never read an identity from the request body");
});

test("the wrong HTTP method cannot delete an account", async () => {
  for (const method of ["GET", "POST", "PUT", "PATCH"]) {
    const res = await handleApiV1(
      mockReq({ method, body: { confirmation: DELETION_CONFIRMATION } }),
      "/api/v1/account",
      { limiters: createLimiters() },
    );
    assert.equal(res.status, 405, `${method} must not reach the deletion handler`);
  }
});

test("deletion is rate limited far more tightly than calculation", async () => {
  const limiters = createLimiters();
  const req = () => mockReq({ headers: { authorization: "Bearer t" }, body: { confirmation: "nope" } });
  let sawRateLimit = false;
  for (let i = 0; i < 8; i += 1) {
    const res = await handleApiV1(req(), "/api/v1/account", { limiters });
    if (res.status === 429) { sawRateLimit = true; break; }
  }
  assert.ok(sawRateLimit, "a destructive endpoint must not accept unlimited attempts");
});

test("the deletion response never carries a token or a key", async () => {
  const res = await handleApiV1(
    mockReq({ body: { confirmation: "wrong" } }),
    "/api/v1/account",
    { limiters: createLimiters() },
  );
  const text = JSON.stringify(res.body);
  for (const forbidden of ["service_role", "eyJ", "sb_secret", "supabase.co", "/Users/", "SUPABASE_"]) {
    assert.ok(!text.includes(forbidden), `a deletion response must not contain ${forbidden}`);
  }
});

test("the account route is declared authenticated", () => {
  const route = ROUTE_TABLE.find((r) => r.path === "/api/v1/account");
  assert.ok(route, "the route must exist");
  assert.equal(route.access, "authenticated");
  assert.equal(route.method, "DELETE");
});

// ── Avatar cleanup (Dev Update 1.10) ────────────────────────────────────────

test("avatars are swept as the USER before sessions are revoked, and counted", async () => {
  const calls = [];
  const result = await withServiceKey(() => deleteAccount({ cancelBilling: async () => {},
    accessToken: "user-token",
    confirmation: DELETION_CONFIRMATION,
    verifyUser: okUser,
    fetchImpl: async (url, init = {}) => {
      const u = String(url);
      const auth = String(init.headers?.authorization || init.headers?.Authorization || "");
      calls.push({ url: u, auth, method: init.method || "GET" });
      const respond = (status, json = []) => ({
        ok: status < 300, status, json: async () => json,
        headers: { get: () => "0-0/0" },
      });
      if (u.includes("/storage/v1/object/list/chart-avatars")) {
        if (auth.includes("test-service-key")) return respond(200, []);   // verification: clean
        const prefix = JSON.parse(init.body || "{}").prefix || "";
        return prefix.endsWith(`${USER_ID}/`)
          ? respond(200, [{ name: "chart-1", id: null }])                 // one chart folder
          : respond(200, [{ name: "avatar.webp", id: "obj-1" }]);         // holding one object
      }
      if (u.includes("/storage/v1/object/chart-avatars/") && init.method === "DELETE") {
        return respond(200);
      }
      if (u.includes("/auth/v1/logout")) return respond(204);
      if (u.includes("/auth/v1/admin/users/")) return respond(200);
      return respond(200);
    },
  }));

  assert.equal(result.deleted, true);
  assert.equal(result.avatarsRemoved, 1);
  assert.equal(result.avatarSweepComplete, true);

  const objectDelete = calls.find((c) => c.url.includes("/storage/v1/object/chart-avatars/") && c.method === "DELETE");
  assert.ok(objectDelete, "the object was removed");
  assert.ok(objectDelete.auth.includes("user-token"),
    "removal runs under the user's own token and policies, never the service role");
  const firstSweep = calls.findIndex((c) => c.url.includes("/storage/v1/object/list/"));
  const logoutAt = calls.findIndex((c) => c.url.includes("/auth/v1/logout"));
  assert.ok(firstSweep > -1 && firstSweep < logoutAt,
    "the sweep must run while the user's token is still valid");
});

test("storage leftovers are survivors: verification refuses to call this success", async () => {
  const error = await caught(() => withServiceKey(() => deleteAccount({ cancelBilling: async () => {},
    accessToken: "user-token",
    confirmation: DELETION_CONFIRMATION,
    verifyUser: okUser,
    fetchImpl: fakeFetch({
      ...CLEAN,
      "/storage/v1/object/list/chart-avatars": (url, init) => {
        const auth = String(init.headers?.authorization || init.headers?.Authorization || "");
        if (!auth.includes("test-service-key")) return { status: 500 };    // the user sweep failed outright
        const prefix = JSON.parse(init.body || "{}").prefix || "";
        return prefix.endsWith(`${USER_ID}/`)
          ? { status: 200, json: [{ name: "chart-9", id: null }] }
          : { status: 200, json: [{ name: "avatar.webp", id: "leftover" }] };
      },
    }),
  })));
  assert.ok(error instanceof AccountDeletionError);
  assert.equal(error.stage, "verification",
    "an orphaned object reads as incomplete deletion, never as success");
});

test("an unverifiable bucket also refuses success — unknown is not clean", async () => {
  const error = await caught(() => withServiceKey(() => deleteAccount({ cancelBilling: async () => {},
    accessToken: "user-token",
    confirmation: DELETION_CONFIRMATION,
    verifyUser: okUser,
    fetchImpl: fakeFetch({
      ...CLEAN,
      "/storage/v1/object/list/chart-avatars": { status: 503 },
    }),
  })));
  assert.ok(error instanceof AccountDeletionError);
  assert.equal(error.stage, "verification");
});
