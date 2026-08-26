// Orbit Axis :: provider event → entitlement intent (Dev Update 3.10).
//
// WHAT THIS FILE IS
//
// The translation layer, and nothing else. It takes a verified provider event
// and produces either an instruction to change somebody's plan, or nothing.
// It reads no environment beyond the price map it is handed, touches no
// network, and writes nothing.
//
// PURE ON PURPOSE. Everything that decides who gets what is here, where a test
// can drive it with a literal event object, because the alternative — testing
// this through a webhook handler with a signature and a database — is how
// billing logic ends up covered by two integration tests and a hope.
//
// WHY SUBSCRIPTION EVENTS AND NOT CHECKOUT
//
// checkout.session.completed is tempting: it is the moment of purchase and it
// carries client_reference_id. But it does not carry a period end, and an
// entitlement without one never expires. Granting on checkout would mean a
// subscription that failed to actually start, or was refunded an hour later,
// leaves a row that nothing revokes.
//
// customer.subscription.* carries status AND current_period_end on every
// delivery, including the first, which Stripe sends immediately after checkout.
// One event shape, one code path, and the expiry is always populated.

/**
 * Subscription statuses, mapped to Orbit's four.
 *
 * Everything not listed here maps to 'expired' rather than being ignored: an
 * unrecognised status is not a reason to leave somebody on a paid plan. Stripe
 * adding a status Orbit has never heard of should cost access, not grant it.
 */
const STATUS_MAP = Object.freeze({
  active: "active",
  trialing: "active",

  // The card failed but the subscription has not ended. 'grace' exists exactly
  // so this does not lock somebody out within the hour of a bank declining a
  // renewal — see the column comment in the entitlements migration.
  past_due: "grace",
  unpaid: "grace",

  canceled: "expired",
  incomplete: "expired",
  incomplete_expired: "expired",
  paused: "expired",
});

/** The event types this module acts on. Everything else is recorded and ignored. */
export const HANDLED_TYPES = Object.freeze([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/**
 * Which plan a Stripe price buys.
 *
 * Passed in rather than read from the environment here, so the mapping is a
 * value a test can supply and a deployment can change without touching code.
 * An unmapped price yields no intent at all — Orbit refuses to guess which plan
 * an unfamiliar product corresponds to, because guessing wrong grants the wrong
 * capabilities to someone who paid for different ones.
 *
 * @param {object} env
 * @returns {Record<string, string>} price id → plan name
 */
export function priceMapFrom(env = process.env) {
  const map = {};
  const consumer = String(env.STRIPE_PRICE_CONSUMER || "").trim();
  const researcher = String(env.STRIPE_PRICE_RESEARCHER || "").trim();
  if (consumer) map[consumer] = "consumer";
  if (researcher) map[researcher] = "researcher";
  return map;
}

/** The first price on the subscription, or null. */
function priceIdOf(subscription) {
  const items = subscription?.items?.data;
  if (!Array.isArray(items) || items.length === 0) return null;
  const price = items[0]?.price?.id;
  return typeof price === "string" && price ? price : null;
}

/**
 * The Orbit account this subscription belongs to.
 *
 * Read from metadata Orbit itself set when the checkout session was created —
 * never from an email, and never by looking a customer up by address. Email is
 * mutable, shared, and provider-controlled; the owner id is the only identifier
 * Orbit put there on purpose.
 */
function ownerIdOf(subscription) {
  const value = subscription?.metadata?.orbit_owner_id;
  return typeof value === "string" && value ? value : null;
}

/**
 * Turn a verified Stripe event into an instruction, or nothing.
 *
 * Returns `{ intent, occurredAt, ignored, reason }`:
 *   · intent   — what to write, or null
 *   · ignored  — true when the event was understood and deliberately not acted
 *                on. The caller still RECORDS it, so it stops being redelivered.
 *   · reason   — why, for the operational log. Never shown to anyone outside.
 *
 * Never throws on a malformed event. A provider that sends something
 * unexpected must produce an ignored result, not a 500 and an endless retry.
 *
 * @param {object} event      the parsed Stripe event
 * @param {Record<string,string>} priceMap
 */
export function intentFromStripeEvent(event, priceMap = {}) {
  const occurredAt = Number.isFinite(event?.created)
    ? new Date(event.created * 1000).toISOString()
    : new Date().toISOString();

  const base = { intent: null, occurredAt, ignored: true, reason: null };
  const ignore = (reason) => ({ ...base, reason });

  const type = typeof event?.type === "string" ? event.type : "";
  if (!HANDLED_TYPES.includes(type)) return ignore(`type ${type || "(none)"} is not handled`);

  const subscription = event?.data?.object;
  if (!subscription || typeof subscription !== "object") return ignore("event carried no object");

  const ownerId = ownerIdOf(subscription);
  if (!ownerId) {
    // A subscription with no Orbit metadata was not created through Orbit's
    // checkout. Recorded and ignored rather than retried: it will never
    // acquire the metadata by being delivered again.
    return ignore("subscription has no orbit_owner_id in metadata");
  }

  const priceId = priceIdOf(subscription);
  if (!priceId) return ignore("subscription has no price");
  const plan = priceMap[priceId];
  if (!plan) return ignore("price is not mapped to a plan");

  // deleted is terminal regardless of what the status field says at the moment
  // the event fires.
  const rawStatus = type === "customer.subscription.deleted"
    ? "canceled"
    : String(subscription.status || "");
  let status = STATUS_MAP[rawStatus] || "expired";

  // WHAT HAPPENS WHEN SOMEBODY CANCELS BUT HAS PAID THROUGH THE MONTH.
  //
  // Stripe keeps the subscription `active` and sets cancel_at_period_end. The
  // entitlements migration has a status for exactly this — 'cancelled', "they
  // asked to stop and the period has not ended yet" — so that is what gets
  // written, because it is what actually happened.
  //
  // ⚠️ service.js does NOT currently treat 'cancelled' as entitling
  // (ENTITLING is active|grace), so writing it revokes access the moment
  // someone cancels, even though they have paid through the period. The
  // migration's comment and the evaluator disagree, and resolving that is a
  // product decision, not one to make silently inside a mapping function.
  //
  // Recorded truthfully here and flagged rather than distorted. Nothing is live
  // yet, so nobody is affected while the decision is outstanding.
  if (status === "active" && subscription.cancel_at_period_end === true) {
    status = "cancelled";
  }

  const periodEnd = Number.isFinite(subscription.current_period_end)
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  return {
    intent: {
      ownerId,
      plan,
      status,
      source: "stripe",
      currentPeriodEnd: periodEnd,
    },
    occurredAt,
    ignored: false,
    reason: null,
  };
}
