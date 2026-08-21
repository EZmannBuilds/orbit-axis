# Obtaining the source

Orbit Axis is licensed under the **GNU Affero General Public License, version 3
or later**. Because it is offered over a network, AGPL section 13 entitles every
user who interacts with it remotely to its complete corresponding source code.

## How the running instance tells you

Any deployed Orbit Axis reports its own licence and source availability:

```
GET /api/v1/source     licence, versions, repository status
GET /api/v1/version    application, engine, contract, ephemeris versions
/source                the same, as a page
```

Those read live from the deployment, so they describe the code actually running
rather than a number written into a document.

## Repositories

| Component | Contents | Public repository |
| --- | --- | --- |
| Orbit Axis | Application: interface, API, readings, accounts | <https://github.com/EZmannBuilds/orbit-axis> |
| Orbit Axis Engine | Deterministic astrology calculation engine | <https://github.com/EZmannBuilds/orbit-axis-engine> |

Both repositories are public and distributed as `AGPL-3.0-or-later`. The
checked-in URLs above are also the defaults used by `/source`,
`/api/v1/source`, and `/api/legal/config`.

Validated overrides are available if either repository moves:

```
ORBIT_SOURCE_APP_URL      https URL on a known code host
ORBIT_SOURCE_ENGINE_URL   https URL on a known code host
```

Anything else — HTTP, an unknown host, or a malformed URL — is rejected. An
unvalidated URL here would be a destination Orbit Axis vouches for.

## Corresponding source

The corresponding source for a deployed instance is the commit it was built
from, together with:

- the vendored Orbit Axis Engine at `vendor/orbit-axis-engine`
- the Swiss Ephemeris binary and `.se1` data that engine executes
- `vercel.json`, which determines how the function is packaged

Configuration values — database URLs, API keys — are not part of the
corresponding source and are never published.

## Building it yourself

```bash
npm ci
npm run build
npm run test:local
```

No bundler, no transpiler, no build step that rewrites the code you read. What
is in the repository is what runs, which is the property that makes the AGPL
meaningful in practice rather than only formally.

See `CONTRIBUTING.md` for the full development setup.
