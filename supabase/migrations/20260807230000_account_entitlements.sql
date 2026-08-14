-- Orbit Axis :: account entitlements (Dev Update 3.0)
--
-- WHAT THIS IS FOR
--
-- Which plan a person is on. Nothing more: no price, no payment, no provider
-- token, no invoice. Billing is Dev Update 3.10, and keeping the money out of
-- this table is what lets the table ship years before the money does.
--
-- ABSENCE IS A VALID STATE
--
-- No row means FREE. That is the single most important property here:
--
--   · no backfill is needed, so this migration cannot be half-applied
--   · a failed write cannot accidentally grant a plan
--   · a read that errors can safely be treated as free (see lib/entitlements)
--
-- The alternative — a row per user, defaulting to 'free' — would require a
-- backfill, a trigger on auth.users, and a reconciliation job, all to represent
-- the state that "nothing" already represents perfectly.
--
-- THE CLIENT MAY READ IT AND MAY NEVER WRITE IT
--
-- The writer of this table is a billing webhook or a deliberate manual grant,
-- both of which run as the service role. There is no circumstance in which a
-- browser should be able to change its own plan, so no policy grants INSERT,
-- UPDATE, or DELETE to `authenticated` at all. Following the precedent set for
-- reference tables in 20260711160800_rls_policies.sql: the absence of a write
-- policy IS the protection.
--
-- Read access is granted because the application has to tell someone what plan
-- they are on. The server never trusts the client's copy of it.

-- ── Table ───────────────────────────────────────────────────────────────────

create table if not exists public.account_entitlements (
  owner_id            uuid primary key references auth.users(id) on delete cascade,

  -- The plan names are a closed set, checked here as well as in the
  -- application's capability matrix. The database protects against corruption;
  -- lib/entitlements/plans.js enforces the product model. Same split as
  -- 20260801120000_chart_identity_relationship_avatars.sql.
  plan                text not null default 'free'
                        check (plan in ('free', 'consumer', 'researcher')),

  -- 'grace' exists so a failed card does not lock somebody out within the hour.
  -- 'cancelled' means they asked to stop and the period has not ended yet —
  -- distinct from 'expired', which means it has.
  status              text not null default 'active'
                        check (status in ('active', 'grace', 'expired', 'cancelled')),

  -- WHO SAYS SO. A support grant and a purchase must not be indistinguishable
  -- afterwards, or there is no way to audit how somebody got a plan.
  source              text not null default 'manual'
                        check (source in ('manual', 'stripe', 'app_store', 'play')),

  -- The capability matrix version this entitlement was granted under, so a
  -- later matrix cannot silently take something away from someone who already
  -- paid for it. See lib/entitlements/plans.js.
  matrix_version      integer not null default 1,

  current_period_end  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.account_entitlements is
  'Which plan an account holds. No billing data. Absence of a row means free.';

-- Finding the accounts whose period has lapsed is the one query a scheduled
-- job will run; everything else is a primary-key lookup.
create index if not exists account_entitlements_period_end_idx
  on public.account_entitlements (current_period_end)
  where current_period_end is not null;

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.account_entitlements enable row level security;

-- Read your own plan. This is the ONLY policy on this table.
--
-- `(select auth.uid())` rather than a bare `auth.uid()`, matching
-- 20260711161000_local_llm_vault_editing.sql: the subquery form is evaluated
-- once per statement instead of once per row.
create policy "account_entitlements_select_own"
  on public.account_entitlements
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- No insert, update, or delete policy is defined for `authenticated`, and that
-- omission is deliberate and load-bearing. Adding one would let a signed-in
-- browser promote itself. The service role bypasses RLS and is how the billing
-- webhook writes.

grant select on public.account_entitlements to authenticated;

-- ── Keeping updated_at honest ───────────────────────────────────────────────

create or replace function public.touch_account_entitlements_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists account_entitlements_touch_updated_at
  on public.account_entitlements;

create trigger account_entitlements_touch_updated_at
  before update on public.account_entitlements
  for each row execute function public.touch_account_entitlements_updated_at();
