# Orbit X — Collective Readings + Template Lab (Dev Update 5.2)

An AI-assisted editorial system built on deterministic Orbit calculations.
It turns verified astronomical events into faceless, brand-voiced social
content, with a human approving every word before anything leaves the desk.

## Dev Update 5.2: Today, This Week, This Month

Orbit X now treats `daily`, `weekly`, and `monthly` as first-class collective
reading types. They describe symbolism associated with the sky everyone
shares; they are not natal readings, sign-by-sign horoscopes, predictions, or
claims that every person will experience the same theme.

The editorial hierarchy is deliberately narrative:

```text
intro → second hook → selected movement → synthesis → reflection → evidence
```

Early slides carry theme and orientation. Calculated positions and timing move
to the later Current Sky/evidence register.

### Period contract and editorial timezone

`ORBIT_X_EDITORIAL_TIMEZONE` is the single reading timezone. It defaults to
`America/Chicago` and is validated as an IANA timezone. Browser timezone does
not silently rename a reading period.

- Daily: one local calendar day, local midnight to the next local midnight.
- Weekly: the ISO Monday–Sunday editorial week, exactly seven local dates.
- Monthly: the named local calendar month.

Every reading stores a stable period key plus `period_start_at` and
`period_end_at` in UTC. The end is explicitly exclusive, so daylight-saving
transitions remain accurate without inventing 24-hour local days. Examples:
`daily:2026-08-20`, `weekly:2026-08-17:2026-08-23`, `monthly:2026-08`.

### Reading architecture

- Daily (six): Cover, Today in one sentence, What's moving, The reading,
  Reflection, Sky behind the reading.
- Weekly (eight): Cover, Week in one sentence, Opening tone, Pivot, Landing,
  Weekly reading, Reflection, Key dates/evidence.
- Monthly (up to ten): Cover, Month in one sentence, Opening, First movement,
  Midmonth pivot, Second half, Monthly reading, Reflection, Key dates,
  Current Sky/Orbit close.

Optional event sections remain empty when the deterministic source packet does
not support them. Orbit X never invents a pivot to satisfy a slide outline.
The curation policy filters the existing `upcomingEvents` surface and ranks
supported lunations, Mercury stations, and Sun ingresses, with period-specific
caps. The source packet also carries the engine Current Sky and calculated
Moon state.

### Five visual families

The same structured reading renders through five explicit, versioned portrait
families (`1080×1350`) while square (`1080×1080`) remains compatible:

1. `orbit_instrument/v1` — precise, minimal, 62° observatory geometry.
2. `celestial_editorial/v1` — asymmetrical, typographic, publication-like.
3. `lunar_field/v1` — quiet calculated Moon geometry and restrained depth.
4. `planetary_grid/v1` — modernist modules and late-carousel data registers.
5. `orbit_signal/v1` — bold, high-contrast, social-native hooks.

The founder-selected cadence defaults are now explicit and deterministic:
Daily uses `lunar_field/v1`, Weekly uses `planetary_grid/v1`, and Monthly uses
`orbit_signal/v1`. The special `something_changed` format also uses
`orbit_signal/v1`. A founder can still choose any of the five families for an
individual draft; the family is persisted with that saved artifact.

All families share the authored SVG planet/zodiac library, continuous Moon
renderer, Current Sky strip, brand tokens, and one canonical Orbit Axis mark.
Exports use the mark without the `ORBIT AXIS` wordmark. Orbit Signal replaces
its decorative orb with the actual Sun-season zodiac sign from the verified
sky packet and omits the 62° axis ornament. Logo placement is constrained to
Footer Left, Footer Center, or Upper Corner. Headline alignment, density,
Moon, diagrams, and sky strip are constrained controls—not a freeform vector
editor.

### Template Lab and review artifact

The founder can open a Daily, Weekly, or Monthly reading from the Orbit X
header and compare all five families from the same editor state. Each card
shows the Intro, second hook, reading, and reflection/detail slide, with a
per-draft selection action. Feed-size and simulated-feed views remain
available.

Run `node scripts/orbit-x-template-review.js YYYY-MM-DD` to regenerate
`docs/orbit-x-template-review.html`. The artifact contains all 15
family/period combinations using real Orbit engine facts; manual symbolic
lines are visibly labelled `EDITORIAL DEMO`.

Run `node scripts/build-orbit-zodiac-glyphs.js` to regenerate the twelve
standalone SVGs in `public/brand/zodiac/` and the reference sheet at
`public/brand/orbit-zodiac-glyphs.svg`. The zodiac artwork uses OpenMoji's
official black SVG linework, adapted to remove the emoji square and accept
Orbit's color and sizing. The untouched upstream files and required CC BY-SA
4.0 attribution live in `public/brand/zodiac/openmoji-source/` and
`public/brand/zodiac/ATTRIBUTION.md`.

### Persistence and duplicate protection

Migration `20260820200000_orbit_x_collective_readings.sql` adds reading type,
period boundaries, template family, and template version. Alternate drafts
remain possible, but a partial unique index allows only one approved/exported/
scheduled/published record to own a period. Saved and exported artifacts keep
their selected family/version when future defaults change.

The desk loads Saved work immediately. Each row can be reopened with its
write-once verified event packet, last edited copy, selected family, and
editor notes; Save then updates that row rather than creating a duplicate.

Manual authoring remains the complete path. No AI key is needed to calculate a
period, collect/select facts, render the Moon/glyphs/templates, edit, preview,
save, approve, export, or use history. AI controls are not offered for these
reading formats yet; a future provider may assist with copy without owning any
astronomy.

**What it is not:** an astrology calculation engine · a replacement for Swiss
Ephemeris · an autonomous prediction system · a general-purpose social bot ·
an Instagram integration (V1 has none, deliberately).

## Data flow (V1)

```text
Orbit engine (CurrentSkyContext + upcomingEvents)
→ candidate generation   lib/orbit-x/candidates.js   stable event keys
→ deterministic scoring  lib/orbit-x/scoring.js      0–25, explainable
→ AI explanation         lib/orbit-x/ai.js           facts in, JSON out
→ validation + audit     schemas.js + editorial.js   refuse, don't repair
→ visual renderer        ui.html SVG template        brand tokens, 62° axis
→ human review           approve / reject + reason
→ manual export          deterministic PNG filenames
```

Future (documented, NOT built): `→ review/policy gate → Instagram publisher
(OrbitXPublisher boundary) → analytics`. Export never sets `published_at`.

## The gates

1. **Feature flag** — `ORBIT_X_ENABLED` must be the exact string `"true"`.
   Unset (the default everywhere, including production) means the routes and
   the `/admin/orbit-x` page do not exist. Missing AI configuration breaks
   nothing else: the desk lists and scores without it; only Generate needs it.
2. **Session** — the same `requireAuth` as every owner route.
3. **Admin membership** — a row in `orbit_x_admins`, checked by the server AND
   re-enforced by every RLS policy on `orbit_x_posts`. Non-admins receive 404.

**Seeding the admin (founder, once, Supabase SQL editor):**

```sql
insert into public.orbit_x_admins (owner_id)
values ('<your auth.users id>');
```

Your id is `auth.users.id` for your account (Dashboard → Authentication).
There is deliberately no INSERT policy — nobody can grant themselves entry.

## Manual drafting — AI is optional, and its absence is a state

The desk is whole without a provider. With no `ORBIT_X_AI_API_KEY`, everything
works except Generate/Regenerate, which the UI hides rather than disables into
an apology; the status line says once, neutrally: *manual drafting (no AI
provider configured)*. Missing AI configuration is never an Orbit X error.

**Create Manual Draft** builds a scaffold from the selected verified candidate
and format — no model, no network. Since Dev Update 5.1 the scaffold is
**publishable-or-empty, never a worksheet**: fields derivable from verified
facts arrive as finished sentences (headline patterns like *Full Moon in
Pisces*, a human-dated fact register like *The Moon reaches full illumination
on August 27, in Pisces, directly opposite the Sun in Virgo*), while the
interpretive fields — the symbolic layer, the reflection — arrive **empty**,
with helper text, placeholders, and one-tap suggestions carried in a separate
`suggestions` object the desk renders as UI. Nothing from that guidance can
reach stored copy, an SVG, or an export; the old worksheet phrasing ("write
the symbolic layer here…") is now a **blocking audit tripwire**. Symbolic
suggestions are built from the Symbol Atlas `themes` lists (trusted, reviewed
knowledge — no new astrology database), rotated through the approved
interpretive framings so "astrologers traditionally associate" stops stamping
every post. A manual draft records `generated_copy` as NULL — human authorship
is a stored fact, not a pretence of generation.

An unfinished draft can be saved, previewed, and edited freely, but the
**approval quality gate** (`draftCompleteness`) refuses `status: approved`
while required sections are empty, naming exactly what is missing; the desk
shows *N of M required sections complete* live. The hero slide needs no body
(slide one carries no paragraphs by design) and the CTA is optional — a post
may end on the final idea.

## The visual system (Dev Update 5.1)

Three isomorphic modules run identically in Node tests and the desk browser
(served read-only at `/admin/orbit-x/{celestial,templates,language,formats}.js`):

- **`celestial.js`** — the iconography. All ten bodies and all twelve zodiac
  signs as **authored SVG paths** (never platform-font glyphs), a restrained
  drawn ℞ station mark, event badges, the 62° axis motif, a Sun–Moon
  opposition diagram, and the PLANET → SIGN ingress grammar. The centrepiece
  is `moonDisc()`: a deterministic instrument-style lunar disc that renders
  the **engine's illumination continuously** (terminator as a half-ellipse,
  waxing lights the right limb — northern-hemisphere convention), in hero /
  inline / mini modes all derived from the same state. No illumination fact →
  no moon, never a decorative one. `skyStrip()` lays engine positions out as
  glyph + sign (+degree, +℞); missing bodies render as absence.
- **`templates.js`** — tokens (body copy strengthened to `#aab0c4` for feed
  legibility), two designed aspects (**square 1080×1080** and **portrait
  1080×1350**, each with its own safe zones — never scaled), three designed
  density presets (minimal / standard / data — no sliders), a template
  registry (`lunar_hero`, `planet_shift`, `sky_grid`, `fog_panel`,
  `sky_contrast`, `instrument`) with deterministic per-event recommendations,
  slide **roles** (`hero`, `fact`, `symbolic`, `reflection`, `cta`, `signal`,
  `explain`, `takeaway`, `the_sky`, `your_sky`, `method`) that give each slide
  its own layout under the format's control, and deterministic **text
  fitting**: designed type tiers step down, and copy that still cannot fit
  comes back as a named warning ("Headline exceeds the hero safe area") —
  never silently shrunk. A region may also state the vertical room it has, so
  a body sharing a slide with the positions grid is fitted to the space above
  it rather than drawn through it, and the hero's Moon is sized to the room
  the headline leaves rather than laid out at one radius and drawn at another.
  `BODY_SPECS` holds those tiers and line counts once; `bodyCapacity(role)`
  reports the same geometry as a character budget, which is what the desk and
  the writer brief quote — a per-slot number, not one flat limit per format.
  Dates render for humans (`August 27`, `AUG 27`);
  exact instants stay in the facts panel or appear UTC-labelled.
- **`language.js`** — the editorial voice as data: the approved interpretive
  framing bank (§ rotation, attribution never erased), reflection style
  examples (offered as chips marked *adapt, don't paste* — never auto-filled
  into unrelated events), CTA classes (product + editorial; nothing begs),
  headline patterns, engine-grounded fact sentences honouring "around" for
  approximate sources, and alt text that describes the actual graphic rather
  than invisible symbolism.

Lunation packets now carry `sky_at_event` — the engine re-asked at the event's
exact instant (Moon sign, Sun sign, illumination), which is how "Full Moon in
Pisces" is a calculated fact rather than copywriting. The daily-sky packet
carries its own position table so a saved Sky Grid draft can re-render its
strip from verified facts forever. Approximate events get no instant
enrichment at all.

A post may carry a sanitized `design` object (aspect, template, variant,
density, visual and metadata toggles); unknown keys and values are dropped at
validation. Deterministic advisories (`adviseCopy`) warn — never block — on
headline length, duplicated sentences across slides, repeated framing,
captions that mirror slides verbatim, generic reflections, relative-time
claims ("tonight") whose truth depends on the publication instant, and long
CTAs.

**Editor controls** (constrained, designed — no freeform x/y): aspect,
density, template cards with live thumbnails, variant, celestial toggles
(Moon / sky strip / diagram), metadata toggles (date / time / sign /
illumination / calculated label), add/remove slide within format bounds for
the expandable roles (`explain`, `method` — the Deep Explainer path, up to 8
slides for Without the Fog), full-size / feed-size (375 px) / simulated-feed
previews, and history with first-slide thumbnails. Export produces
`orbit-axis_<date>_<event>_<nn>[_portrait].png` in posting order. On a phone
the desk is single-column with horizontally snapping slide previews; editing,
template/density changes, approval, and export all work at 375 px.

## Environment

| Variable | Meaning |
| --- | --- |
| `ORBIT_X_ENABLED` | `"true"` enables the desk. Anything else = off. |
| `ORBIT_X_AI_PROVIDER` | `anthropic` (the only V1 provider). |
| `ORBIT_X_AI_API_KEY` | Server-only. Never in `public/`, never logged. |
| `ORBIT_X_AI_MODEL` | Defaults to `claude-sonnet-5`. |

## Migration

`supabase/migrations/20260819210000_orbit_x_editorial.sql` — `orbit_x_admins`
and `orbit_x_posts`. **Applied to hosted production 2026-08-19** (Dev Update
5.0 deployment); the founder's account is the only admin row. The desk 404s
until both tables and the flag exist. Verified facts live in
`event_payload`, which the store's column allow-list makes unwritable after
creation — copy changes beside facts, never over them.

## Status lifecycle

`draft → approved → exported`, `draft/approved → rejected → draft`. Reserved
for the future publisher: `scheduled`, `published`, `failed` — nothing in V1
can write them, and the API refuses the transition by name.

## Autonomy risk model (documented so automation cannot erase it)

- **Green** (could one day auto-publish, policy permitting): fact-heavy —
  moon phase occurred, ingress occurred, station occurred, calculation-method
  explainers. Formats: `something_changed`, `calculated_not_invented`.
- **Yellow** (approval always): interpretive — collective themes, nuanced
  education, tarot. Formats: `daily_signal`, `without_the_fog`, `your_sky`.
- **Red** (never autonomous without an explicit future policy): individual
  natal or synastry interpretation, medical/financial/legal territory,
  deterministic prediction, emotionally sensitive personal guidance.

Future metrics may influence format mix, cadence, and length. They must never
override astronomical truth, the safety rules, symbolic-reflection framing,
or product integrity. No self-modifying behaviour exists or is planned here.

## Manual acceptance checklist

1. Ordinary user signs in → `/admin/orbit-x` is 404, `/api/orbit-x/*` is 404.
2. Founder seeds admin row, sets `ORBIT_X_ENABLED=true` + AI key locally.
3. Open `/admin/orbit-x` as admin → desk loads.
4. Select today → real engine candidates appear (sky, lunations, stock).
5. Inspect a score breakdown → reasons are stated.
6. Generate a Something Changed post from a real event.
7. Verify every date/instant in the copy against the VERIFIED FACTS panel.
8. Edit copy → facts panel unchanged (it is read-only by construction).
9. Regenerate with an instruction → facts unchanged.
10. Preview all slides → brand template, readable at phone size.
11. Export slides → `orbit-axis_<date>_<event>_<nn>.png`, correct order.
12. Copy caption; copy alt text.
13. Save draft → approve → reopen from history.
14. Save a second draft of the same event → 409 → deliberate fresh treatment works.
15. Reject a draft with a reason → reason visible in history.
16. Unset the AI key → Generate/Regenerate disappear; Manual draft still
    scaffolds, edits, previews, exports, saves, and approves end to end; the
    status line notes manual mode without an error appearing anywhere.
17. Stop local Supabase → save fails with a clear message, copy not lost.
18. Confirm no secrets in the page source and no natal/account data in packets.
19. `npm run test:local` — the whole suite still passes.

## Known limitations (V1, deliberate)

- No Instagram, no scheduling, no analytics; export is the finish line.
- Candidate range is what `upcomingEvents` computes (sun ingresses, engine
  lunations, tabulated Mercury windows) plus the evergreen stock — planetary
  ingresses beyond the Sun and other stations arrive when the engine exposes
  them (the sidereal/4.4 engine line already extends `nextStations` /
  `nextIngresses`; wiring those in is a follow-up, not a redesign).
- The regex audit is a tripwire for the worst shapes, not a moderator; the
  human approval step is the real gate, by design.
