-- Orbit Axis :: billing events (Dev Update 3.10)
--
-- WHAT THIS IS FOR
--
-- One row per provider event Orbit has already acted on. It exists so that
-- receiving the same event twice grants a plan once.
--
-- WHY IT IS NOT OPTIONAL
--
-- Every payment provider retries. Stripe redelivers a webhook until it gets a
-- 2xx, and it will send the same event again after a timeout even when the
-- first delivery actually succeeded — the response was simply lost. Without a
-- record of what has been handled, a retry is indistinguishable from a new
-- purchase, and "your subscription renewed" fires twice for one payment.
--
-- Idempotency cannot live in account_entitlements, because that table holds
-- STATE (which plan you are on) and not HISTORY (what happened). Upserting the
-- same plan twice is harmless there; the damage from a duplicate is in whatever
-- else the handler does, and in losing the ability to answer "did we already
-- see this?" at all.
--
-- WHY IT ALSO STORES A SEQUENCE
--
-- Retries are not the only ordering problem. Providers do not guarantee that
-- events arrive in the order they occurred: a cancellation and the renewal that
-- preceded it can land in either order. `occurred_at` is the provider's own
-- timestamp for the event, and the writer refuses to apply an event older than
-- the one already recorded for that account. Last-write-wins on arrival order
-- would let a stale renewal silently un-cancel a subscription.
--
-- NO MONEY IS STORED HERE EITHER
--
-- Same rule as account_entitlements: no amount, no card, no customer email, no
-- provider access token. The event id is an opaque handle for asking the
-- provider, which remains the system of record for anything financial. What
-- Orbit keeps is only enough to avoid acting twice and to avoid acting out of
-- order.

-- ── Table ───────────────────────────────────────────────────────────────────

create table if not exists public.billing_events (
  -- The provider's own event id (Stripe: "evt_..."). Primary key, because
  -- uniqueness IS the feature — a duplicate insert failing is the mechanism
  -- that makes the handler idempotent, not an error to be worked around.
  event_id      text primary key,

  provider      text not null
                  check (provider in ('stripe', 'app_store', 'play')),

  -- The provider's event type, kept verbatim. Useful when reconstructing what
  -- happened months later, and deliberately NOT constrained to a closed set:
  -- providers add event types, and an unrecognised one must still be
  -- recordable so that it is not reprocessed forever.
  event_type    text not null,

  -- Null when an event was recognised but concerned no known account — a
  -- checkout that was abandoned, or a customer Orbit has no user for. Those
  -- are still recorded, so they are not retried indefinitely.
  owner_id      uuid references auth.users(id) on delete set null,

  -- The provider's timestamp for when the event occurred, not when it arrived.
  -- This is what orders two events against each other.
  occurred_at   timestamptz not null,

  -- What the handler decided. 'applied' changed an entitlement; 'ignored' was
  -- a type Orbit does not act on; 'stale' arrived after a newer event had
  -- already been applied for that account. All three mean "do not process
  -- again"; keeping them distinct is what makes the table readable during an
  -- incident.
  outcome       text not null
                  check (outcome in ('applied', 'ignored', 'stale')),

  received_at   timestamptz not null default now()
);

comment on table public.billing_events is
  'One row per provider event already acted on. Makes webhook delivery idempotent. No financial data.';

-- "What is the newest event already applied for this account?" is the ordering
-- check, and it runs on every applied event.
create index if not exists billing_events_owner_occurred_idx
  on public.billing_events (owner_id, occurred_at desc)
  where owner_id is not null;

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.billing_events enable row level security;

-- NO POLICY IS DEFINED, FOR ANYONE, AND THAT IS THE WHOLE ACCESS MODEL.
--
-- account_entitlements grants `select` to authenticated because the application
-- has to tell someone which plan they hold. Nobody needs to read this table
-- from a browser: it answers an operational question, not a product one. The
-- service role bypasses RLS and is the only writer and the only reader.
--
-- Following the precedent in 20260807230000_account_entitlements.sql: the
-- absence of a policy IS the protection.

-- Deliberately no `grant` statement either.
