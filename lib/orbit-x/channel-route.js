// Orbit X :: the channel's cron route (Dev Update 6.1).
//
//   GET /api/orbit-x-channel/tick     (Vercel Cron; POST also accepted for a
//                                      manual tick with the same secret)
//
// NOT A SESSION ROUTE. Vercel Cron is not a signed-in person, so this route
// trusts exactly one thing: `Authorization: Bearer <CRON_SECRET>`, which Vercel
// attaches to every cron invocation when CRON_SECRET is set on the project.
// The comparison is constant-time, the secret must be at least 16 characters,
// and an unset secret refuses everything rather than running unprotected.
//
// Gates, in order: ORBIT_X_ENABLED and ORBIT_X_AUTOPUBLISH (404 when either is
// off, so a deployment without the channel does not advertise it), the secret
// (401), then the purpose-named service-role authorization (503 when refused).
// The response is a summary with no secrets, no copy, and no URLs.

import { timingSafeEqual } from "node:crypto";
import { channelEnabled } from "./channel-config.js";
import { channelAdminConfig, serviceChannelStore } from "./channel-store.js";
import { mediaStore } from "./media.js";
import { runChannelTick } from "./channel.js";

export const CHANNEL_TICK_ROUTE = "/api/orbit-x-channel/tick";

export function cronAuthorized(header, env = process.env) {
  const secret = String(env.CRON_SECRET || "");
  if (secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(String(header || ""));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * @returns {Promise<{status:number, body:object}|null>} null = not this route
 */
export async function handleChannelRoute(method, route, headers = {}, { env = process.env, deps = {} } = {}) {
  if (route !== CHANNEL_TICK_ROUTE) return null;
  if (!channelEnabled(env)) return { status: 404, body: { ok: false, error: "Not found." } };
  if (!["GET", "POST"].includes(method)) return { status: 405, body: { ok: false, error: "Method not allowed." } };
  if (String(env.CRON_SECRET || "").length < 16) {
    return { status: 503, body: { ok: false, error: "The channel has no cron secret configured." } };
  }
  if (!cronAuthorized(headers.authorization, env)) return { status: 401, body: { ok: false, error: "Unauthorized." } };

  let store = deps.store;
  let media = deps.media;
  if (!store) {
    const admin = channelAdminConfig(env);
    if (!admin) return { status: 503, body: { ok: false, error: "Channel storage is not authorized on this deployment." } };
    store = serviceChannelStore(admin, { fetchImpl: deps.fetchImpl || fetch });
    try { media = media || mediaStore(admin, { fetchImpl: deps.fetchImpl || fetch }); } catch { media = null; }
  }
  try {
    const summary = await runChannelTick({ env, store, deps: { ...deps, media, env } });
    return { status: 200, body: summary };
  } catch (error) {
    // The log is the record; the caller gets a code, never a stack or a body.
    console.error(`[orbit-x-channel] tick failed: ${error?.name || "Error"} ${error?.code || ""}`);
    return { status: 500, body: { ok: false, error: "Channel tick failed.", code: error?.code || "tick_failed" } };
  }
}
