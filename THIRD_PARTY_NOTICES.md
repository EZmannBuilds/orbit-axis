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

## OpenMoji

    Copyright (c) OpenMoji — the open-source emoji and icon project
    https://openmoji.org
    Licence: CC BY-SA 4.0

The twelve zodiac glyphs, adapted from the official black SVG collection
(`black/svg/2648.svg` through `black/svg/2653.svg`, retrieved 2026-08-20). Used
in Orbit X templates, the generated standalone zodiac SVGs, and the reference
sheet.

**Two obligations that no other component on this list carries.**

CC BY-SA 4.0 requires *attribution wherever the work appears*, which a file in a
repository does not satisfy on its own for software served over a network — so
the credit is also published on `/source`, where a reader can actually reach it.

It is also *share-alike*, and that travels. Orbit's glyphs are adaptations, so
the adaptations are themselves CC BY-SA 4.0. **This survives a relicence of
Orbit Axis.** If the project ever leaves the AGPL — by buying a Swiss Ephemeris
Professional Licence, for instance — these glyphs do not come with it. They stay
CC BY-SA, or they get replaced.

The adaptation: the square emoji container is removed, the artwork from
OpenMoji's `line-supplement` group is kept, the 72×72 source canvas is cropped to
its 48×48 symbol field, and stroke colour and display size follow Orbit's
templates. Unmodified upstream files are preserved beside them in
`public/brand/zodiac/openmoji-source/`, with the licence text, so the adaptation
can always be compared against its source.

Required credit, verbatim:

> All emojis designed by OpenMoji – the open-source emoji and icon project.
> License: CC BY-SA 4.0

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
