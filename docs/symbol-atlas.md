# Symbol Atlas — the reference workspace

**Since Dev Update 1.12; content completed in Dev Update 3.1.** Orbit's
built-in astrology reference: seven categories, fifty complete entries, and a
deterministic combination layer — all authored and shipped entirely from the
repository. Dev Update 3.2 adds researcher material; it is not started, and
nothing in the interface promises it.

The content audit that scoped 3.1, including the per-entry matrix taken at
`4107ee9`, is in [`symbol-atlas-content-audit.md`](symbol-atlas-content-audit.md).

## Routes

```
#symbol-atlas                     home — search + categories
#symbol-atlas/<category>          category page (canonical order)
#symbol-atlas/<category>/<slug>   entry page
#symbol-atlas/combinations        combination index
#symbol-atlas/combinations/<type>/<slug>…   one combination
```

`combinations` is a reserved first segment rather than a category — it takes a
type and a variable number of slugs, and is parsed separately from the
two-segment category/entry form.

The flat hash router grants nested routes to exactly one workspace — the Atlas
(`currentWorkspace` in `public/app.js`). Unknown categories and entries render
the Atlas's own not-found states with the URL intact; `resolveLegacyRoute`
never redirects an Atlas sub-route to Home. Direct load, refresh, Back,
Forward, and copy-link all work because every card, crumb, and chip is a real
`<a href>`.

Category slugs: `planets`, `signs`, `houses`, `aspects`, `elements`,
`modalities`, `angles`. House slugs are `1st-house` … `12th-house`; angle slugs
are `ascendant`, `descendant`, `midheaven`, `imum-coeli`.

## Content architecture

```
public/symbol-atlas/
  categories.js            the seven shelves (order = display order)
  entries-planets.js       10 planets and luminaries
  entries-signs.js         12 signs (facts mirror lib/symbols.js, tested)
  entries-houses.js        12 houses (aliases: "first house", "house 1", …)
  entries-foundations.js   5 aspects, 4 elements, 3 modalities, 4 angles
  index.js                 assembly, lookups, related graph, validator
  search.js                deterministic search + ranking
  combinations.js          composed two-symbol explanations (3.1)
lib/symbol-atlas/index.js  server-side re-export (chart-identity.js pattern)
```

### The completion schema

Every entry carries all of these, and `validateAtlasContent` fails the gate on
any that is missing or too thin to be useful:

| Field | What it is |
| --- | --- |
| `summary` | one-sentence definition |
| `overview` | 2+ paragraphs, the at-a-glance block |
| `themes` | 3+ scannable labels |
| `everyday` | 2+ concrete ways it may show up |
| `constructive` | prose: what it looks like working well |
| `difficult` | prose: what it looks like under strain |
| `strengths` / `challenges` | 2+ each, as lists |
| `chartRole` | what it does in a chart |
| `whenEmphasized` | what a strong showing tends to describe |
| `whenScarce` | elements and modalities only — the other tail |
| `reflections` | 2–3 optional prompts, each a question |
| `advanced` | 1+ paragraph behind the disclosure |
| `facts` | structured key/value pairs |
| `keywords` (5+) / `aliases` (1+) | search surface |
| `related` | authored graph edges, all resolving |

Plus one composition clause per category — `role` (planets), `style` (signs),
`arena` (houses), `axisRole` (angles), `interaction` + `pairNote` (aspects).
These are lowercase fragments with no terminal full stop, because they are
dropped into sentences the combination layer writes; the validator enforces
both properties.

Reference `status` is `complete` as of 3.1, meaning the entry satisfies this
schema — not that the subject is exhausted. Nothing in the interface renders it.

Entries are frozen data, never markup — the validator refuses angle brackets,
and the renderer escapes everything. `id` (`category-slug`) and `status`
(`starter`) derive in the assembler so no author can mistype them. The
browser lazy-loads the module on first Atlas visit (~76 KB transferred, once);
app boot pays nothing, and no search or entry view ever makes a request.

The validator (`validateAtlasContent`) runs in the test gate and fails CI on:
duplicate ids/slugs, unresolvable related references, self-reference, missing
required fields, missing starter entries (checked by name), non-lowercase
aliases, angle brackets, and fatalistic language (`always`, `never`,
`guarantees`, `proves`, `destined`, `doomed`…). Two parity tests pin the Atlas
to the software beside it: sign facts must equal `lib/symbols.js`, and aspect
orb facts must state the engine's real numbers (8/8/6/6/4, +1 luminary).

## Combination explanations (Dev Update 3.1)

Orbit already showed combinations elsewhere — "Moon in Cancer" on My Chart,
"Mercury trine Jupiter" in the aspect list — as two links and no explanation of
the pairing. `combinations.js` composes the explanation from the canonical
entries themselves.

| Type | Route | Pages |
| --- | --- | --- |
| Planet in Sign | `combinations/planet-in-sign/moon/cancer` | 120 |
| Planet in House | `combinations/planet-in-house/saturn/4th-house` | 120 |
| Planet aspect Planet | `combinations/planet-aspect-planet/moon/square/saturn` | 225 |
| Planet with Angle | `combinations/planet-with-angle/sun/midheaven` | 40 |

**505 reachable pages, none of them authored.** Each is assembled at render
time from composition clauses already on the entries. Every fragment is used
exactly once per page, so nothing is restated in different words — restating a
claim in different words is how a composed page starts contradicting itself.

The boundaries each composer holds:

* **planet + sign** — function and *style*. A sign never supplies an area of life.
* **planet + house** — function and *area of life*. A house never supplies a style.
* **planet + aspect** — the relationship between two functions. The aspect's own
  `pairNote` carries the not-automatically-good argument in its own words, so
  five pages do not share one sentence.
* **planet + angle** — "close to", not "in". An angle is a calculated point and
  a planet does not occupy one.

Pairs normalise to canonical entry order before composing, so `moon/square/saturn`
and `saturn/square/moon` are one page rather than two that disagree about which
planet is named first.

Guarantees, all asserted in `test/symbol-atlas-combinations.test.js`:
deterministic (`validateCombinations()` walks all 505 and composes each twice),
no AI, no network, no `Math.random`, no `Date`, no storage. A missing building
block returns `null` and the route falls back to plain links to the canonical
entries — losing the explanation, keeping the navigation.

This is **not** a second astrology engine: nothing here reads a chart, computes
a position, or decides whether a combination applies. It explains two slugs
that some other part of Orbit has already established.

## Search ranking

Documented in `public/symbol-atlas/search.js` and enforced rank-by-rank in
`test/symbol-atlas-search.test.js`:

| Rank | Match | Example |
| --- | --- | --- |
| 0 | exact title | `moon` → Moon |
| 1 | exact alias | `MC` → Midheaven, `first house` → 1st House |
| 2 | title prefix | `sag` → Sagittarius |
| 3 | keyword or theme | `career` → Midheaven, 10th House |
| 4 | category term | `planets` → all ten |
| 5 | summary substring | `friction` → Square |
| 6 | chart-role substring | `birth time` → houses and angles |

Ties break by canonical category order, then authored entry order. Queries are
normalised (case, whitespace, punctuation, ordinal words: `first` ↔ `1st`) and
treated strictly as text. No fuzzy-search library, no network, no stored or
logged queries.

**Dev Update 3.1 widened the surface without renumbering it.** Themes joined
the keyword rank rather than taking one of their own — a theme and a keyword
are the same kind of thing, and separate ranks would assert that one is a
better match with no reason to believe it. Chart role was appended as rank 6,
the weakest signal, so ranks 0–5 kept their documented behaviour.

Two length floors keep the widened surface from becoming noise: a keyword
*prefix* needs three characters (an exact keyword still matches at any
length), and a chart-role substring needs five. Without the first, `AC`
prefix-matched *action*, *achievement*, *across*, and *activity* before it had
said anything; the four angle abbreviations now return exactly one result each.

Everyday vocabulary reaches the intended entry: `feelings`, `emotions`, `love`,
`conflict`, `money`, `identity`, `communication`, `public image`, `friendship`,
`career`, `hard aspect`, `soft aspect`. No alias was added that does not
describe the entry it points at.

## Simple and Advanced

Update 5.2 collapsed Orbit's detail toggle — one level, plain language first,
technical depth behind progressive disclosure. The Atlas follows that
convention: entry pages lead with the summary, themes, strengths, challenges,
and chart role, with an **Advanced** `<details>` section carrying methodology
notes and structured facts (rulerships, orbs, axes). Both read from one
canonical entry — there is no second copy to drift.

## Contextual links

Wherever Orbit already names a symbol, the name links to its entry:

| Surface | Links |
| --- | --- |
| My Chart | planets, signs, houses (reading cards); bodies + aspect (aspect cards); elements + modalities (balance bars) |
| Current Positions | planet name, sign |
| Today's Transits | transiting planet, natal planet, aspect (evidence table) |
| Compatibility | bodies + aspect, on a quiet "In the Atlas" line per factor |
| Atlas home | "From your chart": Sun/Moon/rising sign from the in-memory summary |

Rules (tested in `test/symbol-atlas-links.test.js`): an unknown name degrades
to plain text rather than minting a dead link; links never open a new tab,
never carry query data, and never touch chart activation, identity, or
compatibility scoring. Combined interpretations ("Moon in Cancer in the 4th
House") are deliberately not authored — contextual surfaces link the individual
canonical entries; combination content is Dev Update 3.1 territory.

## Boundaries

- **No AI** — no provider contacted, no generated content, no prompt storage.
- **No database or Storage involvement** — reference content is repository
  data; nothing about the Atlas touches Supabase, and exports are unchanged
  (schema 1.2.0).
- **Nothing you search or read is recorded** — a search query lives as long as
  the keystroke. The Atlas contacts no analytics service, stores no reading
  history, and keeps nothing in localStorage of its own.
  Since Dev Update 6.0 one first-party event, `atlas_opened`, records that the
  Atlas was opened — a name and a time, never an entry, a category, or a query.
  It is counted by Orbit's own server, and not at all for a reader whose
  browser sends Global Privacy Control or Do Not Track. See [[analytics.md]].
- **Methodology note** (shown on entries and Atlas home): *"Symbol Atlas
  provides authored astrological reference material. It describes common
  interpretive traditions and does not guarantee personality traits, events,
  or outcomes."*
