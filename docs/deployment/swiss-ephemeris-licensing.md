# Swiss Ephemeris licensing — AGPL-3.0 route selected

**Status: selected and recorded on 2026-08-21.**

This is a factual repository decision record. It is not legal advice and does
not claim legal compliance, attorney review, or legal certification.

## Decision

**Decision: Swiss Ephemeris AGPL-3.0 route selected for Orbit Axis. Orbit Axis
will remain distributed under AGPL-compatible terms and provide a
corresponding-source path to network users. No Swiss Ephemeris Professional
License is currently used or claimed.**

Orbit Axis uses Swiss Ephemeris **2.10.03** by Astrodienst AG from the upstream
`v2.10.03` tag (commit `175e1fc`). Swiss Ephemeris is dual-licensed. Orbit Axis
uses the AGPL option (AGPL-3.0); it does not operate under the paid Swiss Ephemeris
Professional License.

The application and calculation engine are each distributed as
`AGPL-3.0-or-later`:

- Orbit Axis: [`LICENSE`](../../LICENSE) and the root `package.json`
- Orbit Axis Engine: `vendor/orbit-axis-engine/LICENSE` and the engine
  repository's `package.json`

Both source repositories are public:

- Orbit Axis: <https://github.com/EZmannBuilds/orbit-axis>
- Orbit Axis Engine: <https://github.com/EZmannBuilds/orbit-axis-engine>

## Source and notice paths

The hosted application exposes the corresponding-source path in both human-
and machine-readable forms:

- `public/source.html`, served at `/source` and `/source.html`, links both
  public repositories and reads running version information from the API.
- `GET /api/v1/source` reports the application and engine licenses, versions,
  public repository URLs, and the Swiss Ephemeris notice and selected option.
- `GET /api/v1/version` reports the running application, engine, API contract,
  and Swiss Ephemeris versions.
- `SOURCE.md` describes how users obtain and build the source.
- `NOTICE` and `THIRD_PARTY_NOTICES.md` preserve the AGPL and Swiss Ephemeris
  attribution notices, including Astrodienst's copyright.

The canonical Swiss Ephemeris runtime record is
`vendor/orbit-axis-engine/src/adapters/swiss-ephemeris/manifest.json`. The older
path `lib/astro/runtime/manifest.json` is not present on current `main`; the
runtime moved into the vendored Orbit Axis Engine. Its existing
`source.licenceStatus` field records the selected AGPL posture and decision
date. Checksums and provenance in that manifest are supply-chain records, not
legal certification.

`npm run deploy:check` includes a narrow, offline consistency check for the
AGPL license texts, source links, source page, upstream notices, and manifest
status. It is explicitly a regression check, not a legal review or compliance
certificate.

## Professional License

A future Swiss Ephemeris Professional License would be a separate business
decision. If Orbit Axis later takes that route, record the license reference,
scope, and effective date separately and update this record, the runtime
manifest, the source page, and the source API together. Until then, the recorded
and implemented route is AGPL-3.0.
