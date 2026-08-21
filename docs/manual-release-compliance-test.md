# Reviewing the release-compliance work

This is a reading-and-clicking pass, not a destructive one. Nothing here deletes
anything. You can do it with your own account.

## Start it

```bash
cd /path/to/orbit/.claude/worktrees/vercel-deployment-readiness-617643
npm run dev
```

Open **http://localhost:3001**

The terminal will show:

```
  ⚠  Local development is using the HOSTED database (project mtdrazdastcgiweauwoj).
     Changes here affect real accounts.
```

That is expected. Orbit runs on one Supabase project, so local development shares
a database with production. It only matters for this review if you delete
something — and nothing here asks you to.

## The five pages to read

Open each and read it properly. These are the pages a stranger, an app-store
reviewer, and a regulator would read.

| Page | What to check |
| --- | --- |
| <http://localhost:3001/privacy> | Does it describe what Orbit *actually* does with your data? |
| <http://localhost:3001/terms> | Is anything overstated, or missing? |
| <http://localhost:3001/support> | Would this help someone who is stuck? |
| <http://localhost:3001/source> | Is the licensing explanation right? |
| <http://localhost:3001/account-deletion> | Does it match what deletion really does? |

They also work with `.html` on the end, and are linked from **More → Account**
and from the sign-in card.

### What you will see, and why

Several places say **"not yet published"** in a dashed box:

- who publishes Orbit Axis
- the support email address
- the governing jurisdiction
- the minimum age

**That is deliberate, not unfinished work.** Those are your decisions, not
engineering ones, and Orbit refuses to invent them. A plausible-looking support
address that nobody reads is worse than a visible gap, because a gap gets fixed
and a convincing placeholder does not.

Once you decide them, they appear everywhere at once — see *Your decisions*
below.

## The disclaimers

1. Open **Ask Orbit**. Under the heading there is one line: for reflection and
   entertainment, not a substitute for medical, mental-health, legal, or
   financial advice, not an emergency service, with a link to the full terms.
2. Open <http://localhost:3001/terms> and read sections 8, 9, and 10.

The intent is one honest sentence where people actually are, and the full
version where someone can read it — rather than a warning banner on every screen
that everyone learns to skip.

## Sign in

Nothing changed here, but confirm it still works: sign in, view Home and Me,
then sign out. On the sign-in card you should now see a line linking to the
Terms of Use and Privacy Policy.

## Password reset

Type your email on the sign-in screen, choose **Forgot your password?**

You will always get the same confirmation whether or not an account exists —
that is deliberate, so the page cannot be used to discover who has an account.

**This is the one thing that may not work end to end yet.** Supabase only
redirects to URLs on an allow-list, and that list cannot be read or changed from
here. See *Your decisions* below.

The reset page itself works: <http://localhost:3001/reset-password.html>
opened without a link says so plainly instead of showing a form that cannot work.

## Confirming Tarot, Learn, and News are gone

1. Look at the left navigation. It should read exactly
   **Home · Me · Ask Orbit · More** — with no gap where the others were.
2. Try <http://localhost:3001/#tarot> — you should land on **Home**, not a blank
   or half-built page. Same for `#learn` and `#news`.
3. Open the **Command** palette. None of the three should be listed.
4. Right-click the page and choose *View Page Source*, then search for `tarot`.
   **There should be no panel markup at all.** This is what changed in this
   update: previously the unfinished markup was still shipped and removed after
   the page loaded. It is now kept outside the published files entirely.

To work on one again, add to `.env.local` and restart:

```
ORBIT_FEATURE_TAROT=true
```

Only that feature returns. Production ignores these variables completely.

## What success looks like

- All five pages load, read well, and have no broken links
- Nothing claims a support address, company, or jurisdiction that does not exist
- The disclaimers are accurate and not frightening
- Navigation is Home, Me, Ask Orbit, More
- No Tarot, Learn, or News anywhere — including in page source
- No red errors in the browser console (Option-Cmd-I → Console)

## Common errors, in plain language

| What you see | What it means |
| --- | --- |
| "not yet published" in a dashed box | A decision of yours that has not been made yet. Not a bug. |
| Either public repository link is missing on the source page | Regression — both public source links must be present and working. |
| A page 404s | Check the server is running and the URL is spelled correctly. |
| The reset email never arrives | Check spam. If it still does not arrive, the Supabase redirect allow-list is the likely cause. |

## Your decisions

These four values are the only thing standing between the legal pages and being
finished. None of them can be chosen for you.

| Value | What it is | Where it goes |
| --- | --- | --- |
| Publisher name | The name Orbit Axis is published under — you, or a company | `ORBIT_LEGAL_ENTITY` |
| Support email | A real address you will read | `ORBIT_SUPPORT_EMAIL` |
| Governing jurisdiction | Which law governs the Terms | `ORBIT_GOVERNING_JURISDICTION` |
| Minimum age | 13, 16, or 18 — affects app-store age rating too | `ORBIT_MINIMUM_AGE` |

Add them to `.env.local`, restart, and reload any legal page. Every "not yet
published" box will fill in.

**Also outstanding, in the Supabase dashboard** —
Authentication → URL Configuration → Redirect URLs:

```
http://localhost:3001/reset-password.html
```

This could not be verified or set from here: Supabase does not expose the
allow-list to the application, and this session was scoped not to change project
settings.

**And one thing that is not a configuration value:** the Terms of Use is a
practical product draft and **has not been reviewed by an attorney.** It
describes what Orbit really does, which makes it honest, but honest is not the
same as legally sufficient. Have it reviewed before a public launch.

## Stopping the server later

```bash
# Find it
lsof -nP -iTCP:3001 -sTCP:LISTEN

# Stop it
kill $(lsof -nP -iTCP:3001 -sTCP:LISTEN -t)
```

Closing the terminal window it started in also works.
