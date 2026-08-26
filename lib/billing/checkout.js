// Orbit Axis :: starting a checkout (Dev Update 3.10).
//
// WHAT THIS DOES AND WHY IT MATTERS MORE THAN IT LOOKS
//
// It creates a Stripe Checkout Session and returns its URL. The interesting
// part is one line: it stamps the Orbit owner id into the subscription's
// metadata. That stamp is the ONLY thing that later lets a webhook say which
// account a payment belongs to.
//
// Get it wrong and the money arrives with nothing to attach it to. There is no
// recovering that automatically — matching by email would mean trusting a
// mutable, provider-controlled, frequently-shared value to decide who gets a
// paid plan, which is precisely the kind of identifier an entitlement must
// never hang on.
//
// THE OWNER ID COMES FROM THE SESSION, NEVER FROM THE REQUEST
//
// The caller is signed in; the id is taken from their verified auth context. A
// body field naming an account would let anyone buy a subscription for — or
// more to the point, ATTACH one to — somebody else's account.
//
// NO PRICES LIVE HERE
//
// Amounts are Stripe's, set in Stripe. Orbit stores a price ID and nothing
// else. A number duplicated into this codebase is a number that will eventually
// disagree with the one actually charged.

/** The plans that can be bought. 'free' is not purchasable, it is the default. */
export const PURCHASABLE = Object.freeze(["consumer", "researcher"]);

/**
 * The Stripe price configured for a plan, or null.
 *
 * @param {string} plan
 * @param {object} env
 */
export function priceIdFor(plan, env = process.env) {
  if (plan === "consumer") return String(env.STRIPE_PRICE_CONSUMER || "").trim() || null;
  if (plan === "researcher") return String(env.STRIPE_PRICE_RESEARCHER || "").trim() || null;
  return null;
}

/**
 * The form body for a Checkout Session.
 *
 * PURE, and exported, because this is where the metadata stamp lives and a test
 * asserting "the owner id is attached to the subscription" should not need a
 * network call to prove it.
 *
 * Stripe's API is form-encoded with bracketed paths rather than JSON, which is
 * why this builds URLSearchParams by hand.
 *
 * @param {{ ownerId: string, priceId: string, successUrl: string, cancelUrl: string }} args
 */
export function checkoutForm(args) {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", args.priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("success_url", args.successUrl);
  params.set("cancel_url", args.cancelUrl);

  // Belt: visible on the session, useful when reconciling by hand.
  params.set("client_reference_id", args.ownerId);

  // Braces, and the one that actually matters. The webhook reads
  // customer.subscription.* events, and a session's client_reference_id does
  // not travel onto the subscription — this does.
  params.set("subscription_data[metadata][orbit_owner_id]", args.ownerId);

  // Let Stripe collect and remember the card without Orbit ever seeing it.
  params.set("payment_method_collection", "always");
  return params;
}

/**
 * Create the session and return somewhere to send the customer.
 *
 * Returns { ok, url, reason } rather than throwing, so a route can answer a
 * signed-in human with something useful instead of a stack trace.
 *
 * @param {object} args
 * @param {string} args.ownerId    from the verified auth context, never the body
 * @param {string} args.plan
 * @param {string} args.origin     where to send them back to
 * @param {object} [args.env]
 * @param {Function} [args.fetchImpl]
 */
export async function createCheckoutSession(args) {
  const env = args.env || process.env;
  const doFetch = args.fetchImpl || fetch;
  const fail = (reason) => ({ ok: false, url: null, reason });

  if (!args.ownerId) return fail("not signed in");
  if (!PURCHASABLE.includes(args.plan)) return fail("that plan cannot be purchased");

  const secret = String(env.STRIPE_SECRET_KEY || "").trim();
  if (!secret) return fail("billing is not configured");

  const priceId = priceIdFor(args.plan, env);
  if (!priceId) return fail("that plan has no price configured");

  const origin = String(args.origin || env.ORBIT_PUBLIC_ORIGIN || "").replace(/\/+$/, "");
  if (!origin) return fail("no origin to return to");

  const form = checkoutForm({
    ownerId: args.ownerId,
    priceId,
    successUrl: `${origin}/you?checkout=complete`,
    cancelUrl: `${origin}/you?checkout=cancelled`,
  });

  let res;
  try {
    res = await doFetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/x-www-form-urlencoded",
        // Stripe replays a request with the same idempotency key rather than
        // creating a second session. A double-clicked button should cost one
        // session, not two.
        "idempotency-key": `orbit-${args.ownerId}-${args.plan}`,
      },
      body: form.toString(),
    });
  } catch {
    return fail("could not reach the payment provider");
  }

  if (!res.ok) {
    // Status only. A Stripe error body can echo the request, and the request
    // contains the account identifier.
    return fail(`the payment provider refused the request (${res.status})`);
  }

  const session = await res.json().catch(() => null);
  const url = session && typeof session.url === "string" ? session.url : "";
  if (!url) return fail("the payment provider returned no checkout url");

  return { ok: true, url, reason: null };
}
