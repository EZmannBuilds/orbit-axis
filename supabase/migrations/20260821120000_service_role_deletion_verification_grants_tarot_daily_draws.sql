-- Orbit Axis :: service-role read grant for post-deletion verification of
-- tarot_daily_draws.
--
-- 20260815230000_tarot_daily_draws.sql created an owner-scoped table (owner_id
-- references auth.users and cascades with the account) after
-- 20260728120000_service_role_deletion_verification_grants.sql had granted the
-- verification reads, so the new table was never granted to service_role.
--
-- Account deletion verifies its own cascade by counting rows that still carry
-- the deleted user's id. service_role bypasses row-level security but NOT
-- table-level GRANTs, so a verified table without this grant answers 42501 and
-- findSurvivingRows() reports it as `unknown` — which makes a fully successful
-- deletion report DELETION_INCOMPLETE. This migration pairs with the addition
-- of tarot_daily_draws to USER_OWNED_TABLES in lib/account/deletion.js.
--
-- SELECT only, for the same reason as the original grant: the verification
-- counts with HEAD and never reads contents or writes anything.

grant select on
  public.tarot_daily_draws
to service_role;

-- MANUAL REVOCATION
--
-- revoke select on public.tarot_daily_draws from service_role;
