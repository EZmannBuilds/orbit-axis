# Changelog

All notable changes to Orbit Axis Engine are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Before 1.0.0, minor versions may contain breaking changes. The response
`contractVersion` is versioned separately and independently.

## [0.3.0] — 2026-08-13

### Added

- **Chiron and Lilith.** Returned under a new `points` object on
  `positionsAtUT`, `currentSky`, and `computeNatalChart` (with `point_houses`),
  never inside `planets` — `planets` feeds aspects, element balance, and
  `skySnapshotHash`, so adding bodies there would have silently changed every
  existing chart and every daily-fortune seed. Lilith is offered as both the
  mean apogee (`Lilith`) and the osculating one (`TrueLilith`); they disagree
  by degrees and charts in the wild are drawn with either. The required
  `seas_18.se1` was already bundled and verified by `runtime:check`.
- `zoneOffsetMinutes(ianaZone, localParts)` — the UTC offset a zone was on at a
  local wall-clock time, historical daylight-saving rules included, via Node's
  built-in ICU. No new dependency and no bundled tzdata to go stale.
- `POINTS` constant; declarations and README entries for all of the above.

### Changed

- **`personalTransits` now reaches the outer planets, Chiron, the nodes, and
  the angles.** Both scope lists previously stopped at Saturn, which made a
  Pluto conjunction to the Sun, anything touching the Ascendant, and any
  contact with the nodes not merely absent but uncomputable. Scope is now a
  fourth argument (`{ bodies, targets }`) so callers can narrow or widen it;
  Lilith is available as a target but excluded by default, since which apogee a
  chart means is the caller's decision. The parity suite pins the previous
  scope explicitly — parity is a claim about the numbers being identical, not a
  freeze on which bodies the engine will look at.
- **`computeNatalChart` uses `timezone_name`.** It was previously accepted and
  hashed but never reached the calculation, so callers had to supply
  `utc_offset_at_birth` and get the daylight-saving history right themselves —
  the most common way a chart comes out subtly wrong, since a one-hour error
  moves every angle by ~15° and nothing in the output looks broken. An explicit
  offset still takes precedence, so no existing chart moves. Supplying neither
  now adds a `utc_offset_assumed` warning instead of silently reading the birth
  time as UT.

## [0.2.1] — 2026-08-13

### Changed

- Playground redesigned to a Meta-commerce-style design language: white
  canvas, Optimistic VF type ramp (with system fallbacks), pill buttons
  (black primary, outlined secondary), hairline-bordered cards at 16/32px
  rounding, ink-deep promo strip and upcoming-events card, cobalt reserved
  for links, focus, and data encoding (meters, wheel aspect lines, transit
  markers). Engine API unchanged.

## [0.2.0] — 2026-08-13

### Added

- `nextStations(date?, { bodies, horizonDays })` — the next retrograde or
  direct station per planet, located by bisecting real ephemeris speed
  sign-changes, sorted chronologically. Default horizon 800 days (covers the
  longest inter-station wait, Mars).
- `nextIngresses(date?, { bodies, horizonDays })` — the next sign ingress per
  body within the horizon (default 400 days); a retrograde body re-entering
  the previous sign counts. Slow outer planets beyond the horizon are omitted
  rather than guessed.
- `STATION_BODIES`, `INGRESS_BODIES`, `UPCOMING_EVENTS_VERSION` constants;
  TypeScript declarations and README rows for all of the above.
- Playground: natal chart wheel (SVG — zodiac band, house cusps, natal
  planets, tight-orb aspect lines, transit markers on the rim), an
  "Upcoming — stations & ingresses" card, and a `/api/upcoming` endpoint.

### Fixed

- Playground: element/modality balance meters rendered zero-width fills;
  oversized request bodies now get a 400 instead of a dropped connection.

## [0.1.1] — 2026-08-13

### Added

- `README` API section documenting the public surface.
- TypeScript declarations (`src/index.d.ts`), wired through `types` and the
  `exports` map.
- `npm run ui` — a zero-dependency local playground (`ui/`) serving current
  sky, moon phase, natal chart, transits, and lunar events on
  `http://localhost:4747`. Localhost only; nothing is stored or sent anywhere.

### Fixed

- `moonPhase` now accepts a single instant (`moonPhase(date)`, defaulting to
  now) and derives both longitudes from the ephemeris. Previously a lone Date
  fell through the two-longitude arithmetic and returned NaN elongation and
  illumination (serialised as `null`) with `waxing` stuck `false`.
- `moonPhase` throws a `TypeError` with `code: "invalid_input"` on an invalid
  instant or non-finite longitudes instead of returning NaN-poisoned flags,
  matching the `nextLunarEvents` convention.
- `currentSky` validates its instant up front: an invalid date now throws
  `TypeError` `code: "invalid_input"` naming `currentSky`, instead of leaking
  the adapter's "Birth year must be a whole number". ISO-string instants are
  accepted, matching `moonPhase` and `nextLunarEvents`.

## [0.1.0] — 2026-07-20

Initial extraction from the Orbit Axis application (Update 5.0).

### Added

- Deterministic natal chart calculation: planetary positions, houses, angles,
  aspects, retrograde state, element and modality balance, chart ruler.
- Current sky snapshot with lunar phase, illumination, retrogrades, and a
  stable coarse snapshot hash suitable for seeding daily readings.
- Personal transits from moving bodies to fixed natal bodies, with orb and
  applying/separating classification derived from the transiting body's speed.
- Swiss Ephemeris adapter with per-platform runtime resolution, checksum
  verification, hardened subprocess execution, and structured errors.
- `contractVersion` v1 metadata block on calculations.
- `npm run runtime:check` — offline verification of platform, manifest,
  checksums, ephemeris data, and a smoke calculation.
- Parity suite proving the extracted engine matches the pre-extraction
  implementation exactly.

### Platforms

- `darwin-arm64` (development), `linux-x64` (deployment, statically linked).
- Verified on both. Unsupported platforms fail with a named error rather than
  falling back to a binary built for another operating system.

### Ephemeris

- Swiss Ephemeris 2.10.03, built from official source
  (`github.com/aloistr/swisseph`, tag `v2.10.03`, commit `175e1fc`).
- macOS ↔ Linux parity: maximum longitude difference 0.0° across 440 compared
  values.

### Licence

- AGPL-3.0-or-later, inherited from the Swiss Ephemeris free licensing option.

### Not included

- No persistence, no user accounts, no network access, no AI provider.
- Synastry is not yet extracted; it remains in the application.
