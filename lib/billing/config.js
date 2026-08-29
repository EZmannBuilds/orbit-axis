// Orbit Axis :: billing configuration (Dev Update 3.10).
//
// Everything Stripe-shaped the server needs, read from the environment in one
// place. Prices are Stripe Price IDs, never amounts: the amount lives on the
// Price object in Stripe, so changing the price is a Stripe Dashboard action
// plus an environment variable — not a code change, and never business logic
// duplicated into the application.
//
// NOTHING HERE IS EVER SENT TO A CLIENT. The pricing page shows amounts as
// copy; the client asks for "month" or "year" and the SERVER resolves which
// Price that means. A client-supplied price id would let anyone subscribe to
// any price ever created in the account, including test ones.

/** The environment variables billing requires. Documented in
 *  docs/deployment/stripe-billing.md. */
export const BILLING_ENV_VARS = Object.freeze([
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_MONTHLY_ID",
  "STRIPE_PRICE_ANNUAL_ID",
]);

/** The plan a paid subscription grants. "Orbit Pro" is the marketing name;
 *  `consumer` is the plan the shipped Dev Update 3.0 matrix defines. One
 *  mapping, here, so the product is never coupled to a price id. */
export const PAID_PLAN = "consumer";

/** The marketing names, used by the interface only. */
export const PLAN_LABELS = Object.freeze({
  free: "Orbit Free",
  consumer: "Orbit Pro",
  researcher: "Orbit Researcher",
});

export function billingConfig(env = process.env) {
  const missing = BILLING_ENV_VARS.filter((name) => !String(env[name] || "").trim());
  return Object.freeze({
    configured: missing.length === 0,
    missing,
    secretKey: env.STRIPE_SECRET_KEY || null,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || null,
    prices: Object.freeze({
      month: env.STRIPE_PRICE_MONTHLY_ID || null,
      year: env.STRIPE_PRICE_ANNUAL_ID || null,
    }),
  });
}

/** The interval a configured price id belongs to, or null for a stranger. */
export function intervalForPrice(priceId, env = process.env) {
  const { prices } = billingConfig(env);
  if (priceId && priceId === prices.month) return "month";
  if (priceId && priceId === prices.year) return "year";
  return null;
}

/**
 * Where Checkout and the Customer Portal may send the browser back to.
 *
 * Deliberately an allow-list decision rather than an echo of the Host header:
 * a return URL built from attacker-controlled headers is an open redirect
 * with a payment receipt attached. ORBIT_BILLING_ORIGIN pins it explicitly;
 * localhost is accepted for Stripe test mode without configuration.
 */
export function billingOrigin(req, env = process.env) {
  const pinned = String(env.ORBIT_BILLING_ORIGIN || "").trim().replace(/\/+$/, "");
  if (pinned) return pinned;
  const host = String(req?.headers?.host || "");
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}`;
  return null;
}
