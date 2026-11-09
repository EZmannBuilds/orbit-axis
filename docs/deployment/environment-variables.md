# Orbit Axis environment variables

Every variable Orbit actually reads, derived from the source (`grep process.env`
across `lib/`, `scripts/`, `server.js`, `api/`), not from memory.

**No value is printed anywhere in this repository.** "Exists locally" means the
name is defined in the untracked `.env.local`; it says nothing about the value.

Legend:

- **Public** — safe to expose to a browser. Row-level security is what protects
  the data, not the key.
- **Server-only** — must never reach a frontend bundle or a browser.
- **Who supplies** — Owner (dashboard/manual), Vercel (automatic), or Orbit
  (tracked default).

---

## Browser-safe

Orbit has no build step and no bundler, so nothing is inlined into a frontend
bundle at build time. The frontend receives Supabase details only through API
responses from the function. These are the values that are *safe* to expose.

| Name | Purpose | Environments | Required | Who supplies | Exists locally |
|---|---|---|---|---|---|
| `SUPABASE_URL` | Hosted (or local) Supabase project URL. Used for Auth and REST. | Local, Test, Preview, Production | **Yes** on any deployment | Owner | Yes |
| `SUPABASE_ANON_KEY` | Client-safe Supabase key. Legacy anon JWT or modern `sb_publishable_…`. | Local, Test, Preview, Production | **Yes** on any deployment | Owner | Yes |

---

## Server-only

**None of these may ever be set in a Vercel Preview or Production environment
unless a specific, documented server-side need exists.** `deploy:check` raises a
BLOCKER if a service-role key is present on a deployment.

| Name | Purpose | Environments | Required | Who supplies | Exists locally |
|---|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses row-level security. Orbit's request paths use the signed-in user's own token instead, so a deployment does not need it. `dev:local` and `test:local` delete it. | Local only, and only for privileged jobs | No | Owner | Yes |
| `SUPABASE_ACCESS_TOKEN` | A user access token for CLI/vault-sync operations that write owner-scoped rows. | Local | No | Owner | No |
| `SUPABASE_OWNER_ID` | Owner UUID paired with `SUPABASE_ACCESS_TOKEN` for CLI writes. | Local | No | Owner | No |
| `GEOAPIFY_API_KEY` | Birthplace search. Without it, birthplace lookup returns a clear error and the rest of Orbit works. | Local, Preview, Production | No | Owner | Yes |
| `ORBIT_PREVIEW_PROJECT_REFS` | Comma-separated Supabase project references explicitly approved as disposable Preview targets. Orbit refuses to start in preview mode without a match. Project references are public identifiers, not credentials — this is server-only because it is a safety control, not a secret. | Preview | **Yes** for Preview | Owner | No |

---

## Environment selection

| Name | Purpose | Environments | Required | Who supplies | Exists locally |
|---|---|---|---|---|---|
| `ORBIT_ENVIRONMENT` | Pins the environment to `local`, `test`, `preview`, or `production`. Overrides `VERCEL_ENV`. | All | Recommended on deployments | Owner / Orbit scripts | No |
| `NODE_ENV` | Only `test` is honoured, and only as a fallback. Deliberately not trusted on its own — it says nothing about which database is configured. | Test | No | Tooling | No |

---

## Local-only

These configure things that do not exist on a deployment. **None of them are
required by Vercel, and Ollama-related values should not be set there** — Orbit
disables the local language provider on any deployment before a network call is
attempted, so setting them would be misleading rather than harmful.

| Name | Purpose | Required | Exists locally |
|---|---|---|---|
| `PORT` | Local HTTP port. Default `3001`. Vercel assigns its own. | No | Yes |
| `ORBIT_LOCAL_LLM_ENABLED` | Master switch for the optional local model. | No | Yes |
| `ORBIT_LOCAL_LLM_PROVIDER` | Only `ollama` is supported. | No | Yes |
| `ORBIT_OLLAMA_BASE_URL` / `OLLAMA_BASE` | Ollama endpoint. Default `http://127.0.0.1:11434`. | No | Yes |
| `ORBIT_LOCAL_MODEL` / `OLLAMA_MODEL` | Model name, e.g. `qwen3:14b`. | No | Yes |
| `ORBIT_LOCAL_EMBEDDING_MODEL` | Embedding model name. | No | No |
| `ORBIT_LOCAL_LLM_CONTEXT_LENGTH` | Context window. Default `8192`. | No | Yes |
| `ORBIT_LOCAL_LLM_TEMPERATURE` | Default `0.2`. | No | Yes |
| `ORBIT_LOCAL_LLM_TIMEOUT_MS` | Batch timeout. Default `180000`. | No | Yes |
| `ORBIT_LOCAL_LLM_MAX_OUTPUT_TOKENS` | Default `3000`. | No | No |
| `ORBIT_LOCAL_LLM_MAX_RESPONSE_CHARS` | Default `120000`. | No | No |
| `ORBIT_LOCAL_LLM_MAX_NOTE_CHARS` | Default `80000`. | No | No |
| `ORBIT_LOCAL_LLM_PROMPT_VERSION` | Prompt version tag. | No | No |
| `ORBIT_LLM_CHAT_TIMEOUT_MS` | Streaming chat timeout. Default `60000`. | No | No |
| `ORBIT_LLM_HEALTH_CACHE_MS` | Health probe cache. Default `5000`. | No | No |
| `ORBIT_LLM_KEEP_ALIVE` | Ollama keep-alive. Default `10m`. | No | No |
| `ORBIT_LLM_WARMUP` | Warm the model at local startup. Only ever runs in `server.js`. | No | No |
| `ORBIT_VAULT_PATH` | Obsidian vault path. Development routes only. | No | No |
| `ORBIT_PROPOSAL_DIR` | Vault edit proposals directory. Development routes only. | No | No |
| `ORBIT_TEST_SUPABASE_URL` | Local Supabase URL for integration tests. | No | No |
| `ORBIT_ENV_CHECK_VERBOSE` | Extra output from the test guard. | No | No |

## Orbit X automatic channel (Dev Update 6.1)

Server-only, all off by default. The full setup order is in
[docs/orbit-x.md](../orbit-x.md#dev-update-61-the-automatic-instagram-channel).
Flags count only the exact string `true`; the kill switch is the one
deliberate exception and stops publishing for any non-empty value.

| Name | Purpose | Environments | Required | Who supplies |
|---|---|---|---|---|
| `ORBIT_X_AUTOPUBLISH` | `true` runs the channel in **review mode**: keeps 7 days prepared as "ready for review"; nothing publishes until a person approves a post with a publish time. Needs `ORBIT_X_ENABLED=true`. | Production | No | Owner |
| `ORBIT_X_AUTOPUBLISH_LIVE` | `true` enables **auto mode**: Green posts approve themselves. Yellow always waits for a person. Off by default. | Production | No | Owner |
| `ORBIT_X_PUBLISH_TIME` | Default publish time per day, `HH:MM` in the editorial timezone. Default `08:30`. | Production | No | Owner |
| `ORBIT_X_KILL_SWITCH` | Any non-empty value stops preparing and publishing and ends a publish under way. Needs a redeploy on Vercel; the desk's Pause is immediate. | Production | No | Owner |
| `CRON_SECRET` | Vercel sends it as `Authorization: Bearer ...` to the cron route. 16+ characters. Unset means the route refuses. | Production | **Yes** for the channel | Owner |
| `ORBIT_X_IG_API` | `facebook` (Facebook Login with the linked Page, the default route) or `instagram` (Instagram Login). | Production | **Yes** to publish | Owner |
| `ORBIT_X_IG_USER_ID` | Numeric Instagram professional account id. | Production | **Yes** to publish | Owner |
| `ORBIT_X_IG_ACCESS_TOKEN` | Token with the content-publish permission; a system-user token does not expire. Secret. | Production | **Yes** to publish | Owner |
| `ORBIT_X_GRAPH_API_VERSION` | Graph API version. Default `v25.0`. | Production | No | Owner |
| `ORBIT_X_IG_TOKEN_EXPIRES_AT` | Optional ISO date for expiring tokens; the run log warns 10 days before it. | Production | No | Owner |
| `ORBIT_X_CHANNEL_ROTATION` | Optional JSON overriding the rotation rules. Invalid keys are ignored and reported in the desk. | Production | No | Owner |
| `ORBIT_X_DESIGN_PROPOSALS` | `true` asks Claude weekly for new post types to review. | Production | No | Owner |

The channel also needs `SUPABASE_SERVICE_ROLE_KEY` with `orbit-x-channel` in
`ORBIT_PRODUCTION_SERVICE_ROLE_PURPOSE` (see `lib/env/service-role.js`), and
`ORBIT_X_AI_API_KEY` to write copy.

## Tuning (optional anywhere)

| Name | Purpose | Default |
|---|---|---|
| `ORBIT_ASK_USE_MODEL` | `false` skips the optional model rewording pass entirely. Redundant on a deployment (already disabled) but makes intent explicit. | `true` |
| `ORBIT_CHAT_MAX_PER_USER` | Concurrent generations per user. | `1` |
| `ORBIT_CHAT_MAX_GLOBAL` | Concurrent generations overall. | `2` |
| `ORBIT_CHAT_RATE_MAX` | Chat messages per minute per user. | `20` |
| `ORBIT_CHAT_LOG` | `false` silences the non-sensitive chat timing log. | enabled |

---

## Vercel-generated

Supplied automatically by Vercel. Orbit **reads** these; never set them by hand.

| Name | How Orbit uses it |
|---|---|
| `VERCEL` | `"1"` means this process is on Vercel. The only trusted "am I deployed" signal. |
| `VERCEL_ENV` | `production` / `preview` / `development`. Maps to Orbit's environment when `ORBIT_ENVIRONMENT` is unset. `development` (i.e. `vercel dev`) maps to `local`. |
| `VERCEL_URL` | Per-deployment hostname. Stored as a hostname only; informational. |
| `VERCEL_GIT_COMMIT_REF` | Branch name. Informational only — never a safety input. |
| `VERCEL_GIT_COMMIT_SHA` | Commit SHA, truncated to 12 characters. Informational only. |

### Files the Vercel CLI writes locally

`vercel link` and `vercel pull` write into your working tree. All of it is
git-ignored and none of it belongs in a commit.

| Path | What it is |
|---|---|
| `.vercel/project.json` | The project link. Contains account-private ids — never commit, never print. |
| `.vercel/.env.<env>.local` | The linked project's environment values, downloaded. |
| `.vercel/output/` | Local build output. |
| `VERCEL_OIDC_TOKEN` in `.env.local` | Appended by the CLI for OIDC federation. **Orbit does not use it**, and no local build needs it. Safe to delete; never commit it. |

Update 4.0.4.1 removed one of these that had been added by a link to the wrong
project — see [vercel-link-incident.md](vercel-link-incident.md).

`VERCEL_URL` alone does **not** make a process look deployed — it can be echoed
into a local shell. `VERCEL=1` is required. Covered by
`test/vercel-environment.test.js`.

---

## Minimum set per environment

**Vercel Preview**

```
ORBIT_ENVIRONMENT=preview
SUPABASE_URL=https://<preview-project-ref>.supabase.co
SUPABASE_ANON_KEY=<preview anon key>
ORBIT_PREVIEW_PROJECT_REFS=<preview-project-ref>
```

**Vercel Production**

```
ORBIT_ENVIRONMENT=production
SUPABASE_URL=https://<production-project-ref>.supabase.co
SUPABASE_ANON_KEY=<production anon key>
```

**Local** — nothing required. `npm run dev:local` pins the local Supabase stack
from the tracked `supabase/config.toml`.

Templates with placeholders only: `.env.local.example`, `.env.preview.example`,
`.env.production.example`.
