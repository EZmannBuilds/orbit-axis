-- Orbit Axis :: Orbit X automatic channel (Dev Update 6.1).
--
-- DRAFT. Not applied anywhere. Apply locally with `supabase start` and
-- `npm run supabase:migrate:local`; production is the owner's call, in the owner's own
-- session, after review.
--
-- What this adds, and why each piece is in the database rather than the app:
--
--   orbit_x_posts         channel columns, plus three guards the service role
--                         cannot bypass: facts stay write-once, only a
--                         non-user role may write the publisher's statuses,
--                         and "published" needs a real Instagram media id.
--   orbit_x_post_types    the approve-once registry. A type's spec and its
--                         render fingerprint are immutable after insert, so a
--                         changed design is a new version, never an edit to
--                         an approved one. Status transitions are enforced
--                         here as well as in code.
--   orbit_x_channel_runs  one row per channel slot (one per editorial day).
--                         The UNIQUE slot key is the idempotency guard: a
--                         second cron invocation resumes the same run.
--   orbit_x_channel_events  append-only audit log: what each tick generated,
--                         which checks passed or failed, what was published.
--   orbit_x_channel_control  the instant pause. An environment variable
--                         change on Vercel needs a redeploy; this row does not.
--   storage bucket        orbit-x-media, PUBLIC, because Meta must fetch the
--                         images over plain HTTPS. It holds only finished brand
--                         graphics that are about to be public anyway.
--
-- The existing partial unique index orbit_x_posts_one_live_period_idx is
-- reused unchanged: the channel writes period_key, so a period that already
-- has an approved/exported/scheduled/published post can never get a second.

-- ── orbit_x_posts: channel columns ─────────────────────────────────────────

alter table public.orbit_x_posts
  add column if not exists origin text not null default 'desk',
  add column if not exists autonomy text,
  add column if not exists post_type_id uuid,
  add column if not exists post_type_label text,
  add column if not exists media jsonb,
  add column if not exists publish_container_id text,
  add column if not exists publish_attempts integer not null default 0,
  add column if not exists last_publish_error text,
  add column if not exists scheduled_at timestamptz,
  add column if not exists permalink text;

alter table public.orbit_x_posts drop constraint if exists orbit_x_posts_origin_valid;
alter table public.orbit_x_posts add constraint orbit_x_posts_origin_valid
  check (origin in ('desk', 'channel'));

alter table public.orbit_x_posts drop constraint if exists orbit_x_posts_autonomy_valid;
alter table public.orbit_x_posts add constraint orbit_x_posts_autonomy_valid
  check (autonomy is null or autonomy in ('green', 'yellow'));

-- The channel is not a signed-in person. Desk rows still require an author;
-- only channel rows may have none.
alter table public.orbit_x_posts alter column created_by drop not null;
alter table public.orbit_x_posts drop constraint if exists orbit_x_posts_author_required;
alter table public.orbit_x_posts add constraint orbit_x_posts_author_required
  check (created_by is not null or origin = 'channel');

-- "published" is a claim about the outside world. It needs the media id Meta
-- returned and the instant it happened, or it is not true.
alter table public.orbit_x_posts drop constraint if exists orbit_x_posts_published_is_real;
alter table public.orbit_x_posts add constraint orbit_x_posts_published_is_real
  check (status <> 'published' or (external_media_id is not null and published_at is not null));

create index if not exists orbit_x_posts_channel_idx
  on public.orbit_x_posts (origin, created_at desc) where origin = 'channel';

-- The JWT role of the caller, or '' for a direct database session (the SQL
-- editor, migrations). Read from the request claims PostgREST sets.
create or replace function public.orbit_x_jwt_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
$$;

revoke execute on function public.orbit_x_jwt_role() from public;
grant execute on function public.orbit_x_jwt_role() to authenticated, service_role;

create or replace function public.orbit_x_posts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  caller text := public.orbit_x_jwt_role();
begin
  -- Facts are write-once for EVERY role, including the service role the
  -- channel uses. The API already refuses this; the database now does too.
  if tg_op = 'UPDATE' and new.event_payload is distinct from old.event_payload then
    raise exception 'orbit_x_posts.event_payload is write-once';
  end if;

  -- The publisher's states and fields belong to the channel (service role).
  -- A signed-in account, admin or not, cannot mark anything scheduled,
  -- published, or failed, and cannot write an Instagram media id.
  if caller in ('authenticated', 'anon') then
    if new.status in ('scheduled', 'published', 'failed')
       and (tg_op = 'INSERT' or new.status is distinct from old.status) then
      raise exception 'only the Orbit X channel may set status %', new.status;
    end if;
    if (tg_op = 'INSERT' and (new.external_media_id is not null or new.published_at is not null))
       or (tg_op = 'UPDATE' and (new.external_media_id is distinct from old.external_media_id
                                 or new.published_at is distinct from old.published_at)) then
      raise exception 'only the Orbit X channel may record publication';
    end if;
    if tg_op = 'INSERT' and new.origin = 'channel' then
      raise exception 'channel rows are written by the channel';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orbit_x_posts_guard on public.orbit_x_posts;
create trigger orbit_x_posts_guard
  before insert or update on public.orbit_x_posts
  for each row execute function public.orbit_x_posts_guard();

-- ── The post-type registry ─────────────────────────────────────────────────

create table if not exists public.orbit_x_post_types (
  id                 uuid primary key default gen_random_uuid(),
  type_key           text not null,
  version            integer not null check (version > 0),
  name               text not null,
  description        text not null,
  spec               jsonb not null,
  spec_hash          text not null,
  render_fingerprint text not null,
  status             text not null default 'proposed',
  source             text not null,
  proposal_notes     text,
  proposed_at        timestamptz not null default now(),
  decided_by         uuid references auth.users (id) on delete set null,
  decided_at         timestamptz,
  decision_reason    text,
  approved_by        uuid references auth.users (id) on delete set null,
  approved_at        timestamptz,
  updated_at         timestamptz not null default now(),

  constraint orbit_x_post_types_status_valid check (status in
    ('proposed', 'approved', 'rejected', 'superseded', 'retired')),
  constraint orbit_x_post_types_source_valid check (source in ('builtin', 'ai', 'founder')),
  constraint orbit_x_post_types_key_version unique (type_key, version),
  constraint orbit_x_post_types_approval_recorded check (status <> 'approved' or approved_at is not null)
);

-- One live row per exact design: the same spec drawn the same way is never
-- proposed twice while an earlier copy is still in play.
create unique index if not exists orbit_x_post_types_one_live_design_idx
  on public.orbit_x_post_types (spec_hash, render_fingerprint)
  where status <> 'superseded';

create index if not exists orbit_x_post_types_status_idx
  on public.orbit_x_post_types (status, type_key, version desc);

create or replace function public.orbit_x_post_types_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  caller text := public.orbit_x_jwt_role();
begin
  if tg_op = 'INSERT' then
    -- Everything enters as a proposal. Nothing is born approved.
    if new.status <> 'proposed' then
      raise exception 'post types are inserted as proposed';
    end if;
    new.approved_by := null; new.approved_at := null;
    new.decided_by := null; new.decided_at := null;
    return new;
  end if;

  -- Immutable identity: a changed design is a new version, never an edit.
  if new.spec is distinct from old.spec or new.spec_hash is distinct from old.spec_hash
     or new.render_fingerprint is distinct from old.render_fingerprint
     or new.type_key is distinct from old.type_key or new.version is distinct from old.version
     or new.source is distinct from old.source then
    raise exception 'a post type''s spec is immutable; propose a new version instead';
  end if;

  if new.status is distinct from old.status then
    if not (
         (old.status = 'proposed' and new.status in ('approved', 'rejected', 'superseded'))
      or (old.status = 'approved' and new.status in ('retired', 'rejected', 'superseded'))
      or (old.status = 'retired'  and new.status in ('approved', 'superseded'))
    ) then
      raise exception 'post type cannot move from % to %', old.status, new.status;
    end if;
    -- Who decided is taken from the session, never from the request body.
    if caller = 'authenticated' then
      new.decided_by := (select auth.uid());
    end if;
    new.decided_at := now();
    if new.status = 'approved' then
      new.approved_by := case when caller = 'authenticated' then (select auth.uid()) else new.approved_by end;
      new.approved_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists orbit_x_post_types_guard on public.orbit_x_post_types;
create trigger orbit_x_post_types_guard
  before insert or update on public.orbit_x_post_types
  for each row execute function public.orbit_x_post_types_guard();

alter table public.orbit_x_post_types enable row level security;

drop policy if exists "orbit_x_post_types_admin_select" on public.orbit_x_post_types;
create policy "orbit_x_post_types_admin_select" on public.orbit_x_post_types
  for select to authenticated
  using (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())));
-- Admins may sync built-ins and record proposals from the desk; the trigger
-- forces every insert to status 'proposed'.
drop policy if exists "orbit_x_post_types_admin_insert" on public.orbit_x_post_types;
create policy "orbit_x_post_types_admin_insert" on public.orbit_x_post_types
  for insert to authenticated
  with check (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())));
drop policy if exists "orbit_x_post_types_admin_update" on public.orbit_x_post_types;
create policy "orbit_x_post_types_admin_update" on public.orbit_x_post_types
  for update to authenticated
  using (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())));
-- No delete policy: the registry is a history of decisions.

grant select, insert, update on public.orbit_x_post_types to authenticated;

alter table public.orbit_x_posts drop constraint if exists orbit_x_posts_post_type_fk;
alter table public.orbit_x_posts add constraint orbit_x_posts_post_type_fk
  foreign key (post_type_id) references public.orbit_x_post_types (id) on delete set null;

-- ── Channel runs and the audit log ─────────────────────────────────────────

create table if not exists public.orbit_x_channel_runs (
  id              uuid primary key default gen_random_uuid(),
  slot_key        text not null unique,
  slot_date       date not null,
  mode            text not null,
  state           text not null default 'claimed',
  post_id         uuid references public.orbit_x_posts (id) on delete set null,
  post_type_id    uuid references public.orbit_x_post_types (id) on delete set null,
  post_type_label text,
  format          text,
  family          text,
  autonomy        text,
  plan            jsonb,
  checks          jsonb,
  generated       jsonb,
  media           jsonb,
  graph           jsonb,
  error           text,
  attempts        integer not null default 0,
  lease_until     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finished_at     timestamptz,

  constraint orbit_x_channel_runs_mode_valid check (mode in ('dry_run', 'live')),
  constraint orbit_x_channel_runs_state_valid check (state in (
    'claimed', 'generated', 'rendered', 'uploaded', 'containers', 'publishing',
    'published', 'dry_run_complete', 'skipped', 'failed', 'expired', 'killed'))
);

create index if not exists orbit_x_channel_runs_recent_idx
  on public.orbit_x_channel_runs (slot_date desc);

create table if not exists public.orbit_x_channel_events (
  id      bigint generated always as identity primary key,
  run_id  uuid references public.orbit_x_channel_runs (id) on delete cascade,
  at      timestamptz not null default now(),
  step    text not null,
  outcome text not null,
  detail  jsonb,
  constraint orbit_x_channel_events_outcome_valid check (outcome in ('ok', 'warn', 'fail', 'skip', 'info'))
);

create index if not exists orbit_x_channel_events_run_idx
  on public.orbit_x_channel_events (run_id, at);

-- Append-only: an audit log that can be edited is a story, not a log.
create or replace function public.orbit_x_channel_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'orbit_x_channel_events is append-only';
end;
$$;

drop trigger if exists orbit_x_channel_events_append_only on public.orbit_x_channel_events;
create trigger orbit_x_channel_events_append_only
  before update or delete on public.orbit_x_channel_events
  for each row execute function public.orbit_x_channel_events_append_only();

create table if not exists public.orbit_x_channel_control (
  id         smallint primary key default 1,
  paused     boolean not null default false,
  reason     text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint orbit_x_channel_control_singleton check (id = 1)
);

insert into public.orbit_x_channel_control (id, paused) values (1, false)
on conflict (id) do nothing;

alter table public.orbit_x_channel_runs enable row level security;
alter table public.orbit_x_channel_events enable row level security;
alter table public.orbit_x_channel_control enable row level security;

-- Admins read everything; only the channel (service role) writes runs and
-- events. Admins may flip the pause.
drop policy if exists "orbit_x_channel_runs_admin_select" on public.orbit_x_channel_runs;
create policy "orbit_x_channel_runs_admin_select" on public.orbit_x_channel_runs
  for select to authenticated
  using (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())));
drop policy if exists "orbit_x_channel_events_admin_select" on public.orbit_x_channel_events;
create policy "orbit_x_channel_events_admin_select" on public.orbit_x_channel_events
  for select to authenticated
  using (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())));
drop policy if exists "orbit_x_channel_control_admin_select" on public.orbit_x_channel_control;
create policy "orbit_x_channel_control_admin_select" on public.orbit_x_channel_control
  for select to authenticated
  using (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())));
drop policy if exists "orbit_x_channel_control_admin_update" on public.orbit_x_channel_control;
create policy "orbit_x_channel_control_admin_update" on public.orbit_x_channel_control
  for update to authenticated
  using (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())));

grant select on public.orbit_x_channel_runs, public.orbit_x_channel_events to authenticated;
grant select, update on public.orbit_x_channel_control to authenticated;

-- service_role bypasses RLS but NOT table grants (see the analytics migration
-- for the 42501 that taught this). The channel needs exactly these.
grant select, insert, update on public.orbit_x_posts to service_role;
grant select, insert, update on public.orbit_x_post_types to service_role;
grant select, insert, update on public.orbit_x_channel_runs to service_role;
grant select, insert on public.orbit_x_channel_events to service_role;
grant select, update on public.orbit_x_channel_control to service_role;

-- ── Public media bucket ────────────────────────────────────────────────────
--
-- PUBLIC on purpose: Meta's servers fetch image_url with a plain GET and no
-- credentials. Only finished slides go here, at unguessable paths under
-- channel/<date>/<post-id>/, and only in live mode (or a dry run that asked to
-- exercise storage). No customer data, ever. Writes are service-role only:
-- there is no insert policy for any client role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'orbit-x-media',
  'orbit-x-media',
  true,
  8388608,                                    -- 8 MB, Meta's JPEG ceiling
  array['image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

comment on table public.orbit_x_post_types is
  'Orbit X approve-once registry. Spec and render fingerprint are immutable; a '
  'changed design is a new version that starts as proposed.';
comment on table public.orbit_x_channel_runs is
  'One row per Orbit X channel slot. slot_key is the idempotency guard.';
comment on table public.orbit_x_channel_events is
  'Append-only audit log of every Orbit X channel tick.';

-- ── MANUAL ROLLBACK (whole migration) ──────────────────────────────────────
--
-- drop table if exists public.orbit_x_channel_events;
-- drop table if exists public.orbit_x_channel_runs;
-- drop table if exists public.orbit_x_channel_control;
-- alter table public.orbit_x_posts drop constraint if exists orbit_x_posts_post_type_fk;
-- drop table if exists public.orbit_x_post_types;
-- drop trigger if exists orbit_x_posts_guard on public.orbit_x_posts;
-- drop function if exists public.orbit_x_posts_guard();
-- drop function if exists public.orbit_x_post_types_guard();
-- drop function if exists public.orbit_x_channel_events_append_only();
-- drop function if exists public.orbit_x_jwt_role();
-- (then restore created_by NOT NULL only after removing channel rows)
