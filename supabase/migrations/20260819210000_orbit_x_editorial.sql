-- Orbit Axis :: Orbit X editorial desk (Dev Update 5.0).
--
-- ADMIN MEMBERSHIP IS A DATABASE FACT, NOT AN ENVIRONMENT STRING. Two tables:
-- who may edit, and what they edited. Every policy on the content table asks
-- the membership table, so the authorization the server checks and the
-- authorization the database enforces are THE SAME FACT — there is no second
-- list to drift, and a request that somehow bypassed the server's check dies
-- at the row anyway.
--
-- Editorial rows are internal working material for the brand account. They
-- contain NO customer data by design: no natal details, no reading history,
-- no account identifiers beyond the admin's own membership row.

create table if not exists public.orbit_x_admins (
  owner_id   uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.orbit_x_admins enable row level security;

-- A person may see whether THEY are an admin — that is the server's whole
-- membership check — and nothing else. Nobody can grant themselves entry:
-- there is no INSERT policy, so seeding happens in the SQL editor with the
-- service role, deliberately, by the founder. Documented in docs/orbit-x.md.
create policy "orbit_x_admins_select_self" on public.orbit_x_admins
  for select to authenticated using (owner_id = (select auth.uid()));

grant select on public.orbit_x_admins to authenticated;

-- ── The editorial record ────────────────────────────────────────────────────
-- One row per draft/post. The verified engine packet (event_payload) is
-- stored SEPARATELY from generated and edited copy, and the API layer never
-- writes it after creation: facts cannot be edited into fiction.

create table if not exists public.orbit_x_posts (
  id                   uuid primary key default gen_random_uuid(),
  event_key            text not null,
  event_type           text not null,
  event_payload        jsonb not null,            -- verified facts, write-once
  calculation_metadata jsonb,                     -- context_version etc.
  editorial_score      integer,
  score_breakdown      jsonb,
  recommended_format   text,
  selected_format      text not null,
  generated_copy       jsonb,                     -- as the model returned it (validated)
  edited_copy          jsonb,                     -- as the human left it
  template             text,
  status               text not null default 'draft',
  rejection_reason     text,
  editor_notes         text,
  created_by           uuid not null references auth.users (id) on delete cascade,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  approved_at          timestamptz,
  exported_at          timestamptz,
  -- Reserved for the future publisher/analytics; nothing writes these in V1,
  -- and exporting NEVER sets published_at — export is not publication.
  published_at         timestamptz,
  external_media_id    text,
  performance_metrics  jsonb,

  constraint orbit_x_posts_status_valid check (status in
    ('draft', 'approved', 'rejected', 'exported', 'scheduled', 'published', 'failed'))
);

create index if not exists orbit_x_posts_event_key_idx on public.orbit_x_posts (event_key);
create index if not exists orbit_x_posts_status_idx on public.orbit_x_posts (status, created_at desc);

alter table public.orbit_x_posts enable row level security;

-- Admins — and only admins — do everything, and the database itself checks
-- the membership on every operation.
create policy "orbit_x_posts_admin_select" on public.orbit_x_posts
  for select to authenticated
  using (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())));
create policy "orbit_x_posts_admin_insert" on public.orbit_x_posts
  for insert to authenticated
  with check (created_by = (select auth.uid())
    and exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())));
create policy "orbit_x_posts_admin_update" on public.orbit_x_posts
  for update to authenticated
  using (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())));
create policy "orbit_x_posts_admin_delete" on public.orbit_x_posts
  for delete to authenticated
  using (exists (select 1 from public.orbit_x_admins a where a.owner_id = (select auth.uid())));

grant select, insert, update, delete on public.orbit_x_posts to authenticated;

comment on table public.orbit_x_posts is
  'Orbit X editorial records. Verified engine facts live in event_payload and '
  'are write-once; generated and edited copy live beside them, never over '
  'them. Admin-only via orbit_x_admins membership, enforced by every policy.';
