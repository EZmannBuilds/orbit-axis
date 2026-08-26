-- Orbit Axis :: first-party product analytics (Dev Update 6.0).
--
-- WHY THIS EXISTS
--
-- Orbit is about to be shown to people for the first time. Until now it could
-- answer nothing about them: no analytics of any kind existed, hash routes
-- never reach the server, and viewing a screen writes nothing. The four
-- questions worth answering are narrow:
--
--   did social content bring someone to Orbit, did they sign up,
--   did they use it, and did they come back
--
-- WHAT THIS IS NOT
--
-- Not a third-party SDK, not a tracking pixel, not cross-site anything, and not
-- fingerprinting. Two identifiers exist, both first-party random values the
-- browser generates and stores for itself:
--
--   visitor_id  a stable id in localStorage — the only thing that can say
--               "this person came back"
--   session_id  one visit, in sessionStorage
--
-- Neither is derived from device characteristics, neither is shared with anyone,
-- and neither is readable off another site. No IP address is stored: abuse
-- protection hashes the peer address in memory and never writes it, which is a
-- deliberately separate concern from counting visits.
--
-- Events carry a NAME and a TIME. They never carry birth data, chart content,
-- a reading, a card, a question, or anything the reader wrote.

create table if not exists public.analytics_sessions (
  id                uuid primary key,
  visitor_id        uuid not null,
  created_at        timestamptz not null default now(),

  -- Where they arrived and what sent them. Normalised and length-bounded by the
  -- server before it ever gets here: arbitrary query strings are not stored.
  landing_path      text,
  referrer_host     text,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,

  -- The Orbit X content identifier, when the visit came from a campaign link
  -- Orbit itself generated. Lets an exported post be tied to the visits it
  -- produced without any social-platform integration existing.
  campaign_key      text
);

comment on table public.analytics_sessions is
  'One row per visit. First-party only; no IP address, no fingerprint, no third party.';

-- The event vocabulary is CLOSED, and it is closed here rather than only in the
-- application. The table is insertable by anonymous visitors (that is what
-- makes counting signed-out arrivals possible at all), so the database itself
-- has to be the thing that refuses an invented event name.
create table if not exists public.analytics_events (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null,
  visitor_id   uuid not null,
  -- Set by the server from the verified session when one exists, never from the
  -- request body. Cascades, so a deleted account takes its events with it.
  owner_id     uuid references auth.users(id) on delete cascade,
  name         text not null check (name in (
                 'session_started',
                 'signup_completed',
                 'chart_created',
                 'today_opened',
                 'sky_opened',
                 'atlas_opened',
                 'tarot_opened',
                 'tarot_saved',
                 'compatibility_opened',
                 'returning_session'
               )),
  occurred_at  timestamptz not null default now()
);

comment on table public.analytics_events is
  'A closed vocabulary of product events. Name and time only — never content.';

create index if not exists analytics_sessions_created_idx on public.analytics_sessions (created_at desc);
create index if not exists analytics_sessions_visitor_idx on public.analytics_sessions (visitor_id, created_at desc);
create index if not exists analytics_sessions_campaign_idx on public.analytics_sessions (utm_source, created_at desc);
create index if not exists analytics_events_occurred_idx on public.analytics_events (occurred_at desc);
create index if not exists analytics_events_name_idx on public.analytics_events (name, occurred_at desc);
create index if not exists analytics_events_session_idx on public.analytics_events (session_id);
create index if not exists analytics_events_owner_idx on public.analytics_events (owner_id, occurred_at desc)
  where owner_id is not null;

alter table public.analytics_sessions enable row level security;
alter table public.analytics_events enable row level security;

-- ── Policies ────────────────────────────────────────────────────────────────
--
-- INSERT is open to anonymous callers on purpose: a visitor who has not signed
-- up is exactly the person these tables exist to count, and they hold no
-- session token. The honest cost is that the public anon key can be used to
-- insert junk rows directly, inflating counts. That is bounded by design rather
-- than prevented: the name column is constrained above, no free text is stored,
-- and the application's own endpoint is rate limited. Nothing here can leak,
-- because nothing here holds anything private.
--
-- SELECT is admin-only, through the same allowlist the Orbit X desk uses.
-- There is deliberately no UPDATE and no DELETE policy: these tables are
-- append-only, like sync_events and llm_runs. Account deletion still removes a
-- person's events, because a foreign-key cascade is a referential action and
-- does not consult policies.

create policy analytics_sessions_insert_any on public.analytics_sessions
  for insert to anon, authenticated
  with check (true);

create policy analytics_events_insert_any on public.analytics_events
  for insert to anon, authenticated
  with check (true);

create policy analytics_sessions_select_admin on public.analytics_sessions
  for select to authenticated
  using (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())));

create policy analytics_events_select_admin on public.analytics_events
  for select to authenticated
  using (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())));

grant insert on public.analytics_sessions to anon, authenticated;
grant insert on public.analytics_events to anon, authenticated;
grant select on public.analytics_sessions to authenticated;
grant select on public.analytics_events to authenticated;

-- ── Account totals ──────────────────────────────────────────────────────────
--
-- Signups and active accounts are facts about auth.users and profiles, and
-- neither is readable by an ordinary caller — profiles is owner-scoped by RLS
-- and auth.users is not exposed at all. So the counts come from a function that
-- can see them, and it returns COUNTS ONLY: no ids, no emails, no rows.
--
-- security definer, with the lesson from 20260817120000 applied directly:
-- EXECUTE is revoked from public and anon so it cannot become a public RPC, the
-- search_path is pinned, and it refuses anyone who is not on the admin
-- allowlist even if they somehow reach it.
create or replace function public.orbit_beta_account_totals()
returns json
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  result json;
begin
  if not exists (select 1 from public.orbit_x_admins a where a.owner_id = auth.uid()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select json_build_object(
    'users_total',        (select count(*) from auth.users),
    'users_confirmed',    (select count(*) from auth.users where email_confirmed_at is not null),
    'signups_7d',         (select count(*) from auth.users where created_at >= now() - interval '7 days'),
    'signups_30d',        (select count(*) from auth.users where created_at >= now() - interval '30 days'),
    'active_7d',          (select count(*) from auth.users where last_sign_in_at >= now() - interval '7 days'),
    'active_30d',         (select count(*) from auth.users where last_sign_in_at >= now() - interval '30 days'),
    'returning_accounts', (select count(*) from auth.users where last_sign_in_at > created_at + interval '1 day'),
    'charts_total',       (select count(*) from public.birth_profiles)
  ) into result;

  return result;
end;
$$;

revoke execute on function public.orbit_beta_account_totals() from public;
revoke execute on function public.orbit_beta_account_totals() from anon;
grant execute on function public.orbit_beta_account_totals() to authenticated;

-- ── Post-deletion verification ──────────────────────────────────────────────
--
-- analytics_events carries owner_id and cascades with the account, so it joins
-- USER_OWNED_TABLES in lib/account/deletion.js. Account deletion verifies its
-- own cascade by counting rows that still carry the deleted id, and service_role
-- bypasses row-level security but NOT table-level grants — without this, a
-- verified table answers 42501, findSurvivingRows() reports `unknown`, and a
-- completely successful deletion is reported as DELETION_INCOMPLETE.
--
-- SELECT only: the verification counts with HEAD and never reads contents.
--
-- analytics_sessions is deliberately absent. It has no owner_id and belongs to
-- no account: a visit is recorded before anyone signs up, and most visits never
-- become an account at all.
grant select on public.analytics_events to service_role;

-- MANUAL REVOCATION
--
-- revoke select on public.analytics_events from service_role;
