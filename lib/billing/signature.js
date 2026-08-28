// Orbit Axis :: Stripe webhook signature verification.
//
// WHY THIS IS HAND-WRITTEN RATHER THAN `stripe.webhooks.constructEvent`.
//
// This repository has nine runtime dependencies and no HTTP framework or
// vendor SDK among them; the deployment bundle is already 20.8 MB because the
// Swiss Ephemeris has to ship inside it. Pulling in the Stripe SDK to reach one
// function that is thirty lines of `node:crypto` would be the largest
// dependency in the tree, bought for the smallest reason.
//
// That trade is only defensible because the scheme is small, exactly specified,
// and testable without an account — which is why test/billing-signature.test.js
// covers the forgery cases directly rather than trusting this file's shape.
// If Orbit ever needs the Stripe API for more than this, take the SDK.
//
// THE SCHEME (docs.stripe.com/webhooks#verify-manually)
//
//   Stripe-Signature: t=<unix seconds>,v1=<hex hmac>,v1=<hex hmac>
//
//   signed payload := "<t>.<raw request body>"
//   expected       := HMAC-SHA256(signing secret, signed payload)
//
// Three details do the actual security work, and each has a test:
//
//   1. THE BODY MUST BE THE EXACT BYTES STRIPE SENT. Parsing to JSON and
//      re-serialising changes key order and whitespace, and the signature stops
//      matching for a message that was never tampered with. Hence readBytes().
//   2. COMPARISON MUST BE TIME-CONSTANT. A byte-by-byte early return leaks how
//      much of a forged signature was right, which is enough to build one.
//   3. THE TIMESTAMP MUST BE CHECKED. Without it a valid signature is valid
//      forever, and an attacker who once observed a "subscription active"
//      webhook can replay it after the customer stops paying.
//
// A header may carry SEVERAL v1 signatures. That is not redundancy — it is what
// makes secret rotation possible, and rejecting all but the first would break
// every rollover.

import { createHmac, timingSafeEqual } from "node:crypto";

/** How far apart Stripe's clock and ours may be. Stripe's own default. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Parse a Stripe-Signature header into its timestamp and v1 signatures.
 *
 * Unknown schemes (v0, and anything Stripe adds later) are ignored rather than
 * rejected, so a future header does not become an outage. Malformed input
 * yields nulls; it never throws, because a hostile client controls this string.
 */
export function parseSignatureHeader(header) {
  const out = { timestamp: null, signatures: [] };
  if (typeof header !== "string" || !header) return out;
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) out.timestamp = Number(value);
    else if (key === "v1" && /^[0-9a-f]+$/i.test(value)) out.signatures.push(value.toLowerCase());
  }
  return out;
}

/** Constant-time hex comparison that cannot throw on attacker-shaped input. */
function sameSignature(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  // Length is not a secret — it is fixed by SHA-256 — but timingSafeEqual
  // throws on a mismatch, so it is checked first rather than caught.
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Is this request really from Stripe?
 *
 * Returns a verdict rather than a boolean so a refusal can name the condition
 * that failed — the difference between "wrong secret" and "too old" is the
 * difference between a misconfiguration and an attack, and both look like a
 * silent 400 otherwise.
 *
 * @param {Buffer|string} rawBody  the EXACT bytes received
 * @param {string} header          the Stripe-Signature header
 * @param {string} secret          the endpoint's signing secret (whsec_…)
 * @param {{ toleranceSeconds?: number, nowSeconds?: number }} [options]
 */
export function verifyStripeSignature(rawBody, header, secret, options = {}) {
  const tolerance = Number.isFinite(options.toleranceSeconds)
    ? options.toleranceSeconds : DEFAULT_TOLERANCE_SECONDS;
  const now = Number.isFinite(options.nowSeconds)
    ? options.nowSeconds : Math.floor(Date.now() / 1000);

  if (!secret || typeof secret !== "string") return { ok: false, reason: "no_signing_secret" };
  if (rawBody == null) return { ok: false, reason: "no_body" };

  const { timestamp, signatures } = parseSignatureHeader(header);
  if (timestamp === null) return { ok: false, reason: "no_timestamp" };
  if (signatures.length === 0) return { ok: false, reason: "no_signature" };

  // Replay window. Checked BEFORE the HMAC so a flood of stale replays costs an
  // integer comparison rather than a hash each.
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, reason: "timestamp_outside_tolerance" };

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  const expected = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), body]))
    .digest("hex");

  // EVERY candidate is compared even after one matches. Returning early would
  // make the number of comparisons depend on which signature was correct.
  let matched = false;
  for (const candidate of signatures) if (sameSignature(candidate, expected)) matched = true;

  return matched ? { ok: true, reason: null, timestamp } : { ok: false, reason: "signature_mismatch" };
}

/**
 * Build a signature header. Exists so the tests can forge and un-forge requests
 * without an account; production never calls it.
 */
export function signPayload(rawBody, secret, timestamp) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  const signature = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), body]))
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}
