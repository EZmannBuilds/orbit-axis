-- Orbit Axis :: the entitlements timestamp trigger stops being a public endpoint.
--
-- WHAT WAS WRONG
--
-- `touch_account_entitlements_updated_at()` is a trigger function. Its entire
-- body is `new.updated_at := now()`. But PostgreSQL grants EXECUTE on a new
-- function to PUBLIC by default, and PostgREST exposes everything in the
-- `public` schema — so the function was reachable as a REST endpoint:
--
--     POST /rest/v1/rpc/touch_account_entitlements_updated_at
--
-- callable by `anon`, which means by anyone on the internet with the publishable
-- key. Found by the Supabase security advisor after the Tarot migrations were
-- applied on 2026-08-17, and it dates from the account_entitlements migration
-- rather than from anything Tarot did.
--
-- HOW MUCH THIS ACTUALLY MATTERED
--
-- Not much, and that is worth stating rather than implying a breach. Called
-- directly the function has no trigger context: `new` is unassigned, so it
-- raises an error and returns nothing. It reads no table, writes no table, and
-- leaks no data. The real problem is category, not consequence — a
-- SECURITY DEFINER function should never be reachable by an anonymous caller,
-- because the next one might not be this harmless, and a codebase where that is
-- normal is one where the dangerous case goes unnoticed.
--
-- TWO CHANGES, BOTH DELIBERATE
--
-- 1. Revoke EXECUTE from PUBLIC. This is what removes the endpoint. `anon` and
--    `authenticated` hold their access THROUGH PUBLIC rather than by a direct
--    grant, so revoking PUBLIC is the change that matters — the explicit
--    revokes below are belt and braces against a direct grant existing now or
--    being added later.
--
--    This does NOT stop the trigger. PostgreSQL does not check EXECUTE
--    privilege on a trigger function when the trigger fires; the check happens
--    only for a direct call. Verified against the live table by updating a row
--    inside a transaction and rolling it back.
--
-- 2. SECURITY DEFINER -> SECURITY INVOKER. Definer rights bought this function
--    nothing: assigning to `new` needs no privilege beyond what the statement
--    that fired the trigger already has. Dropping it removes the elevated
--    status that made this a finding at all, rather than leaving elevation in
--    place and merely hiding the door.
--
-- `search_path = ''` is kept. An empty search path means every reference inside
-- the function must be schema-qualified, so a caller cannot shadow a name with
-- something of their own — the standard hardening, and it was already right.

create or replace function public.touch_account_entitlements_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- The revoke that closes the endpoint. PUBLIC first, because that is where the
-- access actually comes from.
revoke execute on function public.touch_account_entitlements_updated_at() from public;
revoke execute on function public.touch_account_entitlements_updated_at() from anon;
revoke execute on function public.touch_account_entitlements_updated_at() from authenticated;

-- service_role is deliberately NOT revoked. It bypasses RLS and holds broad
-- rights by design; removing one function from it would be theatre, and the
-- key's handling is governed by the purpose-named authorization decision
-- instead. See the service-role notes in the vault.

comment on function public.touch_account_entitlements_updated_at() is
  'Trigger-only. Maintains account_entitlements.updated_at. Not callable over '
  'the REST API: EXECUTE is revoked from PUBLIC, anon, and authenticated, and '
  'a trigger does not need it.';
