# Preview environment, security checklist, and open blockers

Run `npm run deploy:check` for the live version of this list. This document
explains the *why* behind each item.

---

## 1. What "deployment readiness" means here

```
Update 4.0.3 — Vercel Deployment Foundation
  Implementation complete locally.
  Preview BLOCKED pending portability and owner configuration.

Update 4.0.4 — Orbit Core Portability
  Code-level portability blocker RESOLVED and verified on Linux x64.
  Vercel Linux build now verified.

Dev Update 1.2 — Authentication and Account Trust
  Protected fail-closed Preview exists.
  Database-backed acceptance remains blocked pending a database decision.
```

After Update 4.0.4 there are **no known code-level blockers**. Everything
remaining needs the owner's accounts or approval.

It does **not** mean any of the following:

- Production deployment is approved
- Hosted migrations have been applied
- A Preview Supabase project exists
- Swiss Ephemeris licensing is resolved
- Legal review is complete
- Monetization or analytics are active
- A custom domain is configured
- Orbit Intelligence production hosting has been selected

For Dev Update 1.2, the dedicated branch was pushed, the reviewed grant-only
migration was applied, and a protected Preview was deployed. Nothing was
merged to `main`, promoted to Production, or given a deployed service-role key.

---

## 2. Open blockers

### Must fix before Preview

**1. ~~The deployment branch is not pushed.~~ RESOLVED.**
`feat/orbit-axis-core-portability` was pushed on 2026-07-20 and now tracks
`origin/feat/orbit-axis-core-portability`. The repository remains **private**.

**2. No approved Preview Supabase project exists.**
`APPROVED_PREVIEW_PROJECT_REFS` is deliberately empty and
`ORBIT_PREVIEW_PROJECT_REFS` is unset, so Orbit refuses to start in preview
mode. This is the guard working, not a bug. A hosted project is not
preview-safe merely because it is not production.
*Owner decision:* create a separate disposable Supabase project, or explicitly
approve production-backed Preview (not recommended — Preview is where data gets
broken on purpose).

**3. Missing Vercel Preview environment variables.**
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ORBIT_ENVIRONMENT`, and
`ORBIT_PREVIEW_PROJECT_REFS`. Only the owner can set these.

**4. ~~No Orbit Vercel project exists.~~ RESOLVED.**
The dedicated `lorehouse-team/orbit-axis` project is linked and verified.
Dev Update 1.2 built successfully on Vercel's Linux/Node 22 infrastructure.
The protected review deployment is
`https://orbit-axis-gkeqjgca5-lorehouse-team.vercel.app`.

The deployment is intentionally fail-closed: only
`ORBIT_ENVIRONMENT=preview` is configured for this branch. It has no Supabase
URL/key and no service-role key. Unauthenticated requests are redirected to
Vercel SSO. Do not describe database-backed auth as Preview-verified until
blockers 2 and 3 are resolved.

### RESOLVED in Update 4.0.4 — the Swiss Ephemeris platform blocker

This was the most consequential finding of Update 4.0.3 and it is now fixed.

The single bundled executable was Mach-O arm64 (Apple Silicon) and could not
run on Vercel's Linux x86-64 functions, which would have failed *every*
astrology request.

Orbit now ships one executable per platform behind a single resolver
(`lib/astro/runtime/`), selected from `process.platform` and `process.arch`:

- `darwin-arm64` — local development
- `linux-x64` — **statically linked**, for Vercel and any Linux host

Verified inside a `linux/amd64` container: the resolver selects `linux-x64`,
the executable runs, natal charts, transits, Current Sky, fortunes, and Ask
Orbit evidence all compute, the full test suite passes, and the real Vercel
function handler answers a live HTTP request with a genuine calculation while
attempting **zero** connections to localhost Ollama or Supabase.

Mac and Linux agree exactly: across 440 compared values the maximum longitude
difference is **0.0°**. See
[orbit-core-runtime.md](orbit-core-runtime.md) for provenance, checksums,
tolerances, and the exact container commands.

*Historical note:* this resolved the **technical** runtime blocker. The separate
licensing decision was recorded on 2026-08-21; see below.

### Must fix before Production

- Hosted Ask Orbit migration applied (see
  [hosted-supabase-migration.md](hosted-supabase-migration.md))
- Production environment variables set in Vercel
- Production RLS verified against the live project
- Production branch and promotion decision made deliberately
- `npm run deploy:check` passing with zero blockers
- Everything in the Preview list above, resolved

### Legal and launch blockers

**Swiss Ephemeris licensing route: AGPL-3.0 selected and recorded on
2026-08-21.** Orbit Axis and Orbit Axis Engine are `AGPL-3.0-or-later`, both
repositories are public, and the hosted application exposes them through
`/source` and `GET /api/v1/source`. No Swiss Ephemeris Professional License is
currently used or claimed. Full factual record:
[swiss-ephemeris-licensing.md](swiss-ephemeris-licensing.md). This record is not
legal advice or an automated compliance certification.

---

## 3. What will and will not work in Preview

Assuming an `orbit-axis` Vercel project exists, Preview variables are set, and
an approved Preview Supabase project exists — i.e. after the owner-only work:

| Feature | Preview |
|---|---|
| Frontend loads, CSS and modules served | Works |
| Navigation between views | Works |
| Sign up / sign in / sign out | Works |
| Session restoration for a returning user | Works |
| Saved chart list | Works |
| Natal chart calculation | Works — linux-x64 runtime, verified in a container |
| Current Sky | Works |
| Daily fortune | Works |
| Ask Orbit answers and calculated evidence | Works |
| Ask Orbit history persistence | **Fails until the hosted migration is applied** — the answer generates, is marked not-saved, and says so |
| Ollama-worded answers | Never — deterministic engine only, by design |
| Development routes, disposable users, seeds | Never — disabled on a deployment |

The ephemeris rows changed from *Fails* to *Works* in Update 4.0.4. That is
verified on Linux x64 in a container, **not** on a real deployment — no Preview
Deployment has ever existed.

---

## 4. Security checklist

Verified in this update:

- [x] `.env.local` is git-ignored and `.vercelignore`-excluded; never modified,
      moved, or rotated
- [x] `.vercel/` added to `.gitignore` — project ids and pulled env values
      cannot be committed
- [x] Obsidian vault (`07 Orbit App/`), `docs/`, `prompts/`, `.orbit/`,
      `supabase/`, and `test/` excluded from the Vercel upload
- [x] No secret in `vercel.json`; no hardcoded deployment URL
- [x] Service-role key never required by a deployment; `deploy:check` raises a
      BLOCKER if one is present on a deployment
- [x] Orbit has no bundler, so no server-only value can be inlined into a
      frontend bundle; no source maps are generated
- [x] Session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` on deployments
- [x] Production and Preview errors return a generic message; stack traces and
      internal messages stay in the function log
- [x] `/api/health` reveals nothing about environment, database, or version
- [x] Development and vault routes return a plain `404` on a deployment — they
      do not hint that they exist
- [x] Guard messages never contain a key, token, or credential-bearing URL —
      only environment name, hostname, and public project reference
- [x] Chat logging records timing metadata only: never message content, birth
      details, coordinates, prompts, or generated readings
- [x] Secret scan run across the tracked tree — no key material found

Still to verify by the owner, on the live project:

- [ ] Production RLS behaviour with two real accounts
- [ ] Supabase Site URL and redirect URLs
- [ ] That no service-role key was pasted into the Vercel dashboard

---

## 5. Creating the Preview Supabase project

Owner-only. Not performed by this update.

1. Supabase dashboard → **New project**. Name it distinctly, e.g.
   `orbit-preview`. Choose the same region as production.
2. Copy the project reference from its URL
   (`https://<project-ref>.supabase.co`). It is a public identifier, not a
   secret.
3. Link and apply migrations **to that project only**:
   ```bash
   supabase link --project-ref <preview-project-ref>
   supabase db push
   ```
   Double-check the project reference before pressing enter. This is the one
   step in the whole process where a typo reaches production.
4. Copy its anon key from Project Settings → API.
5. In Vercel → Project → Settings → Environment Variables, scoped to
   **Preview** only:
   ```
   ORBIT_ENVIRONMENT=preview
   SUPABASE_URL=https://<preview-project-ref>.supabase.co
   SUPABASE_ANON_KEY=<preview anon key>
   ORBIT_PREVIEW_PROJECT_REFS=<preview-project-ref>
   ```
6. Disable email confirmation on the Preview project (see
   [auth-redirects.md](auth-redirects.md)).
7. Redeploy. Orbit will now start in preview mode instead of refusing.

Do **not** put the production project reference in
`ORBIT_PREVIEW_PROJECT_REFS`. That approval exists precisely so it cannot happen
by accident.
