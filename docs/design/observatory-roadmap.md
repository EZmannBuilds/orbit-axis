# Celestial Editorial Observatory — redesign roadmap

Direction approved by Erik on 2026-11-19, from three concepts (Observatory,
Astral Editorial, Neo-Astrolabe). Core principle: let the celestial content be
the interface; stop putting everything inside a box. Branch: `ui/observatory`.

Constraints for every phase: no change to auth, billing, data handling,
licensing, or astronomy calculations; every astronomical visual uses real
engine output (Swiss Ephemeris), and any example is labelled as one; keep
contrast, 44px touch targets, reduced motion, and mobile performance.

## Phase 1 — design system, navigation, first pass on Today / Sky (done)

- `public/styles/observatory.css`, loaded last; dark theme only.
- Self-hosted OFL fonts: Newsreader (display), Hanken Grotesk (text),
  IBM Plex Mono (sky data). Notices in `THIRD_PARTY_NOTICES.md`.
- Cards, `axis-card` and `fortune-card` lose their boxes inside the workspace;
  sections are separated by space and a short gold rule.
- Today: the real Moon render becomes the hero, bleeding off the right edge;
  phase in large serif; illumination in mono.
- Segmented controls and Chart's sub-nav become underline tabs.
- Floating frosted-glass dock with a lit active edge; workspace bottom padding
  and scroll-padding clear it.

## Phase 2 — Chart

- Large interactive zodiac wheel as the focal point, drawn from engine output.
- Signed-out state: today's real sky on the wheel, labelled "Example · today's
  sky, not your birth chart" (as in the concept board).
- Placements, houses and aspects as glyph-led open rows connected to the wheel
  (tap a row → highlight on the wheel).

## Phase 3 — Sky

- Orbital display of today's planets by ecliptic longitude above the timeline,
  linked to it (tap an event → highlight the bodies involved).
- Remove the remaining card head; timeline nodes use drawn icons, not emoji.

## Phase 4 — Atlas and Tarot

- Atlas as an illustrated encyclopedia: large glyphs, open catalogue rows,
  rich entry pages; keep search first-class.
- Tarot: card art as the focal point, subtle flip, composed reading layout.
  Inspect the real Tarot view first (the review screenshot duplicated Today).

## Phase 5 — You, History, Settings, empty states; desktop pass

- Native-feeling grouped lists with dividers, no per-item cards.
- Intentional empty states.
- Desktop/tablet layouts for every screen; light-theme counterpart.
