# Dev Update 1.2 release verification

Verified 2026-07-30 from the dedicated
`codex/dev-update-1.2-auth-account-trust` worktree.

## Boundaries

- Owner changes in the native checkout were not modified.
- `main`, the Production branch, and the Production deployment were not changed.
- No service-role key was added to Preview or Production.
- Preview was not pointed at the Production database.
- No hosted user account or user-owned row was created, edited, or deleted.

## Repository and tests

- `main` and `origin/main` both remained at
  `2dacdd86311ea8ebd87ac7a61b621a1343f90c86`.
- The app suite ran 796 tests: 781 passed, 15 skipped, 0 failed.
- Focused authentication/account-trust tests ran 58/58.
- App lint, build, dependency audit, vendor check, and the Vercel build passed.
- The engine repository lint, runtime check, and 31/31 tests passed.
- `typecheck` currently aliases `lint`; it is not a separate static type check.
- `app:check` is not defined on this branch. It belongs to the separate native
  prototype and was intentionally not imported.

## Browser verification

Two disposable local accounts were used. The verified behaviors were:

- accessible modal semantics, initial focus, focus containment, inert app shell,
  Escape protection, announced validation, 44-pixel visible controls, scrolling
  instead of clipping at 375×812, and no horizontal overflow at 375 or 1280
  pixels
- signup, reload persistence, sign-out, and sign-in
- local reset email delivery to Mailpit with the exact reset-page redirect
- a controlled invalid-token recovery page; reused-token behavior is also
  covered by automated tests
- data-export download feedback and date-stamped filename
- exact uppercase `DELETE` confirmation; lowercase remained disabled
- deletion failed closed without a service-role key and returned a
  non-sensitive reference
- Privacy, Terms, Support, and account-deletion pages had no raw environment
  variable names and no horizontal overflow
- no browser console errors in the checked mobile or desktop flows

## Hosted Supabase verification

- Site URL already matched Production.
- Exact Production root and reset-page redirect URLs were added; five existing
  redirect entries were retained.
- Migration
  `20260728120000_service_role_deletion_verification_grants.sql` was reviewed as
  grant-only, applied once, and reconciled to its exact repository version.
- All 16 table row counts, storage counts, client grants, policies, and RLS
  state matched the preflight snapshot after application.
- `service_role` could use `public` and select all 16 user-owned tables.
- The hosted platform had already granted broader ordinary privileges to
  `service_role`; those pre-existing privileges were not introduced by this
  migration. Application code limits construction of that client to the
  guarded Production account-deletion path.
- The security advisor's pre-migration warning remains: leaked-password
  protection is disabled. Advisor recheck attempts after DDL returned a
  connector internal error; the migration-specific SQL invariants were
  rechecked directly.

## Preview

Normal source deployment:

`https://orbit-axis-gkeqjgca5-lorehouse-team.vercel.app`

- Vercel status: Ready
- target: Preview, never Production
- normal Linux build, Node 22
- Vercel Authentication enabled; anonymous requests receive an SSO redirect
- no service-role key
- no Supabase URL or publishable key
- database-backed routes intentionally fail closed

This is a safe shell/design review deployment, not a complete auth acceptance
environment. Complete Preview verification requires either a separate Supabase
development branch/project (preferred) or fresh, explicit owner approval to
share the Production database with this exact Preview branch.

## Remaining release decisions

1. Choose and approve the Preview database path.
2. Supply verified legal/support facts. Swiss Ephemeris licensing was later
   recorded as the AGPL-3.0 route on 2026-08-21; see
   `swiss-ephemeris-licensing.md`.
3. Enable Supabase leaked-password protection or explicitly accept the risk.
4. Provide an approved disposable hosted inbox/account for the final hosted
   recovery-email acceptance check.
5. Separately approve any Production service-role secret, merge, or deployment.
