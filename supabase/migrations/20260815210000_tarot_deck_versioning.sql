-- Orbit Axis :: Tarot deck versioning and stable card identity.
--
-- The original tarot_cards table identifies a card by uuid primary key and a
-- unique name. Neither is usable as the stable identity a reading needs.
--
-- A uuid is regenerated whenever the reference deck is re-seeded, so a saved
-- reading pointing at one would break the first time the deck was reloaded —
-- and it would leak a database row identifier into the account export, which
-- that export's own privacy audit correctly forbids.
--
-- A name is human text. "The Hanged One" is one edit away from "The Hanged
-- Man", and that edit would silently orphan every reading that referenced it.
--
-- So: an explicit `slug` is the identity a reading stores, `deck_version`
-- records which authored deck a row belongs to, and `sort_order` gives the
-- deck a deterministic order that does not depend on how PostgREST feels about
-- returning rows. All three are what the draw contract in lib/tarot/draw.js
-- already assumes.
--
-- Nothing is backfilled because the table is empty — [[Tarot Data Model]]
-- records that the deck is unauthored, and this migration deliberately does
-- not invent content to fill it.

alter table public.tarot_cards
  add column if not exists slug         text,
  add column if not exists deck_version text,
  add column if not exists sort_order   integer,
  add column if not exists reflection_prompt text,
  add column if not exists provenance   jsonb not null default '{}'::jsonb;

-- A slug is unique WITHIN a deck version, not globally: two authored versions
-- of the deck both contain "the-tower", and they are different rows with
-- different meanings. A reading records both, which is what lets an old
-- reading keep showing the text it was actually drawn with.
create unique index if not exists tarot_cards_deck_slug_idx
  on public.tarot_cards (deck_version, slug);

create index if not exists tarot_cards_deck_sort_idx
  on public.tarot_cards (deck_version, sort_order);

-- The shape a slug must take, enforced where it cannot be argued with. This
-- mirrors validateCard() in lib/tarot/deck.js; the application check gives a
-- readable error, this one makes the bad value impossible.
alter table public.tarot_cards
  drop constraint if exists tarot_cards_slug_format;
alter table public.tarot_cards
  add constraint tarot_cards_slug_format
  check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

alter table public.tarot_cards
  drop constraint if exists tarot_cards_arcana_valid;
alter table public.tarot_cards
  add constraint tarot_cards_arcana_valid
  check (arcana in ('major', 'minor'));

-- A major arcana card has no suit; a minor one must have a recognised suit.
-- Stated here because a stray suit on a major card would sort it into the
-- wrong place in the deck and change every draw after it.
alter table public.tarot_cards
  drop constraint if exists tarot_cards_suit_matches_arcana;
alter table public.tarot_cards
  add constraint tarot_cards_suit_matches_arcana
  check (
    (arcana = 'major' and suit is null)
    or (arcana = 'minor' and suit in ('wands', 'cups', 'swords', 'pentacles'))
  );

comment on column public.tarot_cards.slug is
  'Stable per-deck identity. Readings store this, never the row uuid.';
comment on column public.tarot_cards.deck_version is
  'Which authored deck this row belongs to. Part of the daily-draw seed.';
comment on column public.tarot_cards.provenance is
  'Author, licence, and review state. A meaning with no provenance does not ship.';

-- tarot_readings gains nothing structurally: reading_data is already jsonb and
-- now carries card slugs plus the draw contract that produced them. Recorded
-- here so the shape is documented in the schema rather than only in code.
comment on column public.tarot_readings.reading_data is
  'Cards (by slug, with the authored text as drawn), positions, and the draw '
  'contract: version, deck version, local date, timezone, seed.';
