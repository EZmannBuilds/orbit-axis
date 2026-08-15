// Orbit Axis :: sky notifications.
//
// The product rule these tests exist to hold: A NOTIFICATION MUST BE USEFUL
// WITHOUT BEING TAPPED. Everything else — the day words, the scheduling, the
// settings — is in service of saying one true thing about the sky at a time
// somebody can use it.
//
// Event times are checked against independently known values rather than
// against whatever the engine happens to return today, because "the code
// agrees with itself" is not evidence that a full moon is at 04:18.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  skyEventsInWindow, filterEnabled, EVENT_SETTINGS, INGRESS_NOTIFY_BODIES,
} from "../lib/notifications/events.js";
import {
  notificationCopy, dayWord, eventClause, houseForLongitude, houseClause,
  auditNotificationCopy, DAY_WORD_HORIZON_HOURS,
} from "../lib/notifications/copy.js";
import {
  buildSchedule, deliveryInstant, notificationId,
  MORNING_HOUR, EVENING_BEFORE_HOUR,
} from "../lib/notifications/schedule.js";
import { handleSkyNotificationsRoute } from "../lib/notifications/api.js";

const CHICAGO = "America/Chicago";
const ALL_KINDS = ["moon", "stations", "ingresses"];

/* ── Event times, against known ephemeris ─────────────────────────────────── */

test("event instants match independently known ephemeris values", () => {
  // The August 2026 full moon and the September 2026 new moon, checked against
  // published lunar calendars rather than against whatever this codebase
  // returns — "the code agrees with itself" is not evidence that a full moon
  // is at 04:18.
  //
  //   Full moon  2026-08-28 04:18 UTC   (timeanddate.com, Space.com, Star Walk;
  //                                      the Sturgeon Moon, with a partial
  //                                      lunar eclipse best seen from the
  //                                      Americas)
  //   New moon   2026-09-11 03:27 UTC   (TheSkyLive gives 04:27 Europe/London,
  //                                      which is BST — UTC+1 — in September)
  const { events } = skyEventsInWindow({ from: new Date("2026-08-15T00:00:00Z"), windowDays: 30 });

  const full = events.find((e) => e.kind === "full_moon");
  const dark = events.find((e) => e.kind === "new_moon");
  assert.ok(full, "a full moon falls in this window");
  assert.ok(dark, "a new moon falls in this window");

  // Within two minutes. Lunation instants are quoted to the minute and
  // different sources round differently; a two-minute band catches a genuine
  // error (an hour out, a day out, the wrong lunation) without failing on
  // rounding.
  assertWithinMinutes(full.instant_utc, "2026-08-28T04:18:00Z", 2);
  assertWithinMinutes(dark.instant_utc, "2026-09-11T03:27:00Z", 2);
});

test("a station is found at the moment the body reverses", () => {
  const { events } = skyEventsInWindow({ from: new Date("2026-08-15T00:00:00Z"), windowDays: 30 });
  const station = events.find((e) => e.kind === "station_retrograde" && e.body === "Uranus");
  assert.ok(station, "Uranus stations retrograde in this window");
  assertWithinMinutes(station.instant_utc, "2026-09-10T18:27:00Z", 5);
  assert.equal(station.sign, "Gemini");
});

test("an ingress is found at the sign boundary", () => {
  const { events } = skyEventsInWindow({ from: new Date("2026-08-15T00:00:00Z"), windowDays: 30 });
  const sun = events.find((e) => e.kind === "ingress" && e.body === "Sun");
  assert.ok(sun);
  // The Sun enters Virgo in late August every year.
  assertWithinMinutes(sun.instant_utc, "2026-08-23T02:18:00Z", 5);
  assert.equal(sun.from_sign, "Leo");
  assert.equal(sun.to_sign, "Virgo");
});

test("the Moon's sign changes are not notifications", () => {
  // Thirteen a month. Including them would drown everything that matters.
  assert.ok(!INGRESS_NOTIFY_BODIES.includes("Moon"));
  const { events } = skyEventsInWindow({ from: new Date("2026-08-15T00:00:00Z"), windowDays: 30 });
  assert.equal(events.filter((e) => e.kind === "ingress" && e.body === "Moon").length, 0);
});

test("the same event is never returned twice", () => {
  // The lunation walk asks "next full and next new" repeatedly and will find
  // the same new moon on consecutive passes.
  const { events } = skyEventsInWindow({ from: new Date("2026-08-15T00:00:00Z"), windowDays: 60 });
  const ids = events.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate events would schedule duplicate notifications");
});

test("event ids are stable when the window start moves", () => {
  // The app recomputes on every open. An id that shifted with the start time
  // would leave the old notification pending and schedule a second one.
  const a = skyEventsInWindow({ from: new Date("2026-08-15T00:00:00Z"), windowDays: 30 });
  const b = skyEventsInWindow({ from: new Date("2026-08-15T06:31:07Z"), windowDays: 30 });
  const shared = a.events.filter((e) => b.events.some((o) => o.instant_utc === e.instant_utc));
  assert.ok(shared.length >= 3, "the windows should overlap");
  for (const event of shared) {
    const other = b.events.find((o) => o.instant_utc === event.instant_utc);
    assert.equal(other.id, event.id);
  }
});

/* ── Copy: the default voice ──────────────────────────────────────────────── */

test("the three product examples come out exactly", () => {
  const at = (iso) => new Date(iso);

  // Full moon at 23:04 local, seen that morning.
  assert.equal(
    notificationCopy(
      { kind: "full_moon", body: "Moon", instant_utc: "2026-08-28T04:04:00Z" },
      { now: at("2026-08-27T14:00:00Z"), timeZone: CHICAGO },
    ).title,
    "Full moon tonight at 23:04",
  );

  assert.equal(
    notificationCopy(
      { kind: "station_direct", body: "Mercury", instant_utc: "2026-08-27T19:00:00Z" },
      { now: at("2026-08-27T14:00:00Z"), timeZone: CHICAGO },
    ).title,
    "Mercury stations direct today",
  );

  assert.equal(
    notificationCopy(
      { kind: "ingress", body: "Venus", to_sign: "Libra", instant_utc: "2026-08-28T13:30:00Z" },
      { now: at("2026-08-27T23:00:00Z"), timeZone: CHICAGO },
    ).title,
    "Venus enters Libra tomorrow morning",
  );
});

test("a clock time is given only for something you could go and look at", () => {
  const now = new Date("2026-08-27T14:00:00Z");
  const opts = { now, timeZone: CHICAGO };
  // A moon has a moment. A station is a bisected change of direction and an
  // ingress is a longitude crossing — neither looks like anything at 14:22.
  assert.match(notificationCopy({ kind: "full_moon", body: "Moon", instant_utc: "2026-08-28T04:04:00Z" }, opts).title, / at /);
  assert.ok(!/ at /.test(notificationCopy({ kind: "station_direct", body: "Mercury", instant_utc: "2026-08-27T19:00:00Z" }, opts).title));
  assert.ok(!/ at /.test(notificationCopy({ kind: "ingress", body: "Mars", to_sign: "Leo", instant_utc: "2026-08-27T19:00:00Z" }, opts).title));
});

test("the clock follows the reader's own format", () => {
  const event = { kind: "full_moon", body: "Moon", instant_utc: "2026-08-28T04:04:00Z" };
  const base = { now: new Date("2026-08-27T14:00:00Z"), timeZone: CHICAGO };
  assert.match(notificationCopy(event, { ...base, locale: "en-GB" }).title, /23:04$/);
  // A 12-hour locale keeps its meridiem: "at 11:04" beside a day word would be
  // ambiguous, and their phone shows it this way.
  assert.match(notificationCopy(event, { ...base, locale: "en-US" }).title, /11:04 PM$|11:04 PM$/);
});

test("times are the reader's local time, not the server's", () => {
  const event = { kind: "full_moon", body: "Moon", instant_utc: "2026-08-28T04:04:00Z" };
  const now = new Date("2026-08-27T14:00:00Z");
  const chicago = notificationCopy(event, { now, timeZone: CHICAGO }).title;
  const tokyo = notificationCopy(event, { now, timeZone: "Asia/Tokyo" }).title;
  assert.notEqual(chicago, tokyo);
  assert.match(chicago, /tonight at 23:04/);
  // 04:04Z is lunchtime in Tokyo, on the following day.
  assert.match(tokyo, /13:04/);
});

/* ── Day words ────────────────────────────────────────────────────────────── */

test("day words follow local calendar days, not elapsed hours", () => {
  const word = (eventIso, nowIso) => dayWord(eventIso, { now: new Date(nowIso), timeZone: CHICAGO }).word;

  // 23:30 local the same day is "tonight" even though it is 20 hours off.
  assert.equal(word("2026-08-28T04:30:00Z", "2026-08-27T08:30:00Z"), "tonight");
  // 00:30 local the NEXT day is not "today", though it is only an hour later.
  assert.equal(word("2026-08-28T05:30:00Z", "2026-08-28T04:30:00Z"), "early tomorrow");
});

test("morning, afternoon, evening and the small hours each read correctly", () => {
  // Delivered 20:00 the evening before; the event walks through the night.
  const now = "2026-09-11T01:00:00Z";
  const expected = [
    [1, "early tomorrow"], [3, "early tomorrow"],
    [6, "tomorrow morning"], [10, "tomorrow morning"],
    [14, "tomorrow afternoon"], [19, "tomorrow evening"], [23, "tomorrow night"],
  ];
  for (const [hour, want] of expected) {
    const iso = new Date(Date.UTC(2026, 8, 11, hour + 5, 6)).toISOString();  // CDT is UTC-5
    assert.equal(dayWord(iso, { now: new Date(now), timeZone: CHICAGO }).word, want, `${hour}:06 local`);
  }
});

test("a 3am event is never described as tomorrow night", () => {
  // partOfDay calls 03:06 "night", and "tomorrow night" is heard as about
  // nine in the evening — eighteen hours from what was meant.
  const iso = new Date(Date.UTC(2026, 8, 11, 8, 6)).toISOString();   // 03:06 CDT
  assert.equal(dayWord(iso, { now: new Date("2026-09-11T01:00:00Z"), timeZone: CHICAGO }).word, "early tomorrow");
});

test("past the horizon a date is used instead of a day word", () => {
  const far = dayWord("2026-09-20T15:00:00Z", { now: new Date("2026-08-27T14:00:00Z"), timeZone: CHICAGO });
  assert.equal(far.kind, "date");
  assert.match(far.word, /^on \d+ \w+$/);

  // And the boundary is where it says it is: just inside stays a day word.
  const inside = new Date(Date.parse("2026-08-27T14:00:00Z") + (DAY_WORD_HORIZON_HOURS - 2) * 3_600_000);
  assert.notEqual(dayWord(inside.toISOString(), { now: new Date("2026-08-27T14:00:00Z"), timeZone: CHICAGO }).kind, "date");
});

/* ── Advanced ─────────────────────────────────────────────────────────────── */

test("Advanced adds one clause to the same line", () => {
  const event = { kind: "full_moon", body: "Moon", instant_utc: "2026-08-28T04:04:00Z", longitude: 200 };
  const cusps = [10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340];
  const base = { now: new Date("2026-08-27T14:00:00Z"), timeZone: CHICAGO };

  const plain = notificationCopy(event, base).title;
  const rich = notificationCopy(event, { ...base, advanced: true, houseCusps: cusps }).title;

  assert.equal(plain, "Full moon tonight at 23:04");
  assert.equal(rich, "Full moon tonight at 23:04, in your seventh house");
  // Same event, same wording, one clause more — not a second notification.
  assert.ok(rich.startsWith(plain));
});

test("default mode never mentions a house, an aspect, or an orb", () => {
  const cusps = [10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340];
  const { events } = skyEventsInWindow({ from: new Date("2026-08-15T00:00:00Z") });
  for (const event of events) {
    const { title } = notificationCopy(event, {
      now: new Date("2026-08-15T12:00:00Z"), timeZone: CHICAGO,
      advanced: false, houseCusps: cusps,      // supplied, and must be ignored
    });
    assert.ok(!/house|orb|conjunct|square|trine|opposition|sextile/i.test(title),
      `default copy leaked chart context: ${title}`);
  }
});

test("Advanced with no chart quietly produces the default line", () => {
  // No chart, no birth time, or an unknown-time chart with no houses. The
  // notification is the default one rather than a broken one.
  const event = { kind: "full_moon", body: "Moon", instant_utc: "2026-08-28T04:04:00Z", longitude: 200 };
  const base = { now: new Date("2026-08-27T14:00:00Z"), timeZone: CHICAGO, advanced: true };
  for (const cusps of [null, undefined, [], [1, 2, 3]]) {
    assert.equal(notificationCopy(event, { ...base, houseCusps: cusps }).title, "Full moon tonight at 23:04");
  }
});

test("houses are found correctly, including across 0 degrees Aries", () => {
  const cusps = [10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340];
  assert.equal(houseForLongitude(15, cusps), 1);
  assert.equal(houseForLongitude(200, cusps), 7);
  // The twelfth house runs 340 -> 10, wrapping past 0.
  assert.equal(houseForLongitude(350, cusps), 12);
  assert.equal(houseForLongitude(5, cusps), 12);
  // The engine's own shape — objects with a longitude — is accepted too.
  assert.equal(houseForLongitude(200, cusps.map((longitude) => ({ longitude }))), 7);
  assert.equal(houseClause(7), "in your seventh house");
  assert.equal(houseClause(null), null);
});

/* ── No bait, ever ────────────────────────────────────────────────────────── */

test("no generated notification is bait", () => {
  // The rule: useful without being tapped. Run every kind, in both modes,
  // across a real window, through the forbidden-language audit.
  const cusps = [10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340];
  const { events } = skyEventsInWindow({ from: new Date("2026-08-15T00:00:00Z"), windowDays: 60 });
  assert.ok(events.length >= 6, "need a real spread of events to be meaningful");

  for (const advanced of [false, true]) {
    for (const event of events) {
      const { title } = notificationCopy(event, {
        now: new Date(event.instant_utc), timeZone: CHICAGO, advanced, houseCusps: cusps,
      });
      assert.deepEqual(auditNotificationCopy(title), [], `bait in: ${title}`);
      // And each line names the actual thing, so it survives being unopened.
      assert.ok(title.length > 8 && /[a-z]/i.test(title));
    }
  }
});

test("an unknown event kind is refused rather than guessed at", () => {
  assert.throws(() => eventClause({ kind: "planetary_alignment_of_destiny" }), RangeError);
});

/* ── Scheduling ───────────────────────────────────────────────────────────── */

test("delivery is the morning of the event, or the evening before", () => {
  const localHourOf = (instant) => Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: CHICAGO, hour: "2-digit", hour12: false,
  }).format(instant)) % 24;

  // Event at 23:04 local -> delivered 09:00 that morning.
  const evening = deliveryInstant("2026-08-28T04:04:00Z", { timeZone: CHICAGO });
  assert.equal(localHourOf(evening), MORNING_HOUR);

  // Event at 06:04 local -> too early for that morning, so the night before.
  const early = deliveryInstant("2026-08-25T11:04:00Z", { timeZone: CHICAGO });
  assert.equal(localHourOf(early), EVENING_BEFORE_HOUR);
  assert.ok(early.getTime() < Date.parse("2026-08-25T11:04:00Z"));
});

test("delivery hours survive a daylight-saving change", () => {
  // US DST ends 2026-11-01. An event just after it must still be delivered at
  // nine in the morning local, not eight or ten.
  const after = deliveryInstant("2026-11-02T20:00:00Z", { timeZone: CHICAGO });
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: CHICAGO, hour: "2-digit", hour12: false,
  }).format(after)) % 24;
  assert.equal(hour, MORNING_HOUR);
});

test("nothing is scheduled when notifications are off", () => {
  const { events } = skyEventsInWindow({ from: new Date("2026-08-15T00:00:00Z") });
  const plan = buildSchedule({
    events, settings: { enabled: false, kinds: ALL_KINDS, advanced: true },
    timeZone: CHICAGO, now: new Date("2026-08-15T00:00:00Z"),
  });
  // An EMPTY plan, not "no new ones" — the caller reads this as cancel
  // everything, which is what off has to mean.
  assert.deepEqual(plan.notifications, []);
  assert.equal(plan.skipped.disabled, events.length);
});

test("only the ticked kinds are scheduled", () => {
  const { events } = skyEventsInWindow({ from: new Date("2026-08-15T00:00:00Z") });
  const plan = buildSchedule({
    events, settings: { enabled: true, kinds: ["moon"] },
    timeZone: CHICAGO, now: new Date("2026-08-15T00:00:00Z"),
  });
  assert.ok(plan.notifications.length > 0);
  for (const n of plan.notifications) {
    assert.ok(["full_moon", "new_moon"].includes(n.kind), `${n.kind} was not asked for`);
  }
  // And ticking nothing schedules nothing.
  assert.deepEqual(buildSchedule({
    events, settings: { enabled: true, kinds: [] }, timeZone: CHICAGO,
  }).notifications, []);
});

test("an event whose delivery time has already passed is not scheduled", () => {
  const { events } = skyEventsInWindow({ from: new Date("2026-08-15T00:00:00Z") });
  const plan = buildSchedule({
    events, settings: { enabled: true, kinds: ALL_KINDS },
    timeZone: CHICAGO,
    now: new Date("2026-09-11T00:00:00Z"),   // near the end of the window
  });
  assert.ok(plan.skipped.past > 0, "some deliveries should be behind us");
  for (const n of plan.notifications) {
    assert.ok(Date.parse(n.schedule_at_utc) > Date.parse("2026-09-11T00:00:00Z"));
  }
});

test("notification ids are stable, positive, and distinct", () => {
  const { events } = skyEventsInWindow({ from: new Date("2026-08-15T00:00:00Z"), windowDays: 60 });
  const ids = events.map((e) => notificationId(e.id));
  for (const id of ids) {
    assert.ok(Number.isInteger(id) && id > 0, `${id} is not a usable notification id`);
  }
  assert.equal(new Set(ids).size, ids.length, "an id collision would drop a notification");
  // Same event, same id, every time — that is what makes rescheduling safe.
  assert.equal(notificationId(events[0].id), notificationId(events[0].id));
});

test("the day word is relative to DELIVERY, not to the moment of scheduling", () => {
  // Scheduled today, delivered in three weeks: the line must say "tonight" on
  // the night it arrives, not "on 11 September" as it would if the wording
  // were fixed when the plan was built.
  const { events } = skyEventsInWindow({ from: new Date("2026-08-15T00:00:00Z") });
  const plan = buildSchedule({
    events, settings: { enabled: true, kinds: ALL_KINDS },
    timeZone: CHICAGO, now: new Date("2026-08-15T00:00:00Z"),
  });
  const moon = plan.notifications.find((n) => n.kind === "full_moon");
  assert.ok(moon);
  assert.match(moon.title, /tonight|today|tomorrow/,
    "wording must be written for the moment it is read");
});

/* ── The endpoint ─────────────────────────────────────────────────────────── */

test("the plan endpoint returns nothing when no kinds are asked for", async () => {
  const res = await handleSkyNotificationsRoute("GET", "/api/sky/notifications",
    new URLSearchParams({ tz: CHICAGO }), {});
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.plan.notifications, []);
});

test("the plan endpoint refuses to trust a timezone it does not know", async () => {
  const res = await handleSkyNotificationsRoute("GET", "/api/sky/notifications",
    new URLSearchParams({ tz: "Mars/Olympus_Mons", kinds: "moon" }), { now: new Date("2026-08-15T00:00:00Z") });
  // UTC rather than an error, and never the server's own zone — a notification
  // an hour out is worse than one that says UTC.
  assert.equal(res.body.timezone, "UTC");
});

test("unknown kinds are dropped, not refused", async () => {
  // An older client asking for a kind this release does not have should get
  // the ones it asked for that exist.
  const res = await handleSkyNotificationsRoute("GET", "/api/sky/notifications",
    new URLSearchParams({ tz: CHICAGO, kinds: "moon,eclipses,quantum" }),
    { now: new Date("2026-08-15T00:00:00Z") });
  assert.equal(res.status, 200);
  for (const n of res.body.plan.notifications) {
    assert.ok(["full_moon", "new_moon"].includes(n.kind));
  }
});

test("the endpoint does not claim routes that are not its own", async () => {
  assert.equal(await handleSkyNotificationsRoute("POST", "/api/sky/notifications", new URLSearchParams(), {}), null);
  assert.equal(await handleSkyNotificationsRoute("GET", "/api/sky/current", new URLSearchParams(), {}), null);
});

test("every settings id the client can send is one the server knows", () => {
  assert.deepEqual([...EVENT_SETTINGS].sort(), ["ingresses", "moon", "stations"]);
  const { events } = skyEventsInWindow({ from: new Date("2026-08-15T00:00:00Z") });
  for (const event of events) {
    assert.ok(EVENT_SETTINGS.includes(event.setting), `${event.kind} maps to no setting`);
  }
  assert.equal(filterEnabled(events, []).length, 0);
  assert.equal(filterEnabled(events, ALL_KINDS).length, events.length);
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

function assertWithinMinutes(actualIso, expectedIso, minutes) {
  const drift = Math.abs(Date.parse(actualIso) - Date.parse(expectedIso)) / 60_000;
  assert.ok(drift <= minutes,
    `${actualIso} is ${drift.toFixed(1)} minutes from the known value ${expectedIso}`);
}
