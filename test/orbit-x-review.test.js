// Orbit Axis :: Orbit X review queue, schedule, and template picker (2026-11-09).
//
// The founder's 2026-11-09 decisions, held as tests through the desk's own
// routes: the channel prepares a week ahead and every post waits for a
// person; the reviewer sees the PNGs that will publish, may edit caption and
// alt text (every check runs again, every edit is logged), and approves with
// a publish time in America/Chicago; a Yellow post needs an explicit per-post
// confirmation bound to the slides that were shown; approved posts publish at
// their time from the cron and can be unscheduled or edited until then; and
// only active templates rotate. Fakes only: no database, no network.

import { test } from "node:test";
import assert from "node:assert/strict";

import { handleOrbitXRoute } from "../lib/orbit-x/api.js";
import { runChannelTick } from "../lib/orbit-x/channel.js";
import { channelOptions } from "../lib/orbit-x/channel-candidates.js";
import { memoryChannelStore, previewCopy } from "../lib/orbit-x/memory-store.js";
import { syncRegistry, samplePost } from "../lib/orbit-x/post-types.js";

const AUTH = Object.freeze({ url: "https://stub.supabase.test", anonKey: "anon", accessToken: "tok",
  ownerId: "33333333-3333-4333-8333-333333333333" });
const GRAPH_ENV = Object.freeze({ ORBIT_X_IG_API: "facebook", ORBIT_X_IG_USER_ID: "17841400000000002",
  ORBIT_X_IG_ACCESS_TOKEN: "test-system-user-token-not-real-0123456789" });
const ENV = Object.freeze({ ORBIT_X_ENABLED: "true", ORBIT_X_AUTOPUBLISH: "true", ORBIT_X_AI_API_KEY: "test-ai-key",
  ORBIT_X_EDITORIAL_TIMEZONE: "America/Chicago", ...GRAPH_ENV });

const generate = (packet) => previewCopy(packet, { samplePost });

// The ephemeris engine spawns a process per request, which is most of a tick's
// cost. Real engine output, computed once per day for the whole file.
const optionCache = new Map();
const buildOptions = (slotDate, env) => {
  if (!optionCache.has(slotDate)) optionCache.set(slotDate, channelOptions(slotDate, env));
  return optionCache.get(slotDate);
};
const admin = (yes = true) => ({ isAdmin: async () => yes, history: async () => [], coverageFor: async () => [] });

function fakeGraph() {
  const calls = [];
  let items = 0;
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || "GET";
    const params = method === "GET" ? Object.fromEntries(u.searchParams) : Object.fromEntries(new URLSearchParams(String(init.body || "")));
    calls.push({ host: u.host, method, path: u.pathname, params });
    assert.equal(u.host, "graph.facebook.com", "Route B (Facebook Login) talks to graph.facebook.com");
    const step = u.pathname.split("/").pop();
    if (step === "content_publishing_limit") return json({ data: [{ quota_usage: 1, config: { quota_total: 100 } }] });
    if (step === "media" && method === "POST") return json({ id: params.media_type === "CAROUSEL" ? "carousel_7" : `item_${++items}` });
    if (step === "carousel_7") return json({ status_code: "FINISHED" });
    if (step === "media_publish") return json({ id: "media_77" });
    if (step === "media_77") return json({ permalink: "https://www.instagram.com/p/week77/" });
    throw new Error(`unexpected ${method} ${u.pathname}`);
  };
  return { fetchImpl, calls };
}

const fakeMedia = () => ({ uploads: [], async upload(path, bytes, type) { this.uploads.push({ path, type });
  return `https://stub.supabase.test/storage/v1/object/public/orbit-x-media/${path}`; } });

/** A week prepared from real engine facts, every template approved. */
async function preparedWeek({ at = "2026-11-09T14:00:00Z" } = {}) {
  const clock = { now: new Date(at) };
  const store = memoryChannelStore({ now: () => clock.now });
  await syncRegistry(store);
  await store.approveAll();
  const graph = fakeGraph();
  const media = fakeMedia();
  const deps = { now: () => clock.now, generate, buildOptions, fetchImpl: graph.fetchImpl, media, sleep: async () => {}, budgetMs: 600_000 };
  await runChannelTick({ env: ENV, store, deps });
  const route = (method, path, body = {}, extra = {}) => {
    const [route, query = ""] = path.split("?");
    return handleOrbitXRoute(method, route, new URLSearchParams(query), body, AUTH,
      { env: ENV, store: admin(), channelStore: store, ...deps, ...extra });
  };
  return { clock, store, graph, media, deps, route };
}

const rowFor = (week, pred) => week.body.rows.find((r) => r.post && pred(r));

test("the week view: 7 prepared days, local times in America/Chicago, nothing approved yet", async () => {
  const { route } = await preparedWeek();
  const week = await route("GET", "/api/orbit-x/channel/week");
  assert.equal(week.status, 200);
  assert.equal(week.body.timezone, "America/Chicago");
  assert.deepEqual(week.body.days, ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  const ready = week.body.rows.filter((r) => r.state === "ready_for_review");
  assert.ok(ready.length >= 5);
  for (const r of ready) {
    assert.equal(r.editable, true);
    assert.equal(r.scheduledFor, null, "no publish time until a person approves");
    assert.match(r.suggestedLocal.label, /8:30 AM CST$/, "the default slot, shown in Chicago time");
    assert.equal(r.suggestedLocal.date >= r.slotDate || r.format === "weekly_reading" || r.format === "monthly_reading", true);
  }
  assert.ok(ready.some((r) => r.needsExplicitApproval), "Yellow posts are marked for per-post approval");
  assert.equal(week.body.canPublish, true);
});

test("previews are the PNGs that will publish, with the hashes an approval must quote back", async () => {
  const { route, store } = await preparedWeek();
  const week = await route("GET", "/api/orbit-x/channel/week");
  const row = rowFor(week, (r) => r.state === "ready_for_review");
  const pv = await route("GET", `/api/orbit-x/channel/posts/${row.post.id}/previews`);
  assert.equal(pv.status, 200);
  assert.equal(pv.body.matchesPrepared, true);
  assert.equal(pv.body.slides.length, row.post.slides);
  assert.ok(pv.body.slides.every((s) => s.dataUrl.startsWith("data:image/png;base64,") && /^[0-9a-f]{64}$/.test(s.sha256)));
  const run = store.db.runs.find((r) => r.post_id === row.post.id);
  assert.deepEqual(pv.body.slides.map((s) => s.sha256), run.media.map((m) => m.pngSha256));
});

test("editing caption and alt text re-runs every check; a failing edit is refused, and both are logged", async () => {
  const { route, store } = await preparedWeek();
  const week = await route("GET", "/api/orbit-x/channel/week");
  const row = rowFor(week, (r) => r.state === "ready_for_review" && r.autonomy === "green");
  const original = store.db.posts.find((p) => p.id === row.post.id).edited_copy.caption;

  const bad = await route("PATCH", `/api/orbit-x/channel/posts/${row.post.id}`, { caption: "This New Moon will bring you money." });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.checks.some((c) => c.id === "red_territory" && !c.passed));
  assert.ok(bad.body.checks.some((c) => c.id === "voice_symbolic_not_predictive" && !c.passed));
  assert.equal(store.db.posts.find((p) => p.id === row.post.id).edited_copy.caption, original, "nothing was saved");

  const good = await route("PATCH", `/api/orbit-x/channel/posts/${row.post.id}`, {
    caption: "Orbit calculates every position it shows from the ephemeris. Astrologers traditionally read that care as a kind of attention.",
    altText: "Orbit Axis carousel explaining what an ephemeris does, with the Orbit Axis mark and calculated labels.",
  });
  assert.equal(good.status, 200, JSON.stringify(good.body).slice(0, 300));
  const saved = store.db.posts.find((p) => p.id === row.post.id).edited_copy;
  assert.match(saved.caption, /^Orbit calculates/);
  assert.match(saved.altText, /^Orbit Axis carousel explaining/);
  assert.equal(store.db.posts.find((p) => p.id === row.post.id).generated_copy.caption, original, "the model's draft is kept beside the edit");

  const edits = store.db.events.filter((e) => e.step === "review_edit");
  assert.deepEqual(edits.map((e) => e.outcome), ["fail", "ok"]);
  assert.equal(edits[1].detail.actor, AUTH.ownerId, "who edited is recorded");
  assert.deepEqual(edits[1].detail.fields, ["caption", "altText"]);
  assert.equal(edits[1].detail.before.caption, original);
});

test("a Yellow post needs the slides seen AND an explicit confirmation, even with an approved template", async () => {
  const { route, store } = await preparedWeek();
  const week = await route("GET", "/api/orbit-x/channel/week");
  const row = rowFor(week, (r) => r.state === "ready_for_review" && r.autonomy === "yellow");
  const pv = await route("GET", `/api/orbit-x/channel/posts/${row.post.id}/previews`);
  const seen = pv.body.slides.map((s) => s.sha256);
  const at = { date: row.suggestedLocal.date, time: "09:00" };

  const unseen = await route("POST", `/api/orbit-x/channel/posts/${row.post.id}/approve`, { ...at, seenSlides: [] });
  assert.equal(unseen.status, 409);
  assert.equal(unseen.body.code, "slides_not_seen");
  const wrong = await route("POST", `/api/orbit-x/channel/posts/${row.post.id}/approve`,
    { ...at, seenSlides: seen.map((h, i) => (i === 0 ? "0".repeat(64) : h)), confirmYellow: true });
  assert.equal(wrong.body.code, "slides_not_seen", "the approval is bound to the exact slides shown");
  const unconfirmed = await route("POST", `/api/orbit-x/channel/posts/${row.post.id}/approve`, { ...at, seenSlides: seen });
  assert.equal(unconfirmed.status, 409);
  assert.equal(unconfirmed.body.code, "yellow_confirmation");
  assert.equal(store.db.runs.find((r) => r.post_id === row.post.id).state, "ready_for_review", "still waiting");

  const ok = await route("POST", `/api/orbit-x/channel/posts/${row.post.id}/approve`, { ...at, seenSlides: seen, confirmYellow: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.scheduledLocal.time, "09:00");
  assert.equal(ok.body.scheduledLocal.zone, "America/Chicago");
  const run = store.db.runs.find((r) => r.post_id === row.post.id);
  assert.equal(run.state, "approved");
  assert.equal(run.reviewed_by, AUTH.ownerId);
  const event = store.db.events.find((e) => e.run_id === run.id && e.step === "review_approve");
  assert.equal(event.detail.yellowConfirmed, true);
  assert.equal(store.db.posts.find((p) => p.id === row.post.id).status, "approved");
});

test("approve and schedule, then it publishes at its time from the cron, with every check", async () => {
  const { route, store, graph, media, clock, deps } = await preparedWeek();
  const week = await route("GET", "/api/orbit-x/channel/week");
  const row = rowFor(week, (r) => r.state === "ready_for_review" && r.autonomy === "green" && r.slotDate > "2026-11-09");
  const pv = await route("GET", `/api/orbit-x/channel/posts/${row.post.id}/previews`);
  const seen = pv.body.slides.map((s) => s.sha256);

  const outside = await route("POST", `/api/orbit-x/channel/posts/${row.post.id}/approve`,
    { date: row.window.end.date, time: "23:59", seenSlides: seen });
  assert.equal(outside.status, 422);
  assert.equal(outside.body.code, "bad_time", "a time outside the facts' window is refused");

  const ok = await route("POST", `/api/orbit-x/channel/posts/${row.post.id}/approve`,
    { date: row.slotDate, time: "10:15", seenSlides: seen });
  assert.equal(ok.status, 200);
  const due = Date.parse(ok.body.scheduledFor);

  clock.now = new Date(due - 5 * 60_000);
  await runChannelTick({ env: ENV, store, deps });
  assert.equal(graph.calls.length, 0, "nothing goes out before its time");
  assert.equal(media.uploads.length, 0, "and nothing is made public early");

  clock.now = new Date(due + 7 * 60_000);
  const tick = await runChannelTick({ env: ENV, store, deps });
  assert.deepEqual(tick.published, [row.slotDate]);
  const post = store.db.posts.find((p) => p.id === row.post.id);
  assert.equal(post.status, "published");
  assert.equal(post.external_media_id, "media_77");
  assert.ok(graph.calls.some((c) => c.path.endsWith("/content_publishing_limit")), "the quota is checked");
  assert.equal(graph.calls.filter((c) => c.path.endsWith("/media_publish")).length, 1);
});

test("until publish time a post can be rescheduled, edited, or unscheduled; after it starts, it is locked", async () => {
  const { route, store, clock, deps } = await preparedWeek();
  const week = await route("GET", "/api/orbit-x/channel/week");
  const row = rowFor(week, (r) => r.state === "ready_for_review" && r.autonomy === "green" && r.slotDate > "2026-11-09");
  const seen = (await route("GET", `/api/orbit-x/channel/posts/${row.post.id}/previews`)).body.slides.map((s) => s.sha256);
  await route("POST", `/api/orbit-x/channel/posts/${row.post.id}/approve`, { date: row.slotDate, time: "09:00", seenSlides: seen });

  const moved = await route("POST", `/api/orbit-x/channel/posts/${row.post.id}/approve`, { date: row.slotDate, time: "11:45", seenSlides: seen });
  assert.equal(moved.body.scheduledLocal.time, "11:45");
  assert.ok(store.db.events.some((e) => e.step === "review_reschedule"));

  const edit = await route("PATCH", `/api/orbit-x/channel/posts/${row.post.id}`,
    { caption: "Every position Orbit shows is calculated first. Astrologers traditionally treat that precision as a starting point." });
  assert.equal(edit.status, 200, "an approved post can still be edited before it goes out");

  const back = await route("POST", `/api/orbit-x/channel/posts/${row.post.id}/unschedule`);
  assert.equal(back.body.state, "ready_for_review");
  assert.equal(store.db.posts.find((p) => p.id === row.post.id).status, "draft");
  assert.equal(store.db.runs.find((r) => r.post_id === row.post.id).scheduled_for, null);

  const again = await route("POST", `/api/orbit-x/channel/posts/${row.post.id}/approve`, { date: row.slotDate, time: "09:30", seenSlides: seen });
  clock.now = new Date(Date.parse(again.body.scheduledFor) + 60_000);
  const lockedRun = store.db.runs.find((r) => r.post_id === row.post.id);
  lockedRun.state = "containers"; // as if the publish had started on the last tick
  const locked = await route("PATCH", `/api/orbit-x/channel/posts/${row.post.id}`, { caption: "Too late." });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.code, "locked");
  const noUnschedule = await route("POST", `/api/orbit-x/channel/posts/${row.post.id}/unschedule`);
  assert.equal(noUnschedule.status, 409);
  void deps;
});

test("reject ends the day; publish-now refuses while paused; a changed rendering cannot be approved", async () => {
  const { route, store } = await preparedWeek();
  const week = await route("GET", "/api/orbit-x/channel/week");
  const rows = week.body.rows.filter((r) => r.state === "ready_for_review" && r.post);
  const [first, second] = rows;

  const rejected = await route("POST", `/api/orbit-x/channel/posts/${first.post.id}/reject`, { reason: "off brand" });
  assert.equal(rejected.body.state, "review_rejected");
  assert.equal(store.db.posts.find((p) => p.id === first.post.id).status, "rejected");

  const seen = (await route("GET", `/api/orbit-x/channel/posts/${second.post.id}/previews`)).body.slides.map((s) => s.sha256);
  await store.setControl({ paused: true });
  const now = await route("POST", `/api/orbit-x/channel/posts/${second.post.id}/approve`,
    { seenSlides: seen, confirmYellow: true, publishNow: true });
  assert.equal(now.body.code, "paused");
  await store.setControl({ paused: false });

  const run = store.db.runs.find((r) => r.post_id === second.post.id);
  run.media = run.media.map((m, i) => (i === 0 ? { ...m, pngSha256: "f".repeat(64) } : m));
  const stale = await route("POST", `/api/orbit-x/channel/posts/${second.post.id}/approve`,
    { date: second.slotDate, time: "09:00", seenSlides: seen, confirmYellow: true });
  assert.equal(stale.body.code, "stale_render");
});

test("templates: thumbnails from today's facts, active and preferred choices, Celestial Editorial blocked", async () => {
  const { route, store, clock, deps } = await preparedWeek();
  const picker = await route("GET", "/api/orbit-x/channel/templates?date=2026-11-09");
  assert.equal(picker.status, 200);
  const byKey = Object.fromEntries(picker.body.templates.map((t) => [t.typeKey, t]));
  assert.ok(byKey.lunar_hero.thumbnail.startsWith("<svg"), "a thumbnail per template");
  assert.equal(byKey.celestial_editorial.active, false);
  const blocked = await route("POST", "/api/orbit-x/channel/templates/celestial_editorial", { active: true });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "template_blocked");

  const off = await route("POST", "/api/orbit-x/channel/templates/lunar_hero", { active: false });
  assert.equal(off.status, 200);
  assert.deepEqual(store.db.templateSettings.find((t) => t.type_key === "lunar_hero"), { ...store.db.templateSettings.find((t) => t.type_key === "lunar_hero"), active: false });
  const pref = await route("POST", "/api/orbit-x/channel/preferences", { format: "something_changed", typeKey: "lunar_hero.tall" });
  assert.equal(pref.status, 200);
  const wrongPref = await route("POST", "/api/orbit-x/channel/preferences", { format: "daily_reading", typeKey: "lunar_hero.tall" });
  assert.equal(wrongPref.body.code, "template_format", "a template can only be preferred for a format it carries");
  assert.ok(store.db.events.some((e) => e.step === "template_active" && e.detail.actor === AUTH.ownerId));

  // The next Full Moon (2026-11-24) is prepared with the active, preferred template.
  clock.now = new Date("2026-11-18T14:00:00Z");
  await runChannelTick({ env: ENV, store, deps });
  const moon = store.db.runs.find((r) => r.slot_date === "2026-11-24");
  assert.equal(moon.format, "something_changed");
  assert.equal(moon.post_type_label, "lunar_hero.tall/v1", "inactive lunar_hero is not used; the preferred one is");
});

test("regenerate with a hand-picked template: a new post, the old one retired, the pick logged", async () => {
  const { route, store } = await preparedWeek();
  const week = await route("GET", "/api/orbit-x/channel/week");
  const row = rowFor(week, (r) => r.state === "ready_for_review" && r.format === "daily_reading");
  const picker = await route("GET", "/api/orbit-x/channel/templates");
  const pick = picker.body.templates.find((t) => t.activatable && t.formats.includes("daily_reading") && t.label !== row.template);
  const regen = await route("POST", `/api/orbit-x/channel/posts/${row.post.id}/regenerate`, { typeId: pick.id, instruction: "Quieter, please." });
  assert.equal(regen.status, 200, JSON.stringify(regen.body));
  assert.equal(regen.body.template, pick.label);
  assert.equal(store.db.posts.find((p) => p.id === row.post.id).status, "rejected");
  assert.equal(store.db.posts.find((p) => p.id === row.post.id).rejection_reason, "regenerated");
  const run = store.db.runs.find((r) => r.id === row.runId);
  assert.equal(run.post_id, regen.body.postId);
  assert.equal(run.post_type_label, pick.label);
  assert.equal(run.state, "ready_for_review", "a regenerated post waits for review again");
  const event = store.db.events.find((e) => e.step === "review_regenerate");
  assert.equal(event.detail.manualPick, true);

  const celestial = picker.body.templates.find((t) => t.typeKey === "celestial_editorial");
  const refused = await route("POST", `/api/orbit-x/channel/posts/${regen.body.postId}/regenerate`, { typeId: celestial.id });
  assert.equal(refused.body.code, "template_blocked", "a blocked template cannot be picked by hand either");
});

test("the gates hold: non-admins see nothing, and writes need the channel's authorization", async () => {
  const { store } = await preparedWeek();
  const outsider = await handleOrbitXRoute("GET", "/api/orbit-x/channel/week", new URLSearchParams(), {}, AUTH,
    { env: ENV, store: admin(false), channelStore: store });
  assert.equal(outsider.status, 404);
  const anyPost = store.db.posts[0];
  const noLane = await handleOrbitXRoute("POST", `/api/orbit-x/channel/posts/${anyPost.id}/reject`, new URLSearchParams(), {},
    AUTH, { env: ENV, store: admin(), fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }) });
  assert.equal(noLane.status, 503);
  assert.equal(noLane.body.code, "channel_unauthorized");
});

test("the profile grid preview: the next nine queued posts, newest first, nothing published by looking", async () => {
  const { route, graph, media } = await preparedWeek();
  const grid = await route("GET", "/api/orbit-x/channel/grid");
  assert.equal(grid.status, 200);
  assert.ok(grid.body.tiles.length >= 5 && grid.body.tiles.length <= 9);
  assert.ok(grid.body.tiles.every((t) => t.svg.startsWith("<svg") && /preserveAspectRatio="xMidYMid slice"/.test(t.svg)), "tiles crop like the profile");
  const dates = grid.body.tiles.map((t) => t.slotDate);
  assert.deepEqual(dates, [...dates].sort().reverse(), "newest first, as a profile shows them");
  assert.equal(graph.calls.length, 0, "viewing the grid calls nobody");
  assert.equal(media.uploads.length, 0, "and uploads nothing");
});
