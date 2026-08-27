# CLAUDE.md

Guidance for Claude Code and other agents working in this repository.

`README.md` says what Orbit is. `CONTRIBUTING.md` says how to set it up and run it —
**read that for setup, Node version, and environment variables; it is not repeated here.**
This file covers what an agent needs that a human contributor does not.

## Before you propose a fix, check whether it already exists

**This repository has more than one author, and one of them is another agent.** Codex works
here. Erik's working tree is frequently on a feature branch, behind `main`, with uncommitted
work in it. The deployed site can be **ahead of the files you are reading**.

On 2026-08-26 an agent read `ui.html`, found strings in the browser that were absent from the
source, and concluded the desk generated them. It had not: the checkout was three commits
behind `main`, and the feature had shipped four days earlier. The agent then offered to build
something that already existed.

Run this before proposing or writing anything:

```bash
git status --short
git branch --show-current
git rev-list --left-right --count origin/main...HEAD   # behind / ahead
git log --oneline origin/main | grep -i <the thing you are about to build>
```

If a string is visible in the browser but not in the source, **assume the checkout is behind.**

There are ~18 local branches and several worktrees under `.claude/worktrees/`. "The code I am
looking at" is rarely "the code that is running."

## Preserve before you reorganize

If the tree is dirty with work you did not write, **do not stash, reset, or checkout over it.**
Tar the changed and untracked files somewhere outside the repo, then commit them on their own
branch with a message that says plainly they are unreviewed and not yours. Uncommitted work is
one `git checkout` from gone, and briefs that only see branches will conclude it never existed.

## Deploying

**`main` is the Vercel Production Branch** (`docs/deployment/vercel.md`). Every push to a
non-production branch builds a Preview; merging to `main` is what ships. Vercel config is
`vercel.json`, deployment notes are under `docs/deployment/`, and `npm run deploy:check` prints
the current honest list of what is outstanding.

Before any TestFlight or native build, **confirm the API hostname with Erik first** — it is
compiled into the binary.

## Testing

```bash
npm run lint     # node --check across the tree; fast, always safe
npm test         # node --test, but see the guard below
```

`pretest` runs `scripts/test-guard.js`, which **refuses to run the suite while the config points
at the hosted production database.** That is correct behaviour, not an obstacle — never work
around it. For suites that use fakes and touch no database, run the file directly:

```bash
node --test test/orbit-x*.test.js
```

For anything database-backed: `supabase start` then `npm run test:local`.

**Say which suites you actually ran.** "Tests pass" after running three of ninety files is a
false report; name the files.

## The engine is vendored, not depended on

`vendor/orbit-axis-engine/` is a copy of `~/Projects/orbit-axis-engine`, which is a **separate,
public, AGPL** repository. `scripts/engine-sync.js` explains why. Two commands matter:

```bash
npm run engine:check    # fail if vendor/ has drifted
npm run engine:sync     # re-copy the engine into vendor/
```

**Never hand-edit `vendor/`.** Fix the engine repo and re-sync. And never let anything private
— natal data, account identifiers, Erik's chart — travel into the engine repo; it is public.

## Architecture rules that are load-bearing

**Facts come from the engine, never from a client and never from a model.** `lib/orbit-x/api.js`
rebuilds the candidate server-side for the named date on every request; a client-supplied `facts`
object is ignored by construction. Preserve that property in anything you touch.

**Orbit X publishes nothing.** No scheduler, no Instagram integration, no publish endpoint.
Export is not publishing — `campaign.js` is explicit that a key existing means a link was
generated, never that anything went out. Do not describe a draft as scheduled or live.

**The symbolic register is a product constraint, not a style note.** The editorial constitution
in `lib/orbit-x/editorial.js` travels with every generation and forbids prediction, diagnosis,
and medical/financial/legal advice. It is enforced by `auditCopy()` and `verifyFactIntegrity()`.
Copy that violates it is refused, and that refusal is the feature.

**Feature flags default to off, and they do not guess.** `lib/features.js` counts only
`"true"` and `"enabled"` as on — `1`, `yes`, `on`, and `"TRUE "` with a trailing space are all
off, deliberately. `orbitXEnabled()` string-compares `"true"` for the same reason. Preserve that
strictness; a flag that guesses eventually guesses wrong in the direction nobody wanted.

## Where things are documented

| Topic | File |
|---|---|
| Orbit X, the content desk | `docs/orbit-x.md` |
| What data lives where | `docs/data-boundaries.md` |
| Environment safety | `docs/environment-safety.md` |
| Deployment, Vercel, previews | `docs/deployment/` |
| Supabase setup and migrations | `docs/supabase-setup.md` |
| Swiss Ephemeris licensing | `docs/deployment/swiss-ephemeris-licensing.md` |
| Local LLM / Ask Orbit | `docs/local-llm.md`, `docs/ask-orbit.md` |
| **Agent decisions and mistakes** | **Orbit vault → `07 Orbit App/Agent Log.md`** (private, untracked) |

## Record what you learn

**`07 Orbit App/Agent Log.md` in the Orbit vault** is the running record of decisions made and
mistakes found **while working in the code** — the things that are true but not obvious from
reading it. Product decisions and release notes live beside it in `07 Orbit App/`.

**It is deliberately not in this repository.** This repo is public; the log describes how the
code actually behaves, which branches are stale, and where agents went wrong. It is untracked
even inside the private vault, and `docs/agent-log.md` is gitignored here so it cannot drift
back. Do not recreate it in the repo.

Add an entry when you discover a non-obvious constraint, when you get something wrong and
correct it, or when you make a judgement call the next agent would otherwise re-litigate.
Stamp date **and** time. Do not write a "no changes" entry.

## Approval gates

Ask Erik before: deploying, merging to `main`, changing environment variables, running anything
against the production database, force-pushing, deleting branches, or making a public repository
change. **Never enter an API key or secret anywhere** — that is his to do, in every case.
