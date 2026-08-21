# First-party analytics (Dev Update 6.0)

Orbit shipped with no analytics at all, and the privacy page said so truthfully.
This is the smallest system that can answer the four questions the public beta
has, and deliberately nothing more.

> Did content bring someone to Orbit? Did they sign up? Did they use it? Did
> they come back?

## What exists

| Piece | Where |
|---|---|
| Event vocabulary and validation | `lib/analytics/events.js` |
| Writing, and the metrics aggregation | `lib/analytics/service.js` |
| HTTP surface | `lib/analytics/api.js` |
| Browser module | `public/analytics.js` |
| Schema, policies, admin totals function | `supabase/migrations/20260821130000_first_party_analytics.sql` |
| Campaign keys for Orbit X posts | `lib/orbit-x/campaign.js` |

Two routes:

```
POST /api/analytics/event     record a visit and/or one event   (open, rate limited)
GET  /api/analytics/metrics   the beta metrics panel            (admin only, 404 otherwise)
```

## The vocabulary

Ten events, and the list is closed in the database as well as the application,
because the events table is insertable by anonymous callers and the database has
to be the thing that refuses an invented name.

```
session_started      signup_completed     chart_created       returning_session
today_opened         sky_opened           atlas_opened        tarot_opened
tarot_saved          compatibility_opened
```

Names match what the product calls these surfaces: Today is `#home`, Sky is
`#transits`, Atlas is `#symbol-atlas`. **There is no click, scroll, hover or
focus event, and there should not be one.** Sky and Atlas are the two surfaces
that wrote nothing to the database at all before this update — they are the
reason a route event exists.

## Identifiers

Two, both random values the browser generates for itself:

- `visitor_id` — localStorage, stable. The only thing that can say "came back".
- `session_id` — sessionStorage, one visit.

Neither is derived from device characteristics, neither is shared with anyone,
and neither can be read from another site. **No IP address is stored.** Rate
limiting hashes the peer address in memory for a minute and writes nothing;
that is abuse protection and is deliberately a separate concern from counting.

## Attribution

The five parameters read from a landing URL — `utm_source`, `utm_medium`,
`utm_campaign`, `utm_content`, and Orbit's own `oxc` content key — are
normalised, length-bounded, lowercased, and stripped of anything outside
`[a-z0-9._:-]`. Everything else in the query string is ignored. The five are
then removed from the address bar so a shared link does not carry someone
else's campaign tag around.

The referrer is reduced to a **host** (`instagram.com`), never a full URL: a
full referring address can carry a path, a query, and occasionally somebody's
search terms. Mobile apps strip the referrer entirely, which is exactly why the
`utm` fields exist alongside it rather than instead of it.

### Orbit X → visit → signup

`lib/orbit-x/campaign.js` derives a stable key from a post's id
(`ox-3f2504e0`). It is **derived, not stored**, so it adds no column and does
not compete with the reserved `external_media_id` / `performance_metrics`
fields, which still belong to a publisher that does not exist.

```
orbit_x_posts.id → campaignUrl() → a link in the caption → analytics_sessions.campaign_key → signup_completed
```

**Exporting is not publishing.** A campaign key existing says a link was
generated, never that anything was posted. Orbit has no social integration and
does not know whether an exported graphic was ever used.

## Permissions, and the honest cost

`INSERT` is open to `anon`. That is not an oversight: the visitors worth
counting are the ones who have not signed up and hold no token. The cost is that
the public anon key can be used to insert junk rows directly, inflating counts.
That is **bounded rather than prevented** — the event name is constrained by a
CHECK, no free text is stored, and the endpoint is rate limited. Nothing here
can leak, because nothing here holds anything private.

`SELECT` is admin-only, through the same `orbit_x_admins` allowlist the
editorial desk uses. There is no `UPDATE` and no `DELETE` policy: these tables
are append-only, like `sync_events` and `llm_runs`. Account deletion still
removes a person's events, because a foreign-key cascade is a referential action
and does not consult policies.

Account totals come from `orbit_beta_account_totals()`, a `security definer`
function that returns **counts only** — `auth.users` is not reachable any other
way. The lesson from `20260817120000_entitlements_touch_not_callable.sql` is
applied directly: EXECUTE is revoked from `public` and `anon`, the search_path
is pinned, and it refuses anyone not on the admin allowlist even if they reach
it.

### Two traps worth remembering

**The upsert that could not work.** `recordSession` was written as an upsert
(`on_conflict=id`). PostgREST resolves a conflict by *reading* the existing row,
so an upsert needs SELECT — which `anon` deliberately does not have. It returned
401 and recorded nothing, and every unit test passed because they stub `fetch`.
The session id is the primary key, so a plain insert is already idempotent.

**The grant that verification needs.** `analytics_events` carries `owner_id` and
therefore joins `USER_OWNED_TABLES`. `service_role` bypasses RLS but not
table-level grants, so without `grant select … to service_role` a completely
successful account deletion reports `DELETION_INCOMPLETE`.

## What is deliberately not measured

- Anyone sending **Global Privacy Control** or **Do Not Track**. Honoured in
  `public/analytics.js` before an identifier is created.
- Anyone whose browser has no storage (a private window). Nothing is counted
  rather than anything failing.
- Repeat visits within a single day are one visit; "came back" means a different
  **day**, because two tabs in one sitting is not a return.

Every number therefore reads as a **floor**. The metrics response carries its
own caveats so they travel with the figures rather than living in a document
nobody opens beside them.

## Running it

The tables must exist. Locally:

```bash
supabase start
npm run supabase:migrate:local
```

The application degrades quietly without them: beacons fail, the failure is
swallowed by design, and nothing breaks — which also means nothing is counted.
`npm run deploy:check` names the migration if it is not recorded as applied.
