# Orbit X design handoff (for a design collaborator or an image model)

Draft, 2026-11-09. This describes what exists in the Orbit X Instagram channel today, so a designer (or ChatGPT) can critique it or propose better art without reading code. Nothing here is published or live.

## What Orbit X posts

Carousels and single images for Instagram, drawn from real calculated astrology facts (Moon phase, planetary positions, retrogrades, a monthly reading). Voice is symbolic, never predictive. Every slide is vector SVG turned into a flat PNG: 1080 x 1350 (4:5, the default) and 1080 x 1080 (square). A profile grid shows the 3:4 crop, so keep important content inside the middle.

## The three families (all inactive until the owner switches them on)

| Family | Mood | Page | Ink | Accents (by kind of post) | Fonts |
|---|---|---|---|---|---|
| Living Atlas | Paper, astrolabe line art | #F6F1E7 | #182C39 | Moon yellow #F1C75B, transit cobalt #2859A6, retrograde terracotta #C65B43, method sage #6C8669, monthly rose #E8B5C0 | Fraunces, DM Sans |
| After Dark Observatory | Midnight star map | #101B29 | #F7F0DE | Moon amber #EBC95D, transit ice #9CC9DB, retrograde coral #F28C69, method mint #8FB89F, monthly orchid #D9B9E8 | Newsreader, Manrope |
| Cosmic Press | Two-ink risograph, halftone, registration offset | #FFF8E9 | #242020 | Moon ochre #D9A72E, transit blue #285D83, retrograde vermilion #C43D3B, method forest #53765A, monthly lilac #D9B5E8 | Newsreader, Space Grotesk |

Coordinates and labels use "Orbit Coord Mono" (a renamed IBM Plex Mono subset). All fonts are SIL OFL 1.1.

Colour means a kind of post. Do not recolour a kind.

## Cover layouts (three per family)

1. **Numeral:** the post's own date as a very large number.
2. **Diagram:** the zodiac wheel drawn from real ecliptic longitudes and real aspects (never invented).
3. **Type:** headline only.

## Depth assets (the 3D-looking art)

Moon sphere (with the real phase), Sun, Mercury, a ringed planet, an armillary sphere, cast shadows and a star scatter. They are vector, they export flat, and they are decoration except for the Moon's phase, the wheel and the date numeral, which are data.

Latest change: the Moon is now drawn like a real near side (maria in their true places, Tycho's rays, a crater field lit from the Sun's side, a ragged soft terminator, faint earthshine on the unlit part). Cosmic Press keeps a filter-free, flat-ink version.

## Hard rules

- Facts are calculated, never invented. A diagram with no data falls back to type.
- No gradients on pages or panels, no glass, glow, sparkle bursts, or one typeface everywhere. Gradients and filters exist only inside the marked assets and cast shadows.
- Contrast: 4.5:1 for body text, 3:1 for large text, checked at draw time.
- No em dashes in post copy.
- The channel never promises outcomes (no prediction, no medical, financial or legal advice).

## What to ask for

- A critique of the nine cover layouts and the three carousels in `images/`.
- Replacement or additional depth art (a more photographic Moon, a better ringed planet, a brass armillary) as a transparent PNG or SVG, with the licence stated. Keep the family palette. Art must stay recognisable at 360 px wide.
- Do not change the wheel geometry, the type scale, or the contrast rules.

## Files

- `images/overview.png`: the same three posts in each family.
- `images/<family>-covers.png`: three layouts by five kinds.
- `images/<family>-carousel-daily.png`, `-square.png`, and single full-size slides.
- `images/grid-preview.png` (and `grid-preview.html`): the profile grid.
- `images/moon-realism-study.png`: the Moon at eight phases (waxing and waning).

Regenerate the family images with `node scripts/orbit-x-sample-sheet.js`.
