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

## resvg-js

    https://github.com/yisibl/resvg-js
    Licence: MPL-2.0

Server-side SVG rendering for the Orbit X automatic channel (Dev Update 6.1):
turns the same slide SVG the desk exports into a PNG without a browser. Used
unmodified as an npm dependency, with its prebuilt native binary for the
deployment platform. MPL-2.0 is file-level copyleft and compatible with
Orbit's AGPL; Orbit makes no changes to its files.

## jpeg-js

    Copyright (c) 2014, Eugene Ware
    https://github.com/jpeg-js/jpeg-js
    Licence: BSD-3-Clause

Pure-JavaScript JPEG encoding for the Orbit X channel. Instagram's publishing
API accepts JPEG only, so each slide is encoded once more from the same pixels.

## Arimo and Gelasio (fonts)

    Copyright 2026 The Arimo Project Authors (https://github.com/googlefonts/arimo)
    Copyright 2022 The Gelasio Project Authors (https://github.com/SorkinType/Gelasio)
    Licence: SIL Open Font License 1.1

Bundled in `lib/orbit-x/fonts/` so the server can draw the slides' text; a
serverless function has no system fonts. Metric-compatible with Arial and
Georgia, the faces the templates are fitted for. Instanced to static weights
and subset to Latin from the upstream variable fonts; neither family declares
a Reserved Font Name. The full licences travel beside the files
(`OFL-Arimo.txt`, `OFL-Gelasio.txt`).

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
| Anthropic | Orbit X copy drafting (optional; server-only key) |
| Meta (Instagram Content Publishing API) | Orbit X automatic channel publishing (off by default) |

## Development-only

**Ollama** may be used locally for optional language-model wording during
development. It is not a production dependency, is never contacted by a deployed
instance, and no reading served to a user passes through it.
