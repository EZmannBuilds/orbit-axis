// Orbit Axis :: billing domain logic (Dev Update 3.10).
//
// WHAT DECIDES WHAT.
//
//   Stripe            owns the money and the subscription's true state.
//   This module       translates verified Stripe facts into Orbit's read
//                     model: one billing_subscriptions row and one
//                     account_entitlements row per account.
//   lib/entitlements  answers "is this person allowed?" from that row, and
//                     already expires by clock — a period that ended is over
//                     whatever the status column says.
//
// THE BROWSER REDIRECT IS NEVER AUTHORITATIVE. Landing on the success URL
// grants nothing; only a signature-verified webhook writes state. A reader who
// pays and returns before the webhook lands sees Pro appear moments later —
// that ordering is honest, and the alternative (trusting the URL) is a
// vulnerability with a thank-you page.
//
// STATUS MAPPING — every Stripe status has a deliberate, documented answer:
//
//   Stripe status         entitlement          why
//   ─────────────────────────────────────────────────────────────────────────
//   active                consumer / active    paid, current
//   trialing              consumer / active    Stripe treats a trial as live
//   past_due              consumer / grace     renewal failed; Stripe is
//                                              retrying. Access holds for
//                                              GRACE_DAYS from the event so a
//                                              card hiccup is not an instant
//                                              lockout — then expires by clock.
//   incomplete            free                 first payment never completed;
//                                              nothing was ever granted
//   incomplete_expired    free                 the above, timed out
//   unpaid                free                 retries exhausted
//   canceled              free                 the subscription is over
//   paused                free                 collection paused = not paying
//
//   cancel_at_period_end with status active keeps consumer/active and its
//   real current_period_end: the reader paid for the period and keeps it. The
//   deleted event — or the clock, whichever lands first — ends access.

import { CURRENT_MATRIX_VERSION } from "../entitlements/plans.js";
import { PAID_PLAN, billingConfig, intervalForPrice } from "./config.js";
import { BillingError, createCheckoutSession, createCustomer, createPortalSession } from "./stripe.js";

/** Days of access a failed renewal keeps while Stripe retries the card. */
export const GRACE_DAYS = 7;

/** Stripe statuses that entitle, and what they entitle to. */
export function entitlementForSubscription(sub, { nowMs = Date.now() } = {}) {
  const status = String(sub?.status || "none");
  const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;

  if (status === "active" || status === "trialing") {
    return { plan: PAID_PLAN, status: "active", currentPeriodEnd: periodEnd };
  }
  if (status === "past_due") {
    const graceEnd = new Date(nowMs + GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    // The larger of the two horizons: an early-period failure keeps the time
    // already paid for; a period-boundary failure gets the grace window.
    const end = periodEnd && periodEnd > graceEnd ? periodEnd : graceEnd;
    return { plan: PAID_PLAN, status: "grace", currentPeriodEnd: end };
  }
  return { plan: "free", status: "expired", currentPeriodEnd: periodEnd };
}

/** The billing_subscriptions row a Stripe subscription object becomes. */
export function subscriptionRow(ownerId, sub, eventCreatedSeconds, env = process.env) {
  const item = sub?.items?.data?.[0] || {};
  const priceId = item?.price?.id || null;
  return {
    owner_id: ownerId,
    stripe_customer_id: String(sub.customer),
    stripe_subscription_id: sub.id || null,
    stripe_product_id: item?.price?.product || null,
    stripe_price_id: priceId,
    status: String(sub.status || "none"),
    billing_interval: intervalForPrice(priceId, env) || item?.price?.recurring?.interval || null,
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end === true,
    last_event_created: new Date(eventCreatedSeconds * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * The webhook's whole job. Returns what happened, for the log line — never
 * anything derived from unverified input.
 *
 * Idempotency has two layers, both required:
 *   1. Insert-first event ledger: a redelivered event id is acknowledged and
 *      applied ZERO times.
 *   2. Stale-event skip: deliveries are not ordered, so an event older than
 *      the row's last applied one is acknowledged and applied zero times.
 *
 * @param {object} event  the signature-verified, parsed Stripe event
 * @param {object} store  the write side (service-role) — see api.js
 */
export async function applyStripeEvent(event, store, { env = process.env, nowMs = Date.now() } = {}) {
  const recorded = await store.recordEvent(event.id, event.type);
  if (recorded === "replay") return { outcome: "replay", eventType: event.type };

  const object = event?.data?.object || {};

  // Which account? Server-controlled metadata only. client_reference_id and
  // metadata.orbit_user_id were both written BY OUR SERVER at session/customer
  // creation; an email address is never consulted.
  const resolveOwner = async () => {
    const direct = object?.metadata?.orbit_user_id
      || object?.subscription_details?.metadata?.orbit_user_id
      || object?.client_reference_id;
    if (direct) return direct;
    if (object.customer) return store.ownerForCustomer(String(object.customer));
    return null;
  };

  switch (event.type) {
    case "checkout.session.completed": {
      // Links customer to account; the authoritative subscription state
      // arrives in its own event. Granting here would trust a session object
      // to describe a subscription it does not carry in full.
      const ownerId = await resolveOwner();
      if (!ownerId) return { outcome: "orphan", eventType: event.type };
      await store.linkCustomer(ownerId, String(object.customer), event.created);
      return { outcome: "linked", eventType: event.type };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const ownerId = await resolveOwner();
      if (!ownerId) return { outcome: "orphan", eventType: event.type };

      const existing = await store.read(ownerId);
      if (existing?.last_event_created
          && Date.parse(existing.last_event_created) > event.created * 1000) {
        return { outcome: "stale", eventType: event.type };
      }

      // A deleted subscription reports its final state; force the mapping.
      const sub = event.type === "customer.subscription.deleted"
        ? { ...object, status: "canceled" }
        : object;

      await store.upsert(subscriptionRow(ownerId, sub, event.created, env));
      const grant = entitlementForSubscription(sub, { nowMs });
      await store.entitle(ownerId, {
        plan: grant.plan,
        status: grant.status,
        source: "stripe",
        matrix_version: CURRENT_MATRIX_VERSION,
        current_period_end: grant.currentPeriodEnd,
        updated_at: new Date(nowMs).toISOString(),
      });
      return { outcome: "applied", eventType: event.type, plan: grant.plan, status: grant.status };
    }

    case "invoice.paid":
    case "invoice.payment_succeeded":
    case "invoice.payment_failed": {
      // Invoices matter because they MOVE the subscription (renewed period,
      // past_due) — and Stripe sends customer.subscription.updated alongside,
      // which this handler already applies. The invoice itself is recorded in
      // the ledger and deliberately drives no state of its own: one writer per
      // fact. Documented behaviour, not an omission.
      return { outcome: "noted", eventType: event.type };
    }

    default:
      return { outcome: "ignored", eventType: event.type };
  }
}

// ── Checkout and portal ──────────────────────────────────────────────────────

/** Statuses that mean "a live subscription already exists — refuse a second". */
const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export async function beginCheckout({ ownerId, interval, origin, store, env = process.env, fetchImpl = fetch }) {
  const cfg = billingConfig(env);
  if (!cfg.configured) throw new BillingError("Billing is not configured.", { code: "billing_unconfigured", status: 503 });
  if (!origin) throw new BillingError("No approved return address for Checkout.", { code: "origin_unpinned", status: 503 });
  const priceId = cfg.prices[interval];
  if (!priceId) throw new BillingError("Choose monthly or annual.", { code: "invalid_interval", status: 400 });

  // One live subscription per account. The duplicate would bill twice and
  // entitle once — refused before Stripe is ever asked.
  const existing = await store.read(ownerId);
  if (existing && LIVE_STATUSES.has(existing.status)) {
    throw new BillingError("This account already has an active subscription. Manage it from billing.",
      { code: "already_subscribed", status: 409 });
  }

  let customerId = existing?.stripe_customer_id || null;
  if (!customerId) {
    const customer = await createCustomer({ ownerId, secretKey: cfg.secretKey, fetchImpl });
    customerId = customer.id;
    await store.linkCustomer(ownerId, customerId, Math.floor(Date.now() / 1000));
  }

  const session = await createCheckoutSession({
    customerId,
    ownerId,
    priceId,
    successUrl: `${origin}/#more?billing=success`,
    cancelUrl: `${origin}/pricing?billing=cancelled`,
    secretKey: cfg.secretKey,
    fetchImpl,
  });
  return { url: session.url };
}

export async function beginPortal({ ownerId, origin, store, env = process.env, fetchImpl = fetch }) {
  const cfg = billingConfig(env);
  if (!cfg.configured) throw new BillingError("Billing is not configured.", { code: "billing_unconfigured", status: 503 });
  if (!origin) throw new BillingError("No approved return address for the portal.", { code: "origin_unpinned", status: 503 });
  const existing = await store.read(ownerId);
  if (!existing?.stripe_customer_id) {
    throw new BillingError("No billing history for this account yet.", { code: "no_customer", status: 404 });
  }
  const session = await createPortalSession({
    customerId: existing.stripe_customer_id,
    returnUrl: `${origin}/#more`,
    secretKey: cfg.secretKey,
    fetchImpl,
  });
  return { url: session.url };
}

/** What the account page shows. Local read model only — no Stripe call. */
export function describeBilling(row, { labels } = {}) {
  if (!row || !row.stripe_subscription_id) {
    return { plan: "free", label: labels?.free || "Orbit Free", status: "none",
             interval: null, renewsAt: null, endsAt: null, cancelAtPeriodEnd: false, manageable: Boolean(row?.stripe_customer_id) };
  }
  const grant = entitlementForSubscription({
    status: row.status,
    current_period_end: row.current_period_end ? Math.floor(Date.parse(row.current_period_end) / 1000) : null,
    cancel_at_period_end: row.cancel_at_period_end,
  });
  const pro = grant.plan !== "free";
  return {
    plan: grant.plan,
    label: pro ? (labels?.consumer || "Orbit Pro") : (labels?.free || "Orbit Free"),
    status: row.status,
    interval: row.billing_interval,
    renewsAt: pro && !row.cancel_at_period_end ? row.current_period_end : null,
    endsAt: row.cancel_at_period_end || !pro ? row.current_period_end : null,
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    manageable: true,
  };
}
