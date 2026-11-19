// Orbit Axis :: write the LoRA training set for the local tarot model.
//
//   npm run tarot:export-training -- [--readings 3000] [--seed 1] [--sky-file sky.json]
//
// Two kinds of example, in chat format (system / user / assistant):
//
//   reading  The user turn is everything the composer knows about a spread —
//            each card's approved meaning and prompt, and the facts it may
//            state. The assistant turn is the composer's reading. The model
//            learns Orbit's register and structure; it never sees a meaning
//            that is not the deck's own.
//   study    A question about the tradition, answered from one named source
//            (Book T, Liber 777, Lilly, Agrippa, Westcott, Lenain) with the
//            source said aloud. This is where the depth comes from, kept apart
//            from readings by its own system prompt.
//
// Not included: Mathers and Papus (fortune-telling keywords would pull the
// model toward the predictive register Orbit forbids).
//
// Every assistant turn is run through FORBIDDEN_CONTENT_PATTERNS; any that
// trips one is dropped and counted. Reading targets must also have no
// study-only language (they are composer output, so they never should).
//
// Sky facts: by default each reading gets a SYNTHETIC set of planet positions
// (or none), labelled `sky: "synthetic"` in its metadata. They exist so the
// model learns to carry sky sentences through unchanged; they are training
// inputs, never shown to anyone. To train on real engine positions instead,
// pass --sky-file with a JSON array of currentSky() snapshots, generated where
// the engine runs (macOS or Linux).
//
// Output: .cache/tarot-lora/data/{train,val}.jsonl and manifest.json.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { PRODUCTION_CARDS, SPREAD_SIZES } from "../../lib/tarot/deck.js";
import { auditReadingText, composeScanReading, correspondenceLine, standingLine } from "../../lib/tarot/scan-reading.js";
import { CORRESPONDENCES, DECANS, SIGN_ORDER } from "../../lib/tarot/correspondences.js";
import { suitRelation } from "../../lib/tarot/dignities.js";
import { DIGNITY_TABLE } from "../../lib/esoteric/lilly.js";
import { BEHENIAN_STARS, DECAN_IMAGES, LUNAR_MANSIONS } from "../../lib/esoteric/agrippa.js";
import { LIBER777 } from "../../lib/esoteric/liber777.js";
import { YETZIRAH_LETTERS } from "../../lib/esoteric/yetzirah.js";
import { LENAIN_ANGELS } from "../../lib/esoteric/lenain.js";
import { studyLeaks } from "../../lib/esoteric/study-language.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const READINGS = Number(args.readings ?? 3000);
const SEED = Number(args.seed ?? 1);
const OUT = new URL("../../.cache/tarot-lora/data/", import.meta.url);

export const SYSTEM_READING = [
  "You are Orbit's tarot reader. Write the reading from what you are given and nothing else.",
  "Keep each card's meaning and reflection prompt in substance; state the facts exactly as given.",
  "Add no cards, no facts, no predictions, and no medical, financial, legal or relationship advice.",
  "The register is symbolic and reflective, never predictive.",
].join(" ");

export const SYSTEM_STUDY = [
  "You are Orbit's study companion for the Western esoteric tradition.",
  "Answer from the source the question names, say which source, and quote or paraphrase it faithfully.",
  "This is history and reference: do not apply it to the reader's life, and do not predict.",
].join(" ");

// ── Deterministic randomness ────────────────────────────────────────────────

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

function syntheticSky(i) {
  // Positions spread around the zodiac; Mercury and Venus kept near the Sun as
  // they are in the real sky. Labelled synthetic in the metadata.
  const sun = rand() * 360;
  const near = (max) => (sun + (rand() * 2 - 1) * max + 360) % 360;
  const planets = {
    Sun: { longitude: sun }, Moon: { longitude: rand() * 360 },
    Mercury: { longitude: near(28) }, Venus: { longitude: near(47) },
    Mars: { longitude: rand() * 360 }, Jupiter: { longitude: rand() * 360 }, Saturn: { longitude: rand() * 360 },
  };
  const retrogrades = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"].filter(() => rand() < 0.15);
  return { instant_utc: `synthetic-${i}`, planets, retrogrades };
}

const skyFile = args["sky-file"] ? JSON.parse(readFileSync(args["sky-file"], "utf8")) : null;

// ── Reading examples ────────────────────────────────────────────────────────

function readingPrompt(r) {
  const head = `Spread: ${r.spread_type}${r.position_set ? ` (${r.position_set})` : ""}`;
  const cards = r.positions.map((p, i) => [
    `Card ${i + 1}, ${p.position}: ${p.name}, ${p.orientation}`,
    `Meaning: ${p.meaning}`,
    `Reflection prompt: ${p.reflection_prompt}`,
    "Facts:",
    ...[p.correspondence, p.standing, p.dignity, ...p.sky_links].filter(Boolean).map((f) => `- ${f}`),
  ].join("\n"));
  return [head, ...cards].join("\n\n");
}

function readingExamples() {
  const out = [];
  const slugs = PRODUCTION_CARDS.map((c) => c.slug);
  let i = 0;
  while (out.length < READINGS) {
    i++;
    const spreadType = rand() < 0.4 ? "one_card" : "three_card";
    const n = SPREAD_SIZES[spreadType];
    const chosen = new Set();
    while (chosen.size < n) chosen.add(pick(slugs));
    const cards = [...chosen].map((slug) => ({ slug, reversed: rand() < 0.35 }));
    const skyKind = skyFile ? "engine" : rand() < 0.3 ? "none" : "synthetic";
    const sky = skyFile ? pick(skyFile) : skyKind === "none" ? null : syntheticSky(i);
    const r = composeScanReading({ cards, spreadType, positionSet: rand() < 0.75 ? "reflective" : "timeline", sky });
    out.push({
      kind: "reading",
      messages: [
        { role: "system", content: SYSTEM_READING },
        { role: "user", content: readingPrompt(r) },
        { role: "assistant", content: r.text },
      ],
      meta: { cards: cards.map((c) => `${c.slug}${c.reversed ? "~r" : ""}`), spread: spreadType, sky: skyKind },
    });
  }
  return out;
}

// ── Study examples ──────────────────────────────────────────────────────────

const the = (p) => (p === "Sun" || p === "Moon" ? `the ${p}` : p);
const NAME = Object.fromEntries(PRODUCTION_CARDS.map((c) => [c.slug, c.name]));
const study = [];
function qa(source, questions, answer) {
  for (const q of questions) study.push({ kind: "study", source, messages: [{ role: "system", content: SYSTEM_STUDY }, { role: "user", content: q }, { role: "assistant", content: answer }] });
}

// Book T and 777 correspondences, per card.
for (const c of Object.values(CORRESPONDENCES)) {
  const name = NAME[c.slug];
  const lines = [correspondenceLine(c.slug), standingLine(c.slug)].filter(Boolean);
  if (c.arcana === "major") {
    const l = c.hebrew_letter;
    lines.push(`Its letter, ${l.name} (${l.glyph}), has the value ${l.value} and is a ${l.kind} letter in the Sepher Yetzirah. Book T titles the card "${c.title}".`);
  } else if (c.kind === "pip") {
    lines.push(`Book T sets the angels ${c.angels[0].name} and ${c.angels[1].name} over this decan, numbers ${c.angels[0].number} and ${c.angels[1].number} of the seventy-two.`);
  } else if (c.kind === "court") {
    lines.push(`In Book T this card is the ${c.book_t_rank}, ${c.figure}, the ${c.letter_of_name} of the Name in its suit.`);
  }
  qa("book_t", [`What does the Golden Dawn attach to the ${name}?`, `Give the Book T correspondences of the ${name}.`], `According to Book T (the Golden Dawn's tarot manuscript, 1912): ${lines.join(" ")}`);
}

// Decans as sky facts.
for (const d of DECANS) {
  qa("book_t", [`Which card rules the ${d.ordinal} decan of ${d.sign}?`], `In Book T the ${d.ordinal} decan of ${d.sign} (${d.start_longitude % 30}° to ${(d.start_longitude % 30) + 10}°) is ruled by ${the(d.ruler)} and belongs to the ${NAME[d.slug]}, "${d.title}".`);
}

// Book T's dignity rule.
for (const a of ["wands", "cups", "swords", "pentacles"]) for (const b of ["wands", "cups", "swords", "pentacles"]) {
  if (a >= b) continue;
  const rel = suitRelation(a, b);
  const said = { inimical: "inimical: a card of one beside the other weakens it", friendly: "friendly", unstated: "not given: Book T states no relation between them" }[rel];
  qa("book_t", [`In Book T's elemental dignities, how do ${a} and ${b} relate?`], `In Book T's rule of elemental dignities, ${a} and ${b} are ${said}. Cards of the same suit beside a card strengthen it, and a card between two contrary cards is not much affected.`);
}

// Lilly.
for (const sign of SIGN_ORDER) {
  const row = DIGNITY_TABLE[sign];
  const terms = row.terms.map((t, i) => `${t.planet} to ${t.to_degree}°`).join(", ");
  const ex = row.exaltation ? `${the(row.exaltation.planet).replace("North Node", "the Dragon's Head").replace("South Node", "the Dragon's Tail")} is exalted at ${row.exaltation.degree}°` : "no planet is exalted";
  qa("lilly", [`What are the essential dignities of ${sign} in Lilly?`, `Summarise Lilly's table of dignities for ${sign}.`],
    `In Lilly's Christian Astrology (1647), ${sign} is the house of ${the(row.domicile)}; ${ex}; its triplicity is ruled by ${the(row.triplicity.day)} by day and ${the(row.triplicity.night)} by night; its terms run ${terms}; its faces are ${row.faces.map(the).join(", ")}; ${the(row.detriment)} is in detriment there${row.fall && ["Saturn", "Jupiter", "Mars", "Sun", "Venus", "Mercury", "Moon"].includes(row.fall) ? ` and ${the(row.fall)} in its fall` : ""}.`);
}

// Agrippa.
for (const d of DECAN_IMAGES) {
  const ord = ["first", "second", "third"][d.face - 1];
  qa("agrippa", [`What is Agrippa's image for the ${ord} face of ${d.sign}?`], `In Agrippa's Three Books of Occult Philosophy (1651 English), the ${ord} face of ${d.sign} is ${d.image}.${d.virtue ? ` He writes that it ${d.virtue}.` : ""}`);
}
for (const m of LUNAR_MANSIONS) {
  qa("agrippa", [`What does Agrippa say of the ${m.number}th mansion of the Moon?`], `Agrippa's ${m.number}th mansion of the Moon is ${m.name}; it ${/^from|^begin/i.test(m.starts) ? "begins " : ""}${m.starts}. He says ${m.effects}.`);
}
for (const s of BEHENIAN_STARS) {
  qa("agrippa", [`What does Agrippa give for the fixed star ${s.name}?`], `Agrippa counts ${s.name} among the fifteen fixed stars, of the nature of ${s.nature_of.join(" and ")}; its stone is ${s.stone} and its herb ${s.herb}.`);
}

// Liber 777.
for (const row of Object.values(LIBER777)) {
  const what = row.key <= 10 ? `the Sephirah ${row.name}` : `path ${row.key} (${row.name})`;
  const parts = [
    row.egyptian_gods && `Egyptian gods: ${row.egyptian_gods}`,
    row.greek_gods && `Greek: ${row.greek_gods}`,
    row.roman_gods && `Roman: ${row.roman_gods}`,
    row.archangel && `archangel: ${row.archangel}`,
    row.choir && `choir: ${row.choir}`,
    `colours in the four scales: ${[row.king_scale, row.queen_scale, row.prince_scale, row.princess_scale].join("; ")}`,
    row.stones && `stones: ${row.stones}`,
    row.plants && `plants: ${row.plants}`,
    row.animals && `animals: ${row.animals}`,
    row.perfumes && `perfumes: ${row.perfumes}`,
    row.weapons && `weapons: ${row.weapons}`,
  ].filter(Boolean);
  qa("liber_777", [`What does Liber 777 list for ${what}?`, `Give the 777 correspondences of key ${row.key}.`], `Liber 777 (1909) gives, for key ${row.key}, ${what}: ${parts.join("; ")}.`);
}

// Westcott.
for (const l of Object.values(YETZIRAH_LETTERS)) {
  const parts = [l.element && `the element ${l.element}`, l.planet && `the planet ${l.planet} (after Kalisch; the Golden Dawn differs)`, l.sign && `the sign ${l.sign}`, l.day, l.month && `the month ${l.month}`, l.body && `the ${l.body}`, l.function && `the faculty of ${l.function.toLowerCase()}`].filter(Boolean);
  qa("westcott", [`What does Westcott's Sepher Yetzirah assign to the letter ${l.westcott_name}?`], `In the supplement to Westcott's Sepher Yetzirah (1893), which he calls a modern illustration not found in the ancient copies, ${l.westcott_name}, a ${l.class} letter, is given ${parts.join(", ")}.`);
}

// Lenain.
for (const a of LENAIN_ANGELS) {
  const attr = a.attribute_en.replace(/\s*\[our translation\]/, "");
  const rules = a.rules_en.replace(/\s*\[our translation\]/, "");
  const lsign = SIGN_ORDER[Math.floor(a.lenain_start_longitude / 30)];
  const bsign = SIGN_ORDER[Math.floor(a.book_t_start_longitude / 30)];
  qa("lenain", [`What does Lenain say of the angel ${a.name_lenain}?`], `In La Science cabalistique (1823), Lenain gives angel ${a.number}, ${a.name_lenain}, the attribute "${attr}". ${rules}. He places it at ${a.lenain_start_longitude % 30}° ${lsign}; Book T sets the same angel at ${a.book_t_start_longitude % 30}° ${bsign}.`);
}

// ── Write ───────────────────────────────────────────────────────────────────

const readings = readingExamples();
const dropped = { forbidden: 0, leak: 0 };
const keep = [...readings, ...study].filter((ex) => {
  const answer = ex.messages[2].content;
  if (auditReadingText(answer).length) { dropped.forbidden++; return false; }
  if (ex.kind === "reading" && studyLeaks(answer).length) { dropped.leak++; return false; }
  return true;
});

// Split by a hash of the user turn, so the same question never lands in both.
const isVal = (ex) => createHash("sha1").update(ex.messages[1].content).digest()[0] < 26; // ~10%
mkdirSync(OUT, { recursive: true });
const train = keep.filter((ex) => !isVal(ex));
const val = keep.filter(isVal);
writeFileSync(new URL("train.jsonl", OUT), train.map((x) => JSON.stringify(x)).join("\n") + "\n");
writeFileSync(new URL("val.jsonl", OUT), val.map((x) => JSON.stringify(x)).join("\n") + "\n");
const count = (xs, k) => xs.filter((x) => x.kind === k).length;
const bySource = {};
for (const x of keep.filter((x) => x.kind === "study")) bySource[x.source] = (bySource[x.source] || 0) + 1;
const manifest = {
  seed: SEED, sky: skyFile ? "engine" : "synthetic",
  train: { reading: count(train, "reading"), study: count(train, "study") },
  val: { reading: count(val, "reading"), study: count(val, "study") },
  study_by_source: bySource, dropped,
  excluded_sources: ["mathers-1888", "papus-1892"],
  system: { reading: SYSTEM_READING, study: SYSTEM_STUDY },
};
writeFileSync(new URL("manifest.json", OUT), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
