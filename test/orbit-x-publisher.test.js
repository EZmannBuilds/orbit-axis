// Orbit Axis :: Orbit X automatic channel, the parts that act (Dev Update 6.1).
//
// The publisher against a mocked Graph API, the channel tick end to end in dry
// run (real engine facts, no network) and live (mocked Meta and storage),
// idempotency, the kill switch and the pause, the cron route's gates, the
// desk's approve-once routes, and AI design proposals. Nothing here reaches a
// real service: every fetch is a fake that records what it was asked.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createPublisher, graphConfig, OrbitXPublishError } from "../lib/orbit-x/publisher.js";
import { runChannelTick, historyFromRuns, slideAltText, localParts } from "../lib/orbit-x/channel.js";
import { memoryChannelStore, previewCopy } from "../lib/orbit-x/memory-store.js";
import { syncRegistry, samplePost, BUILTIN_POST_TYPES, renderFingerprint } from "../lib/orbit-x/post-types.js";
import { evergreenCandidate, EVERGREEN_TOPICS } from "../lib/orbit-x/channel-candidates.js";
import { autonomyFor } from "../lib/orbit-x/policy.js";
import { handleChannelRoute, cronAuthorized, CHANNEL_TICK_ROUTE } from "../lib/orbit-x/channel-route.js";
import { handleOrbitXRoute } from "../lib/orbit-x/api.js";
import { vetProposal, proposePostTypes, MAX_PENDING_AI_PROPOSALS } from "../lib/orbit-x/design-proposals.js";
import { mediaPath, mediaStore } from "../lib/orbit-x/media.js";

const TOKEN = "test-access-token-not-real-0123456789";
const IG = "17841400000000001";
const GRAPH_ENV = Object.freeze({ ORBIT_X_IG_API: "instagram", ORBIT_X_IG_USER_ID: IG, ORBIT_X_IG_ACCESS_TOKEN: TOKEN });
const CRON = "cron-secret-for-tests-0123456789";
const BASE_ENV = Object.freeze({
  ORBIT_X_ENABLED: "true", ORBIT_X_AUTOPUBLISH: "true", ORBIT_X_AI_API_KEY: "test-ai-key-not-real",
  ORBIT_X_EDITORIAL_TIMEZONE: "America/Chicago", CRON_SECRET: CRON,
});
const LIVE_ENV = Object.freeze({ ...BASE_ENV, ...GRAPH_ENV, ORBIT_X_AUTOPUBLISH_LIVE: "true" });

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body,
  headers: { get: () => "application/json" } });

/** A fake Graph API. `script` lets a test change answers per call. */
function fakeGraph({ statuses = ["IN_PROGRESS", "FINISHED"], quotaUsed = 0, onPublish = null, failures = {} } = {}) {
  const calls = [];
  let items = 0;
  let statusIndex = 0;
  let published = false;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || "GET";
    const params = method === "GET" ? Object.fromEntries(u.searchParams) : Object.fromEntries(new URLSearchParams(String(init.body || "")));
    const call = { host: u.host, method, path: u.pathname, params };
    calls.push(call);
    if (u.host === "api.anthropic.com") throw new Error("the AI is injected in these tests");
    if (u.host !== "graph.instagram.com") throw new Error(`unexpected host ${u.host}`);
    const step = u.pathname.split("/").pop();
    if (failures[step]?.length) {
      const f = failures[step].shift();
      if (f === "network") throw new Error("socket hang up");
      return json(f.status, { error: f.error });
    }
    if (step === "content_publishing_limit") return json(200, { data: [{ quota_usage: quotaUsed, config: { quota_total: 100, quota_duration: 86400 } }] });
    if (step === "media" && method === "POST") return json(200, { id: params.media_type === "CAROUSEL" ? "carousel_1" : `item_${++items}` });
    if (step === "media" && method === "GET") return json(200, { data: published ? [{ id: "media_9", caption: onPublish?.caption || "", timestamp: new Date().toISOString() }] : [] });
    if (step === "carousel_1") {
      if (published) return json(200, { status_code: "PUBLISHED" });
      const s = statuses[Math.min(statusIndex, statuses.length - 1)];
      statusIndex += 1;
      return json(200, { status_code: s });
    }
    if (step === "media_publish") {
      published = true;
      if (onPublish?.loseResponse) throw new Error("connection reset after publish");
      return json(200, { id: "media_9" });
    }
    if (step === "media_9") return json(200, { id: "media_9", permalink: "https://www.instagram.com/p/abc123/" });
    return json(404, { error: { message: "unknown", code: 100 } });
  };
  return { fetchImpl, calls, graphCalls: () => calls.filter((c) => c.host === "graph.instagram.com") };
}

const noSleep = async () => {};

/* ── The publisher ────────────────────────────────────────────────────────── */

test("graph configuration is exact and never exposes the token", () => {
  assert.equal(graphConfig({ ...GRAPH_ENV, ORBIT_X_IG_API: "Instagram" }).configured, false, "case matters");
  const cfg = graphConfig(GRAPH_ENV);
  assert.equal(cfg.configured, true);
  assert.equal(cfg.host, "graph.instagram.com");
  assert.equal(cfg.version, "v25.0");
  assert.equal(graphConfig({ ...GRAPH_ENV, ORBIT_X_IG_API: "facebook" }).host, "graph.facebook.com");
  assert.ok(!JSON.stringify(cfg.summary).includes(TOKEN));
  assert.throws(() => createPublisher({ config: graphConfig({}) }), OrbitXPublishError);
});

test("a carousel publishes the documented way: items, carousel, poll, publish", async () => {
  const graph = fakeGraph();
  const logs = [];
  const p = createPublisher({ config: graphConfig(GRAPH_ENV), fetchImpl: graph.fetchImpl, sleep: noSleep,
    log: (step, outcome, detail) => logs.push(JSON.stringify({ step, outcome, detail })) });
  const a = await p.createImageItem({ imageUrl: "https://stub.supabase.test/a.jpg", altText: "Slide one alt text, long enough." });
  const b = await p.createImageItem({ imageUrl: "https://stub.supabase.test/b.jpg", altText: "Slide two alt text, long enough." });
  const carousel = await p.createCarousel({ children: [a, b], caption: "Caption." });
  const status = await p.waitForFinished(carousel, { intervalMs: 1 });
  assert.equal(status.statusCode, "FINISHED");
  const mediaId = await p.publish(carousel);
  assert.equal(mediaId, "media_9");
  assert.equal(await p.permalink(mediaId), "https://www.instagram.com/p/abc123/");

  const posts = graph.calls.filter((c) => c.method === "POST");
  assert.deepEqual(posts.map((c) => c.path), [`/v25.0/${IG}/media`, `/v25.0/${IG}/media`, `/v25.0/${IG}/media`, `/v25.0/${IG}/media_publish`]);
  assert.equal(posts[0].params.is_carousel_item, "true");
  assert.equal(posts[0].params.alt_text, "Slide one alt text, long enough.");
  assert.equal(posts[2].params.media_type, "CAROUSEL");
  assert.equal(posts[2].params.children, "item_1,item_2");
  assert.equal(posts[3].params.creation_id, "carousel_1");
  assert.ok(graph.calls.some((c) => c.path.endsWith("/content_publishing_limit")), "the quota is read");
  assert.ok(!logs.join("").includes(TOKEN), "the token never reaches a log");
});

test("transient failures back off and retry; a refused token fails at once", async () => {
  const sleeps = [];
  const graph = fakeGraph({ failures: { media: [{ status: 500, error: { code: 2, message: "temporary" } }, "network"] } });
  const p = createPublisher({ config: graphConfig(GRAPH_ENV), fetchImpl: graph.fetchImpl,
    sleep: async (ms) => { sleeps.push(ms); }, retry: { attempts: 3, baseMs: 100 } });
  assert.equal(await p.createImageItem({ imageUrl: "https://x.test/a.jpg" }), "item_1");
  assert.deepEqual(sleeps, [100, 200], "exponential backoff");

  const refused = fakeGraph({ failures: { media: [{ status: 400, error: { code: 190, message: `Invalid OAuth access token ${TOKEN}` } }] } });
  const q = createPublisher({ config: graphConfig(GRAPH_ENV), fetchImpl: refused.fetchImpl, sleep: noSleep });
  await assert.rejects(q.createImageItem({ imageUrl: "https://x.test/a.jpg" }), (error) => {
    assert.equal(error.code, "graph_refused");
    assert.equal(error.retryable, false);
    assert.ok(!JSON.stringify(error.graph).includes(TOKEN), "an echoed token is scrubbed");
    return true;
  });
  assert.equal(refused.calls.length, 1, "no retry for a final error");
});

test("the stop check runs before every write, and the quota before carousel and publish", async () => {
  const graph = fakeGraph();
  const stopped = createPublisher({ config: graphConfig(GRAPH_ENV), fetchImpl: graph.fetchImpl, sleep: noSleep,
    shouldStop: async () => "paused from the desk" });
  await assert.rejects(stopped.createImageItem({ imageUrl: "https://x.test/a.jpg" }), { code: "killed" });
  await assert.rejects(stopped.publish("carousel_1"), { code: "killed" });
  assert.equal(graph.calls.length, 0, "nothing reached Meta");

  const full = fakeGraph({ quotaUsed: 100 });
  const p = createPublisher({ config: graphConfig(GRAPH_ENV), fetchImpl: full.fetchImpl, sleep: noSleep });
  await assert.rejects(p.createCarousel({ children: ["a", "b"], caption: "" }), { code: "quota_exhausted" });
  assert.ok(!full.calls.some((c) => c.method === "POST"), "no carousel was created past the limit");
  await assert.rejects(p.createImageItem({ imageUrl: "http://x.test/a.jpg" }), { code: "image_url_not_https" });
  await assert.rejects(p.createCarousel({ children: ["a"], caption: "" }), { code: "carousel_size" });
});

/* ── Media ────────────────────────────────────────────────────────────────── */

test("media paths are safe and uploads use the service lane, idempotently", async () => {
  assert.equal(mediaPath({ slotDate: "2026-11-09", postId: "abc-123", filename: "orbit-axis_x_01.png" }),
    "channel/2026-11-09/abc-123/orbit-axis_x_01.png");
  assert.throws(() => mediaPath({ slotDate: "2026-11-09", postId: "../etc", filename: "a.png" }));
  const seen = [];
  const store = mediaStore({ url: "https://stub.supabase.test", serviceKey: "service-key" },
    { fetchImpl: async (url, init) => { seen.push({ url, headers: init.headers }); return { ok: true, status: 200 }; } });
  const url = await store.upload("channel/2026-11-09/p/a.jpg", Buffer.from("x"), "image/jpeg");
  assert.equal(url, "https://stub.supabase.test/storage/v1/object/public/orbit-x-media/channel/2026-11-09/p/a.jpg");
  assert.equal(seen[0].headers["x-upsert"], "true");
  await assert.rejects(store.upload("channel/2026-11-09/p/a.svg", Buffer.from("x"), "image/svg+xml"), /Refusing/);
});

/* ── The channel, end to end ──────────────────────────────────────────────── */

async function approvedStore(clock) {
  const store = memoryChannelStore({ now: () => clock.now });
  await syncRegistry(store);
  await store.approveAll();
  return store;
}
const generate = (packet) => previewCopy(packet, { samplePost });
const fakeMedia = () => {
  const uploads = [];
  return { uploads, async upload(path, bytes, type) { uploads.push({ path, type, size: bytes.length });
    return `https://stub.supabase.test/storage/v1/object/public/orbit-x-media/${path}`; } };
};
/** One Green evergreen option per day, so a test does not depend on the
 *  calendar. Only the first day gets it: the topic window keeps the rest. */
const greenOption = (slug = "what-an-ephemeris-does") => (slotDate) => {
  const topic = EVERGREEN_TOPICS.find((t) => t.slug === slug);
  const candidate = evergreenCandidate(topic);
  return { options: [{ candidate, formatId: topic.format, kind: "evergreen", autonomy: autonomyFor(topic.format),
    urgency: "standing", topicKey: topic.slug, periodKey: `${candidate.eventKey}:${slotDate}`, eventKey: candidate.eventKey }], notes: [] };
};
const firstPrepared = (store) => store.db.runs.filter((r) => r.post_id).sort((a, b) => a.slot_date.localeCompare(b.slot_date))[0];

test("review mode, end to end on real engine facts: a week of drafts, every one waiting, no call to Meta", async () => {
  const clock = { now: new Date("2026-11-09T14:00:00Z") };
  const store = await approvedStore(clock);
  const graph = fakeGraph();
  const summary = await runChannelTick({ env: { ...BASE_ENV, ...GRAPH_ENV }, store,
    deps: { now: () => clock.now, generate, fetchImpl: graph.fetchImpl, budgetMs: 600_000 } });
  assert.equal(summary.mode, "review");
  assert.equal(graph.calls.length, 0, "review mode never calls Meta on its own");
  assert.deepEqual(store.db.runs.map((r) => r.slot_date).sort(),
    ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"], "7 days ahead");
  const prepared = store.db.runs.filter((r) => r.state === "ready_for_review");
  assert.ok(prepared.length >= 5, `most days are prepared (${prepared.length})`);
  assert.ok(store.db.runs.every((r) => ["ready_for_review", "skipped"].includes(r.state)), "nothing is approved without a person");
  assert.ok(store.db.posts.every((p) => p.status === "draft" && p.origin === "channel" && p.created_by === null));
  assert.ok(prepared.some((r) => r.autonomy === "yellow") && prepared.some((r) => r.autonomy === "green"));
  assert.ok(new Set(prepared.map((r) => r.format)).size >= 4, "the week is varied across formats");

  const moon = store.db.runs.find((r) => r.slot_date === "2026-11-09");
  assert.equal(moon.format, "something_changed", "2026-11-09 is a New Moon, and an event outranks standing options");
  const post = store.db.posts.find((p) => p.id === moon.post_id);
  assert.ok(post.event_payload.facts.instant_utc, "the engine's exact instant is in the packet");
  assert.match(moon.media[0].filename, /^orbit-axis_2026-11-09_new-moon-2026-11-09_01(_portrait)?\.png$/);
  assert.match(moon.media[0].pngSha256, /^[0-9a-f]{64}$/);
  assert.ok(moon.publish_by, "every prepared post knows when its window closes");
  const steps = store.db.events.filter((e) => e.run_id === moon.id).map((e) => `${e.step}:${e.outcome}`);
  for (const s of ["claim:info", "plan:ok", "checks:ok", "write:ok", "render:ok", "queue:info"]) {
    assert.ok(steps.includes(s), `the log records ${s}`);
  }
});

test("idempotent: later ticks prepare nothing twice, and an overlapping tick is turned away", async () => {
  const clock = { now: new Date("2026-11-11T14:00:00Z") };
  const store = await approvedStore(clock);
  const deps = { now: () => clock.now, generate, buildOptions: greenOption(), budgetMs: 600_000 };
  await runChannelTick({ env: BASE_ENV, store, deps });
  const runs = store.db.runs.length;
  const posts = store.db.posts.length;
  clock.now = new Date("2026-11-11T14:15:00Z");
  await runChannelTick({ env: BASE_ENV, store, deps });
  assert.equal(store.db.runs.length, runs, "no second run for any day");
  assert.equal(store.db.posts.length, posts, "no second post for any day");

  const busy = await approvedStore(clock);
  const claimed = await busy.insertRun({ slot_key: "day:2026-11-11", slot_date: "2026-11-11", mode: "review", state: "claimed" });
  await busy.leaseRun(claimed.id, "2099-01-01T00:00:00.000Z", clock.now.toISOString());
  await runChannelTick({ env: BASE_ENV, store: busy, deps });
  assert.equal(busy.db.runs.find((r) => r.id === claimed.id).state, "claimed", "a leased run is left alone");
});

test("auto mode: a Green post approves itself at the default time and publishes then, not before", async () => {
  const clock = { now: new Date("2026-11-11T13:00:00Z") };
  const store = await approvedStore(clock);
  const graph = fakeGraph();
  const media = fakeMedia();
  const deps = { now: () => clock.now, generate, media, fetchImpl: graph.fetchImpl, sleep: noSleep,
    buildOptions: greenOption(), budgetMs: 600_000 };
  await runChannelTick({ env: LIVE_ENV, store, deps });
  const run = firstPrepared(store);
  assert.equal(run.state, "approved");
  assert.equal(localParts(run.scheduled_for, "America/Chicago").label, "Wed Nov 11, 8:30 AM CST", "the default slot");
  assert.equal(graph.calls.length, 0, "nothing goes out before its time");
  assert.equal(media.uploads.length, 0, "and nothing is uploaded early");

  clock.now = new Date("2026-11-11T14:35:00Z"); // 8:35 AM CST
  const summary = await runChannelTick({ env: LIVE_ENV, store, deps });
  assert.deepEqual(summary.published, ["2026-11-11"]);
  const post = store.db.posts.find((p) => p.id === run.post_id);
  assert.equal(post.status, "published");
  assert.equal(post.external_media_id, "media_9");
  assert.equal(post.permalink, "https://www.instagram.com/p/abc123/");
  assert.equal(post.publish_container_id, "carousel_1");
  assert.ok(media.uploads.some((u) => u.type === "image/jpeg") && media.uploads.some((u) => u.type === "image/png"));
  const items = graph.calls.filter((c) => c.method === "POST" && c.path.endsWith("/media") && c.params.is_carousel_item);
  assert.equal(items.length, post.edited_copy.slides.length, "one container per slide");
  assert.ok(items.every((c) => /\.jpg$/.test(c.params.image_url)), "Meta receives the JPEGs");
  assert.ok(items.every((c) => c.params.alt_text.length >= 40), "every slide carries alt text");
  assert.equal(graph.calls.filter((c) => c.path.endsWith("/media_publish")).length, 1);

  clock.now = new Date("2026-11-11T15:00:00Z");
  await runChannelTick({ env: LIVE_ENV, store, deps });
  assert.equal(graph.calls.filter((c) => c.path.endsWith("/media_publish")).length, 1, "a later tick never republishes");
});

test("auto mode never approves Yellow: it waits for a person, whatever its template", async () => {
  const clock = { now: new Date("2026-11-09T14:00:00Z") };
  const store = await approvedStore(clock);
  await runChannelTick({ env: LIVE_ENV, store, deps: { now: () => clock.now, generate, budgetMs: 600_000 } });
  const yellow = store.db.runs.filter((r) => r.autonomy === "yellow" && r.post_id);
  assert.ok(yellow.length > 0);
  assert.ok(yellow.every((r) => r.state === "ready_for_review"), "every Yellow post waits");
  assert.ok(store.db.runs.filter((r) => r.autonomy === "green" && r.post_id).every((r) => r.state === "approved"),
    "Green posts approved themselves");
});

test("a lost publish response is recovered from the container, never published twice", async () => {
  const clock = { now: new Date("2026-11-12T13:00:00Z") };
  const store = await approvedStore(clock);
  // Meta publishes, then the response is lost. The fake's media list carries
  // the caption the post really has, which is what recovery matches on.
  const onPublish = { loseResponse: true, get caption() { return store.db.posts[0]?.edited_copy?.caption || ""; } };
  const graph = fakeGraph({ onPublish });
  const deps = { now: () => clock.now, generate, media: fakeMedia(), fetchImpl: graph.fetchImpl, sleep: noSleep,
    buildOptions: greenOption("why-apps-disagree"), budgetMs: 600_000 };
  await runChannelTick({ env: LIVE_ENV, store, deps });
  clock.now = new Date("2026-11-12T15:00:00Z");
  await runChannelTick({ env: LIVE_ENV, store, deps });
  const run = firstPrepared(store);
  assert.equal(run.state, "published", "the container said it went out, and the id was recovered");
  assert.equal(store.db.posts.find((p) => p.id === run.post_id).external_media_id, "media_9");
  assert.equal(graph.calls.filter((c) => c.path.endsWith("/media_publish")).length, 1, "exactly one publish call, never a retry");
  const log = store.db.events.map((e) => `${e.step}:${e.outcome}:${JSON.stringify(e.detail)}`).join("\n");
  assert.match(log, /publish_outcome_unknown/, "the unknown outcome is in the audit log");

  // And when the container shows it did NOT go out, it is published once more.
  const clock2 = { now: new Date("2026-11-12T13:00:00Z") };
  const store2 = await approvedStore(clock2);
  const graph2 = fakeGraph({ failures: { media_publish: [{ status: 503, error: { code: 2, message: "unavailable" } }] } });
  const deps2 = { ...deps, now: () => clock2.now, fetchImpl: graph2.fetchImpl };
  await runChannelTick({ env: LIVE_ENV, store: store2, deps: deps2 });
  clock2.now = new Date("2026-11-12T15:00:00Z");
  await runChannelTick({ env: LIVE_ENV, store: store2, deps: deps2 });
  assert.equal(firstPrepared(store2).state, "published");
  assert.equal(graph2.calls.filter((c) => c.path.endsWith("/media_publish")).length, 2,
    "a 503 is resolved through the container (FINISHED, not PUBLISHED) and published once more");
});

test("pause and kill switch: due posts wait while paused; the kill switch ends a publish under way", async () => {
  const clock = { now: new Date("2026-11-13T13:00:00Z") };
  const store = await approvedStore(clock);
  const graph = fakeGraph({ statuses: ["IN_PROGRESS"] });
  const media = fakeMedia();
  const deps = { now: () => clock.now, generate, media, fetchImpl: graph.fetchImpl, sleep: noSleep,
    buildOptions: greenOption(), budgetMs: 600_000 };
  await runChannelTick({ env: LIVE_ENV, store, deps });
  const run = firstPrepared(store);
  assert.equal(run.state, "approved");

  await store.setControl({ paused: true, reason: "test" });
  clock.now = new Date("2026-11-13T15:00:00Z");
  const paused = await runChannelTick({ env: LIVE_ENV, store, deps });
  assert.equal(paused.state, "paused");
  assert.equal(media.uploads.length, 0, "nothing is uploaded while paused");
  assert.equal(graph.calls.length, 0, "and Meta is not called");
  await store.setControl({ paused: false });

  await runChannelTick({ env: LIVE_ENV, store, deps });
  assert.equal(store.db.runs.find((r) => r.id === run.id).state, "containers", "after resuming, it goes out; Meta is still processing");

  const killed = await runChannelTick({ env: { ...LIVE_ENV, ORBIT_X_KILL_SWITCH: "stop" }, store, deps });
  assert.equal(killed.state, "killed");
  assert.equal(store.db.runs.find((r) => r.id === run.id).state, "killed", "the publish under way ends for good");
  assert.equal(store.db.posts.find((p) => p.id === run.post_id).status, "failed", "and its post says it did not go out");
  assert.equal(graph.calls.filter((c) => c.path.endsWith("/media_publish")).length, 0);
});

test("a queued post whose window closes expires instead of posting late", async () => {
  const clock = { now: new Date("2026-11-09T14:00:00Z") };
  const store = await approvedStore(clock);
  await runChannelTick({ env: BASE_ENV, store, deps: { now: () => clock.now, generate, budgetMs: 600_000 } });
  const moon = store.db.runs.find((r) => r.slot_date === "2026-11-09");
  clock.now = new Date("2026-11-10T07:00:00Z"); // 1:00 AM CST on the 10th
  const summary = await runChannelTick({ env: BASE_ENV, store, deps: { now: () => clock.now, generate, budgetMs: 600_000 } });
  assert.ok(summary.expired.includes("2026-11-09"));
  assert.equal(store.db.runs.find((r) => r.id === moon.id).state, "expired");
  assert.equal(store.db.posts.find((p) => p.id === moon.post_id).status, "rejected");
  assert.ok(store.db.runs.some((r) => r.slot_date === "2026-11-16"), "and the lookahead moved on a day");
});

test("the channel skips, and says why, when no template is active or AI is missing", async () => {
  const clock = { now: new Date("2026-11-14T14:00:00Z") };
  const empty = memoryChannelStore({ now: () => clock.now });
  await runChannelTick({ env: BASE_ENV, store: empty, deps: { now: () => clock.now, generate, buildOptions: greenOption(), budgetMs: 600_000 } });
  assert.ok(empty.db.runs.every((r) => r.state === "skipped"));
  assert.match(empty.db.runs[0].error, /no template is active/);
  assert.ok(empty.db.types.length === BUILTIN_POST_TYPES.length && empty.db.types.every((t) => t.status === "proposed"),
    "the tick proposed the built-ins for review");

  const noAi = await approvedStore(clock);
  const env = { ...BASE_ENV };
  delete env.ORBIT_X_AI_API_KEY;
  await runChannelTick({ env, store: noAi, deps: { now: () => clock.now, buildOptions: greenOption(), budgetMs: 600_000 } });
  assert.match(firstPrepared(noAi)?.error || noAi.db.runs[0].error, /no copy source|topic/);
  assert.ok(noAi.db.runs.some((r) => /no copy source/.test(r.error || "")));
});

test("a period the desk already covered is never prepared again", async () => {
  const clock = { now: new Date("2026-11-15T14:00:00Z") };
  const store = await approvedStore(clock);
  const option = greenOption()("2026-11-15");
  store.db.posts.push({ id: "desk-1", event_key: option.options[0].eventKey, period_key: "other", status: "exported", origin: "desk" });
  await runChannelTick({ env: BASE_ENV, store, deps: { now: () => clock.now, generate, buildOptions: () => option, budgetMs: 600_000 } });
  const day = store.db.runs.find((r) => r.slot_date === "2026-11-15");
  assert.equal(day.state, "skipped");
  assert.match(JSON.stringify(day.plan.refusedByPolicy), /already covered \(desk, exported\)/);
});

test("copy that fails its checks is excluded and the next tick tries the next-best option", async () => {
  const clock = { now: new Date("2026-11-16T14:00:00Z") };
  const store = await approvedStore(clock);
  const two = (slotDate) => ({ options: [greenOption("what-an-ephemeris-does")(slotDate).options[0],
    greenOption("why-apps-disagree")(slotDate).options[0]], notes: [] });
  const badThenGood = async (packet) => {
    const out = await generate(packet);
    if (packet.event.title === "What an ephemeris does") {
      const bad = JSON.parse(out.text);
      bad.caption = "This will bring you luck.";
      return { text: JSON.stringify(bad), usage: null };
    }
    return out;
  };
  await runChannelTick({ env: BASE_ENV, store, deps: { now: () => clock.now, generate: badThenGood, buildOptions: two, budgetMs: 600_000 } });
  const day = store.db.runs.find((r) => r.slot_date === "2026-11-16");
  if (day.state === "claimed") {
    assert.equal(day.plan.excluded.length, 1, "the failed plan is excluded");
    clock.now = new Date("2026-11-16T14:15:00Z");
    await runChannelTick({ env: BASE_ENV, store, deps: { now: () => clock.now, generate: badThenGood, buildOptions: two, budgetMs: 600_000 } });
  }
  const after = store.db.runs.find((r) => r.slot_date === "2026-11-16");
  assert.equal(after.state, "ready_for_review");
  assert.equal(store.db.posts.find((p) => p.id === after.post_id).event_key, "educational:why-apps-disagree");
  assert.ok(!store.db.posts.some((p) => /luck/.test(p.edited_copy.caption)), "the refused copy was never saved");
});

test("history and alt text helpers", () => {
  const runs = [{ post_id: "p", plan: { hookStyle: "contrast" }, state: "published", slot_date: "2026-11-01", format: "daily_reading",
    family: "lunar_field", post_type_label: "lunar_field/v1", generated: { headline: "H" } },
  { post_id: null, plan: {}, state: "skipped" }];
  assert.equal(historyFromRuns(runs).length, 1, "skipped days are not history");
  const post = { altText: "Orbit Axis carousel about the New Moon, with a dark disc.", slides: [{ heading: "A" }, { heading: "B" }] };
  assert.equal(slideAltText(post, 1), "Orbit Axis carousel about the New Moon, with a dark disc. Slide 2 of 2: B.");
});

/* ── The cron route ───────────────────────────────────────────────────────── */

test("the cron route: off is 404, no secret is 503, a wrong secret is 401, the right one ticks", async () => {
  const store = memoryChannelStore();
  const call = (env, header) => handleChannelRoute("GET", CHANNEL_TICK_ROUTE, { authorization: header }, { env, deps: { store } });
  assert.equal(await handleChannelRoute("GET", "/api/other", {}, { env: BASE_ENV }), null);
  assert.equal((await call({ ...BASE_ENV, ORBIT_X_AUTOPUBLISH: "false" }, `Bearer ${CRON}`)).status, 404);
  assert.equal((await call({ ...BASE_ENV, CRON_SECRET: "short" }, "Bearer short")).status, 503);
  assert.equal((await call(BASE_ENV, "Bearer wrong-secret-0123456789abcd")).status, 401);
  assert.equal((await call(BASE_ENV, undefined)).status, 401);
  const ok = await call(BASE_ENV, `Bearer ${CRON}`);
  assert.equal(ok.status, 200);
  assert.ok(!JSON.stringify(ok.body).includes(CRON));
  assert.equal(cronAuthorized(`Bearer ${CRON}`, BASE_ENV), true);
  assert.equal(cronAuthorized(`bearer ${CRON}`, BASE_ENV), false);
});

/* ── The desk: approve once ───────────────────────────────────────────────── */

const AUTH = Object.freeze({ url: "https://stub.supabase.test", anonKey: "anon", accessToken: "tok", ownerId: "22222222-2222-4222-8222-222222222222" });
const adminStore = (admin = true) => ({ isAdmin: async () => admin, history: async () => [], coverageFor: async () => [] });

test("the desk lists proposed built-ins, approves once, refuses illegal moves, and renders samples", async () => {
  const channelStore = memoryChannelStore();
  const deps = { env: { ORBIT_X_ENABLED: "true" }, store: adminStore(), channelStore };
  const list = await handleOrbitXRoute("GET", "/api/orbit-x/channel", new URLSearchParams(), {}, AUTH, deps);
  assert.equal(list.status, 200);
  assert.equal(list.body.types.length, BUILTIN_POST_TYPES.length);
  assert.ok(list.body.types.every((t) => t.status === "proposed"));
  assert.ok(list.body.types.filter((t) => !t.type_key.startsWith("celestial_editorial")).every((t) => t.layout.length === 0));
  assert.equal(list.body.status.mode, "review");
  assert.ok(!JSON.stringify(list.body).includes("test-ai-key"), "no secret values in the desk payload");

  const type = list.body.types.find((t) => t.type_key === "lunar_hero");
  const approved = await handleOrbitXRoute("PATCH", `/api/orbit-x/post-types/${type.id}`, new URLSearchParams(),
    { status: "approved" }, AUTH, deps);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.type.usable, true, "approved and current: it joins the rotation");
  const rejected = await handleOrbitXRoute("PATCH", `/api/orbit-x/post-types/${type.id}`, new URLSearchParams(),
    { status: "rejected", reason: "not for us" }, AUTH, deps);
  assert.equal(rejected.body.type.status, "rejected");
  const back = await handleOrbitXRoute("PATCH", `/api/orbit-x/post-types/${type.id}`, new URLSearchParams(),
    { status: "approved" }, AUTH, deps);
  assert.equal(back.status, 409, "a rejected type never comes back");

  const sample = await handleOrbitXRoute("GET", `/api/orbit-x/post-types/${type.id}/sample`,
    new URLSearchParams({ format: "something_changed", date: "2026-11-09" }), {}, AUTH, deps);
  assert.equal(sample.status, 200);
  assert.ok(sample.body.slides.length >= 4 && sample.body.slides[0].startsWith("<svg"));
  assert.match(sample.body.notice, /placeholders, never published/);

  const paused = await handleOrbitXRoute("POST", "/api/orbit-x/channel/pause", new URLSearchParams(), { paused: true }, AUTH, deps);
  assert.equal(paused.body.control.paused, true);

  const outsider = await handleOrbitXRoute("GET", "/api/orbit-x/channel", new URLSearchParams(), {}, AUTH,
    { ...deps, store: adminStore(false) });
  assert.equal(outsider.status, 404, "a non-admin cannot see the channel exists");
});

/* ── AI design proposals ──────────────────────────────────────────────────── */

const goodProposal = () => ({
  key: "lunar_field.quiet_orbits", name: "Lunar Field · Quiet Orbits",
  description: "Lunar Field readings with a subtle orbit-ring motif and a centred headline.",
  rationale: "Adds a calmer centred variant with orbit rings.",
  spec: {
    family: "lunar_field", familyVersion: "v1", formats: ["daily_reading"], aspect: "portrait",
    design: { density: "minimal", variant: 1, headlineAlignment: "center", logoPosition: "upper_corner",
      visuals: { moon: true, strip: true, diagram: true },
      metadata: { date: true, time: true, sign: true, illumination: true, retro: true, calculated: true } },
    motif: { kind: "orbit_rings", tone: "brand", placement: "bottom_left", intensity: "subtle" },
    voice: { hookStyles: ["quiet_observation"], captionStructures: ["short_note"] },
  },
});

test("a proposal is vetted: valid ones land proposed, unsafe ones are refused with reasons", () => {
  const ok = vetProposal(goodProposal());
  assert.equal(ok.ok, true, JSON.stringify(ok.problems));
  assert.equal(ok.row.status, "proposed");
  assert.equal(ok.row.source, "ai");

  const claim = { ...goodProposal(), description: "This design will bring you followers." };
  assert.match(vetProposal(claim).problems.join(" "), /states an outcome as certain|description/);
  const wrongKey = { ...goodProposal(), key: "orbit_signal.borrowed" };
  assert.match(vetProposal(wrongKey).problems.join(" "), /must start with "lunar_field\."/);
  const exists = vetProposal(goodProposal(), { existing: [{ type_key: "lunar_field.quiet_orbits" }] });
  assert.match(exists.problems.join(" "), /already exists/);
  const collides = goodProposal();
  collides.key = "celestial_editorial.dense";
  collides.spec = { ...collides.spec, family: "celestial_editorial", design: { ...collides.spec.design, variant: 0 } };
  assert.match(vetProposal(collides).problems.join(" "), /layout:/, "layout collisions refuse a proposal");
  const fp = renderFingerprint(vetProposal(goodProposal()).row.spec);
  assert.deepEqual(fp.layout, []);
});

test("proposals come from Claude as JSON, are capped, and are never inserted by the proposer itself", async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return json(200, { content: [{ type: "text", text: JSON.stringify({ proposals: [goodProposal(), { key: "bad" }] }) }],
      usage: { input_tokens: 10, output_tokens: 20 } });
  };
  const result = await proposePostTypes({ env: { ORBIT_X_AI_API_KEY: "test-key" }, fetchImpl, existing: [] });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.refused.length, 1);
  assert.equal(sent[0].url, "https://api.anthropic.com/v1/messages");
  assert.match(sent[0].body.system, /you approve nothing/i);
  const pending = Array.from({ length: MAX_PENDING_AI_PROPOSALS }, (_, i) => ({ type_key: `x.${i}`, source: "ai", status: "proposed" }));
  const capped = await proposePostTypes({ env: { ORBIT_X_AI_API_KEY: "test-key" }, fetchImpl, existing: pending });
  assert.equal(capped.accepted.length, 0, "the desk never holds more than the cap of unreviewed proposals");
  assert.equal(sent.length, 1, "and the model was not even asked");
});
