// Orbit Axis :: Tarot correspondences — what each card is attached to in the
// Golden Dawn system: planet, sign, element, decan, Hebrew letter, path on the
// Tree of Life, Sephirah, title, and the angels of its decan.
//
// THESE ARE REFERENCE FACTS, NOT MEANINGS. A card's meaning is the owner-approved
// text in draft-deck.js. Nothing here says what a card means for a reader; it
// says what the tradition attaches the card to. The composer (scan-reading.js)
// may state these facts beside the approved meaning. It may not turn them into
// a meaning, and neither may a model.
//
// Sourcing. Every table below was checked against a primary source, not written
// from memory or from secondary websites:
//
//   book_t      "Book T — The Tarot" (Golden Dawn Manuscripts N–R), published by
//               Crowley in The Equinox I(7–8), 1912. Public domain. Gives the
//               decan of every small card and its title, its Sephirah and letter
//               of the Name, the two angels of each decan, the title, letter and
//               attribution of each trump, and the sub-element, title and zodiac
//               range of each court card.
//   liber_777   Crowley, Liber 777, 1909. Public domain in the US. Used for the
//               path numbers 11–32 and which two Sephiroth each path joins, and
//               for the Four Worlds. Read from an e-text of the later edition
//               and checked against a scan of the 1909 tables, which agree on
//               these columns (see lib/esoteric/liber777.js).
//   sepher_yetzirah  The three mother, seven double and twelve simple letters.
//               This is a structural fact the Golden Dawn attributions follow;
//               the tests check every trump against it.
//
// Research notes, including the court-card naming question and three angel
// spellings that differ in the transcription, are in
// docs/tarot-correspondences-research.md.
//
// Waite–Smith naming. The Waite–Smith deck keeps the old court names (Page,
// Knight, Queen, King) but follows the Golden Dawn attributions, and Book T
// itself labels its cards that way: its mounted "King" (Fire) is the KNIGHT,
// its "Prince" in the chariot (Air) is the KING, and its "Princess" (Earth) is
// the PAGE. So in this deck the Knight is Fire and the King is Air. Many modern
// websites print the reverse (King = Fire); that is the Marseille convention,
// not the one this deck was drawn under.

export const CORRESPONDENCES_VERSION = "1.0.0";

export const SOURCES = Object.freeze({
  book_t: Object.freeze({
    id: "book_t",
    title: "Book T — The Tarot (Golden Dawn Manuscripts N, O, P, Q, R)",
    published: "The Equinox, Vol. I, Nos. 7 and 8, 1912",
    license: "Public domain",
  }),
  liber_777: Object.freeze({
    id: "liber_777",
    title: "Liber 777",
    published: "Aleister Crowley, 1909",
    license: "Public domain (US)",
  }),
  sepher_yetzirah: Object.freeze({
    id: "sepher_yetzirah",
    title: "Sepher Yetzirah: the mother, double and simple letters",
    published: "Traditional text; structure as used by the Golden Dawn",
    license: "Public domain",
  }),
});

// ── Building blocks ──────────────────────────────────────────────────────────

/** Zodiac order from 0° Aries. Index × 30 is the sign's starting longitude. */
export const SIGN_ORDER = Object.freeze([
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
]);

export const SIGN_ELEMENT = Object.freeze({
  Aries: "Fire", Leo: "Fire", Sagittarius: "Fire",
  Taurus: "Earth", Virgo: "Earth", Capricorn: "Earth",
  Gemini: "Air", Libra: "Air", Aquarius: "Air",
  Cancer: "Water", Scorpio: "Water", Pisces: "Water",
});

export const SIGN_MODALITY = Object.freeze({
  Aries: "Cardinal", Cancer: "Cardinal", Libra: "Cardinal", Capricorn: "Cardinal",
  Taurus: "Fixed", Leo: "Fixed", Scorpio: "Fixed", Aquarius: "Fixed",
  Gemini: "Mutable", Virgo: "Mutable", Sagittarius: "Mutable", Pisces: "Mutable",
});

/** Chaldean order, slowest to fastest. The decan rulers cycle through it. */
export const CHALDEAN_ORDER = Object.freeze(["Saturn", "Jupiter", "Mars", "Sun", "Venus", "Mercury", "Moon"]);

export const SUIT_ELEMENT = Object.freeze({ wands: "Fire", cups: "Water", swords: "Air", pentacles: "Earth" });

/**
 * Each suit is one letter of the Name (YHVH) and one of the Four Worlds.
 * Letters: Book T ("Chokmah of Y", "Binah of H", ...). Worlds: Liber 777.
 */
export const SUIT_WORLD = Object.freeze({
  wands: Object.freeze({ letter_of_name: "Yod", world: "Atziluth", world_gloss: "the Archetypal World" }),
  cups: Object.freeze({ letter_of_name: "Heh", world: "Briah", world_gloss: "the Creative World" }),
  swords: Object.freeze({ letter_of_name: "Vau", world: "Yetzirah", world_gloss: "the Formative World" }),
  pentacles: Object.freeze({ letter_of_name: "Heh final", world: "Assiah", world_gloss: "the Material World" }),
});

/** The ten Sephiroth, with the sphere each is assigned in the Golden Dawn and in Liber 777. */
export const SEPHIROTH = Object.freeze([
  null,
  Object.freeze({ number: 1, name: "Kether", gloss: "the Crown", sphere: "Primum Mobile" }),
  Object.freeze({ number: 2, name: "Chokmah", gloss: "Wisdom", sphere: "the Zodiac" }),
  Object.freeze({ number: 3, name: "Binah", gloss: "Understanding", sphere: "Saturn" }),
  Object.freeze({ number: 4, name: "Chesed", gloss: "Mercy", sphere: "Jupiter" }),
  Object.freeze({ number: 5, name: "Geburah", gloss: "Severity", sphere: "Mars" }),
  Object.freeze({ number: 6, name: "Tiphareth", gloss: "Beauty", sphere: "the Sun" }),
  Object.freeze({ number: 7, name: "Netzach", gloss: "Victory", sphere: "Venus" }),
  Object.freeze({ number: 8, name: "Hod", gloss: "Splendour", sphere: "Mercury" }),
  Object.freeze({ number: 9, name: "Yesod", gloss: "Foundation", sphere: "the Moon" }),
  Object.freeze({ number: 10, name: "Malkuth", gloss: "the Kingdom", sphere: "the Elements" }),
]);

/**
 * The 22 letters. `kind` is the Sepher Yetzirah class: mother letters carry an
 * element, double letters a planet, simple letters a sign.
 */
export const HEBREW_LETTERS = Object.freeze(Object.fromEntries([
  ["aleph", "Aleph", "א", 1, "ox", "mother"],
  ["beth", "Beth", "ב", 2, "house", "double"],
  ["gimel", "Gimel", "ג", 3, "camel", "double"],
  ["daleth", "Daleth", "ד", 4, "door", "double"],
  ["heh", "Heh", "ה", 5, "window", "simple"],
  ["vav", "Vav", "ו", 6, "nail", "simple"],
  ["zayin", "Zayin", "ז", 7, "sword", "simple"],
  ["cheth", "Cheth", "ח", 8, "fence", "simple"],
  ["teth", "Teth", "ט", 9, "serpent", "simple"],
  ["yod", "Yod", "י", 10, "hand", "simple"],
  ["kaph", "Kaph", "כ", 20, "palm of the hand", "double"],
  ["lamed", "Lamed", "ל", 30, "ox-goad", "simple"],
  ["mem", "Mem", "מ", 40, "water", "mother"],
  ["nun", "Nun", "נ", 50, "fish", "simple"],
  ["samekh", "Samekh", "ס", 60, "prop", "simple"],
  ["ayin", "Ayin", "ע", 70, "eye", "simple"],
  ["peh", "Peh", "פ", 80, "mouth", "double"],
  ["tzaddi", "Tzaddi", "צ", 90, "fish-hook", "simple"],
  ["qoph", "Qoph", "ק", 100, "back of the head", "simple"],
  ["resh", "Resh", "ר", 200, "head", "double"],
  ["shin", "Shin", "ש", 300, "tooth", "mother"],
  ["tav", "Tav", "ת", 400, "mark", "double"],
].map(([id, name, glyph, value, meaning, kind]) => [id, Object.freeze({ id, name, glyph, value, meaning, kind })])));

// ── The 72 angels of the Shem ha-Mephorash ──────────────────────────────────
//
// Book T sets two angels over each decan, in order, starting at 0° Leo with the
// Five of Wands. `book_t` is the transliteration exactly as it appears in the
// transcription used ("a'a" stands for Ayin). Three differ from the usual
// spelling (14, 40, 42); see the research notes. `name` is the common English
// spelling. Lauviah appears twice (11 and 17), as it does in the tradition.

export const SHEM_ANGELS = Object.freeze([
  ["Vehuiah", "VHVYH"], ["Jeliel", "YLYAL"], ["Sitael", "SYTAL"], ["Elemiah", "a'aLMYH"],
  ["Mahasiah", "MHShYH"], ["Lelahel", "LLHAL"], ["Achaiah", "AKAYH"], ["Cahethel", "KHThAL"],
  ["Haziel", "HZYAL"], ["Aladiah", "ALDYH"], ["Lauviah", "LAVYH"], ["Hahaiah", "HHa'aYH"],
  ["Iezalel", "YZLAL"], ["Mebahel", "MNHAL"], ["Hariel", "HRYAL"], ["Hakamiah", "HQMYH"],
  ["Lauviah", "LAVYH"], ["Caliel", "KLYAL"], ["Leuviah", "LVVYH"], ["Pahaliah", "PHLYH"],
  ["Nelchael", "NLKAL"], ["Ieiaiel", "YYYAL"], ["Melahel", "MLHAL"], ["Haheuiah", "ChHVYH"],
  ["Nith-Haiah", "NThHYH"], ["Haaiah", "HAAYH"], ["Ierathel", "YRThAL"], ["Seheiah", "ShAHYH"],
  ["Reiiel", "RYYAL"], ["Omael", "AVMAL"], ["Lecabel", "LKBAL"], ["Vasariah", "VShRYH"],
  ["Iehuiah", "YChVYH"], ["Lehahiah", "LHChYH"], ["Chavakiah", "KVQYH"], ["Menadel", "MNDAL"],
  ["Aniel", "ANYAL"], ["Haamiah", "Cha'aMYH"], ["Rehael", "RHa'aAL"], ["Ieiazel", "YYVHL"],
  ["Hahahel", "HHHAL"], ["Mikael", "Ma'aKAL"], ["Veuliah", "VVLYH"], ["Ielahiah", "YLHYH"],
  ["Sealiah", "SALYH"], ["Ariel", "a'aRYAL"], ["Asaliah", "a'aShLYH"], ["Mihael", "MYHAL"],
  ["Vehuel", "VHVAL"], ["Daniel", "DNYAL"], ["Hahasiah", "HHShYH"], ["Imamiah", "a'aMMYH"],
  ["Nanael", "NNAAL"], ["Nithael", "NYThHL"], ["Mebahiah", "MBHYH"], ["Poiel", "PNYAL"],
  ["Nemamiah", "NMMYH"], ["Ieialel", "YYLAL"], ["Harahel", "HRChAL"], ["Mitzrael", "MTzRAL"],
  ["Umabel", "VMBAL"], ["Iahhel", "YHHAL"], ["Anauel", "a'aNVAL"], ["Mehiel", "MChYAL"],
  ["Damabiah", "DMBYH"], ["Manakel", "MNQAL"], ["Eiael", "AVa'aAL"], ["Habuhiah", "ChBVYH"],
  ["Rochel", "RAHAL"], ["Iabamiah", "YBMYH"], ["Haiaiel", "HYYAL"], ["Mumiah", "MVMYH"],
].map(([name, book_t], i) => Object.freeze({ number: i + 1, name, book_t })));

// ── Decans and the small cards ──────────────────────────────────────────────
//
// Book T table, in its own order (it starts at Leo). Each row: card, title,
// decan ruler, sign. The decan index within the sign follows from the card
// number: 2/5/8 first, 3/6/9 second, 4/7/10 third.

const BOOK_T_DECANS = [
  ["five-of-wands", "Strife", "Saturn", "Leo"],
  ["six-of-wands", "Victory", "Jupiter", "Leo"],
  ["seven-of-wands", "Valour", "Mars", "Leo"],
  ["eight-of-pentacles", "Prudence", "Sun", "Virgo"],
  ["nine-of-pentacles", "Material Gain", "Venus", "Virgo"],
  ["ten-of-pentacles", "Wealth", "Mercury", "Virgo"],
  ["two-of-swords", "Peace Restored", "Moon", "Libra"],
  ["three-of-swords", "Sorrow", "Saturn", "Libra"],
  ["four-of-swords", "Rest from Strife", "Jupiter", "Libra"],
  ["five-of-cups", "Loss in Pleasure", "Mars", "Scorpio"],
  ["six-of-cups", "Pleasure", "Sun", "Scorpio"],
  ["seven-of-cups", "Illusionary Success", "Venus", "Scorpio"],
  ["eight-of-wands", "Swiftness", "Mercury", "Sagittarius"],
  ["nine-of-wands", "Great Strength", "Moon", "Sagittarius"],
  ["ten-of-wands", "Oppression", "Saturn", "Sagittarius"],
  ["two-of-pentacles", "Harmonious Change", "Jupiter", "Capricorn"],
  ["three-of-pentacles", "Material Works", "Mars", "Capricorn"],
  ["four-of-pentacles", "Earthly Power", "Sun", "Capricorn"],
  ["five-of-swords", "Defeat", "Venus", "Aquarius"],
  ["six-of-swords", "Earned Success", "Mercury", "Aquarius"],
  ["seven-of-swords", "Unstable Effort", "Moon", "Aquarius"],
  ["eight-of-cups", "Abandoned Success", "Saturn", "Pisces"],
  ["nine-of-cups", "Material Happiness", "Jupiter", "Pisces"],
  ["ten-of-cups", "Perfected Success", "Mars", "Pisces"],
  ["two-of-wands", "Dominion", "Mars", "Aries"],
  ["three-of-wands", "Established Strength", "Sun", "Aries"],
  ["four-of-wands", "Perfected Work", "Venus", "Aries"],
  ["five-of-pentacles", "Material Trouble", "Mercury", "Taurus"],
  ["six-of-pentacles", "Material Success", "Moon", "Taurus"],
  ["seven-of-pentacles", "Success Unfulfilled", "Saturn", "Taurus"],
  ["eight-of-swords", "Shortened Force", "Jupiter", "Gemini"],
  ["nine-of-swords", "Despair and Cruelty", "Mars", "Gemini"],
  ["ten-of-swords", "Ruin", "Sun", "Gemini"],
  ["two-of-cups", "Love", "Venus", "Cancer"],
  ["three-of-cups", "Abundance", "Mercury", "Cancer"],
  ["four-of-cups", "Blended Pleasure", "Moon", "Cancer"],
];

const NUMBER_WORDS = ["", "ace", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function numberFromSlug(slug) {
  return NUMBER_WORDS.indexOf(slug.split("-of-")[0]);
}

const DECAN_ORDINALS = ["first", "second", "third"];

/** All 36 decans, ordered from 0° Aries. */
export const DECANS = Object.freeze(BOOK_T_DECANS.map(([slug, title, ruler, sign], bookIndex) => {
  const number = numberFromSlug(slug);
  const index = (number - 2) % 3; // 0, 1, 2
  const start = SIGN_ORDER.indexOf(sign) * 30 + index * 10;
  return Object.freeze({
    slug,
    sign,
    index,
    ordinal: DECAN_ORDINALS[index],
    start_longitude: start,
    end_longitude: start + 10,
    ruler,
    title: `The Lord of ${title}`,
    // Two angels per decan, in Book T order from 0° Leo.
    angels: Object.freeze([SHEM_ANGELS[bookIndex * 2], SHEM_ANGELS[bookIndex * 2 + 1]]),
  });
}).sort((a, b) => a.start_longitude - b.start_longitude));

// ── The 22 trumps ───────────────────────────────────────────────────────────
//
// Title, letter and attribution: Book T. Path number and the Sephiroth each
// path joins: Liber 777. Path = 11 + the letter's place in the alphabet.

const TRUMPS = [
  ["the-fool", "aleph", "The Spirit of Aether", ["element", "Air"], [1, 2]],
  ["the-magician", "beth", "The Magus of Power", ["planet", "Mercury"], [1, 3]],
  ["the-high-priestess", "gimel", "The Priestess of the Silver Star", ["planet", "Moon"], [1, 6]],
  ["the-empress", "daleth", "The Daughter of the Mighty Ones", ["planet", "Venus"], [2, 3]],
  ["the-emperor", "heh", "Sun of the Morning, Chief among the Mighty", ["sign", "Aries"], [2, 6]],
  ["the-hierophant", "vav", "The Magus of the Eternal", ["sign", "Taurus"], [2, 4]],
  ["the-lovers", "zayin", "The Children of the Voice; the Oracles of the Mighty Gods", ["sign", "Gemini"], [3, 6]],
  ["the-chariot", "cheth", "The Child of the Powers of the Waters; the Lord of the Triumph of Light", ["sign", "Cancer"], [3, 5]],
  ["strength", "teth", "The Daughter of the Flaming Sword", ["sign", "Leo"], [4, 5]],
  ["the-hermit", "yod", "The Magus of the Voice of Power; the Prophet of the Eternal", ["sign", "Virgo"], [4, 6]],
  ["wheel-of-fortune", "kaph", "The Lord of the Forces of Life", ["planet", "Jupiter"], [4, 7]],
  ["justice", "lamed", "The Daughter of the Lords of Truth; the Ruler of the Balance", ["sign", "Libra"], [5, 6]],
  ["the-hanged-one", "mem", "The Spirit of the Mighty Waters", ["element", "Water"], [5, 8]],
  ["death", "nun", "The Child of the Great Transformers; the Lord of the Gates of Death", ["sign", "Scorpio"], [6, 7]],
  ["temperance", "samekh", "The Daughter of the Reconcilers; the Bringer-Forth of Life", ["sign", "Sagittarius"], [6, 9]],
  ["the-devil", "ayin", "The Lord of the Gates of Matter; the Child of the Forces of Time", ["sign", "Capricorn"], [6, 8]],
  ["the-tower", "peh", "The Lord of the Hosts of the Mighty", ["planet", "Mars"], [7, 8]],
  ["the-star", "tzaddi", "The Daughter of the Firmament; the Dweller between the Waters", ["sign", "Aquarius"], [7, 9]],
  ["the-moon", "qoph", "The Ruler of Flux and Reflux; the Child of the Sons of the Mighty", ["sign", "Pisces"], [7, 10]],
  ["the-sun", "resh", "The Lord of the Fire of the World", ["planet", "Sun"], [8, 9]],
  ["judgement", "shin", "The Spirit of the Primal Fire", ["element", "Fire"], [8, 10]],
  ["the-world", "tav", "The Great One of the Night of Time", ["planet", "Saturn"], [9, 10]],
];

// Book T gives two of the trumps a second attribution: Judgement is "Spirit and
// Fire" and the Universe (the World) is "Earth and Saturn". Those are the
// fourth and fifth elements, which have no letter of their own.
const SECONDARY = { judgement: ["element", "Spirit"], "the-world": ["element", "Earth"] };

// ── Court cards ─────────────────────────────────────────────────────────────
//
// Book T: rank in the Name, sub-element, title, and the heavens each rules.
// Kings, Queens and Princes (here Knights, Queens and Kings) each rule from 20°
// of one sign to 20° of the next, three decans. Princesses (Pages) rule a
// quadrant around the North Pole and are the Thrones of the Aces.

const RANKS = {
  knight: { book_t_rank: "King", letter_of_name: "Yod", element: "Fire", figure: "mounted on a steed" },
  queen: { book_t_rank: "Queen", letter_of_name: "Heh", element: "Water", figure: "seated on a throne" },
  king: { book_t_rank: "Prince", letter_of_name: "Vau", element: "Air", figure: "borne in a chariot" },
  page: { book_t_rank: "Princess", letter_of_name: "Heh final", element: "Earth", figure: "standing" },
};

const COURTS = {
  "knight-of-wands": ["The Lord of the Flame and the Lightning; the King of the Spirits of Fire", "Scorpio"],
  "queen-of-wands": ["The Queen of the Thrones of Flame", "Pisces"],
  "king-of-wands": ["The Prince of the Chariot of Fire", "Cancer"],
  "page-of-wands": ["The Princess of the Shining Flame; the Rose of the Palace of Fire", null],
  "knight-of-cups": ["The Lord of the Waves and the Waters; the King of the Hosts of the Sea", "Aquarius"],
  "queen-of-cups": ["The Queen of the Thrones of the Waters", "Gemini"],
  "king-of-cups": ["The Prince of the Chariot of the Waters", "Libra"],
  "page-of-cups": ["The Princess of the Waters; the Lotus of the Palace of the Floods", null],
  "knight-of-swords": ["The Lord of the Winds and the Breezes; the King of the Spirits of Air", "Taurus"],
  "queen-of-swords": ["The Queen of the Thrones of Air", "Virgo"],
  "king-of-swords": ["The Prince of the Chariot of the Winds", "Capricorn"],
  "page-of-swords": ["The Princess of the Rushing Winds; the Lotus of the Palace of Air", null],
  "knight-of-pentacles": ["The Lord of the Wide and Fertile Land; the King of the Spirits of Earth", "Leo"],
  "queen-of-pentacles": ["The Queen of the Thrones of Earth", "Sagittarius"],
  "king-of-pentacles": ["The Prince of the Chariot of Earth", "Aries"],
  "page-of-pentacles": ["The Princess of the Echoing Hills; the Rose of the Palace of Earth", null],
};

const ACE_TITLES = {
  wands: "The Root of the Powers of Fire",
  cups: "The Root of the Powers of the Waters",
  swords: "The Root of the Powers of the Air",
  pentacles: "The Root of the Powers of the Earth",
};

// ── Assembly ────────────────────────────────────────────────────────────────

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function attribution([kind, name]) {
  return { kind, name };
}

function buildMajor([slug, letterId, title, attr, joins], index) {
  const path = 11 + index;
  const secondary = SECONDARY[slug];
  return {
    slug,
    arcana: "major",
    title,
    attribution: attribution(attr),
    secondary_attribution: secondary ? attribution(secondary) : null,
    hebrew_letter: HEBREW_LETTERS[letterId],
    path: { number: path, joins: joins.map((n) => SEPHIROTH[n]) },
    element: attr[0] === "element" ? attr[1] : attr[0] === "sign" ? SIGN_ELEMENT[attr[1]] : null,
    sources: ["book_t", "liber_777", "sepher_yetzirah"],
  };
}

function suitOf(slug) {
  return slug.split("-of-")[1];
}

function buildPip(decan) {
  const suit = suitOf(decan.slug);
  const number = numberFromSlug(decan.slug);
  return {
    slug: decan.slug,
    arcana: "minor",
    kind: "pip",
    suit,
    number,
    element: SUIT_ELEMENT[suit],
    title: decan.title,
    decan: {
      sign: decan.sign,
      ordinal: decan.ordinal,
      start_longitude: decan.start_longitude,
      end_longitude: decan.end_longitude,
      ruler: decan.ruler,
      modality: SIGN_MODALITY[decan.sign],
    },
    angels: decan.angels,
    sephirah: SEPHIROTH[number],
    ...SUIT_WORLD[suit],
    sources: ["book_t", "liber_777"],
  };
}

function buildAce(suit) {
  return {
    slug: `ace-of-${suit}`,
    arcana: "minor",
    kind: "ace",
    suit,
    number: 1,
    element: SUIT_ELEMENT[suit],
    title: ACE_TITLES[suit],
    sephirah: SEPHIROTH[1],
    throne: `page-of-${suit}`,
    heavens: "Revolves at the North Pole of the Universe; the Thrones of the Aces are the Princesses' quadrants",
    ...SUIT_WORLD[suit],
    sources: ["book_t", "liber_777"],
  };
}

function buildCourt(slug) {
  const rankId = slug.split("-of-")[0];
  const suit = suitOf(slug);
  const rank = RANKS[rankId];
  const [title, fromSign] = COURTS[slug];
  let rules;
  if (fromSign) {
    const start = SIGN_ORDER.indexOf(fromSign) * 30 + 20;
    const end = (start + 30) % 360;
    rules = {
      start_longitude: start,
      end_longitude: end,
      from: { sign: fromSign, degree: 20 },
      to: { sign: SIGN_ORDER[(SIGN_ORDER.indexOf(fromSign) + 1) % 12], degree: 20 },
      decans: DECANS.filter((d) => inArc(d.start_longitude, start, end)).map((d) => d.slug),
    };
  } else {
    rules = null;
  }
  return {
    slug,
    arcana: "minor",
    kind: "court",
    suit,
    element: SUIT_ELEMENT[suit],
    rank: rankId,
    book_t_rank: rank.book_t_rank,
    figure: rank.figure,
    letter_of_name: rank.letter_of_name,
    sub_element: { element: rank.element, of: SUIT_ELEMENT[suit], label: `${rank.element} of ${SUIT_ELEMENT[suit]}` },
    title,
    rules,
    throne_of: rankId === "page" ? `ace-of-${suit}` : null,
    heavens: rankId === "page" ? "One quadrant of the heavens around the North Pole of the ecliptic" : null,
    world: SUIT_WORLD[suit].world,
    sources: ["book_t", "liber_777"],
  };
}

/** True when `lon` lies in the arc [start, end), allowing the arc to wrap past 0°. */
function inArc(lon, start, end) {
  const l = normalise(lon);
  return start < end ? l >= start && l < end : l >= start || l < end;
}

function normalise(lon) {
  // Not ((lon % 360) + 360) % 360: that adds float error to longitudes that
  // were already in range (237.2 came back as 237.20000000000005).
  const l = lon % 360;
  return l < 0 ? l + 360 : l;
}

const SUITS = ["wands", "cups", "swords", "pentacles"];
const COURT_RANKS = ["page", "knight", "queen", "king"];

const ALL = [
  ...TRUMPS.map(buildMajor),
  ...SUITS.map(buildAce),
  ...DECANS.map(buildPip),
  ...SUITS.flatMap((s) => COURT_RANKS.map((r) => buildCourt(`${r}-of-${s}`))),
];

/** Every card's correspondences, keyed by slug. 78 entries. */
export const CORRESPONDENCES = deepFreeze(Object.fromEntries(ALL.map((c) => [c.slug, c])));

export const CORRESPONDENCE_SLUGS = Object.freeze(Object.keys(CORRESPONDENCES));

/** The correspondences for one card, or null for an unknown slug. */
export function correspondenceFor(slug) {
  return Object.hasOwn(CORRESPONDENCES, slug) ? CORRESPONDENCES[slug] : null;
}

/** Sign and whole degree for an ecliptic longitude. */
export function zodiacPosition(longitude) {
  if (!Number.isFinite(longitude)) return null;
  const lon = normalise(longitude);
  const sign = SIGN_ORDER[Math.floor(lon / 30)];
  return { sign, degree: Math.floor(lon % 30), longitude: lon };
}

/** The decan (and its small card) at a longitude. */
export function decanAt(longitude) {
  if (!Number.isFinite(longitude)) return null;
  const lon = normalise(longitude);
  return DECANS[Math.floor(lon / 10)];
}

/** The court card (Knight, Queen or King) whose heavens contain a longitude. */
export function courtAt(longitude) {
  if (!Number.isFinite(longitude)) return null;
  return ALL.find((c) => c.kind === "court" && c.rules && inArc(longitude, c.rules.start_longitude, c.rules.end_longitude)) ?? null;
}

/** True when a longitude falls inside a card's own stretch of the zodiac (pip decan, court range, or sign trump). */
export function longitudeTouchesCard(slug, longitude) {
  const c = correspondenceFor(slug);
  if (!c || !Number.isFinite(longitude)) return false;
  if (c.kind === "pip") return inArc(longitude, c.decan.start_longitude, c.decan.end_longitude);
  if (c.kind === "court" && c.rules) return inArc(longitude, c.rules.start_longitude, c.rules.end_longitude);
  if (c.arcana === "major" && c.attribution.kind === "sign") return zodiacPosition(longitude).sign === c.attribution.name;
  return false;
}
