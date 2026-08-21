-- Orbit Axis :: Orbit X collective readings + versioned visual families
-- (Dev Update 5.2).

alter table public.orbit_x_posts
  add column if not exists reading_type text,
  add column if not exists period_key text,
  add column if not exists period_start_at timestamptz,
  add column if not exists period_end_at timestamptz,
  add column if not exists template_family text,
  add column if not exists template_version text;

alter table public.orbit_x_posts
  drop constraint if exists orbit_x_posts_reading_type_valid;
alter table public.orbit_x_posts
  add constraint orbit_x_posts_reading_type_valid
  check (reading_type is null or reading_type in ('daily', 'weekly', 'monthly'));

create index if not exists orbit_x_posts_reading_library_idx
  on public.orbit_x_posts (reading_type, period_start_at desc)
  where reading_type is not null;

-- Alternate drafts are allowed. At most one approved/exported record may own
-- a reading period, which prevents accidental duplicate publication while
-- preserving deliberate editorial exploration in draft/rejected states.
create unique index if not exists orbit_x_posts_one_live_period_idx
  on public.orbit_x_posts (period_key)
  where period_key is not null and status in ('approved', 'exported', 'scheduled', 'published');

comment on column public.orbit_x_posts.period_end_at is
  'Exclusive UTC end instant for a Daily, Weekly, or Monthly editorial period.';
comment on column public.orbit_x_posts.template_version is
  'Immutable visual-family renderer version selected for the saved artifact.';
