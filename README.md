# Orbit — Astro Signal Observatory

A small, self-contained astrology app and JSON API. Orbit shows today's sky
(sun season, moon phase, Mercury status, symbol of the day), an interactive
zodiac wheel, birth-date → sign lookup, compatibility geometry, and a symbol
atlas. Everything is **symbolic reflection for creative and brand work — never
prediction, medical, financial, or relationship advice.**

- **Zero runtime dependencies.** Pure Node.js standard library (`http`, `fs`).
- **Full-stack in one process.** The server serves both the JSON API and the
  static frontend from `public/`.
- **Optional local LLM.** Orbit supports local [Ollama](https://ollama.com)
  only. If Ollama is unavailable, the app keeps running and uses deterministic
  fallbacks. Anthropic and external astrology APIs are not required.
- **Controlled vault intelligence.** The local model can summarize approved
  project/business notes and propose vault edits, but every write requires a
  preview, approval, backup, and audit log.

## Requirements

- **Node.js 18+** to run the server.
- (Optional) [Ollama](https://ollama.com) running locally. The validated model is
  `qwen3:14b`; install it with `ollama pull qwen3:14b`.

## Setup

```bash
# No dependencies to install — but this validates package.json / lockfile.
npm install
```

## Run

```bash
# Local development, pinned to the local Supabase stack (recommended).
supabase start          # starts the local database (Docker)
npm run env:check       # confirms which database Orbit would use
npm run dev:local       # → Orbit astrology app listening at http://localhost:3001

# Zero-config start. Refuses to run if configuration points at the hosted
# production database, and tells you what to run instead.
npm start
```

Orbit refuses to start when the environment and the configured database
disagree — for example local development pointed at the hosted production
project. See [`docs/environment-safety.md`](docs/environment-safety.md).

Then open <http://localhost:3001> in a browser.

Other ways to run:

```bash
npm run dev            # auto-restart on file changes (node --watch)
node server.js 8080    # port as the first CLI argument
PORT=8080 node server.js
```

## Configuration (optional)

Orbit runs with **no configuration**. To override defaults, copy the example
file and edit it:

```bash
cp .env.example .env.local
```

Orbit's local configuration module loads `.env.local` before it initializes the
Ollama provider. Start the app normally:

```bash
npm start
```

| Variable            | Default                   | Purpose                                             |
| ------------------- | ------------------------- | --------------------------------------------------- |
| `PORT`              | `3001`                    | HTTP port the server listens on.                    |
| `ORBIT_LOCAL_LLM_ENABLED` | `true` | Enables local LLM features; app still runs when Ollama is down. |
| `ORBIT_LOCAL_LLM_PROVIDER` | `ollama` | Only supported LLM provider. |
| `ORBIT_OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Local Ollama endpoint. |
| `ORBIT_LOCAL_MODEL` | first installed model | Optional model name. No model is downloaded automatically. |
| `ORBIT_LOCAL_LLM_CONTEXT_LENGTH` | `8192` | Ollama context window for project intelligence. |
| `ORBIT_LOCAL_LLM_TEMPERATURE` | `0.2` | Conservative structured-generation temperature. |
| `ORBIT_LOCAL_LLM_TIMEOUT_MS` | `180000` | Local generation timeout. |
| `ORBIT_LOCAL_EMBEDDING_MODEL` | unset | Optional local embedding model. Keyword retrieval works without it. |
| `ORBIT_VAULT_PATH` | `../Orbit vault` | Canonical Obsidian vault path. |
| `ORBIT_ENVIRONMENT` | `local` | `local`, `test`, `preview`, or `production`. Drives the safety guards. |
| `ORBIT_PREVIEW_PROJECT_REFS` | unset | Comma-separated hosted project refs explicitly approved as disposable previews. |

**No secrets or API keys are required.** Never commit `.env` or `.env.local`
(both are gitignored).

## API

All responses are JSON and include a `disclaimer` field where relevant.

| Method | Endpoint                          | Description                              |
| ------ | --------------------------------- | ---------------------------------------- |
| GET    | `/api/health`                     | Liveness check.                          |
| GET    | `/api/chart/now` (`/api/chart`)   | Current sky snapshot.                     |
| GET    | `/api/stella/daily`               | Daily symbolic brief.                    |
| POST   | `/api/stella/chat`                | **Deprecated.** Chat-style reflection (`{ "prompt": "" }`); returns a Sun-sign `harmony_score`. |
| GET    | `/api/symbols`                    | Full symbol knowledge base.             |
| GET    | `/api/sign-for-date?month=&day=`  | Zodiac sign for a date.                 |
| GET    | `/api/compatibility?a=&b=`        | **Deprecated.** Sun-sign distance only — see [legacy note](docs/deployment/legacy-sun-sign-endpoints.md). Use `/api/compatibility/compare`. |
| GET    | `/api/events?count=`              | Upcoming sky events.                    |
| POST   | `/api/query`                      | **Deprecated.** Free-text query (`{ "prompt": "" }`); returns a Sun-sign `harmony_score`. |
| GET    | `/api/chakra`, `/api/chakra/:id`  | Chakra reference data.                  |
| POST   | `/api/ask`                        | Ask Orbit: evidence-grounded astrology answer (auth). |
| GET    | `/api/ask/suggestions`            | Empty-state context + adaptive suggestions (auth). |
| GET    | `/api/compatibility/options`      | Which saved charts can be compared (auth). |
| GET    | `/api/compatibility/compare?a=&b=`| Full-chart compatibility between two saved charts, read for their relationship type (auth). |
| GET    | `/api/ask/conversations`          | List / start Ask Orbit conversations (auth). |
| GET    | `/api/local-llm/status`           | Local Ollama status.                    |
| GET    | `/api/local-llm/models`           | Installed Ollama models.                |
| POST   | `/api/local-llm/generate`         | Grounded local project answer.          |
| GET    | `/api/vault/project-notes`        | Approved project-note retrieval.        |
| POST   | `/api/vault/edit-proposals`       | Create a preview-only vault proposal.   |

Quick check:

```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/chart/now
```

## Tests

Run the built-in checks:

```bash
npm run lint
npm run test:local     # tests pinned to the local database
npm test               # same suite; refuses if configured for production
```

Useful local intelligence commands:

```bash
npm run orbit:llm:status
npm run orbit:llm:models
npm run orbit:llm:test
npm run orbit:vault:search -- "Orbit Axis roadmap"
npm run orbit:vault:propose -- --type app_update --title "Local LLM Integration"
npm run orbit:vault:proposals
```

`orbit:llm:test` is a strict real-model check: it rejects fallback output. The
Local Intelligence panel always labels whether content came from the selected
Ollama model or deterministic retrieval. Vault changes remain proposals until
reviewed, approved, hash-checked, backed up, and applied. See
[`docs/local-llm.md`](docs/local-llm.md) and
[`docs/vault-editing.md`](docs/vault-editing.md).

## Deployment

Orbit is **prepared for** a Vercel Preview Deployment and has never been
deployed. Check the current state at any time:

```bash
npm run deploy:check   # read-only; reports BLOCKER / WARNING / INFORMATIONAL
```

It contacts nothing, prints no secret, and exits non-zero when a real blocker
exists. Known open blockers include an unpushed branch, no approved Preview
Supabase project, the unapplied hosted Ask Orbit migration, and the Swiss
Ephemeris binary being built for macOS/arm64 rather than the Linux x86-64 that
Vercel Functions run on.

Documentation:

- [`docs/deployment/vercel.md`](docs/deployment/vercel.md) — architecture, exact
  dashboard settings, troubleshooting, rollback
- [`docs/deployment/environment-variables.md`](docs/deployment/environment-variables.md) — every variable, where it belongs
- [`docs/deployment/preview-environment.md`](docs/deployment/preview-environment.md) — blockers, security checklist, Preview setup
- [`docs/deployment/hosted-supabase-migration.md`](docs/deployment/hosted-supabase-migration.md) — the pending migration
- [`docs/deployment/auth-redirects.md`](docs/deployment/auth-redirects.md) — Supabase URL configuration

## Project layout

```
orbit/
├── server.js          # Local entry point: creates an http server and listens
├── api/index.js       # Vercel entry point: exports the same handler
├── vercel.json        # Static from public/, /api/* to one Node Function
├── package.json
├── lib/
│   ├── server/        # create-app.js — every route; binds nothing, calls nothing
│   ├── env/           # Environment + database-target resolver and guards
│   ├── symbols.js     # Knowledge base + deterministic query algorithms
│   ├── sky.js         # Sun season / moon phase / Mercury / events math
│   ├── llm.js         # Optional local Ollama symbolic fallback
│   ├── local-llm/     # Ollama provider, vault retrieval, proposal workflow
│   └── ask-orbit/     # Ask Orbit: deterministic context engine + history
│                       #   docs/ask-orbit.md · docs/ask-orbit-local-setup.md
└── public/            # Static frontend (vanilla JS, no build step)
    ├── index.html     # App shell + workspace panels
    ├── app.js         # Router, data loading, renderers, command palette
    └── styles/        # Orbit Design System
        ├── tokens.css     # Design tokens (colors, type, spacing, motion…)
        ├── base.css       # Reset, typography helpers, accessibility
        ├── components.css # Reusable UI primitives (o-* component library)
        └── app.css        # App shell layout + app-specific views
```

The frontend is built on the **Orbit Design System** — a token-driven set of
reusable UI primitives with dark/light themes, density/contrast/motion/text
modes, a workspace navigation model, and a ⌘K command palette. See
[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) for the full component reference.

## License

**AGPL-3.0-or-later.** See `LICENSE` for the full text and `NOTICE` for
attribution.

Orbit Axis calculates with Swiss Ephemeris (Astrodienst AG), which is
dual-licensed under the AGPL or a paid Professional License. Orbit Axis has
selected the AGPL-3.0 option, and both the application and engine are
distributed as AGPL-3.0-or-later.

Because Orbit Axis is offered over a network, AGPL section 13 entitles anyone who
uses it remotely to its complete corresponding source. `/api/v1/source` and the
`/source` page exist to satisfy that. See `SOURCE.md`.

Both source repositories are public:

- <https://github.com/EZmannBuilds/orbit-axis>
- <https://github.com/EZmannBuilds/orbit-axis-engine>

The selected route and decision date are recorded in
`docs/deployment/swiss-ephemeris-licensing.md`. That record is factual project
documentation, not legal advice or a compliance certification.
