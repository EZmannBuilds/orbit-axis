-- Orbit Axis :: the daily card becomes a DRAW that is remembered.
--
-- WHAT CHANGED AND WHY IT NEEDS A TABLE
--
-- The daily card used to be DERIVED: a hash of the local date, the account,
-- the timezone and the deck version picked a card. That gave stability for
-- free — nothing had to be stored, and every device recomputed the same answer
-- — but the card was decided by arithmetic rather than drawn, and which card
-- you got was a function of who you are and what day it is.
--
-- The product decision is that it should be a real draw: randomised the first
-- time the app is opened on a given day, then the same card for the rest of
-- that day. A genuine draw cannot be recomputed, so it has to be written down.
-- That is the entire reason this table exists.
--
-- ONE ROW PER ACCOUNT PER LOCAL DAY PER DECK.
--
-- `local_date` is the reader's own calendar date, resolved in their timezone by
-- the application — not a server date. The unique constraint is what makes the
-- draw stable under a double-open: two tabs racing on the same morning both
-- try to insert, one wins, and the loser reads the winner's row instead of
-- drawing a second card.
--
-- `deck_version` is in the key because a card drawn from a different deck is a
-- different card. Replacing the deck mid-day gives a fresh draw rather than a
-- row pointing at a card that no longer exists.

create table if not exists public.tarot_daily_draws (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  local_date   date not null,
  deck_version text not null,
  card_slug    text not null,
  orientation  text not null default 'upright',
  created_at   timestamptz not null default now(),

  constraint tarot_daily_draws_orientation_valid
    check (orientation in ('upright', 'reversed')),
  -- The stability guarantee, enforced by the database rather than by whichever
  -- request happened to arrive first.
  constraint tarot_daily_draws_one_per_day
    unique (owner_id, local_date, deck_version)
);

create index if not exists tarot_daily_draws_owner_date_idx
  on public.tarot_daily_draws (owner_id, local_date desc);

alter table public.tarot_daily_draws enable row level security;

-- Owner-scoped, exactly like tarot_readings. A daily draw says what card a
-- named person was shown on a named day, which is theirs and nobody else's.
create policy "tarot_daily_draws_select_own" on public.tarot_daily_draws
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "tarot_daily_draws_insert_own" on public.tarot_daily_draws
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "tarot_daily_draws_delete_own" on public.tarot_daily_draws
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Deliberately NO update policy. A daily draw is a record of what was drawn.
-- Letting it be rewritten would make "the same card all day" a promise the
-- interface keeps rather than one the data does.

grant select, insert, delete on public.tarot_daily_draws to authenticated;

comment on table public.tarot_daily_draws is
  'The card drawn for an account on a given local day. Written once, never '
  'updated: the draw is random, so it cannot be recomputed and must be kept.';
comment on column public.tarot_daily_draws.local_date is
  'The reader''s own calendar date, resolved in their timezone by the app.';
