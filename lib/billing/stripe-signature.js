// Orbit Axis :: Stripe webhook signature verification (Dev Update 3.10).
//
// THIS IS THE ONLY THING AUTHENTICATING THE WEBHOOK.
//
// The billing endpoint has no session, no user token, and no cookie. Anyone on
// the internet can POST to it. The signature is the entire reason a request is
// believed, which makes this file the security boundary for the one endpoint
// that can change what people have paid for.
//
// So it verifies before parsing. A JSON.parse on an unverified body is already
// trusting the sender with your parser.
//
// WHY NOT THE STRIPE SDK
//
// Orbit runs on the Node standard library and vendors almost nothing (see
// THIRD_PARTY_NOTICES). The whole scheme is an HMAC and a timestamp comparison,
// and node:crypto has both. Pulling in a dependency tree to avoid twenty lines
// would cost more than it saves — and those twenty lines are auditable in one
// sitting, which a dependency tree is not.
//
// THE SCHEME, AS STRIPE DEFINES IT
//
//   Stripe-Signature: t=1737000000,v1=5257a8...,v1=e5d2c1...
//
//   signed payload  = "{t}.{raw request body}"
//   expected        = HMAC-SHA256(signing secret, signed payload), hex
//   valid           = expected matches ANY v1 in the header
//
// Multiple v1 values exist so a secret can be rotated without dropping events:
// during rotation Stripe signs with both. Checking only the first would fail
// exactly half the deliveries mid-rotation.

import { createHmac, timingSafeEqual } from "node:crypto";

/** How far apart the header's clock and ours may be. Stripe's own default. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Split a Stripe-Signature header into its parts.
 *
 * PURE. Returns a timestamp and every v1 candidate; malformed input yields an
 * empty result rather than throwing, because a hostile header must fail
 * verification, not crash the handler.
 *
 * @param {string} header
 * @returns {{ timestamp: number|null, signatures: string[] }}
 */
export function parseSignatureHeader(header) {
  const empty = { timestamp: null, signatures: [] };
  if (typeof header !== "string" || header.length === 0) return empty;
  // A header long enough to be an attack is not a header worth parsing.
  if (header.length > 4096) return empty;

  let timestamp = null;
  const signatures = [];

  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      // Integer seconds only. parseInt would accept "17370abc" and quietly
      // return a number, which is exactly the kind of leniency that turns into
      // a bypass.
      if (/^\d+$/.test(value)) timestamp = Number(value);
    } else if (key === "v1") {
      if (/^[0-9a-f]+$/i.test(value)) signatures.push(value.toLowerCase());
    }
    // v0 is Stripe's test-mode scheme and is deliberately not accepted.
  }

  return { timestamp, signatures };
}

/**
 * The signature Stripe should have sent for this body at this timestamp.
 *
 * PURE apart from the HMAC. Exported so a test can build a valid header without
 * reimplementing the scheme — a test that computes the expected value a second
 * way is a test that can agree with a bug.
 *
 * @param {Buffer|string} rawBody  the EXACT bytes received
 * @param {number} timestamp
 * @param {string} secret
 */
export function expectedSignature(rawBody, timestamp, secret) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  return createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), body]))
    .digest("hex");
}

/** Constant-time hex comparison. Length is compared first, in the clear, because
 *  timingSafeEqual throws on a length mismatch and the length of a signature is
 *  not a secret. */
function sameSignature(a, b) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Did Stripe send this, recently?
 *
 * @param {object} args
 * @param {Buffer|string} args.rawBody  the exact bytes; a re-serialised object will NOT verify
 * @param {string} args.header          the Stripe-Signature header
 * @param {string} args.secret          the endpoint's signing secret (whsec_...)
 * @param {number} [args.nowSeconds]    injectable so tolerance can be tested
 * @param {number} [args.toleranceSeconds]
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function verifyStripeSignature(args) {
  const {
    rawBody,
    header,
    secret,
    nowSeconds = Math.floor(Date.now() / 1000),
    toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  } = args || {};

  const bad = (reason) => ({ ok: false, reason });

  if (!secret) return bad("no signing secret configured");
  if (rawBody == null) return bad("no body");

  const { timestamp, signatures } = parseSignatureHeader(header);
  if (timestamp === null) return bad("no timestamp in signature header");
  if (signatures.length === 0) return bad("no v1 signature in header");

  // Replay window. Checked BEFORE the HMAC so a flood of old-but-validly-signed
  // events is rejected without doing the expensive part — and because a
  // correctly signed event from last year is still an event Orbit must not act
  // on twice.
  //
  // Absolute difference, so a timestamp far in the FUTURE is refused too. Only
  // guarding the past would accept a signature minted with a skewed clock and
  // valid indefinitely.
  const drift = Math.abs(nowSeconds - timestamp);
  if (drift > toleranceSeconds) {
    return bad(`timestamp is ${drift}s away, outside the ${toleranceSeconds}s tolerance`);
  }

  const expected = expectedSignature(rawBody, timestamp, secret);
  // Every candidate is compared, and comparison does not stop early on a match,
  // so the number of comparisons does not depend on which one matched.
  let matched = false;
  for (const candidate of signatures) {
    if (sameSignature(expected, candidate)) matched = true;
  }
  if (!matched) return bad("signature does not match");

  return { ok: true, reason: null };
}
