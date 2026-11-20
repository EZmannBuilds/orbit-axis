// Orbit Axis :: source rows to hand a model, instead of asking it to remember.
//
// The first LoRA run showed what the plan warned about: a small model asked to
// recall a table answers fluently and wrongly (54% of facts recalled, 43%
// invented, on held-out questions). So in study mode the model is never the
// source of truth. The app looks up the relevant rows here, puts them in the
// prompt, and the model explains and phrases them. Same tables, same tests.
//
// Each function returns a row: { source, label, lines: [...] }, rendered with
// renderRows(). Unknown keys return null rather than a guess.

import { CORRESPONDENCES, DECANS } from "../tarot/correspondences.js";
import { suitRelation } from "../tarot/dignities.js";
import { DIGNITY_TABLE } from "./lilly.js";
import { BEHENIAN_STARS, LUNAR_MANSIONS, decanImage } from "./agrippa.js";
import { liber777Row } from "./liber777.js";
import { yetzirahLetter } from "./yetzirah.js";
import { lenainAngel } from "./lenain.js";

const SOURCE_NAMES = {
  book_t: "Book T (Golden Dawn, The Equinox, 1912)",
  lilly: "Lilly, Christian Astrology (1647)",
  agrippa: "Agrippa, Three Books of Occult Philosophy (1651 English)",
  liber_777: "Liber 777 (1909)",
  westcott: "Westcott, Sepher Yetzirah (1893), modern supplement",
  lenain: "Lenain, La Science cabalistique (1823)",
};

const SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
/** 125 → "5° Leo"; an end at a sign boundary reads "30° Leo", not "0° Virgo". */
function place(lon, isEnd = false) {
  const l = ((lon % 360) + 360) % 360;
  const deg = l % 30;
  if (isEnd && deg === 0) return `30° ${SIGNS[(Math.floor(l / 30) + 11) % 12]}`;
  return `${deg}° ${SIGNS[Math.floor(l / 30)]}`;
}

const row = (source, label, lines) => ({ source, source_name: SOURCE_NAMES[source], label, lines: lines.filter(Boolean) });

export function cardRow(slug, name = slug) {
  const c = CORRESPONDENCES[slug];
  if (!c) return null;
  if (c.arcana === "major") {
    const l = c.hebrew_letter;
    return row("book_t", name, [
      `title: ${c.title}`,
      `attribution: ${c.attribution.kind} ${c.attribution.name}${c.secondary_attribution ? `; also ${c.secondary_attribution.name}` : ""}`,
      `letter: ${l.name} (${l.glyph}), "${l.meaning}", value ${l.value}, ${l.kind} letter`,
      `path: ${c.path.number}, joining ${c.path.joins[0].name} and ${c.path.joins[1].name}`,
    ]);
  }
  if (c.kind === "ace") {
    return row("book_t", name, [`title: ${c.title}`, `element: ${c.element}`, `sephirah: Kether`, `world: ${c.world} (${c.world_gloss})`, `throne: the Page of its suit`]);
  }
  if (c.kind === "pip") {
    return row("book_t", name, [
      `title: ${c.title}`,
      `decan: ${c.decan.ordinal} decan of ${c.decan.sign}, ${c.decan.start_longitude % 30}° to ${(c.decan.start_longitude % 30) + 10}°`,
      `decan ruler: ${c.decan.ruler}`,
      `sephirah: ${c.sephirah.name} (${c.sephirah.gloss})`,
      `world: ${c.world} (${c.world_gloss}), letter of the Name ${c.letter_of_name}`,
      `angels of the decan: ${c.angels[0].name} (no. ${c.angels[0].number}) and ${c.angels[1].name} (no. ${c.angels[1].number})`,
    ]);
  }
  return row("book_t", name, [
    `title: ${c.title}`,
    `Book T rank: ${c.book_t_rank}, ${c.figure}, the ${c.letter_of_name} of the Name`,
    `sub-element: ${c.sub_element.label}`,
    c.rules ? `rules: 20° ${c.rules.from.sign} to 20° ${c.rules.to.sign}` : `rules: a quadrant around the North Pole; throne of the Ace of its suit`,
  ]);
}

export function decanRow(sign, index, nameOf = (s) => s) {
  const d = DECANS.find((x) => x.sign === sign && x.index === index);
  if (!d) return null;
  return row("book_t", `${d.ordinal} decan of ${sign}`, [
    `span: ${d.start_longitude % 30}° to ${(d.start_longitude % 30) + 10}° ${sign}`,
    `ruler: ${d.ruler}`, `card: ${nameOf(d.slug)}`, `title: ${d.title}`,
  ]);
}

export function suitPairRow(a, b) {
  const rel = suitRelation(a, b);
  if (!rel) return null;
  return row("book_t", `${a} and ${b}`, [
    `relation: ${rel === "unstated" ? "not stated in Book T" : rel}`,
    "rule: same suit beside a card strengthens it; an opposite (inimical) nature weakens it; a card between two contraries is not much affected",
  ]);
}

export function lillyRow(sign) {
  const r = DIGNITY_TABLE[sign];
  if (!r) return null;
  const node = (p) => p.replace("North Node", "the Dragon's Head").replace("South Node", "the Dragon's Tail");
  return row("lilly", sign, [
    `house of: ${r.domicile}`,
    `exaltation: ${r.exaltation ? `${node(r.exaltation.planet)} at ${r.exaltation.degree}°` : "none"}`,
    `triplicity: ${r.triplicity.day} by day, ${r.triplicity.night} by night`,
    `terms: ${r.terms.map((t) => `${t.planet} to ${t.to_degree}°`).join(", ")}`,
    `faces: ${r.faces.join(", ")}`,
    `detriment: ${r.detriment}`,
    `fall: ${r.fall ? node(r.fall) : "none"}`,
  ]);
}

export function agrippaDecanRow(sign, face) {
  const d = decanImage(sign, face);
  if (!d) return null;
  return row("agrippa", `face ${face} of ${sign}`, [`image: ${d.image}`, d.virtue && `virtue: ${d.virtue}`]);
}

export function mansionRow(number) {
  const m = LUNAR_MANSIONS[number - 1];
  if (!m) return null;
  return row("agrippa", `mansion ${number} of the Moon`, [`name: ${m.name}`, `starts: ${m.starts}`, `effects: ${m.effects}`]);
}

export function starRow(name) {
  const s = BEHENIAN_STARS.find((x) => x.name === name);
  if (!s) return null;
  return row("agrippa", s.name, [`nature of: ${s.nature_of.join(" and ")}`, `stone: ${s.stone}`, `herb: ${s.herb}`]);
}

export function liber777KeyRow(key) {
  const r = liber777Row(key);
  if (!r) return null;
  return row("liber_777", `key ${key}, ${key <= 10 ? "the Sephirah" : "path"} ${r.name}`, [
    r.egyptian_gods && `Egyptian gods: ${r.egyptian_gods}`,
    r.greek_gods && `Greek gods: ${r.greek_gods}`,
    r.roman_gods && `Roman gods: ${r.roman_gods}`,
    r.archangel && `archangel: ${r.archangel}`,
    r.choir && `choir: ${r.choir}`,
    `colours (King, Queen, Emperor, Empress scales): ${[r.king_scale, r.queen_scale, r.prince_scale, r.princess_scale].join("; ")}`,
    r.stones && `stones: ${r.stones}`,
    r.plants && `plants: ${r.plants}`,
    r.animals && `animals: ${r.animals}`,
    r.perfumes && `perfumes: ${r.perfumes}`,
    r.weapons && `weapons: ${r.weapons}`,
  ]);
}

export function westcottRow(letterId) {
  const l = yetzirahLetter(letterId);
  if (!l) return null;
  return row("westcott", l.westcott_name, [
    `class: ${l.class}`,
    l.element && `element: ${l.element}`,
    l.planet && `planet: ${l.planet} (Kalisch's allotment; the Golden Dawn differs)`,
    l.sign && `sign: ${l.sign}`,
    l.day && `day: ${l.day}`,
    l.month && `month: ${l.month}`,
    l.season && `season: ${l.season}`,
    l.body && `body: ${l.body}`,
    l.function && `faculty: ${l.function}`,
    l.opposites && `opposites: ${l.opposites}`,
  ]);
}

export function lenainRow(number) {
  const a = lenainAngel(number);
  if (!a) return null;
  return row("lenain", `angel ${number}, ${a.name_lenain}`, [
    `attribute: ${a.attribute_en.replace(/\s*\[our translation\]/, "")}`,
    `rules: ${a.rules_en.replace(/\s*\[our translation\]/, "")}`,
    `Lenain's place: ${place(a.lenain_start_longitude)} to ${place(a.lenain_start_longitude + 5, true)}`,
    `Book T's place for the same angel: ${place(a.book_t_start_longitude)} to ${place(a.book_t_start_longitude + 5, true)}`,
  ]);
}

/** Rows as a prompt block. */
export function renderRows(rows) {
  return rows.filter(Boolean).map((r) => [`[${r.source_name}: ${r.label}]`, ...r.lines.map((l) => `- ${l}`)].join("\n")).join("\n\n");
}
