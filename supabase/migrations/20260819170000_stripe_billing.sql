-- Orbit Axis :: web billing (Dev Update 3.10, first slice).
--
-- STRIPE IS THE SOURCE OF TRUTH FOR BILLING; THIS IS THE READ MODEL.
--
-- The application must answer "is this account Pro?" on every request without
-- calling Stripe, and Stripe must remain the only place that decides what a
-- subscription's real state is. So: verified webhooks write these rows, the
-- entitlement evaluator reads them (via account_entitlements, which webhooks
-- derive), and nothing the browser says about its own plan is ever written
-- anywhere.
--
-- TWO TABLES, TWO JOBS.
--
-- billing_subscriptions is the per-account mirror of the Stripe subscription:
-- one row per Orbit account, upserted by webhook events. stripe_events is the
-- idempotency ledger: every event id Stripe delivers is recorded BEFORE its
-- effects are applied, so a replayed delivery (Stripe retries, at-least-once)
-- inserts nothing and changes nothing the second time.
--
-- WRITES ARE SERVICE-ROLE ONLY. There is deliberately no INSERT, UPDATE, or
-- DELETE policy on either table: the authenticated role can read its own
-- billing row (it is the account holder's own information) and can touch
-- nothing. The webhook handler writes under the purpose-named service-role
-- authorization (lib/env/service-role.js, purpose "stripe-billing"), which
-- bypasses RLS by design and is gated far more narrowly than a policy could
-- express.

create table if not exists public.billing_subscriptions (
  owner_id               uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id     text not null,
  stripe_subscription_id text,
  stripe_product_id      text,
  stripe_price_id        text,
  -- Stripe's own vocabulary, verbatim. Mapping to an entitlement happens in
  -- code (lib/billing/service.js) where it is versioned and tested; storing a
  -- pre-mapped value here would hide the mapping from review.
  status                 text not null default 'none',
  billing_interval       text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  -- Idempotency horizon: the Stripe-side creation time of the newest event
  -- applied to this row. An event older than this is stale and is skipped —
  -- Stripe does not guarantee delivery order.
  last_event_created     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint billing_subscriptions_customer_unique unique (stripe_customer_id),
  constraint billing_subscriptions_interval_valid
    check (billing_interval is null or billing_interval in ('month', 'year'))
);

create index if not exists billing_subscriptions_subscription_idx
  on public.billing_subscriptions (stripe_subscription_id);

alter table public.billing_subscriptions enable row level security;

-- The account holder may see their own billing state; nobody may write it.
create policy "billing_subscriptions_select_own" on public.billing_subscriptions
  for select to authenticated using (owner_id = (select auth.uid()));

grant select on public.billing_subscriptions to authenticated;

-- ── The idempotency ledger ──────────────────────────────────────────────────
-- Insert-first: the handler inserts the event id, and a unique violation means
-- "already processed — acknowledge and do nothing". Kept as its own table
-- rather than a column so replay protection does not depend on which row an
-- event happens to touch.

create table if not exists public.stripe_events (
  id           text primary key,            -- Stripe's evt_… id
  event_type   text not null,
  created_at   timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- No policies at all: service-role only, invisible to every client role.

comment on table public.billing_subscriptions is
  'Per-account mirror of the Stripe subscription. Written only by verified '
  'webhooks under the stripe-billing service-role purpose; Stripe is the '
  'source of truth and this is the local authorization read model.';
comment on table public.stripe_events is
  'Every Stripe event id ever processed. Insert-first idempotency: a replayed '
  'delivery conflicts here and is acknowledged without effect.';
