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
import {
  BillingError, createCheckoutSession, createCustomer, createPortalSession,
  listSubscriptions, listCheckoutSessions, retrieveCheckoutSession,
  expireCheckoutSession, cancelSubscription,
} from "./stripe.js";

/** Days of access a failed renewal keeps while Stripe retries the card. */
export const GRACE_DAYS = 7;

/** Normalize legacy and item-level Stripe periods. The earliest item is the
 * conservative boundary if a subscription ever contains mixed intervals. */
export function subscriptionPeriodEnd(sub) {
  const items = sub?.items?.data || [];
  const values = items.map((item) => item.current_period_end).filter((v) => Number.isFinite(v) && v > 0);
  const seconds = values.length ? Math.min(...values) : sub?.current_period_end;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Stripe statuses that entitle, and what they entitle to. */
export function entitlementForSubscription(sub, { nowMs = Date.now() } = {}) {
  const status = String(sub?.status || "none");
  const periodEnd = subscriptionPeriodEnd(sub);

  if (status === "active" || status === "trialing") {
    if (!periodEnd) throw new BillingError("Subscription period is missing.", { code: "missing_period" });
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
    current_period_end: subscriptionPeriodEnd(sub),
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
 *   1. Transactional event ledger: a redelivered completed event id is
 *      acknowledged and applied ZERO times; failures remain retryable.
 *   2. Stale-event skip: deliveries are not ordered, so an event older than
 *      the row's last applied one is acknowledged and applied zero times.
 *
 * @param {object} event  the signature-verified, parsed Stripe event
 * @param {object} store  the write side (service-role) — see api.js
 */
export async function applyStripeEvent(event, store, { env = process.env, nowMs = Date.now() } = {}) {
  const object = event?.data?.object || {};
  const customerId = typeof object.customer === "string" ? object.customer : object.customer?.id;
  const type = event.type;
  const subscriptionEvent = ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(type);
  const linkEvent = type === "checkout.session.completed";
  const ownerId = subscriptionEvent || linkEvent
    ? object?.metadata?.orbit_user_id || object?.client_reference_id
      || (customerId ? await store.ownerForCustomer(customerId) : null)
    : null;
  let row = null;
  let grant = null;
  if (subscriptionEvent && ownerId) {
    const sub = type === "customer.subscription.deleted" ? { ...object, status: "canceled" } : object;
    row = subscriptionRow(ownerId, sub, event.created, env);
    // Anchor grace to the event, so delayed delivery cannot extend it.
    const entitlement = entitlementForSubscription(sub, { nowMs: Math.min(nowMs, event.created * 1000) });
    grant = {
      plan: entitlement.plan, status: entitlement.status, source: "stripe",
      matrix_version: CURRENT_MATRIX_VERSION, current_period_end: entitlement.currentPeriodEnd,
      updated_at: new Date(nowMs).toISOString(),
    };
  }
  // The ledger, stale-event check, and both writes commit in ONE database
  // transaction. A failed write rolls back the ledger too, allowing retries.
  const mode = subscriptionEvent ? "subscription" : linkEvent ? "link"
    : ["invoice.paid", "invoice.payment_succeeded", "invoice.payment_failed"].includes(type) ? "noted" : "ignored";
  const result = await store.applyEvent({ eventId: event.id, eventType: type, ownerId, customerId, row, grant, mode });
  return { ...result, eventType: type, ...(result.outcome === "applied" ? { plan: grant.plan, status: grant.status } : {}) };
}

// ── Checkout and portal ──────────────────────────────────────────────────────

/** Statuses that mean "a live subscription already exists — refuse a second". */
const TERMINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);
const LIVE_STATUSES = new Set(["active", "trialing", "past_due", "incomplete", "unpaid", "paused"]);

function alreadySubscribed() {
  return new BillingError("This account already has a subscription. Manage it from billing.", { code: "already_subscribed", status: 409 });
}

async function checkoutForAttempt(attempt, options) {
  if (attempt.session_id) return retrieveCheckoutSession(attempt.session_id, options);
  if (attempt.params.expiresAt * 1000 <= Date.now() + 30 * 60 * 1000) {
    // A lost response near expiry cannot be recreated with a changed expiry:
    // that would violate idempotency. Recover the original by its metadata.
    const sessions = await listCheckoutSessions(attempt.params.customerId, options);
    const session = sessions.find((s) => s.metadata?.orbit_checkout_attempt === attempt.id);
    if (session) return session;
    if (attempt.params.expiresAt * 1000 > Date.now()) {
      throw new BillingError("Checkout is still being recovered. Please try again shortly.", { status: 409 });
    }
    return { status: "expired" };
  }
  return createCheckoutSession({ ...attempt.params, attemptId: attempt.id, ...options });
}

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

  const options = { secretKey: cfg.secretKey, fetchImpl };
  // Check Stripe as well as the mirror: checkout completion may precede its
  // webhook, and older app versions could create more than one subscription.
  const subscriptions = await listSubscriptions(customerId, options);
  if (subscriptions.some((s) => !TERMINAL_STATUSES.has(s.status))) throw alreadySubscribed();
  const params = { customerId, ownerId, priceId, successUrl: `${origin}/#more?billing=success`, cancelUrl: `${origin}/pricing?billing=cancelled` };
  let previousId = null;
  for (let pass = 0; pass < 2; pass += 1) {
    const attempt = await store.reserveCheckout(ownerId, interval, params, previousId);
    if (attempt.deleting) throw new BillingError("Account deletion is in progress.", { status: 409 });
    const session = await checkoutForAttempt(attempt, options);
    if (session.status === "complete") {
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (subscriptionId && subscriptions.some((s) => s.id === subscriptionId && TERMINAL_STATUSES.has(s.status))) {
        previousId = attempt.id;
        continue;
      }
      throw alreadySubscribed();
    }
    if (session.status === "expired") { previousId = attempt.id; continue; }
    if (attempt.interval !== interval) {
      throw new BillingError("Another plan's checkout is open. Finish it or wait for it to expire.", { status: 409 });
    }
    if (!session.id || !session.url || session.status !== "open") throw new BillingError("Checkout response was incomplete.");
    const saved = await store.saveCheckout(ownerId, attempt.id, session.id);
    if (saved.deleting) {
      // Deletion may have begun while Stripe answered. Its recovery uses the
      // same attempt and key, so no independent payment session can escape.
      try { await expireCheckoutSession(session.id, options); } catch { /* deletion retries the authoritative read */ }
      throw new BillingError("Account deletion is in progress.", { status: 409 });
    }
    return { url: session.url };
  }
  throw new BillingError("Checkout expired. Please try again.", { status: 409 });
}

/** Close the checkout gate before any identity or avatar is removed. A
 * failure leaves the account and mapping available for a safe deletion retry. */
export async function cancelBillingForDeletion({ ownerId, store, env = process.env, fetchImpl = fetch }) {
  const state = await store.beginDeletion(ownerId);
  const row = await store.read(ownerId);
  const customerId = row?.stripe_customer_id;
  if (!customerId) return;
  const options = { secretKey: billingConfig(env).secretKey, fetchImpl };
  if (!options.secretKey) throw new BillingError("Billing must be available before this account can be deleted.");
  // Materialize/recover an in-flight request under the SAME idempotency key.
  // If Stripe is still processing it, deletion fails safely and is retried.
  if (state.attempt) {
    const pending = await checkoutForAttempt(state.attempt, options);
    if (pending.status === "open") await expireCheckoutSession(pending.id, options);
  }
  // Sweep older sessions too, including sessions created before this fix.
  for (const session of await listCheckoutSessions(customerId, options)) {
    if (session.status === "open") {
      try { await expireCheckoutSession(session.id, options); }
      catch (error) {
        const current = await retrieveCheckoutSession(session.id, options);
        if (current.status === "open") throw error;
      }
    }
  }
  for (const sub of await listSubscriptions(customerId, options)) {
    if (!TERMINAL_STATUSES.has(sub.status)) await cancelSubscription(sub.id, options);
  }
  if ((await listSubscriptions(customerId, options)).some((s) => !TERMINAL_STATUSES.has(s.status))) {
    throw new BillingError("Subscription cancellation has not completed. Please retry deletion.");
  }
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
    status: row.current_period_end ? row.status : "expired",
    current_period_end: row.current_period_end ? Math.floor(Date.parse(row.current_period_end) / 1000) : null,
    cancel_at_period_end: row.cancel_at_period_end,
  });
  const pro = grant.plan !== "free" && (!row.current_period_end || Date.parse(row.current_period_end) > Date.now());
  return {
    plan: pro ? grant.plan : "free",
    label: pro ? (labels?.consumer || "Orbit Pro") : (labels?.free || "Orbit Free"),
    status: row.status,
    interval: row.billing_interval,
    renewsAt: pro && !row.cancel_at_period_end ? row.current_period_end : null,
    endsAt: row.cancel_at_period_end || !pro ? row.current_period_end : null,
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    manageable: true,
  };
}
