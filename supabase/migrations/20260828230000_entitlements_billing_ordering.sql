-- Orbit Axis :: the entitlements row remembers WHEN it was last told something.
--
-- WHY THIS COLUMN EXISTS
--
-- Stripe delivers webhooks with at-least-once semantics and no ordering
-- guarantee. Duplicates are harmless here — every write is "set this account to
-- this plan", which lands on the same value however many times it runs — but
-- REORDERING is not. A `customer.subscription.deleted` emitted at 09:00 can be
-- retried and arrive after the `customer.subscription.created` from 09:05, and
-- applying it would silently downgrade somebody who is paying.
--
-- Deduplicating by event id does nothing about that: both events are genuine
-- and neither is a duplicate. What is needed is the ordering signal, so the
-- writer can refuse an event older than the one already recorded.
--
-- `created` on the Stripe event is that signal — it survives retries, and it is
-- assigned by Stripe rather than by delivery order.
--
-- Nullable, because every row that exists today predates billing and has no
-- last event. lib/billing/events.js treats an undated row as "apply", which is
-- correct: there is no newer truth to protect.

alter table public.account_entitlements
  add column if not exists last_event_at bigint;

comment on column public.account_entitlements.last_event_at is
  'Unix seconds of the Stripe event that last wrote this row. Guards against '
  'out-of-order webhook delivery; null for rows granted before billing existed.';

-- Deliberately NO new row-level security policy.
--
-- 20260807230000_account_entitlements.sql grants `authenticated` select and
-- nothing else, and says why: "Adding one would let a signed-in browser promote
-- itself. The service role bypasses RLS and is how the billing webhook writes."
-- That remains true of this column. A billing webhook has no user session at
-- all — the request comes from Stripe, not from a browser — so there is no
-- session for a policy to be written against.
