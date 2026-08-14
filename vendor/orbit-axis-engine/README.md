# Orbit Axis Engine

Deterministic astrology calculation engine. Natal charts, houses, aspects,
retrogrades, lunar phase, and transits — computed locally with Swiss Ephemeris,
with no network call and no dependencies.

Extracted from the [Orbit Axis](https://github.com/EZmannBuilds/orbit)
application so that the calculations can be inspected, tested, and reused
independently of the app that presents them.

**Licence: AGPL-3.0-or-later.** See [Licensing](#licensing) — this is not
optional, and it is inherited from Swiss Ephemeris.

---

## What it does

```js
import { computeNatalChart, currentSky, personalTransits, buildMetadata } from "@ezmannbuilds/orbit-axis-engine";

const chart = computeNatalChart({
  birth_date: "1990-06-15",
  birth_time: "14:30",
  time_accuracy: "exact",
  latitude: 41.8781,
  longitude: -87.6298,
  utc_offset_at_birth: "-05:00",
  house_system: "placidus",
});

chart.planets.Sun.longitude;      // 84.4280202
chart.angles.ascendant.sign;      // "Libra"
chart.houses.length;              // 12

const sky = currentSky(new Date());
const transits = personalTransits(sky, chart, 3);
// [{ transiting: "Mercury", natal: "Jupiter", aspect: "conjunction",
//    orb: 0.9, applying: true, ... }]
```

Every response can carry a metadata block so a stored reading stays
reproducible:

```js
buildMetadata({ houseSystem: "placidus", timezone: "America/Chicago" });
// { engineVersion: "0.1.0", contractVersion: "v1",
//   ephemerisProvider: "swiss-ephemeris", ephemerisVersion: "2.10.03",
//   zodiacType: "tropical", calculatedAt: "..." }
```

## What it deliberately does not do

This is the boundary that makes the engine worth extracting:

- **No users.** It has no concept of an account, and no Supabase.
- **No persistence.** It computes and returns; storage is the caller's job.
- **No AI.** It never asks a language model for a fact. Interpretation layers
  may *explain* the evidence it produces; they may not add to it.
- **No birth-data logging.** Diagnostics record the failure, never the input.
- **No silent fallbacks.** An unsupported platform, a missing binary, or
  malformed output raises a named error rather than returning a plausible-looking
  chart.

The application owns identity, storage, and wording. The engine owns the
numbers. There is exactly one place the numbers come from.

## Install

```bash
npm install github:EZmannBuilds/orbit-axis-engine#v0.1.0
```

Pin to a tag or commit. Do not depend on a moving branch in production.

No build step. No dependencies. Node 22.x.

## API

TypeScript declarations ship with the package (`src/index.d.ts`). The main
surface, all importable from the package root:

```js
import {
  computeNatalChart, currentSky, moonPhase, nextLunarEvents,
  personalTransits, computeSynastryAspects, engineHealth,
} from "@ezmannbuilds/orbit-axis-engine";
```

| Export | Signature | Returns |
|---|---|---|
| `computeNatalChart` | `(input)` — `birth_date` "YYYY-MM-DD", `birth_time` "HH:MM", `time_accuracy`, `latitude`, `longitude`, `utc_offset_at_birth` "-05:00", `house_system` | planets, houses, angles, aspects, big three, element/modality balance |
| `currentSky` | `(date?)` — Date, ISO string, or epoch ms; defaults to now | sky snapshot: sun, moon + phase, retrogrades, tight aspects, `snapshot_hash` |
| `moonPhase` | `(date?)` **or** `(sunLon, moonLon)` | `{ elongation, phase_name, waxing, waning, illumination_percent }` |
| `nextLunarEvents` | `(date?)` | next full-moon and new-moon instants (ephemeris crossings, UTC) |
| `nextStations` | `(date?, { bodies, horizonDays })` | next retrograde/direct station per planet, sorted by time |
| `nextIngresses` | `(date?, { bodies, horizonDays })` | next sign ingress per body within the horizon (slow planets omitted when beyond it) |
| `personalTransits` | `(sky, chart, orbLimit = 3, scope?)` | transits from moving bodies to natal bodies, tightest first; reaches the outer planets, Chiron, the nodes, and the angles |
| `zoneOffsetMinutes` | `(ianaZone, { year, month, day, hour, minute })` | the UTC offset that zone was on at that local time, daylight saving included |
| `computeSynastryAspects` | `(chartA, chartB)` | inter-chart aspects; summarise with `summariseSynastry` |
| `engineHealth` | `()` | `{ ok, runtime, detail }` — run at startup, refuse to serve on failure |

Calls that take an instant accept anything `new Date(value)` accepts — which
means a **lone number is epoch milliseconds**, never a longitude. Invalid
instants and non-finite longitudes throw `TypeError` with
`code: "invalid_input"` instead of returning NaN-shaped output.

**Birth time zones.** Give `computeNatalChart` a `timezone_name`
(`"America/Chicago"`) rather than a hand-written `utc_offset_at_birth`: the
engine resolves the historical daylight-saving rules for that date itself. A
one-hour offset error moves every angle by ~15° and produces a chart that looks
entirely plausible. An explicit offset still wins where both are given, and
supplying neither adds a `utc_offset_assumed` warning rather than quietly
reading the birth time as UT.

**Chiron and Lilith** are returned under `points`, never inside `planets` —
`planets` feeds aspects, element balance, and the sky snapshot hash, so folding
new bodies in would silently change existing charts and daily-fortune seeds.
Lilith is offered both ways (`Lilith` is the mean apogee, `TrueLilith` the
osculating one); they differ by degrees, and charts in the wild use either.

Lower-level exports (raw ephemeris access, runtime diagnostics, hashing,
version constants) are documented in the declaration file.

## Try it locally

```bash
npm run ui
```

Serves a dependency-free playground at `http://localhost:4747` — current sky,
moon phase, natal chart form, transits, and lunar events, all computed by this
engine on your machine. Nothing leaves localhost.

## Supported platforms

| Runtime | Linkage | Purpose |
|---|---|---|
| `darwin-arm64` | dynamic | Local development on Apple Silicon |
| `linux-x64` | **static** | Deployment (Vercel functions, containers, CI) |

The Linux build is statically linked, so it does not depend on the host's glibc
version — verified running on busybox, which ships no glibc at all.

`darwin-x64` and `linux-arm64` are recorded as unsupported rather than shipped
untested. Ask if you need one.

```bash
npm run runtime:check     # platform, checksums, data files, smoke calculation
```

## Accuracy and parity

Swiss Ephemeris **2.10.03**, built from official Astrodienst source.

The macOS and Linux builds were compared across 440 values: maximum longitude
difference **0.0°** (bit-identical); speed differs by 1e-7 °/day in the last
printed digit only. Signs, degrees, retrograde states, house cusps, angles,
lunar phase, and transit applying/separating classification are identical.

The parity fixture in `tests/fixtures/` was generated from the Orbit Axis
application *before* extraction, so the suite proves the engine is a faithful
replacement and not merely self-consistent.

```bash
npm test
```

Test tolerances are far tighter than the observed difference and must not be
widened to make a failing test pass — real drift means the binaries, data
files, or flags genuinely differ, which is a bug to find.

## Licensing

Swiss Ephemeris is dual-licensed by Astrodienst: **AGPL** or a paid
**Professional License**. This project uses the AGPL option.

Astrodienst's licence text states that choosing the AGPL carries "the
obligation to place his or her whole software project under the AGPL or a
compatible license". That is why this engine — and the Orbit Axis application
that consumes it — are AGPL-3.0-or-later rather than something more permissive.

The AGPL also requires that users of a **network service** be offered the
corresponding source. See [SOURCE.md](SOURCE.md).

If you would rather not accept those terms, buy a Swiss Ephemeris Professional
License from Astrodienst and use the engine under whatever terms that permits —
but note this repository's own code remains AGPL.

> This is a plain-language summary of published licence terms, not legal advice.

## Not a prediction system

The engine computes astronomical positions accurately. It does not predict
events. Astrological interpretation is symbolic and is not a statement of fact.
Nothing here is medical, legal, financial, or psychological advice.

## Documentation

- [SOURCE.md](SOURCE.md) — source availability, build and modification
- [NOTICE](NOTICE) — copyright and Swiss Ephemeris attribution
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) — bundled components
- [SECURITY.md](SECURITY.md) — reporting a vulnerability
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to work on this
- [CHANGELOG.md](CHANGELOG.md) — version history
