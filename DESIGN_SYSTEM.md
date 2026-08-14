# Orbit Axis Design System

Orbit Axis is built on Apple's marketing-surface design language: a
near-invisible interface wrapped around the one thing worth looking at. Here that
thing is your reading, not a product render — but the rules are the same, and
they are not negotiable one screen at a time.

Every screen should answer three questions instantly: **Where am I? What matters
most? What should I do next?**

---

## The five rules

**1. One accent.** Every "you can act on this" signal is Orbit Violet and nothing
else. There is no second brand colour, no zodiac palette, no sign colours.
Meaning comes from words; colour only says *this is interactive*.

**2. Elevation is a surface change, not a shadow.** Sections separate because the
canvas under them changes tone. The system has exactly **one** drop shadow
(`--shadow-object`) and it belongs to the chart wheel and the Moon — objects
resting on a surface, not interface. Cards, buttons, tiles, and rows never take
it.

**3. Type carries the hierarchy.** Display sizes are weight 600 with negative
tracking. Body is **17px, not 16px** — the extra pixel is the difference between
reading and scanning.

**4. The weight ladder is 300 / 400 / 600 / 700.** Weight 500 is deliberately
absent; mid-emphasis is 600. Having both makes every decision a coin-flip that
drifts.

**5. Radius is a grammar.** Pill = action. 18px = card. 8px = compact utility.
Nothing in between.

**A night-sky product.** Apple's own surfaces are light-dominant; Orbit Axis
defaults to dark, because it is an app about the night sky and most people open
it in the evening. That changes the palette, not the system: same single accent
(in its on-dark variant), same tile alternation, same type ladder, same one
shadow. Both themes are complete, and neither is a filter over the other.

---

## File layout

```
public/
├── index.html            # App shell + workspace panels (semantic markup only)
├── app.js                # Router, data loading, renderers, search
├── icons.js              # GENERATED — Phosphor path data (see below)
└── styles/
    ├── tokens.css        # ① Design tokens — the single source of truth
    ├── base.css          # ② Reset, the type ladder, a11y, motion
    ├── components.css    # ③ Reusable UI primitives (the `o-` library)
    ├── app.css           # ④ App shell: rail, frosted sub-nav, workspace
    ├── navigation.css    # ⑤ Navigation STATE (what the rail says)
    └── …                 # ⑥ Per-surface: orbit-axis, fortune, more, atlas, …
```

Load order matters. Nothing below the token layer hardcodes a colour, size,
radius, or duration.

### Icons

Phosphor (MIT), inlined at build time into `public/icons.js` — **no icon font, no
CDN, no third-party request to draw the app's own navigation.**

```bash
node scripts/build-icons.js [path-to-phosphor-icons]
```

The output is committed, so a clone that never runs the script still builds. The
manifest in the script lists every icon the interface draws and **nothing else** —
`test/design-system.test.js` fails if an icon ships that no surface uses, and
fails if a surface asks for one that does not exist (which would otherwise render
as silent blank space).

Markup declares icons with `data-icon="trash"`; `hydrateIcons()` paints them.
Navigation ships **both weights**: outline for the destinations you are not on,
solid for the one you are.

**Astrological glyphs** (♈ ☉ ☿) are not icons — they are Unicode, and several have
emoji presentations that Apple platforms prefer. Three defences, because each is
ignored somewhere: the `--font-glyph` symbol-first stack, `font-variant-emoji:
text`, and a U+FE0E appended by `textGlyph()`.

---

## Tokens (`styles/tokens.css`)

| Group | Notes |
| --- | --- |
| **Accent** | **Orbit Violet**, one hue at 254°: `--violet-action` #4a28b8 (light, 9.2:1 on white) · `--violet-sky` #a185ff (dark, 7.3:1 on black). A single hex cannot serve both themes — #4a28b8 is 2.3:1 on the dark canvas. On dark the filled button takes `--violet-ink` #16082b rather than white, because a pale fill cannot carry white text. |
| **Ink / Paper** | Apple's near-black `#1d1d1f` and the parchment `#f5f5f7`. |
| **Void** | `#000` canvas with `#272729/#2a2a2c/#252527` tiles — micro-steps apart, so two dark sections separate without a border. |
| **Type** | `--type-hero` 56 → `--type-display` 40 → `--type-section` 34 → `--type-lead` 28 → `--type-tagline` 21 → `--type-body` **17** → `--type-caption` 14 → `--type-fine` 12 → `--type-micro` 10, each with its own tracking and leading. |
| **Radius** | 0 / 5 / 8 / 11 / 18 / 26 / pill. |
| **Spacing** | 4 / 8 / 12 / **17** / 24 / 32 / 48 / 80. The 17px step matches the body size, which keeps text-adjacent padding optically aligned. |
| **Elevation** | `--shadow-object` — the only shadow. `--blur-frosted` for sticky chrome. |
| **Motion** | `--duration-*`, `--ease-*`, and `--press-scale: 0.95` — the system-wide press, on every button. |

A **compatibility alias layer** at the end of the file maps the pre-redesign token
names (and the bare `--accent`, `--border`, `--surface-2` names some stylesheets
were written against with hardcoded fallbacks) onto the system. It is a migration
surface, not an API — new rules use the names above.

### Themes & modes (attributes on `<html>`)

| Attribute | Values | Effect |
| --- | --- | --- |
| `data-theme` | `dark` (default) / `light` | Full semantic palette swap. |
| `data-density` | `comfortable` / `compact` | Remaps `--density-*` + control height. |
| `data-text` | `default` / `large` | Scales the rem base. |
| `data-contrast` | `normal` / `high` | Strengthens hairlines first — they are what disappears first. |
| `data-motion` | `full` / `reduced` | Kills looping animation. |

All five persist to `localStorage` (`orbit.*`) and live in **Appearance**.

---

## Component library (`styles/components.css`)

Two button grammars, and they mean different things:

- A **pill** is an action. Primary violet fill, or a bordered ghost.
- An **8px rect** is utility. Refresh, sign out, close — chrome that operates the
  app rather than advancing the reading.

Nothing lives between them, which is what lets a screen be read at a glance.

| Component | Class | Purpose |
| --- | --- | --- |
| Button | `.o-btn` (`--primary`, `--secondary`, `--ghost`, `--utility`, `--danger`, `--large`, `--sm`, `--block`) | Actions |
| Icon button | `.o-icon-btn` (`--chip` over imagery) | Toolbar |
| Input / Select | `.o-input`, `.o-select`, `.o-field`, `.o-label` | Forms |
| Search | `.o-search` | Pill input with a leading icon |
| Badge / Pill | `.o-badge`, `.o-pill` (`--success/warning/error/accent`) | Labels, status |
| Card | `.o-card` (`--elevated`, `--flush`, `--quiet`, `--interactive`) | Container |
| **Grouped list** | `.o-group`, `.o-row` (`--link`, `--danger`) | **The inset list — how the app presents "a set of things you can open"** |
| Metric tile | `.o-tile` | Value + eyebrow + glyph |
| Section head | `.o-section-head`, `.o-card-head` | Titles + actions |
| Tabs / Segmented | `.o-tabs`, `.o-segment` (`--block`) | In-view switching |
| Table / Timeline | `.o-table`, `.o-timeline` | Data, dated events |
| Progress | `.o-progress`, `.o-ring` | Linear + radial |
| Expandable | `.o-expand` | Disclosure |
| Action bar | `.o-actionbar` | Frosted, bottom-anchored primary action |
| Dialog | `.o-modal`, `.o-overlay`, `.o-dialog` | Modals |
| Object | `.o-object` | Takes the one shadow |
| Skeleton / Spinner / Empty / Toast | `.o-skel`, `.o-spinner`, `.o-empty`, `.o-toast` | States |

Type helpers live in `base.css`: `.u-hero`, `.u-display`, `.u-section`,
`.u-title`, `.u-lead`, `.u-heading`, `.u-card-title`, `.u-body`, `.u-caption`,
`.u-meta`, `.u-fine`, `.u-eyebrow`, `.u-dense-link`, plus `.u-mono`, `.u-strong`,
`.u-muted`, `.u-tnum`.

---

## Navigation — five destinations

```
Today · Chart · Sky · Atlas · You
```

Defined once in `WORKSPACES` (`app.js`) and rendered into one container. The
desktop sidebar and the phone tab bar are **the same DOM in different CSS** — two
sets of markup are two places for the order and the labels to drift. The
structural switch is 1024px.

| Destination | Contents |
| --- | --- |
| **Today** | The week strip · your reading · the Moon · sky highlights · Technical Sky |
| **Chart** | Your natal reading (8 sections) · saved charts · Compatibility |
| **Sky** | Your transits ⇄ Everyone's sky (segmented) · upcoming events |
| **Atlas** | The reference library — 7 categories, ~50 entries |
| **You** | Account · readings · appearance · your data · legal · deletion |

Secondary destinations (`positions`, `compatibility`, `history`, `settings`)
declare a `tab:` so they light the primary destination they belong to — arriving
somewhere and being told you are nowhere is worse than not having a tab.

**Why these five.** Two of the previous five tabs were directories: *Tools* was
four links to pages that exist elsewhere, and *More* was a settings drawer —
while the Atlas, the deepest finished feature in the app, sat two taps down. Tools
was dissolved into the surfaces its links pointed at, Positions joined Transits
under Sky, and the Atlas took the freed tab. Nothing was deleted; `#tools`
redirects with a sentence naming where each thing went.

### Search

One field in the sub-nav over the three things people actually look for: a page,
one of their saved charts, and a symbol they did not recognise. Everything it
searches is **already in the browser** — a constant, `state`, and the Atlas
content module — so there is no request, no spinner, no failure mode, and nothing
typed leaves the device. Full keyboard support (↑ ↓ Enter Escape).

### The week strip

Seven days ending today, across the top of Today, built from your own reading
history and nothing else. A day you have a reading for is a **button** that opens
it; a day you do not is inert and says so, because a control that opens nothing
reads as a bug. There is no tomorrow: Orbit Axis calculates today's sky, so
offering a future day would offer something it cannot deliver.

---

## Accessibility

- Skip link; `:focus-visible` ring on every interactive element.
- The rail is a list of real links with `aria-current="page"` — plus a weight
  change **and** the solid icon weight, so the current tab never rests on colour.
- Search is a labelled `combobox`/`listbox` with `aria-activedescendant`.
- 44px minimum touch target; modal actions stay 44px even in compact density.
- `prefers-reduced-motion`, `prefers-contrast`, and `prefers-color-scheme` are all
  honoured, each with an explicit in-app override.
- `forced-colors` rules wherever meaning was carried by a tint.

**Not claimed:** none of this is screen-reader-tested. Automated coverage and
assistive-technology evidence are different things.

---

## Validating

```bash
npm run lint && npm test && npm run build
```

`test/design-system.test.js` pins the three guarantees that fail silently: every
icon resolves, one accent survives, and the week strip never shows a day it
cannot open. Then boot it — the tests read source and cannot click anything:

```bash
npm run dev:local
```

Check both themes, 375px and 1280px, keyboard navigation, and the console.
