# Tarot correspondences: research notes

Status 2026-11-19. The research behind `lib/tarot/correspondences.js`. Erik asked
for the card-to-astrology mapping to be researched from sources rather than taken
as given, and for the data to go deep enough for a later LoRA to learn from.

## What the table holds

For all 78 cards:

| Layer | Cards | Source |
|---|---|---|
| Planet, sign or element | 22 trumps | Book T |
| Second attribution (Spirit, Earth) | Judgement, the World | Book T |
| Hebrew letter: glyph, value, name meaning, Sepher Yetzirah class | 22 trumps | Liber 777; Sepher Yetzirah |
| Path number 11–32, and the two Sephiroth it joins | 22 trumps | Liber 777 |
| Golden Dawn title ("The Magus of Power") | all 78 | Book T |
| Decan: sign, 10° span, ruling planet, modality | 36 small cards | Book T |
| The two Shem ha-Mephorash angels of the decan | 36 small cards | Book T |
| Sephirah (Chokmah … Malkuth) and its sphere | aces and small cards | Book T; Liber 777 |
| Letter of the Name and the Four Worlds | all minor cards | Book T; Liber 777 |
| Sub-element ("Water of Fire") and Book T rank | 16 courts | Book T |
| The heavens each court rules (20° of one sign to 20° of the next) | 12 courts | Book T |
| Throne of the ace | 4 pages | Book T |

None of this is a meaning. Meanings remain the owner-approved deck text.

## Sources

**Book T: The Tarot.** Golden Dawn Manuscripts N, O, P, Q, R, published by
Crowley in *The Equinox* I(7) and I(8), 1912. Public domain. Read from the
archive.org transcription "Book T – The Tarot". Its text was extracted from the
PDF and the tables parsed directly, not paraphrased by a summariser.

**Liber 777.** Crowley, 1909. Public domain in the US. Read from the archive.org
scan. Used for the "Path joins" column (which Sephiroth each path connects) and
the Four Worlds.

Secondary websites were used only to find the primary texts. Several of them
disagree with Book T on the court cards (below).

## Decisions and findings

### Court cards: the Knight is Fire, the King is Air

Book T's four court ranks are King (mounted on a steed, Fire, Yod), Queen
(throned, Water, Heh), Prince (in a chariot, Air, Vau) and Princess (standing,
Earth, Heh final). The transcription labels each with its Waite–Smith card:

- "The Lord of the Flame and the Lightning; the King of the Spirits of Fire" is
  the **Knight of Wands**, Fire of Fire.
- "The Prince of the Chariot of Fire" is the **King of Wands**, Air of Fire.
- "The Princess of the Shining Flame" is the **Knave (Page) of Wands**, Earth of Fire.

So in the Waite–Smith deck, which Orbit uses, the Knight is Fire and the King is
Air. Many modern websites say King = Fire. That is the Marseille habit, and
under the Golden Dawn system it is wrong for this deck. The table follows Book T.

### The decan chain starts at 0° Aries, though Book T's table starts at Leo

The rulers cycle in Chaldean order (Saturn, Jupiter, Mars, Sun, Venus, Mercury,
Moon) unbroken from Mars at 0° Aries to Mars at 20° Pisces. Thirty-six decans
cannot divide evenly by seven planets, so Mars rules two decans in a row across
the Pisces–Aries seam. Book T begins its table and its angels at 0° Leo with the
Five of Wands (Saturn). Book T doesn't say why in the passages used here, and
the reason doesn't change the chain. Both facts are tested.

### Angels

Book T sets the 72 angels of the Shem ha-Mephorash two to a decan, in order
from 0° Leo. The table keeps the Book T transliteration exactly as found (with
"a'a" for Ayin) beside a common English spelling. Three transliterations in this
transcription differ from the usual consonants. They are kept as found and noted
here rather than silently corrected:

| No. | Usual name | Transcription | Usual consonants |
|---|---|---|---|
| 14 | Mebahel | MNHAL | MBHAL |
| 40 | Ieiazel | YYVHL | YYZAL |
| 42 | Mikael | Ma'aKAL | MYKAL |

English spellings of these names vary widely between sources. The ones used
here are common, but not the only correct ones.

### Smaller transcription points

- The Ten of Wands reads "Malkuth of V". Every other Wands card reads "of Y",
  and the Wands are Yod throughout Book T, so the table derives the letter from
  the suit (Yod).
- The Princess of the Rushing Winds (Page of Swords) is printed as "Throne of the
  Ace of Wands". By the pattern of the other three Princesses, it should be the
  Ace of Swords. The table uses Swords.
- The Wheel's title is garbled in the transcription ("The Lord of the of Fate
  Forces of Life"). The standard reading, "The Lord of the Forces of Life", is
  used.
- The Fool's title is "The Spirit of Aethyr". The transcription renders the
  Greek *αἰθήρ* as a placeholder. The table spells it "Aether".

### Trumps

The Waite–Smith numbering already follows the Golden Dawn (Strength VIII = Leo,
Justice XI = Libra), so no swap is needed. Crowley's later Thoth swaps
(Tzaddi/Heh) are not used. The tests check every trump against the Sepher
Yetzirah: the three mother letters carry the three elements, the seven double
letters the seven planets, and the twelve simple letters the twelve signs in
zodiac order.

## What this enables

- `lib/tarot/scan-reading.js` states these facts beside the approved meaning,
  and links them to the engine's sky ("the Sun is in this card's decan today").
- The LoRA training export (step 3 of `docs/tarot-camera-plan.md`) can draw on
  the full table: letters, paths, Sephiroth, worlds, angels, titles and ranges.
  The model learns how Orbit states these facts, and the guard in
  `checkWovenText()` still refuses any output that adds a card or a forbidden
  claim.

## Not done yet

- The angels' traditional meanings, the Golden Dawn colour scales, and the
  Princesses' earthly quadrants are left out. They are in the same sources and
  can be added the same way if wanted.
- The engine doesn't run on Windows. The composer takes the sky as an argument,
  so its tests use a fixed snapshot. Real sky facts for training data will come
  from the engine on macOS, or on Linux (WSL on Erik's PC is available but not
  yet tried).
