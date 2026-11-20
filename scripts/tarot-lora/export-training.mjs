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
import {
  agrippaDecanRow, cardRow, decanRow, lenainRow, liber777KeyRow, lillyRow, mansionRow, renderRows, starRow, suitPairRow, westcottRow,
} from "../../lib/esoteric/retrieval.js";

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
  "Answer only from the source rows given with the question: name the source, and use no fact that is not in those rows.",
  "Some rows may be about something else; use the one the question asks about.",
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
//
// Every study question carries its source rows (lib/esoteric/retrieval.js),
// and every answer uses only facts in those rows: the model learns to explain
// what it is handed, not to recall. Half the questions also carry one row about
// something else, so it learns to pick the right row. Held-out items are split
// by ITEM (not by question), so evaluation asks about rows the model has never
// trained on and can only read from the prompt.

const the = (p) => (p === "Sun" || p === "Moon" ? `the ${p}` : p);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const NAME = Object.fromEntries(PRODUCTION_CARDS.map((c) => [c.slug, c.name]));
const items = [];
function item(key, source, questions, row, answer) {
  if (row) items.push({ key, source, questions, row, answer });
}

// Book T: cards.
for (const c of Object.values(CORRESPONDENCES)) {
  const name = NAME[c.slug];
  let answer;
  if (c.arcana === "major") {
    const l = c.hebrew_letter;
    const second = c.secondary_attribution ? ` and to ${c.secondary_attribution.name}` : "";
    answer = `In Book T, the ${name} is titled "${c.title}". It belongs to the ${c.attribution.kind} ${c.attribution.name}${second}; to the letter ${l.name} (${l.glyph}), "${l.meaning}", value ${l.value}, a ${l.kind} letter; and to path ${c.path.number}, joining ${c.path.joins[0].name} and ${c.path.joins[1].name}.`;
  } else if (c.kind === "ace") {
    answer = `In Book T, the ${name} is "${c.title}": ${c.element} as a whole, in Kether, in ${c.world}, ${c.world_gloss}. Its throne is the Page of its suit.`;
  } else if (c.kind === "pip") {
    answer = `In Book T, the ${name} is "${c.title}". It is the ${c.decan.ordinal} decan of ${c.decan.sign}, ${c.decan.start_longitude % 30}° to ${(c.decan.start_longitude % 30) + 10}°, ruled by ${the(c.decan.ruler)}, in ${c.sephirah.name} (${c.sephirah.gloss}) of ${c.world}, ${c.world_gloss}. The angels of its decan are ${c.angels[0].name} and ${c.angels[1].name}, numbers ${c.angels[0].number} and ${c.angels[1].number}.`;
  } else {
    const rules = c.rules ? `It rules from 20° ${c.rules.from.sign} to 20° ${c.rules.to.sign}.` : "It rules a quadrant around the North Pole and is the throne of the Ace of its suit.";
    answer = `In Book T, the ${name} is "${c.title}", the ${c.book_t_rank}, ${c.figure}, the ${c.letter_of_name} of the Name: ${c.sub_element.label}. ${rules}`;
  }
  item(`card:${c.slug}`, "book_t", [`What does the Golden Dawn attach to the ${name}?`, `Give the Book T correspondences of the ${name}.`, `In Book T, what is the ${name}?`], cardRow(c.slug, name), answer);
}

// Book T: decans.
for (const d of DECANS) {
  item(`decan:${d.slug}`, "book_t", [`Which card rules the ${d.ordinal} decan of ${d.sign}?`, `In Book T, what belongs to ${d.sign}'s ${d.ordinal} decan?`], decanRow(d.sign, d.index, (s) => NAME[s]),
    `In Book T the ${d.ordinal} decan of ${d.sign}, ${d.start_longitude % 30}° to ${(d.start_longitude % 30) + 10}°, is ruled by ${the(d.ruler)} and belongs to the ${NAME[d.slug]}, "${d.title}".`);
}

// Book T: elemental dignities.
const SUITS = ["wands", "cups", "swords", "pentacles"];
for (const a of SUITS) for (const b of SUITS) {
  if (a >= b) continue;
  const rel = suitRelation(a, b);
  const said = { inimical: "inimical: a card of one beside the other weakens it", friendly: "friendly", unstated: "not stated: Book T gives no relation between them" }[rel];
  item(`suits:${a}-${b}`, "book_t", [`In Book T's elemental dignities, how do ${a} and ${b} relate?`], suitPairRow(a, b),
    `In Book T's elemental dignities, ${a} and ${b} are ${said}. The same suit beside a card strengthens it, and a card between two contraries is not much affected.`);
}

// Lilly.
for (const sign of SIGN_ORDER) {
  const r = DIGNITY_TABLE[sign];
  const node = (p) => p.replace("North Node", "the Dragon's Head").replace("South Node", "the Dragon's Tail");
  const ex = r.exaltation ? `${node(the(r.exaltation.planet))} is exalted at ${r.exaltation.degree}°` : "no planet is exalted there";
  const fall = r.fall ? `, and ${node(the(r.fall))} is in its fall` : "";
  item(`lilly:${sign}`, "lilly", [`What are the essential dignities of ${sign} in Lilly?`, `Summarise Lilly's table of dignities for ${sign}.`], lillyRow(sign),
    `In Lilly's Christian Astrology (1647), ${sign} is the house of ${the(r.domicile)}; ${ex}; its triplicity is ruled by ${the(r.triplicity.day)} by day and ${the(r.triplicity.night)} by night; its terms run ${r.terms.map((t) => `${t.planet} to ${t.to_degree}°`).join(", ")}; its faces are ${r.faces.map(the).join(", ")}. ${cap(the(r.detriment))} is in detriment there${fall}.`);
}

// Agrippa.
for (const d of DECAN_IMAGES) {
  const ord = ["first", "second", "third"][d.face - 1];
  item(`agrippa-face:${d.sign}-${d.face}`, "agrippa", [`What is Agrippa's image for the ${ord} face of ${d.sign}?`, `How does Agrippa picture ${d.sign}'s ${ord} face?`], agrippaDecanRow(d.sign, d.face),
    `In Agrippa's Three Books of Occult Philosophy (1651 English), the ${ord} face of ${d.sign} is ${d.image}.${d.virtue ? ` He writes that it ${d.virtue}.` : ""}`);
}
for (const m of LUNAR_MANSIONS) {
  item(`mansion:${m.number}`, "agrippa", [`What does Agrippa say of mansion ${m.number} of the Moon?`, `Name Agrippa's ${m.number}th lunar mansion and its effects.`], mansionRow(m.number),
    `Agrippa's mansion ${m.number} of the Moon is ${m.name}. Where it starts: ${m.starts}. Its effects: ${m.effects}.`);
}
for (const s of BEHENIAN_STARS) {
  item(`star:${s.name}`, "agrippa", [`What does Agrippa give for the fixed star ${s.name}?`], starRow(s.name),
    `Agrippa gives ${s.name} the nature of ${s.nature_of.join(" and ")}; its stone is ${s.stone} and its herb ${s.herb}.`);
}

// Liber 777.
for (const r of Object.values(LIBER777)) {
  const what = r.key <= 10 ? `the Sephirah ${r.name}` : `path ${r.key} (${r.name})`;
  const parts = [
    r.egyptian_gods && `Egyptian gods ${r.egyptian_gods}`, r.greek_gods && `Greek gods ${r.greek_gods}`, r.roman_gods && `Roman gods ${r.roman_gods}`,
    r.archangel && `the archangel ${r.archangel}`, r.choir && `the choir ${r.choir}`,
    `colours ${[r.king_scale, r.queen_scale, r.prince_scale, r.princess_scale].join("; ")}`,
    r.stones && `stones ${r.stones}`, r.plants && `plants ${r.plants}`, r.animals && `animals ${r.animals}`, r.perfumes && `perfumes ${r.perfumes}`, r.weapons && `weapons ${r.weapons}`,
  ].filter(Boolean);
  item(`777:${r.key}`, "liber_777", [`What does Liber 777 list for ${what}?`, `Give the 777 correspondences of key ${r.key}.`], liber777KeyRow(r.key),
    `Liber 777 (1909), key ${r.key}, ${what}: ${parts.join("; ")}.`);
}

// Westcott.
for (const l of Object.values(YETZIRAH_LETTERS)) {
  const parts = [l.element && `the element ${l.element}`, l.planet && `the planet ${l.planet} (Kalisch's allotment; the Golden Dawn differs)`, l.sign && `the sign ${l.sign}`, l.day, l.month && `the month ${l.month}`, l.season, l.body && `the ${l.body}`, l.function && `the faculty ${l.function}`].filter(Boolean);
  item(`westcott:${l.id}`, "westcott", [`What does Westcott's Sepher Yetzirah assign to the letter ${l.westcott_name}?`], westcottRow(l.id),
    `In the modern supplement to Westcott's Sepher Yetzirah (1893), ${l.westcott_name}, a ${l.class} letter, is given ${parts.join(", ")}.`);
}

// Lenain.
for (const a of LENAIN_ANGELS) {
  const r = lenainRow(a.number);
  const get = (prefix) => r.lines.find((x) => x.startsWith(prefix)).slice(prefix.length);
  item(`lenain:${a.number}`, "lenain", [`What does Lenain say of the angel ${a.name_lenain}?`, `Who is angel ${a.number} in Lenain?`], r,
    `In La Science cabalistique (1823), Lenain's angel ${a.number}, ${a.name_lenain}, has the attribute "${get("attribute: ")}". ${get("rules: ")}. Lenain places it at ${get("Lenain's place: ")}; Book T sets the same angel at ${get("Book T's place for the same angel: ")}.`);
}

// Questions → examples, each with its row and sometimes a distractor.
const study = [];
for (const it of items) {
  for (const q of it.questions) {
    const rows = [it.row];
    if (rand() < 0.5) {
      const others = items.filter((x) => x.source === it.source && x.key !== it.key);
      rows.push(pick(others).row);
      if (rand() < 0.5) rows.reverse();
    }
    study.push({
      kind: "study", source: it.source, key: it.key,
      messages: [
        { role: "system", content: SYSTEM_STUDY },
        { role: "user", content: `${q}\n\nSource rows:\n${renderRows(rows)}` },
        { role: "assistant", content: it.answer },
      ],
    });
  }
}

// ── Write ───────────────────────────────────────────────────────────────────

// Every proper name and number in a study answer must appear in its prompt:
// the model is trained to use what it is handed and nothing else.
const COMMON = new Set(["The", "In", "It", "Its", "He", "His", "Her", "She", "They", "Where", "Name", "Who", "What", "Give", "How", "Which", "Summarise", "Source", "Some", "Answer", "This", "And", "Of"]);
export const groundTerms = (s) => new Set([...(s.match(/\b[A-Z][a-z]{2,}\b/g) || []).filter((w) => !COMMON.has(w)), ...(s.match(/\b\d+\b/g) || [])]);
const ungrounded = (ex) => {
  const have = groundTerms(ex.messages[1].content);
  return [...groundTerms(ex.messages[2].content)].some((t) => !have.has(t));
};

const readings = readingExamples();
const dropped = { forbidden: 0, leak: 0, ungrounded: 0 };
const keep = [...readings, ...study].filter((ex) => {
  const answer = ex.messages[2].content;
  if (auditReadingText(answer).length) { dropped.forbidden++; return false; }
  if (ex.kind === "reading" && studyLeaks(answer).length) { dropped.leak++; return false; }
  if (ex.kind === "study" && ungrounded(ex)) { dropped.ungrounded++; return false; }
  return true;
});

// Readings split by their prompt; study split by ITEM, so every paraphrase of a
// held-out item stays held out and evaluation reads facts it never trained on.
const isVal = (ex) => createHash("sha1").update(ex.kind === "study" ? ex.key : ex.messages[1].content).digest()[0] < 26; // ~10%
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
