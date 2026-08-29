// Orbit Axis :: the Stripe transport (Dev Update 3.10).
//
// A thin client over Stripe's REST API, in the project's own idiom: no SDK.
// The standing dependency rule is ask-first, and everything billing needs —
// three POST endpoints and an HMAC check — is a page of fetch and node:crypto.
// What the SDK would add (retries, typed objects for hundreds of endpoints) is
// weight this function never uses, in a bundle that ships to a serverless
// runtime where weight is latency.
//
// SECURITY SHAPE
//   - The secret key exists only inside these calls. It is never logged,
//    never echoed into an error, and never reaches lib/billing callers as data.
//   - Webhook verification is constant-time (timingSafeEqual) over the exact
//     raw bytes Stripe signed. Parsing happens only AFTER the signature holds.
//   - Errors surfaced to callers carry Stripe's error TYPE and our own safe
//     message, never the raw response body, which can quote request fields.

import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.stripe.com/v1";

export class BillingError extends Error {
  constructor(message, { code = "billing_failed", status = 502 } = {}) {
    super(message);
    this.name = "BillingError";
    this.code = code;
    this.status = status;
  }
}

/** Flatten a nested object into Stripe's form encoding
 *  ({a:{b:1}} -> a[b]=1, {c:[x]} -> c[0]=x). */
export function formEncode(params, prefix = "", out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === "object") formEncode(item, `${name}[${i}]`, out);
        else out.append(`${name}[${i}]`, String(item));
      });
    } else if (typeof value === "object") {
      formEncode(value, name, out);
    } else {
      out.append(name, String(value));
    }
  }
  return out;
}

async function stripePost(path, params, { secretKey, idempotencyKey = null, fetchImpl = fetch } = {}) {
  if (!secretKey) throw new BillingError("Billing is not configured.", { code: "billing_unconfigured", status: 503 });
  const headers = {
    authorization: `Bearer ${secretKey}`,
    "content-type": "application/x-www-form-urlencoded",
  };
  // Stripe's own replay protection for OUR requests: a network retry of the
  // same logical action (same key) cannot create a second customer or session.
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

  let res;
  try {
    res = await fetchImpl(`${API}${path}`, { method: "POST", headers, body: formEncode(params).toString() });
  } catch {
    throw new BillingError("Stripe could not be reached.", { code: "stripe_unreachable" });
  }
  let body = null;
  try { body = await res.json(); } catch { /* handled by status below */ }
  if (!res.ok) {
    const type = body?.error?.type || "api_error";
    // Card/validation problems are the caller's to hear about in safe terms;
    // everything else is our configuration or Stripe's day.
    throw new BillingError(
      type === "card_error" ? "The payment could not be completed." : "Billing request failed.",
      { code: `stripe_${type}`, status: res.status >= 500 ? 502 : 400 },
    );
  }
  return body;
}

/** Create a Stripe Customer bound to an Orbit account id. */
export function createCustomer({ ownerId, secretKey, fetchImpl }) {
  return stripePost("/customers", {
    // The stable server-controlled identifier. NOT the email address: an email
    // identifies a mailbox, not an account, and is user-editable.
    metadata: { orbit_user_id: ownerId },
  }, { secretKey, idempotencyKey: `orbit-customer-${ownerId}`, fetchImpl });
}

/** Create a subscription Checkout Session. */
export function createCheckoutSession({ customerId, ownerId, priceId, successUrl, cancelUrl, secretKey, fetchImpl }) {
  return stripePost("/checkout/sessions", {
    mode: "subscription",
    customer: customerId,
    client_reference_id: ownerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: { metadata: { orbit_user_id: ownerId } },
    // Stripe collects what payment needs; Orbit sends nothing else. No natal
    // data, no reading history, no birth details — metadata above is the whole
    // of what crosses.
  }, { secretKey, fetchImpl });
}

/** Create a hosted Customer Portal session. */
export function createPortalSession({ customerId, returnUrl, secretKey, fetchImpl }) {
  return stripePost("/billing_portal/sessions", {
    customer: customerId,
    return_url: returnUrl,
  }, { secretKey, fetchImpl });
}

// ── Webhook signatures ───────────────────────────────────────────────────────

export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verify a Stripe-Signature header against the raw request bytes.
 *
 * Stripe signs `${timestamp}.${rawBody}` with HMAC-SHA256 under the endpoint's
 * signing secret. The header carries `t=…` and one or more `v1=…` candidates
 * (key rolls produce two). Verification:
 *   - constant-time comparison, so a byte-by-byte oracle cannot exist
 *   - timestamp within tolerance, so a captured delivery cannot be replayed
 *     outside a five-minute window (inside it, the event-id ledger refuses)
 *   - the RAW bytes, exactly as received — a re-serialised JSON body would
 *     have different bytes and must never be what gets signed.
 *
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function verifyWebhookSignature(rawBody, signatureHeader, secret, { nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret) return { ok: false, reason: "no signing secret configured" };
  const header = String(signatureHeader || "");
  const parts = Object.create(null);
  for (const piece of header.split(",")) {
    const [k, v] = piece.split("=", 2);
    if (!k || v === undefined) continue;
    (parts[k.trim()] ||= []).push(v.trim());
  }
  const timestamp = Number(parts.t?.[0]);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "malformed signature header" };
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }
  const payload = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody);
  const expected = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), payload]))
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  for (const candidate of parts.v1 || []) {
    const candidateBuf = Buffer.from(candidate, "utf8");
    if (candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf)) {
      return { ok: true, reason: null };
    }
  }
  return { ok: false, reason: "no matching v1 signature" };
}

/** Build a valid Stripe-Signature header — the test suite's forgery bench. */
export function signPayloadForTest(rawBody, secret, { timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}
