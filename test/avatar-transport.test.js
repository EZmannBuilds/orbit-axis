// Orbit Axis :: avatar HTTP transport.
//
// The endpoints existed before this layer and were unreachable: the chart
// dispatcher read every body as a UTF-8 string, which is right for JSON and
// destroys a WebP. These tests pin the plumbing that carries exact bytes in
// and exact bytes out, and the limits that stop a hostile client buffering
// whatever it likes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "lib", "server", "create-app.js"), "utf8");
const API = readFileSync(join(ROOT, "lib", "charts", "api.js"), "utf8");

function block(src, from, to) {
  const a = src.indexOf(from);
  assert.ok(a > -1, `anchor missing: ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `end anchor missing: ${to}`);
  return src.slice(a, b);
}

// ── Bytes in ────────────────────────────────────────────────────────────────

test("avatar uploads are read as bytes, not concatenated into a string", () => {
  const reader = block(APP, "function readBytes(", "function binary(");
  assert.match(reader, /Buffer\.concat\(chunks\)/, "the exact bytes survive");
  assert.ok(!/data \+= chunk/.test(reader),
    "string concatenation is what corrupts a WebP");
  // And the JSON reader is untouched for every other route.
  const json = block(APP, "function readBody(req) {", "function readBytes(");
  assert.match(json, /data \+= chunk/);
});

test("an oversized upload is refused before a single chunk is buffered", () => {
  const reader = block(APP, "function readBytes(", "function binary(");
  const declaredAt = reader.indexOf('content-length');
  const chunksAt = reader.indexOf("chunks.push");
  assert.ok(declaredAt > -1 && declaredAt < chunksAt,
    "Content-Length is checked first, so nothing is held for a 40 MB claim");
  // Content-Length is a claim, so the stream is measured too.
  assert.match(reader, /total > limit/);
  assert.match(reader, /req\.destroy\(\)/);
});

test("the transport limit is an outer defence, not the avatar rule", () => {
  const reader = block(APP, "function readBytes(", "function binary(");
  assert.match(reader, /limit = 2 \* 1024 \* 1024/,
    "deliberately larger than the 1 MB the validator enforces");
  // The validator, not the transport, decides what a valid avatar is.
  assert.match(API, /validateAvatarUpload\(bytes/);
});

test("a client that disappears mid-upload settles rather than hanging", () => {
  const reader = block(APP, "function readBytes(", "function binary(");
  assert.match(reader, /req\.on\("error"/);
  assert.match(reader, /req\.on\("aborted"/);
  assert.match(reader, /aborted: true/);
  // One settle only, however many events fire.
  assert.match(reader, /if \(!settled\)/);
  const dispatch = block(APP, "const isAvatarUpload", "const handled = await handleChartsRoute");
  assert.match(dispatch, /if \(read\.aborted\) return;/,
    "an aborted upload writes nothing");
});

test("only avatar POSTs take the bytes path; every other chart route is unchanged", () => {
  const dispatch = block(APP, "const isAvatarUpload", "const handled = await handleChartsRoute");
  assert.match(dispatch, /req\.method === "POST" && \/\\\/api\\\/charts\\\/\[\^\/\]\+\\\/avatar\$\//);
  assert.match(dispatch, /body = \(req\.method === "POST" \|\| req\.method === "PATCH" \|\| req\.method === "DELETE"\)/,
    "the JSON branch survives for create, update, and delete");
});

test("an oversized request returns a structured code, not a bare failure", () => {
  const dispatch = block(APP, "const isAvatarUpload", "const handled = await handleChartsRoute");
  assert.match(dispatch, /413/);
  assert.match(dispatch, /avatar_request_too_large/);
  assert.ok(!/stack|bucket|chart-avatars/.test(dispatch), "and names no internals");
});

// ── Bytes out ───────────────────────────────────────────────────────────────

test("image responses are sent as bytes with their own headers", () => {
  const sender = block(APP, "function binary(res, status", "\nfunction ");
  assert.ok(!/JSON\.stringify/.test(sender), "JSON-encoding an image corrupts it");
  assert.ok(!/application\/json/.test(sender), "and mislabels it");
  const dispatch = block(APP, "const handled = await handleChartsRoute", "// Daily fortune");
  assert.match(dispatch, /handled\.binary \|\| handled\.status === 304/);
  assert.match(dispatch, /binary\(res, handled\.status, handled\.body/);
  assert.match(dispatch, /return json\(res, handled\.status, handled\.body, cookie\)/,
    "ordinary JSON actions still take the JSON path");
});

test("a 304 carries no body", () => {
  const sender = block(APP, "function binary(res, status", "\nfunction ");
  assert.match(sender, /status === 304 \|\| !bytes/);
  assert.match(sender, /res\.end\(\);/);
});

test("the session cookie survives on both response paths", () => {
  const dispatch = block(APP, "const handled = await handleChartsRoute", "// Daily fortune");
  // withSession() replaced the inline `auth?.setCookie ? … : {}` when the iOS
  // container needed the session in a readable header as well. What this test
  // guards is unchanged: whatever the session headers are, BOTH the JSON and
  // the binary path must carry them, or a rotated session is lost on whichever
  // path forgot.
  assert.match(dispatch, /const cookie = withSession\(req, auth\?\.setCookie\)/);
  assert.match(dispatch, /\.\.\.\(handled\.headers \|\| \{\}\), \.\.\.cookie/);
});

// ── What the action returns ─────────────────────────────────────────────────

test("the read action sets private, version-keyed, nosniff headers", () => {
  const action = block(API, 'if (action === "avatar")', 'if (action === "activate"');
  assert.match(action, /avatarCacheHeaders\(profile\.avatar_version/);
  assert.match(action, /if-none-match/);
  assert.match(action, /status: 304/);
  assert.match(action, /binary: true/);
});

test("no avatar response or error carries a storage path", () => {
  const action = block(API, 'if (action === "avatar")', 'if (action === "activate"');
  // The path is computed and used, never returned.
  assert.match(action, /const path = avatarObjectPath\(owner, profile\.id\)/);
  assert.ok(!/body: \{[^}]*path/.test(action));
  assert.match(action, /publicIdentity\(/, "responses carry public identity only");
  // Error bodies name codes, not internals.
  for (const leak of ["chart-avatars", "storage.objects", "supabase", "auth.uid"]) {
    assert.ok(!action.includes(leak), `${leak} must not appear in the action`);
  }
});

test("ownership is established before any storage call", () => {
  const action = block(API, 'if (action === "avatar")', 'if (action === "activate"');
  const ownedAt = action.indexOf("await svc.profileFor(owner, id)");
  const storeAt = action.indexOf("createAvatarStore(auth)");
  assert.ok(ownedAt > -1 && ownedAt < storeAt,
    "a chart belonging to someone else fails before Storage is touched");
});

test("image bytes are never logged", () => {
  const action = block(API, 'if (action === "avatar")', 'if (action === "activate"');
  assert.ok(!/console\.(log|error|warn)/.test(action), "no logging in the avatar action at all");
  const store = readFileSync(join(ROOT, "lib", "charts", "avatar-store.js"), "utf8");
  assert.ok(!/console\./.test(store), "nor in the storage layer");
});

test("the storage layer offers no bucket listing, only an owner prefix", () => {
  const store = readFileSync(join(ROOT, "lib", "charts", "avatar-store.js"), "utf8");
  assert.match(store, /prefix: `\$\{ownerId\}\/`/);
  assert.ok(!/service_role|SERVICE_ROLE/.test(store),
    "ordinary avatar operations use the user's token");
  assert.match(store, /authorization: `Bearer \$\{accessToken\}`/);
});
