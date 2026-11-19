// Orbit Axis :: historical divinatory meanings, for the owner's reference.
//
// Sources (public domain):
//   Mathers, The Tarot: Its Occult Signification, Use in Fortune-Telling, and
//     Method of Play (1888) — upright and reversed for all 78. Read from the
//     sacred-texts transcription (via the Wayback Machine); typos kept.
//   Papus, The Tarot of the Bohemians, tr. A. P. Morton (1892), ch. XX —
//     keywords for the 22 trumps. Read from the archive.org OCR; the two-column
//     page was re-paired by column order and should be checked against p. 317.
//
// NOT FOR READERS. These are 19th-century fortune-telling keywords ("Male
// Inquirer", "Death", "Ruin"). Orbit's meanings are the owner-approved text in
// draft-deck.js. These exist so the owner can compare when reviewing card text,
// and as labelled context for training — never as a reading. Every entry
// carries display: false, and nothing in lib/tarot composes from this file.

import { readFileSync } from "node:fs";

const DATA = JSON.parse(readFileSync(new URL("../esoteric/sources/yetzirah-mathers-papus.json", import.meta.url), "utf8"));

export const HISTORICAL_SOURCES = Object.freeze(DATA.sources.filter((s) => s.id === "mathers-1888" || s.id === "papus-1892").map(Object.freeze));
export const HISTORICAL_NAMING_NOTES = DATA.naming_notes;

export const MATHERS_MEANINGS = Object.freeze(Object.fromEntries(DATA.mathers.map((m) => [m.slug, Object.freeze({
  source: "mathers-1888", name_in_source: m.name_in_source, upright: m.upright, reversed: m.reversed, display: false,
})])));

export const PAPUS_MEANINGS = Object.freeze(Object.fromEntries(DATA.papus.map((p) => [p.slug, Object.freeze({
  source: "papus-1892", name_in_source: p.name_in_source, number_in_source: p.number_in_source, meaning: p.meaning, display: false,
})])));

/** Everything the historical sources say about one card, or null. */
export function historicalMeanings(slug) {
  const mathers = MATHERS_MEANINGS[slug] ?? null;
  const papus = PAPUS_MEANINGS[slug] ?? null;
  return mathers || papus ? { slug, mathers, papus } : null;
}
