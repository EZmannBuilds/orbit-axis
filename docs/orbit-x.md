# Orbit X — Collective Readings + Template Lab (Dev Update 5.2)

An AI-assisted editorial system built on deterministic Orbit calculations.
It turns verified astronomical events into faceless, brand-voiced social
content, with a human approving every word before anything leaves the desk.
Since Dev Update 6.1 an optional automatic channel can also publish to
Instagram on its own, but only with designs a human approved once, only after
automated checks on every post, and only behind flags that default off.

## Dev Update 6.1: the automatic Instagram channel

Status on 2026-11-09: built, tested, and **off**. Nothing here has run against
production, and nothing has been posted. This section is the setup and
operating guide.

### What it does

A cloud cron calls one protected route a few times each morning. Each call
advances the day's run as far as the function's time allows, then the next
call resumes it:

```text
engine facts (engine-facts.js, the desk's own code path)
-> the day's options: Daily/Weekly/Monthly readings, today's Full or New Moon,
   the evergreen methodology stock                 channel-candidates.js
-> policy: Green always; Yellow only with its flag; Red never   policy.js
-> rotation: one option, one approved post type, one hook style,
   one caption structure                           rotation.js
-> copy: Claude writes from the verified packet plus a channel brief
-> every per-post check (below); a failure retries once, then the next tick
   tries the next-best option
-> SVG (templates.js) -> PNG at the desk's size and filename, plus a JPEG of
   the same pixels for Meta                         raster.js
-> upload to the public Supabase Storage bucket orbit-x-media   media.js
-> Instagram Graph API: one container per slide, a carousel container,
   poll until FINISHED, media_publish               publisher.js
-> the post row records "scheduled" after Meta returns a carousel id and
   "published" only with Meta's media id
```

Every step, pass or fail, is written to an append-only log
(`orbit_x_channel_events`) that the desk shows under **Automatic channel**.

### The switches, and the order to turn them on

Every flag counts only the exact string `true`. The kill switch is the one
deliberate exception: any non-empty value stops publishing.

| Variable | Effect |
| --- | --- |
| `ORBIT_X_ENABLED=true` | Orbit X exists (unchanged). |
| `ORBIT_X_AUTOPUBLISH=true` | The channel runs, in **dry run**: plans, writes, checks, renders, logs, and saves the result as a desk draft. Never calls Meta. |
| `ORBIT_X_AUTOPUBLISH_LIVE=true` | The channel publishes **Green** posts. |
| `ORBIT_X_AUTOPUBLISH_YELLOW=true` | The channel may also publish **Yellow** posts, after the stricter Yellow checks. Works in dry run too, to preview what Yellow would do. |
| `ORBIT_X_KILL_SWITCH=<anything>` | Stops all publishing and ends any in-flight run for good. On Vercel an environment change reaches the deployment only after a redeploy, so for an immediate stop use **Pause channel** in the desk, which the channel reads before every call to Meta. |

Other variables: `CRON_SECRET` (required; see setup), `ORBIT_X_IG_API`,
`ORBIT_X_IG_USER_ID`, `ORBIT_X_IG_ACCESS_TOKEN`, `ORBIT_X_GRAPH_API_VERSION`
(default `v25.0`), `ORBIT_X_IG_TOKEN_EXPIRES_AT` (optional; the log warns 10
days before), `ORBIT_X_CHANNEL_ROTATION` (optional JSON), `ORBIT_X_DRY_RUN_UPLOAD`
(optional), `ORBIT_X_DESIGN_PROPOSALS` (optional). All are listed in
`docs/deployment/environment-variables.md` and `.env.example` with placeholders.

### Setup, in order (owner)

1. **Review and apply the migration.**
   `supabase/migrations/20261109170000_orbit_x_auto_channel.sql` adds channel
   columns to `orbit_x_posts`, the post-type registry, the run table, the
   append-only event log, the pause row, and the public `orbit-x-media`
   bucket. Apply it locally first (`supabase start`, then
   `npm run supabase:migrate:local`). Production is your call.
2. **Authorize the service role for the channel.** The cron has no signed-in
   user, so it writes with the service-role key under a new purpose,
   `orbit-x-channel` (`lib/env/service-role.js`). In Vercel Production, add it
   to the existing list, for example
   `ORBIT_PRODUCTION_SERVICE_ROLE_PURPOSE=account-deletion,stripe-billing,orbit-x-channel`.
   Without it the cron route answers 503 and writes nothing.
3. **Set `CRON_SECRET`** in Vercel Production to a random value of at least 16
   characters. Vercel sends it as `Authorization: Bearer ...` on every cron
   call; without it the route refuses every request.
4. **Set the AI key** (`ORBIT_X_AI_API_KEY`, already documented below) if it is
   not set. Without it the channel plans and then skips each day with "no copy
   source"; it never posts a scaffold.
5. **Turn on dry run:** `ORBIT_X_ENABLED=true`, `ORBIT_X_AUTOPUBLISH=true`, and
   redeploy. Crons run only on the Production deployment.
6. **Approve post types** in the desk (**Automatic channel**, below the
   reading bar). Fourteen built-ins arrive as `proposed`. Open each one's
   sample (today's calculated facts, placeholder interpretation), then approve
   or reject. Nothing posts, even in dry run, until at least one type is
   approved.
7. **Create the Meta app and token** (one of the two routes below), then set
   `ORBIT_X_IG_API`, `ORBIT_X_IG_USER_ID`, `ORBIT_X_IG_ACCESS_TOKEN`, and
   optionally `ORBIT_X_IG_TOKEN_EXPIRES_AT`.
8. **Watch dry run for a week** (checklist below).
9. **Go live for Green:** `ORBIT_X_AUTOPUBLISH_LIVE=true`, redeploy.
10. **Decide on Yellow** separately: `ORBIT_X_AUTOPUBLISH_YELLOW=true`.

#### Meta: route A, Instagram API with Instagram Login (simplest)

No Facebook Page needed. Host `graph.instagram.com`, so `ORBIT_X_IG_API=instagram`.

1. At developers.facebook.com, create an app (type **Business**) and add the
   **Instagram** product, choosing **API setup with Instagram login**.
2. Give the Business account a role on the app (it is your own account), then
   in the app dashboard generate a token for it with the permissions
   `instagram_business_basic` and `instagram_business_content_publish`.
3. The dashboard shows the account's Instagram user id; that is
   `ORBIT_X_IG_USER_ID`. The generated token is long-lived (about 60 days);
   that is `ORBIT_X_IG_ACCESS_TOKEN`. Record the expiry date in
   `ORBIT_X_IG_TOKEN_EXPIRES_AT`.
4. Refresh before expiry (the token must be at least 24 hours old):
   `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<current token>`.
   Put the new token and its expiry into Vercel and redeploy. The channel
   never stores or rotates the token itself; it reads it from the environment
   only.

#### Meta: route B, Facebook Login with a linked Page

Host `graph.facebook.com`, so `ORBIT_X_IG_API=facebook`. Needs the Instagram
Business account linked to a Facebook Page.

1. Create a Business app, add **Facebook Login for Business** and the
   **Instagram Graph API**.
2. Request `instagram_basic`, `instagram_content_publish`,
   `pages_read_engagement` and `pages_show_list`.
3. Prefer a **system user** token from Meta Business Suite (Business
   Settings, System users) assigned to the Page and the app: it does not
   expire. A long-lived Page token derived from a long-lived user token also
   works.
4. Find the account id with `GET /{page-id}?fields=instagram_business_account`
   and use it as `ORBIT_X_IG_USER_ID`.

On either route, an app in Development mode can normally publish to an
account that holds a role on the app; App Review is for publishing on behalf
of accounts that do not. Confirm this in the app dashboard before going live.

### How to dry-run

**Locally, with no database and no Meta at all:**

```bash
node scripts/orbit-x-channel.js preview --days 14 --yellow --out ./orbit-x-preview
```

This runs the real channel tick against real engine facts for 14 days, with
every built-in type approved in memory only, labelled sample copy (add `--ai`
with `ORBIT_X_AI_API_KEY` set to have Claude write it), and every network call
except the AI provider blocked. It prints the rotation day by day and writes
each slide as the PNG the desk would export and the JPEG Meta would receive.

**Deployed:** with `ORBIT_X_AUTOPUBLISH=true` and LIVE unset, every cron tick
does everything except call Meta. The result lands in the desk's Saved work
as a draft (origin channel), the run and its checks appear under **Automatic
channel**, and the PNG and JPEG hashes are in the run's media record. Set
`ORBIT_X_DRY_RUN_UPLOAD=true` to also exercise the storage upload.

### Dry-run checklist (before LIVE)

1. A week of runs: one per day, the states you expect, no `failed`.
2. The desk drafts read well. Open several in the editor and check every date
   against the VERIFIED FACTS panel.
3. The checks column: note which days were skipped and why. Frequent
   `not_near_duplicate` or `voice_symbolic_not_predictive` failures mean the
   copy brief needs work before it posts unattended.
4. Rotation: no family twice in a row, no format over its weekly cap, hooks
   and caption structures varying.
5. With `ORBIT_X_DRY_RUN_UPLOAD=true` for one day, open a JPEG URL from the
   run's media record in a private browser window. That is what Meta fetches.
6. Pause from the desk, confirm the next tick logs "paused", resume.
7. Set the kill switch, redeploy, confirm the next tick logs "kill switch
   engaged", clear it, redeploy.

### Autonomy: Green, Yellow, Red

| Level | Formats | Channel behaviour |
| --- | --- | --- |
| Green | `something_changed` (engine-exact Full and New Moons on their day), `calculated_not_invented` | Auto-publish when LIVE is on. |
| Yellow | `daily_reading`, `weekly_reading`, `monthly_reading`, `without_the_fog`, `your_sky` | Only with `ORBIT_X_AUTOPUBLISH_YELLOW=true`, and only after the extra Yellow checks. |
| Red | none exist as formats; natal or synastry interpretation, medical, financial or legal territory, deterministic prediction, sensitive personal guidance | Never. Red content is refused in every post by the checks below, whatever its format or approved type. |

Sun ingresses and Mercury stations are not channel events: their dates come
from a season table and an approximate table in `lib/sky.js`, not from the
engine, so they are not facts the channel may publish unattended.

**Every post, every time** (`runPostChecks`, `lib/orbit-x/policy.js`): schema
and completeness; the editorial audit; fact integrity for ISO dates and for
human dates ("November 13" must be a day in the facts); Red territory;
symbolic-never-predictive voice (certainty, prediction, fear and luck framing,
giving the sky intentions, relative time other than "this week" in a weekly
reading or "this month" in a monthly one); alt text present, 40 to 1,000
characters, no hashtags or links; caption within Instagram's 2,200 and the
format's own limit; at most 5 hashtags; 2 to 10 slides; an approved CTA; no
renderer fitting warning; no layout collision; not a near-duplicate of a
recent post. **Yellow adds:** the interpretation must be attributed to
tradition ("astrologers associate", "may symbolize", ...), and no personal
directives ("you should", "your week").

These are deliberately broader than the desk's audit, because no one reads
the post first. They will sometimes refuse copy a person would have passed.
A refused post means a quiet day and a logged reason.

### Approve once: the post-type registry

A post type (`lib/orbit-x/post-types.js`) is a versioned, declarative design:
a template, the formats it carries, the aspect, a constrained design object
(density, variant, alignment, mark position, visual and metadata toggles), at
most one motif from a closed library (`MOTIF_KINDS` in `templates.js`, brand
tokens only), and the hook styles and caption structures its copy may use.

- Every type starts `proposed`, built-ins included. Approving it in the desk
  records who and when. A rejected type is final.
- An approval binds to a **spec hash** and a **render fingerprint** (the SVG
  the renderer draws for a fixed fixture in every format the type claims).
  Any change to the spec, or any change in how the renderer draws it, is a new
  version that starts `proposed`; the old version is `superseded` and stops
  posting. The database enforces that a spec never changes after insert.
- Fourteen built-ins: four reading families twice each (default, and an
  alternate with the second variant, a centred headline, and a motif), plus
  Lunar Hero (square and tall), Instrument (square and tall), Fog Panel and
  Sky Contrast for the Green and evergreen formats.
- **AI proposals:** with `ORBIT_X_DESIGN_PROPOSALS=true` the channel asks
  Claude once a week (Sundays) for up to two new types, or use **Ask for new
  post types** in the desk. Claude sees only the closed vocabulary and the
  existing types and returns JSON. A proposal is refused if it uses anything
  outside the vocabulary, makes a claim in its name or description, renders
  with a fitting warning or a layout collision, or duplicates a live design.
  At most four AI proposals wait for review at once.

**Layout rules found while building this** (now enforced on every spec):
the five families were founder-reviewed for readings and collide on other
formats, so families carry readings only and each 5.1 event template carries
only its own format; and every non-reading format puts the mark in the upper
corner, because the footer metadata line is drawn across a footer mark.

### Rotation rules (defaults)

| Rule | Default |
| --- | --- |
| Posts per day | 1 (one slot per editorial day) |
| Same visual family | never twice in a row (`familyNoRepeat: 1`) |
| Same post type | not within the last 2 posts (`typeNoRepeat: 2`) |
| Weekly caps (rolling 7 days) | daily_reading 3, weekly_reading 1, monthly_reading 1, something_changed 4, calculated_not_invented 2, without_the_fog 2, your_sky 1 |
| Weights | something_changed 1.0, daily 1.0, weekly 1.2, monthly 1.2, calculated_not_invented 0.8, without_the_fog 0.8, your_sky 0.6 |
| Urgency multiplier | event on its day 3, period start 2, otherwise 1 |
| Hook style | not one of the last 2 used |
| Caption structure | not the last one used |
| Evergreen topic | not within 45 days |
| Near-duplicate | opening or caption at 0.6 similarity or more to any of the last 30 posts |
| Founder default family | small preference (x1.1) for the 2026-08-20 cadence defaults |

Override any of these with JSON, for example
`ORBIT_X_CHANNEL_ROTATION={"weeklyCaps":{"daily_reading":4},"familyNoRepeat":2}`.
Unknown keys and out-of-range values are ignored and listed in the desk.

With Yellow off, the channel posts on Moon days and a few methodology days a
month, and stays quiet otherwise. That is expected; most of the variety comes
from Yellow.

### Idempotency and safety

- One run per editorial day and mode: `orbit_x_channel_runs.slot_key` is
  UNIQUE, so a repeated cron call resumes the same run.
- A lease on the run keeps two overlapping invocations apart.
- The existing partial unique index on `period_key` (approved, exported,
  scheduled, published) means a period the desk already covered, or the
  channel already posted, cannot be posted again.
- State is saved before every external call. A `media_publish` whose answer
  is lost is never retried blindly: the channel asks the carousel container
  whether it was published and recovers the media id instead.
- Yesterday's unfinished run never posts late; it is marked `expired`.
- The publishing quota (`content_publishing_limit`, about 100 per 24 hours)
  is read before the carousel is created and again before publishing.
- Only the channel's service role can set `scheduled`, `published` or
  `failed`, and `published` requires Meta's media id (database constraints).

### Cron schedule

`vercel.json` calls `/api/orbit-x-channel/tick` at 13:07, 14:37 and 16:17 UTC
(07:07, 08:37 and 10:17 in Chicago in winter). Three ticks, each once a day,
work on any Vercel plan; on Hobby, Vercel may run a daily cron at any minute
within its hour. Each tick has a 24-second budget inside the 30-second
function limit and stops starting new steps before it runs out.

### Known limitations and findings

- **Pre-existing renderer collisions, not fixed here.** In the shipped desk
  renderer, the footer metadata line on fact and movement slides is drawn
  across a footer-left or centred mark in four of the five families, and
  Celestial Editorial's vertical label crosses its page counter and the
  positions grid. The desk exports these today. The channel avoids them with
  layout rules and leaves Celestial Editorial out of its built-ins; a renderer
  fix is a follow-up that should bump those families to v2.
- One renderer change was made: the hero's fallback axis (heroes with no Moon
  to draw) is now placed after the headline is measured, so it no longer runs
  through a long headline. It is left out when there is no room.
- Orbit Signal's mark in the upper corner sits on the family's purple band
  with low contrast. It is legible but quiet.
- Instagram accepts JPEG only, so each slide is also encoded as a JPEG of the
  same pixels. The PNG keeps the desk's filename and is archived beside it.
- Fonts on the server are Arimo and Gelasio (SIL OFL), metric-compatible
  with the Arial and Georgia the templates are fitted for. They are close to,
  not identical with, the desk preview in a browser.
- Uploaded media is not deleted automatically; remove old
  `channel/<date>/...` folders from the bucket by hand if storage matters.

### Licensing

Unchanged in kind. Swiss Ephemeris remains AGPL and Orbit remains
AGPL-3.0-or-later; the channel adds network use of the same server code, which
section 13 already covers through the existing Source link. New third-party
pieces: resvg-js (MPL-2.0, unmodified), jpeg-js (BSD-3-Clause), and the
Arimo and Gelasio fonts (SIL OFL 1.1, instanced and subset, licences beside
the files). See `THIRD_PARTY_NOTICES.md`.

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
Ephemeris · an autonomous prediction system · a general-purpose social bot.
(V1 had no Instagram integration, deliberately. Dev Update 6.1 adds one,
off by default; see above.)

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

Future in V1, built in Dev Update 6.1 behind flags: the review/policy gate
(`policy.js`) and the Instagram publisher (`publisher.js`, the OrbitXPublisher
boundary). Analytics is still future. Export never sets `published_at`; only
the publisher does, with Meta's media id.

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
| `ORBIT_X_AUTOPUBLISH` and the channel's other variables | See Dev Update 6.1 above. |

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

Dev Update 6.1: the desk API still refuses them. Only the automatic channel,
writing with the service role, can set them: `scheduled` after Meta returns a
carousel container id, `published` with Meta's media id, `failed` when a run
ends without publishing. A database trigger refuses all three (and any media
id) from a signed-in account.

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
  (Still true of the desk. The Dev Update 6.1 channel is separate and off by
  default.)
- Candidate range is what `upcomingEvents` computes (sun ingresses, engine
  lunations, tabulated Mercury windows) plus the evergreen stock — planetary
  ingresses beyond the Sun and other stations arrive when the engine exposes
  them (the sidereal/4.4 engine line already extends `nextStations` /
  `nextIngresses`; wiring those in is a follow-up, not a redesign).
- The regex audit is a tripwire for the worst shapes, not a moderator; the
  human approval step is the real gate, by design.
