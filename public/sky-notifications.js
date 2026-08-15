// Orbit Axis :: scheduling sky notifications on the device.
//
// The plan — what to say, when to deliver it — comes from
// /api/sky/notifications. This file's whole job is the part that has to happen
// on the phone: asking for permission at the right moment, handing the plan to
// the system scheduler, and cancelling everything when the reader turns it off.
//
// NO PUSH, ANYWHERE.
//
// There is no device token, no APNs registration, and no server that knows a
// notification is pending. Once the plan is fetched, delivery is the operating
// system's own timer. Turning Orbit off at the OS level, or deleting the app,
// takes every scheduled notification with it — there is nothing left behind on
// a server to keep sending.
//
// Plugins are reached through the global Capacitor bridge rather than an
// import, for the reason platform.js gives: Orbit ships no bundler, so a bare
// module specifier resolves nowhere. The npm package exists so `cap sync` can
// install the native pod.

import { isNativeApp } from "./platform.js";

const PLUGIN = "LocalNotifications";
const CHANNEL_ID = "sky-events";

/** Local-only settings. Nothing about notifications is stored server-side. */
const SETTINGS_KEY = "orbit.notifications";

/** Everything off. A notification nobody asked for is the failure mode. */
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  kinds: Object.freeze([]),
  advanced: false,
});

/* ── Settings ─────────────────────────────────────────────────────────────── */

export function readSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
    return {
      enabled: raw.enabled === true,
      kinds: Array.isArray(raw.kinds) ? raw.kinds.filter((k) => typeof k === "string") : [],
      advanced: raw.advanced === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch { /* private mode: the choice lasts for this session */ }
}

/* ── The plugin ───────────────────────────────────────────────────────────── */

function notifications() {
  return globalThis.Capacitor?.Plugins?.[PLUGIN] ?? null;
}

/** Is scheduling possible here at all? A browser tab is not a phone. */
export function available() {
  return isNativeApp() && Boolean(notifications());
}

/**
 * Ask for permission, in context.
 *
 * Called ONLY from the moment the reader switches notifications on — never at
 * launch. A permission prompt on first run asks for something before the
 * person has any idea what it is for, and iOS gives exactly one chance to ask.
 *
 * @returns {Promise<"granted"|"denied"|"unavailable">}
 */
export async function requestPermission() {
  const plugin = notifications();
  if (!plugin) return "unavailable";
  try {
    const current = await plugin.checkPermissions();
    if (current?.display === "granted") return "granted";
    // "denied" from checkPermissions means the system will not show a prompt
    // again. Asking anyway resolves instantly with the same answer, so the
    // caller is told the truth rather than being left waiting on a dialog
    // that is never coming.
    if (current?.display === "denied") return "denied";
    const asked = await plugin.requestPermissions();
    return asked?.display === "granted" ? "granted" : "denied";
  } catch {
    return "unavailable";
  }
}

/** Has permission already been granted? Never prompts. */
export async function permissionState() {
  const plugin = notifications();
  if (!plugin) return "unavailable";
  try {
    const current = await plugin.checkPermissions();
    return current?.display === "granted" ? "granted"
      : current?.display === "denied" ? "denied" : "prompt";
  } catch {
    return "unavailable";
  }
}

/* ── Scheduling ───────────────────────────────────────────────────────────── */

/** Cancel every sky notification this app has pending. */
export async function cancelAll() {
  const plugin = notifications();
  if (!plugin) return 0;
  try {
    const pending = await plugin.getPending();
    const ours = (pending?.notifications ?? []).filter((n) => n?.extra?.channel === CHANNEL_ID);
    if (!ours.length) return 0;
    await plugin.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
    return ours.length;
  } catch {
    return 0;
  }
}

/**
 * Fetch the plan and put it on the device's schedule.
 *
 * Cancel-then-schedule rather than a diff. Rescheduling six notifications to
 * the instants they already had costs nothing, and a diffing reconciler would
 * have to exist here AND on the server, which is two implementations of one
 * rule waiting to disagree.
 *
 * Quiet on every failure path. A reader who has denied permission, or is
 * offline, or is in a browser, should notice nothing — this is a background
 * courtesy, not a task they are waiting on.
 *
 * @returns {Promise<{ scheduled: number, cancelled: number, reason?: string }>}
 */
export async function refreshSchedule({ apiUrl = (p) => p, fetchImpl = fetch } = {}) {
  const settings = readSettings();

  // Off, or nothing ticked: cancel and stop. This is the path that makes
  // "turning everything off" mean the phone goes quiet, rather than merely
  // that no NEW notifications get added.
  if (!settings.enabled || settings.kinds.length === 0) {
    const cancelled = await cancelAll();
    return { scheduled: 0, cancelled, reason: "disabled" };
  }

  if (!available()) return { scheduled: 0, cancelled: 0, reason: "unavailable" };

  // Permission is checked, never requested here. Asking during a routine
  // refresh would put a system dialog in front of someone who just opened the
  // app to look at their chart.
  if (await permissionState() !== "granted") {
    const cancelled = await cancelAll();
    return { scheduled: 0, cancelled, reason: "no_permission" };
  }

  let plan;
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const locale = navigator.language || "en-GB";
    const query = new URLSearchParams({
      tz: timeZone,
      locale,
      kinds: settings.kinds.join(","),
      advanced: settings.advanced ? "on" : "off",
    });
    const res = await fetchImpl(apiUrl(`/api/sky/notifications?${query}`));
    if (!res.ok) return { scheduled: 0, cancelled: 0, reason: "unreachable" };
    plan = (await res.json())?.plan;
  } catch {
    // Offline. The notifications already on the device stay scheduled — they
    // were computed from real ephemeris and are still correct.
    return { scheduled: 0, cancelled: 0, reason: "offline" };
  }

  if (!plan?.notifications?.length) {
    const cancelled = await cancelAll();
    return { scheduled: 0, cancelled, reason: "nothing_upcoming" };
  }

  const cancelled = await cancelAll();
  const plugin = notifications();
  try {
    await plugin.schedule({
      notifications: plan.notifications.map((n) => ({
        id: n.id,
        title: n.title,
        // No body. The title says the whole thing, and a body repeating it in
        // other words is padding — a notification should be readable in the
        // one line a lock screen gives it.
        body: n.body ?? "",
        schedule: { at: new Date(n.schedule_at_utc), allowWhileIdle: false },
        // Tapping opens Orbit at the sky, which is the thing being described.
        extra: { channel: CHANNEL_ID, event_id: n.event_id, kind: n.kind, route: "#transits" },
      })),
    });
    return { scheduled: plan.notifications.length, cancelled };
  } catch {
    return { scheduled: 0, cancelled, reason: "schedule_failed" };
  }
}

/**
 * Turn notifications on, asking for permission at that moment.
 *
 * Returns what actually happened so the settings UI can tell the truth: a
 * reader who denies the system prompt must not be left looking at a switch
 * that says notifications are on.
 *
 * @returns {Promise<{ ok: boolean, permission: string }>}
 */
export async function enable(kinds, { advanced = false, apiUrl, fetchImpl } = {}) {
  if (!available()) {
    // A browser cannot schedule these. The setting is still stored, so it
    // survives to the phone, but nothing is promised here.
    writeSettings({ enabled: true, kinds, advanced });
    return { ok: false, permission: "unavailable" };
  }
  const permission = await requestPermission();
  if (permission !== "granted") {
    // Denied: the switch goes back off, because leaving it on would show a
    // promise the operating system has already refused.
    writeSettings({ ...DEFAULT_SETTINGS });
    return { ok: false, permission };
  }
  writeSettings({ enabled: true, kinds, advanced });
  await refreshSchedule({ apiUrl, fetchImpl });
  return { ok: true, permission };
}

/** Turn everything off, and leave nothing pending. */
export async function disable() {
  writeSettings({ ...DEFAULT_SETTINGS });
  const cancelled = await cancelAll();
  return { cancelled };
}
