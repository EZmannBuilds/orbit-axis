# Orbit X — Internal Content Desk (Dev Update 5.0)

An AI-assisted editorial system built on deterministic Orbit calculations.
It turns verified astronomical events into faceless, brand-voiced social
content, with a human approving every word before anything leaves the desk.

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
  never silently shrunk. Dates render for humans (`August 27`, `AUG 27`);
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
