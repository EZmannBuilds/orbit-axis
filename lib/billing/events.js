// Orbit Axis :: turning a Stripe event into an entitlement row.
//
// This file decides WHAT a webhook means. lib/billing/signature.js decides
// whether to believe it, and the route decides when to write. Keeping the three
// apart is what lets this one be tested exhaustively with plain objects.
//
// THE COLUMN SET IS ALREADY RIGHT. account_entitlements was written in
// Dev Update 3.0 with `source` including 'stripe' and a `grace` status that
// exists, in its own words, "so a failed card does not lock somebody out within
// the hour". Nothing here invents a schema; it fills one in.
//
// TWO HAZARDS, AND THEY ARE NOT THE SAME HAZARD
//
//   DUPLICATES. Stripe retries until it gets a 2xx, so the same event arrives
//   more than once. This is harmless here by construction: every write is "set
//   this account to this plan", which lands on the same value however many
//   times it runs. Idempotency needs no event-id ledger.
//
//   REORDERING. Retries and parallel delivery mean an OLDER event can arrive
//   after a newer one — a `subscription.deleted` from 09:00 landing after the
//   `subscription.created` from 09:05 would silently downgrade a paying
//   customer. That is the real risk, and duplicate-suppression does nothing
//   about it. Every mapping therefore carries `occurredAt`, and the writer
//   refuses to apply an event older than the row it would overwrite.
//
// PLAN NAMES NEVER COME FROM STRIPE. A price id is mapped to a plan through
// configuration this repository controls. Reading a plan out of event metadata
// would mean anyone who could forge an event — or a mis-set field in the Stripe
// dashboard — could name their own tier.

import { PLANS, DEFAULT_PLAN } from "../entitlements/plans.js";

/** Events that say something about what someone is entitled to. */
export const HANDLED_TYPES = Object.freeze([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/**
 * Stripe subscription status → the four states account_entitlements allows.
 *
 * `past_due` and `unpaid` become 'grace' rather than 'expired' deliberately:
 * the card failed, the person has not cancelled, and Stripe is still retrying.
 * Cutting them off at the first failed charge would punish an expired card.
 *
 * `incomplete` is NOT entitling — the first payment never succeeded, so nothing
 * was bought. `incomplete_expired` likewise.
 */
const STATUS_MAP = Object.freeze({
  active: "active",
  trialing: "active",
  past_due: "grace",
  unpaid: "grace",
  paused: "grace",
  canceled: "cancelled",
  incomplete: "expired",
  incomplete_expired: "expired",
});

/**
 * Read the price → plan mapping out of the environment.
 *
 * Unset variables simply do not appear, so a half-configured environment maps
 * nothing rather than mapping everything to a guess.
 */
export function pricePlanMap(env = process.env) {
  const map = new Map();
  const add = (priceId, plan) => {
    const id = String(priceId || "").trim();
    if (id) map.set(id, plan);
  };
  add(env.ORBIT_STRIPE_PRICE_CONSUMER_MONTHLY, "consumer");
  add(env.ORBIT_STRIPE_PRICE_CONSUMER_ANNUAL, "consumer");
  add(env.ORBIT_STRIPE_PRICE_RESEARCHER_MONTHLY, "researcher");
  add(env.ORBIT_STRIPE_PRICE_RESEARCHER_ANNUAL, "researcher");
  return map;
}

/** The Supabase user this event belongs to, or null. */
function ownerIdFrom(object) {
  // client_reference_id is set when the Checkout Session is created and is the
  // only field the customer cannot influence. metadata is the fallback for
  // subscription events, which do not carry it.
  const candidate = object?.client_reference_id
    || object?.metadata?.orbit_owner_id
    || object?.subscription_details?.metadata?.orbit_owner_id
    || null;
  const id = String(candidate || "").trim();
  // A UUID, or nothing. A malformed id must not reach a database query.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : null;
}

/** Every price id mentioned by a subscription's line items. */
function priceIdsFrom(object) {
  const items = object?.items?.data || [];
  const ids = items.map((item) => item?.price?.id).filter(Boolean);
  if (ids.length) return ids;
  return [object?.plan?.id].filter(Boolean);
}

/**
 * What does this event mean for one account?
 *
 * Returns null for anything not worth acting on — an unhandled type, an event
 * with no account attached, a price this deployment does not sell. Null is a
 * successful outcome: the route still answers 200, because a webhook Orbit
 * chooses to ignore is not an error Stripe should retry.
 *
 * @param {object} event   a parsed Stripe event
 * @param {object} [env]
 * @returns {null | { ownerId: string, plan: string, status: string,
 *                    currentPeriodEnd: string|null, source: 'stripe',
 *                    occurredAt: number, reason: string }}
 */
export function entitlementFromEvent(event, env = process.env) {
  const type = String(event?.type || "");
  if (!HANDLED_TYPES.includes(type)) return null;

  const object = event?.data?.object;
  if (!object) return null;

  const ownerId = ownerIdFrom(object);
  if (!ownerId) return null;

  // `created` is when Stripe made the event, which is the only ordering signal
  // that survives retries and parallel delivery. Missing means unorderable, and
  // an unorderable event must not be allowed to overwrite a dated one.
  const occurredAt = Number(event?.created);
  if (!Number.isFinite(occurredAt)) return null;

  const base = { ownerId, source: "stripe", occurredAt };

  // A cancellation that has already taken effect. There is nothing to look up:
  // whatever they had, it has ended.
  if (type === "customer.subscription.deleted") {
    return { ...base, plan: DEFAULT_PLAN, status: "expired", currentPeriodEnd: null, reason: type };
  }

  // Checkout completion is only entitling once it is actually paid. An unpaid
  // session is somebody who reached the payment page and stopped.
  if (type === "checkout.session.completed" && object.payment_status !== "paid") return null;

  const prices = priceIdsFrom(object);
  const map = pricePlanMap(env);
  // The strongest plan among the line items, so a mixed cart cannot downgrade
  // somebody by ordering. Unknown prices contribute nothing.
  let plan = null;
  for (const id of prices) {
    const candidate = map.get(id);
    if (!candidate) continue;
    if (plan === null || PLANS.indexOf(candidate) > PLANS.indexOf(plan)) plan = candidate;
  }
  // Checkout sessions do not carry line items on the event; the subscription
  // events that follow do. Ignoring the session is correct rather than
  // guessing a plan from a price this deployment does not recognise.
  if (!plan) return null;

  const stripeStatus = String(object.status || "active");
  const status = STATUS_MAP[stripeStatus] || "expired";

  const endSeconds = Number(object.current_period_end);
  const currentPeriodEnd = Number.isFinite(endSeconds)
    ? new Date(endSeconds * 1000).toISOString()
    : null;

  return { ...base, plan, status, currentPeriodEnd, reason: type };
}

/**
 * Should `incoming` be written over `existing`?
 *
 * This is the reordering guard. An event that occurred before the one already
 * recorded is stale, and applying it would undo a newer truth — the case that
 * silently downgrades a paying customer.
 *
 * Equal timestamps apply: Stripe can emit two events in the same second, and
 * refusing ties would drop the second one.
 */
export function shouldApply(incoming, existing) {
  if (!incoming) return false;
  if (!existing) return true;
  const previous = Number(existing.last_event_at);
  if (!Number.isFinite(previous)) return true;   // undated row: nothing to lose
  return incoming.occurredAt >= previous;
}
