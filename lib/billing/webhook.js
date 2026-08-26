// Orbit Axis :: the billing webhook (Dev Update 3.10).
//
// THE ORDER OF OPERATIONS IS THE DESIGN.
//
//   1. verify the signature, against the raw bytes
//   2. parse
//   3. have we already handled this event id?      → stop
//   4. translate it into an intent                 → or record and stop
//   5. is a newer event already applied?           → record as stale and stop
//   6. write the entitlement
//   7. record the event
//
// Every step before 6 exists to stop step 6 happening twice, happening out of
// order, or happening for a request nobody authenticated.
//
// WHAT THE STATUS CODE MEANS TO STRIPE
//
// 2xx: delivered, stop retrying. Anything else: retry with backoff, for days.
// That makes the status code a control signal, not decoration:
//
//   · a bad signature is 400 — it will be just as bad next time
//   · an event Orbit ignores is 200 — it is handled, in the sense that matters
//   · a duplicate is 200 — the work is already done
//   · Supabase being down is 500 — please do try again
//
// Returning 500 for a permanent problem is how an endpoint gets hammered for a
// week over a config typo. Returning 200 for a transient one silently loses a
// customer's subscription.
//
// WHAT NEVER APPEARS IN A RESPONSE
//
// Nothing about the account, the plan, or why a decision was made. The response
// body goes to whoever POSTed, and the whole premise is that anyone can POST.
// Detail belongs in the return value, which the route logs server-side.

import { grantEntitlement, grantAllowance } from "../entitlements/grant.js";
import { verifyStripeSignature } from "./stripe-signature.js";
import { intentFromStripeEvent, priceMapFrom } from "./intents.js";

/** Shared headers for a service-role REST call. */
function serviceHeaders(key) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    accept: "application/json",
  };
}

/**
 * Has this exact event already been acted on?
 *
 * A read rather than relying on the insert conflicting, because the insert
 * happens LAST — after the entitlement write. Checking first is what stops the
 * grant from running twice; the primary key is the backstop for two deliveries
 * racing each other.
 *
 * @returns {Promise<{ known: boolean, failed: boolean }>}
 */
async function alreadyHandled(eventId, { url, key, doFetch }) {
  const query = `billing_events?event_id=eq.${encodeURIComponent(eventId)}&select=event_id&limit=1`;
  try {
    const res = await doFetch(`${url}/rest/v1/${query}`, { headers: serviceHeaders(key) });
    if (!res.ok) return { known: false, failed: true };
    const rows = await res.json();
    return { known: Array.isArray(rows) && rows.length > 0, failed: false };
  } catch {
    return { known: false, failed: true };
  }
}

/**
 * The timestamp of the newest event already APPLIED for this account.
 *
 * Only applied events count. An ignored or stale one says nothing about what
 * the account's entitlement currently reflects, and letting them participate in
 * the ordering check would let a stream of ignored events block a real update.
 *
 * @returns {Promise<{ occurredAt: string|null, failed: boolean }>}
 */
async function newestApplied(ownerId, { url, key, doFetch }) {
  const query = `billing_events?owner_id=eq.${encodeURIComponent(ownerId)}`
    + "&outcome=eq.applied&select=occurred_at&order=occurred_at.desc&limit=1";
  try {
    const res = await doFetch(`${url}/rest/v1/${query}`, { headers: serviceHeaders(key) });
    if (!res.ok) return { occurredAt: null, failed: true };
    const rows = await res.json();
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    return { occurredAt: row?.occurred_at || null, failed: false };
  } catch {
    return { occurredAt: null, failed: true };
  }
}

/**
 * Write the event down so it is never processed again.
 *
 * A conflict means another delivery of the same event won the race and has
 * already recorded it, which is success from this delivery's point of view —
 * hence ignoreDuplicates rather than merge-duplicates. The first outcome
 * recorded is the true one; overwriting it would erase which delivery actually
 * did the work.
 */
async function recordEvent(row, { url, key, doFetch }) {
  try {
    const res = await doFetch(`${url}/rest/v1/billing_events`, {
      method: "POST",
      headers: {
        ...serviceHeaders(key),
        prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify([row]),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Handle one delivery.
 *
 * @param {object} args
 * @param {Buffer} args.rawBody      the EXACT bytes received
 * @param {string} args.signature    the Stripe-Signature header
 * @param {object} [args.env]
 * @param {object} [args.context]    environment context for the service-role check
 * @param {Function} [args.fetchImpl]
 * @param {number} [args.nowSeconds]
 * @returns {Promise<{ status: number, body: object, detail: string }>}
 */
export async function handleStripeWebhook(args) {
  const env = args.env || process.env;
  const doFetch = args.fetchImpl || fetch;
  const context = args.context || {};

  const done = (status, detail) => ({ status, body: { received: status < 400 }, detail });

  // ── 1. Authenticate ───────────────────────────────────────────────────────
  const verified = verifyStripeSignature({
    rawBody: args.rawBody,
    header: args.signature,
    secret: env.STRIPE_WEBHOOK_SECRET,
    ...(Number.isFinite(args.nowSeconds) ? { nowSeconds: args.nowSeconds } : {}),
  });
  if (!verified.ok) return done(400, `signature rejected: ${verified.reason}`);

  // ── 2. Parse, now that the bytes are trusted ──────────────────────────────
  let event;
  try {
    event = JSON.parse(Buffer.isBuffer(args.rawBody) ? args.rawBody.toString("utf8") : String(args.rawBody));
  } catch {
    // Signed but not JSON. Only Stripe could have produced it, so this is a
    // bug rather than an attack — but it will not parse next time either.
    return done(400, "signed body is not json");
  }

  const eventId = typeof event?.id === "string" ? event.id : "";
  if (!eventId) return done(400, "event has no id");

  // Everything past here needs the service role.
  const allowance = grantAllowance(env, context);
  if (!allowance.authorized) {
    // 500 so the delivery is retried: this is a deployment that is not ready,
    // and the event is worth keeping. Stripe retries for days, which is long
    // enough to fix an environment variable.
    return done(500, `service-role refused: ${allowance.reason}`);
  }
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const deps = { url, key, doFetch };

  // ── 3. Idempotency ────────────────────────────────────────────────────────
  const seen = await alreadyHandled(eventId, deps);
  if (seen.failed) return done(500, "could not read billing_events");
  if (seen.known) return done(200, `event ${eventId} already handled`);

  // ── 4. Translate ──────────────────────────────────────────────────────────
  const { intent, occurredAt, ignored, reason } = intentFromStripeEvent(event, priceMapFrom(env));

  if (ignored) {
    // Recorded so it stops being redelivered. A failure to record is NOT fatal:
    // the event changed nothing, and the worst case is seeing it again.
    await recordEvent({
      event_id: eventId,
      provider: "stripe",
      event_type: String(event.type || "unknown"),
      owner_id: null,
      occurred_at: occurredAt,
      outcome: "ignored",
    }, deps);
    return done(200, `ignored: ${reason}`);
  }

  // ── 5. Ordering ───────────────────────────────────────────────────────────
  const newest = await newestApplied(intent.ownerId, deps);
  if (newest.failed) return done(500, "could not read event history");
  if (newest.occurredAt && Date.parse(occurredAt) < Date.parse(newest.occurredAt)) {
    await recordEvent({
      event_id: eventId,
      provider: "stripe",
      event_type: String(event.type || "unknown"),
      owner_id: intent.ownerId,
      occurred_at: occurredAt,
      outcome: "stale",
    }, deps);
    return done(200, `stale: an event from ${newest.occurredAt} is already applied`);
  }

  // ── 6. Grant ──────────────────────────────────────────────────────────────
  const granted = await grantEntitlement(intent, { env, context, fetchImpl: doFetch });
  if (!granted.ok) {
    // The event is deliberately NOT recorded on failure. Recording it would
    // mark work as done that never happened, and the retry — the one chance to
    // get it right — would be dismissed as a duplicate.
    return done(granted.retryable ? 500 : 400, `grant failed: ${granted.reason}`);
  }

  // ── 7. Record ─────────────────────────────────────────────────────────────
  const recorded = await recordEvent({
    event_id: eventId,
    provider: "stripe",
    event_type: String(event.type || "unknown"),
    owner_id: intent.ownerId,
    occurred_at: occurredAt,
    outcome: "applied",
  }, deps);

  if (!recorded) {
    // The entitlement IS written. Saying "please retry" would replay a grant
    // that already succeeded — harmless in itself, since the write is an
    // idempotent upsert of the same row, but it would also replay the ordering
    // check against a history missing this event. 200, and the missing record
    // is an operational note rather than a customer-facing failure.
    return done(200, `granted, but the event record failed for ${eventId}`);
  }

  return done(200, `applied ${event.type} for ${intent.plan}`);
}
