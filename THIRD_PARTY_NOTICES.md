# Third-party notices

Orbit Axis runs on deliberately few dependencies. Everything bundled or executed
is listed here.

## Swiss Ephemeris

    Copyright (C) 1997-2021 Astrodienst AG, Switzerland
    https://www.astro.com/swisseph/
    Licence: AGPL-3.0 (dual-licensed; Orbit Axis uses the AGPL option)

Provides the astronomical positions every chart is calculated from. Executed as a
native binary with bundled `.se1` ephemeris data. Sends nothing anywhere — it
reads local data files and returns positions.

Its AGPL option is the reason Orbit Axis is AGPL. See `NOTICE`.

## Luxon

    Copyright (c) 2019 JS Foundation and other contributors
    https://github.com/moment/luxon
    Licence: MIT

Date, time, and IANA time-zone handling. Used to resolve the UTC offset that
applied at a given place on a given date, which is why Orbit requires a time-zone
name rather than a raw offset.

## tz-lookup

    https://github.com/darkskyapp/tz-lookup
    Licence: MIT

Maps coordinates to an IANA time-zone name, so a birthplace chosen on a map
yields the correct historical offset.

## Phosphor Icons

    Copyright (c) 2020-2024 Phosphor Icons
    https://phosphoricons.com
    Licence: MIT

Every icon in the interface. Not a runtime dependency: `scripts/build-icons.js`
inlines the path data for the ~60 icons Orbit Axis actually draws into the
committed `public/icons.js`, so the app ships no icon font, loads no CDN, and
makes no third-party request to render its own navigation.

## Orbit Axis Engine

    Copyright (C) 2026 EZmannBuilds
    Licence: AGPL-3.0-or-later

The deterministic calculation engine, maintained in its own repository and
vendored here for reproducible builds. Its own `THIRD_PARTY_NOTICES.md` covers
what it depends on.

## Services

These are used over the network rather than bundled, and their own terms apply:

| Service | Role |
| --- | --- |
| Supabase | Accounts, authentication, database |
| Vercel | Hosting |
| Geoapify | Birthplace geocoding |

## Development-only

**Ollama** may be used locally for optional language-model wording during
development. It is not a production dependency, is never contacted by a deployed
instance, and no reading served to a user passes through it.
