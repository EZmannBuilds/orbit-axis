# Orbit X — Solo Publishing Workspace (Dev Update 5.6)

An AI-assisted editorial system built on deterministic Orbit calculations.
It turns verified astronomical events into faceless, brand-voiced social
content, with a human approving every word before anything leaves the desk.

## Dev Update 5.6: the publishing workspace

Orbit X was one very long engineering-oriented page: candidates, the whole
editor, five full template previews, every slide preview, and a saved-work
table, all stacked in one scroll. It is now a **three-stage solo publishing
workspace** — *Choose → Write → Preview* — with a **Library** as its own
top-level view.

- **Choose** is five actions (Daily, Weekly, Monthly, Special, Interactive)
  over one date control, plus recommendation cards that show a human title, a
  timing, the recommended template, and **one** short reason. Event keys, ISO
  instants, numeric scores and the full scoring explanation live under
  *Details*. An event that already has a draft is a neutral **Draft exists**
  state with an **Open draft** action — never a red error.
- **Write** puts the editor and a live preview side by side above 1000px and
  collapses to the editor alone below it; the field you are editing outlines
  the slide it draws. Fields are grouped (Hook · Interactive question ·
  Reading · Caption & CTA · Accessibility · Notes) and each group collapses.
  One cadence-default template is shown with a **Change template** control.
- **Preview** carries one labelled **Preview mode** selector (Full size ·
  Feed width · Simulated feed post) in place of three unlabelled buttons, and
  the finish actions.
- A **sticky action bar** holds Save draft, Preview, and Export with a live
  **Unsaved changes / Saving… / Saved at HH:MM** state. Saving stays
  **explicit** — the input handler marks the draft dirty and writes nothing,
  so no keystroke can overwrite stored work. Copy caption, copy alt text and
  Template Lab live under *More*.
- **Template Lab** is a native `<dialog>` opened with `showModal()`: focus
  moves into it, Escape closes it, focus returns to whatever opened it, and
  choosing *Use for this draft* returns to the editor and says what changed.
  The five-family comparison is unchanged.
- The **verified facts panel** is now readable UI — period, timezone, moon
  phase, sign, illumination, a planet register, and selected movements as
  labelled groups and chips. The packet is unchanged and still read-only; the
  raw object sits behind a *View raw engine data* disclosure. A fact the
  engine did not supply is absent, never defaulted.
- The **Library** replaces the saved-work table: cards with a first-slide
  thumbnail, a human title, the reading/post type, the period, a status pill,
  the template, and **Open draft**. `full_moon:2026-08-27` reads as *Full Moon
  · August 27, 2026*; the key stays visible as detail. Reopening and
  update-in-place are unchanged.
- The visible lifecycle is **Draft → Ready to Post → Exported**. Nothing in
  the database changed: *Mark ready to post* still writes `approved`, and
  `rejected` is now *Needs changes*, moved into an optional
  *Review & set aside* disclosure instead of the primary action row.
- Missing AI configuration is a calm **Manual mode** chip. The provider detail
  moved to a *Diagnostics* disclosure.

### Interactive posts (first class)

An interactive post is its own format (`interactive_post`), not a question
buried in a reflection slide. `lib/orbit-x/interactive.js` owns eight
interaction formats — open question, two-choice poll, this or that, finish the
sentence, emoji response, save and return, story question, carousel reflection
— each declaring whether answer choices are `required`, `optional` or `none`
and how many are valid.

Structured fields: interaction format, main question, optional context/setup,
two to four answer choices where applicable, engagement prompt, caption, CTA,
alt text, and placement. **The interaction is the source of truth**: the
slides are recomputed from it at validation, so a stored poll can never
disagree with the slide that draws it — the same principle as facts never
coming from the browser, applied to the question.

Validation: polls and *this or that* require valid, distinct choices before a
post can be finished (a count still being typed is a draft, not an error);
open questions require none. Questions are audited deterministically for
**predictive** and **diagnostic** shapes and for engagement bait, beside the
existing editorial audit — a question may notice, it may never predict an
outcome or ask anyone to self-assess. Calculated facts stay separate from
editorial symbolism, and every existing format and stored draft remains valid.

Interactive posts render through the existing SVG/template system (new
`question`, `choices` and `engagement` slide roles) and open on the founder
default `orbit_signal/v1`, changeable per draft like any other.

**No migration.** An interactive post is anchored to a real calculated day but
is not that day's reading: it writes `reading_type`, `period_key`,
`period_start_at` and `period_end_at` as NULL, so it satisfies the
`reading_type` CHECK constraint and can never take the Daily Reading's slot in
the one-live-period partial unique index. `event_type` has no constraint, and
the structured `interaction` object lives inside the existing `edited_copy`
JSONB.

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
an apology; a single calm **Manual mode** chip states the absence, and the
provider detail lives under Diagnostics. Missing AI configuration is never an
Orbit X error.

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

Isomorphic modules run identically in Node tests and the desk browser (served
read-only at
`/admin/orbit-x/{celestial,templates,language,formats,schemas,editorial,interactive,desk}.js`).
`interactive.js` owns the interaction contract and `desk.js` owns the
workspace's presentation logic — stage order, library titles, the solo status
vocabulary, the readable fact summary — so the suite executes what the desk
runs instead of grepping the page for strings. The three visual modules:

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
density, the cadence-default template with a Change template control into the
Template Lab dialog, variant, celestial toggles
(Moon / sky strip / diagram), metadata toggles (date / time / sign /
illumination / calculated label), add/remove slide within format bounds for
the expandable roles (`explain`, `method` — the Deep Explainer path, up to 8
slides for Without the Fog), one Preview mode selector, and the Library's
first-slide thumbnails. Export produces
`orbit-axis_<date>_<event>_<nn>[_portrait].png` in posting order. On a phone
the workspace is stage-tabbed and single-column with horizontally snapping
slide previews; editing, template changes, marking ready, and export all work
at 390×844 with no horizontal overflow.

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
  education, tarot. Formats: `daily_signal`, `without_the_fog`, `your_sky`,
  and `interactive_post`, which is yellow permanently: a post that solicits an
  answer from real people is not something a future automation may publish
  unattended.
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
13. Save draft → Mark ready to post → reopen from the Library.
14. Save a second draft of the same event → 409 → deliberate fresh treatment works.
15. Reject a draft with a reason → reason visible in history.
16. Unset the AI key → Generate/Regenerate disappear; Manual draft still
    scaffolds, edits, previews, exports, saves, and approves end to end; the
    status line notes manual mode without an error appearing anywhere.
17. Stop local Supabase → save fails with a clear message, copy not lost.
18. Confirm no secrets in the page source and no natal/account data in packets.
19. Start an Interactive post → pick "This or that" → two answers → save,
    reopen from the Library, and confirm it updates in place.
20. Check the workspace at wide desktop, ~1024 px, and 390×844: no horizontal
    overflow, stage tabs reachable, saved items render as cards.
21. `npm run test:local` — the whole suite still passes.

## Known limitations (V1, deliberate)

- No Instagram, no scheduling, no analytics; export is the finish line.
- Candidate range is what `upcomingEvents` computes (sun ingresses, engine
  lunations, tabulated Mercury windows) plus the evergreen stock — planetary
  ingresses beyond the Sun and other stations arrive when the engine exposes
  them (the sidereal/4.4 engine line already extends `nextStations` /
  `nextIngresses`; wiring those in is a follow-up, not a redesign).
- The regex audit is a tripwire for the worst shapes, not a moderator; the
  human approval step is the real gate, by design.
