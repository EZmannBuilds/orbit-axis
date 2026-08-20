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

## Environment

| Variable | Meaning |
| --- | --- |
| `ORBIT_X_ENABLED` | `"true"` enables the desk. Anything else = off. |
| `ORBIT_X_AI_PROVIDER` | `anthropic` (the only V1 provider). |
| `ORBIT_X_AI_API_KEY` | Server-only. Never in `public/`, never logged. |
| `ORBIT_X_AI_MODEL` | Defaults to `claude-sonnet-5`. |

## Migration

`supabase/migrations/20260819210000_orbit_x_editorial.sql` — `orbit_x_admins`
and `orbit_x_posts`. **Not applied to hosted.** Apply before enabling the flag
in production; the desk 404s until both exist. Verified facts live in
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
16. Unset the AI key → Generate fails cleanly, candidate survives, retry offered.
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
