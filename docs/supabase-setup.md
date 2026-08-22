# Supabase setup

Orbit's structured data lives in Supabase. This is the connect-and-run guide.

## Project

- **Name:** `orbit`
- **Ref:** `mtdrazdastcgiweauwoj`
- **URL:** `https://mtdrazdastcgiweauwoj.supabase.co`
- **Org:** EZmannBuild's · **Region:** us-west-2 · **Postgres:** 17

## Keys and where they go

| Key | Safe in browser? | Where |
| --- | --- | --- |
| Publishable (`sb_publishable_...`) / legacy anon JWT | ✅ yes | `.env.local` → `SUPABASE_ANON_KEY`; ships to client |
| Service role | ❌ **never** | backend env only; bypasses RLS |

Copy `.env.example` → `.env.local` and fill in. `.env.local` is gitignored.
**Never commit real keys. Never put the service-role key in client code.**

```bash
cp .env.example .env.local
# then set SUPABASE_URL and SUPABASE_ANON_KEY
```

Get keys from: Supabase Dashboard → Project Settings → API.

## Schema

Migrations are in `supabase/migrations/`, applied in filename order. There are
**25** of them as of Dev Update 6.0, so this document deliberately no longer
lists them by hand — a hand-maintained list of a growing directory is a document
that is wrong most of the time. It listed six for a long while after there were
twenty-four.

The authoritative answers:

| Question | Where |
|---|---|
| What exists in the repository | `ls supabase/migrations/` |
| What is applied to the hosted project | `docs/deployment/hosted-verification.json` → `migrationHistoryReconciliation` |
| Whether anything is pending | `npm run deploy:check` names it |

The foundation, for orientation: `core_identity` (profiles, people),
`astrology` (birth data, charts, transits, events), `tarot_journal_sync`,
`rls_policies`, `harden_function`, `local_llm_vault_editing`. Everything since
adds a surface — saved charts, daily fortunes, Ask Orbit, chart identity,
entitlements, the tarot deck and daily draws, the Orbit X editorial desk, and
first-party analytics.

Apply them locally:

```bash
supabase start
npm run supabase:migrate:local
```

Applying to the **hosted** project is not automated and remains an explicit
owner decision — see [`environment-safety.md`](environment-safety.md). The
initial schema was applied to the live project on 2026-07-11; the full applied
history was reconciled against the hosted project on 2026-08-21 and recorded in
`docs/deployment/hosted-verification.json`.

## Security model

- RLS is enabled on every table — all 25 in the public schema, verified against
  the hosted project (Supabase security advisors: 0 findings, 2026-08-21).
- User data is scoped to `auth.uid()` via `owner_id` (child tables via the
  parent's `owner_id`).
- Local LLM tables store metadata, hashes, diffs, statuses, and token
  estimates. They do not store full private prompts by default.
- `tarot_cards` and `celestial_events` are public read-only reference data.
- Verified: anon can read public reference data, cannot read other users' rows
  (returns empty), and cannot write (401 RLS violation).

## Seeding reference data

`tarot_cards` and `celestial_events` have no write policy, so seeding requires
the **service role** (backend only). Do it from a trusted server or the SQL
editor — never from the client.
