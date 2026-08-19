# Stripe Billing — Dev Update 3.10

Web subscriptions for Orbit Pro. Stripe owns the money; verified webhooks write
the local read model; `lib/entitlements` answers "is this person allowed?" from
that model with no Stripe call on any page load. Nothing here touches the App
Store, and no purchase or portal control renders in the native container.

## Plans

| Tier | Internal plan | Price |
| --- | --- | --- |
| Orbit Free | `free` | $0 |
| Orbit Pro | `consumer` | $4.99/month or **$39/year billed once** |

"Orbit Pro" is the marketing name for the `consumer` plan the Dev Update 3.0
matrix already defines — one mapping, in `lib/billing/config.js`, so the
product is never coupled to a price id. Annual arithmetic, stated honestly:
12 × $4.99 = $59.88, so $39/year saves $20.88.

## Environment variables (server only — never in `public/`)

| Variable | What it is |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_…` in test mode, `sk_live_…` in live. |
| `STRIPE_WEBHOOK_SECRET` | The endpoint's `whsec_…` from the Stripe Dashboard. |
| `STRIPE_PRICE_MONTHLY_ID` | `price_…` for $4.99/month. |
| `STRIPE_PRICE_ANNUAL_ID` | `price_…` for $39/year. |
| `ORBIT_BILLING_ORIGIN` | Pinned return origin for Checkout/Portal redirects, e.g. `https://orbit-axis-omega.vercel.app`. Localhost works unpinned; anything else refuses rather than echoing the Host header. |
| `ORBIT_PRODUCTION_SERVICE_ROLE_PURPOSE` | Now a comma list. Production needs `account-deletion,stripe-billing`. |

Test mode and live mode are separated by which keys/price ids are configured —
same code, no mode flag.

## Stripe Dashboard configuration (founder)

1. Create Product "Orbit Pro" with two recurring Prices: $4.99 monthly and
   $39 yearly. Copy both `price_…` ids into the environment.
2. Developers → Webhooks → Add endpoint:
   `https://<origin>/api/stripe/webhook`, events:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`, `invoice.payment_failed`. Copy the signing secret.
3. Billing → Customer Portal: enable, allow cancellation and payment-method
   update. (Invoice history is on by default.)
4. Do all of the above in **test mode first**; repeat in live mode only after
   the acceptance checklist below passes.

## Database migration

`supabase/migrations/20260819170000_stripe_billing.sql` — `billing_subscriptions`
(read model, select-own only) and `stripe_events` (insert-first idempotency
ledger, service-role only). **Apply to hosted before deploying this code**;
the routes answer 503 until both the migration and the environment exist, and
nothing else in the app touches these tables.

## Free/Pro matrix — PROPOSAL for founder review

Matrix v1 (shipped dark in 3.0) already defines `free` vs `consumer`. Enforcement
stays **off** (`ORBIT_ENTITLEMENTS_ENFORCED` unset) until the founder approves
this matrix; purchases work and the plan displays either way.

| Capability | Free | Pro |
| --- | --- | --- |
| Saved charts | 1 | 10 |
| Compatibility readings | — | ✓ |
| Interpretation depth | basic | expanded |
| Chart photos | — | ✓ |
| Technical positions | none | partial |
| History window | 7 days | unlimited |
| Atlas depth | basic | deeper |
| Personalised reminders | — | ✓ |
| **Never paid, ever** | export, deletion, recovery, basic Atlas, themes | same |

Open question for the founder: the free history window (7 days) predates the
reading work of 4.x — confirm or widen before enforcement.

## Manual test-mode checklist

With test keys configured and `stripe listen --forward-to localhost:3001/api/stripe/webhook`:

1. Signed out: `/pricing` buy button → sent to sign in. ✓/✗
2. Signed in: monthly checkout with card `4242 4242 4242 4242` → completes →
   webhook `customer.subscription.created` → You page shows **Orbit Pro**,
   "Renews <date>". ✓/✗
3. Buy again → 409 "already has an active subscription". ✓/✗
4. Portal: switch monthly→annual → plan row shows year interval. ✓/✗
5. Portal: cancel → plan row shows "Cancelled — Pro until <date>". ✓/✗
6. Dashboard: delete subscription → plan returns to Orbit Free. ✓/✗
7. Card `4000 0000 0000 0341` (fails after attach) on a renewal → status
   past_due → "A payment didn't go through…" and Pro retained (grace). ✓/✗
8. `stripe trigger checkout.session.completed` twice with same event →
   second logs `replay`, nothing double-applied. ✓/✗
9. curl the webhook unsigned → 400. ✓/✗
10. Native build: no Upgrade row, no Manage billing row, plan still shown. ✓/✗

## What Stripe receives — and does not

Stripe gets: an opaque Orbit user id in metadata, and whatever the customer
types into Stripe's own hosted pages. Stripe never receives birth data, charts,
readings, tarot history, journals, or email-as-identifier from Orbit. The
webhook selects accounts by server-written metadata only.

## Deliberate behaviours

- The success redirect grants nothing; only verified webhooks write state.
- `past_due` = Pro in `grace` for max(period end, +7 days) while Stripe retries.
- `cancel_at_period_end` keeps Pro until the paid period ends (clock-enforced
  by the evaluator even if the deletion webhook is late).
- `incomplete`, `incomplete_expired`, `unpaid`, `canceled`, `paused` → Free.
- Invoice events are ledgered but drive no state: the subscription events they
  accompany are the single writer per fact.
- Store unavailable during a webhook → 503, so Stripe retries; nothing lost.

## Release notes (draft)

Orbit Pro is available on the web: $4.99/month or $39/year, through Stripe's
hosted checkout. Free keeps the complete product — your chart, today's sky,
your daily reading, the daily card, and always your data. Pro deepens it:
more saved charts, compatibility, expanded interpretation, full history.
Manage or cancel any time from You → Manage billing; a cancelled subscription
keeps Pro until the period you paid for ends.
