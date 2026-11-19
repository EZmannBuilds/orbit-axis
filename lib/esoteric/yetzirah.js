// Orbit Axis :: the Hebrew letters in the Sepher Yetzirah, after Westcott.
//
// Source: W. Wynn Westcott, Sepher Yetzirah (2nd ed., 1893), read from the
// archive.org scan and checked against Wikisource. Public domain.
//
// Read this before using it. The ancient text lists the planets, days, gates,
// signs, months and organs, but never pairs them with individual letters. The
// per-letter values here come from Westcott's Supplements to Chapters IV and V,
// which he calls "a modern illustration… not found in the ancient copies"
// (after Kalisch). For the seven double letters Westcott's planets differ from
// the Golden Dawn's (correspondences.js), and Westcott himself says in note 40
// that both Kircher's and Kalisch's allotments are wrong. So:
//   - mothers and simples agree with the Golden Dawn and the tests check it;
//   - doubles are kept as a second, labelled tradition (`tradition: "kalisch"`)
//     and never replace the Golden Dawn planets used by the tarot.
// No letter has a direction in the text; `direction` is always null.

import { readFileSync } from "node:fs";

const DATA = JSON.parse(readFileSync(new URL("./sources/yetzirah-mathers-papus.json", import.meta.url), "utf8"));

export const YETZIRAH_SOURCE = Object.freeze({ ...DATA.sources.find((s) => s.id === "westcott-sy-1893") });

/** Westcott's spellings → the ids used in lib/tarot/correspondences.js. */
const ID = {
  Aleph: "aleph", Mem: "mem", Shin: "shin", Beth: "beth", Gimel: "gimel", Daleth: "daleth", Kaph: "kaph",
  Pe: "peh", Resh: "resh", Tau: "tav", Heh: "heh", Vau: "vav", Zain: "zayin", Cheth: "cheth", Teth: "teth",
  Yod: "yod", Lamed: "lamed", Nun: "nun", Samech: "samekh", Oin: "ayin", Tzaddi: "tzaddi", Qoph: "qoph",
};

/** Normalise Westcott's "Capricornus" to the sign name used elsewhere. */
const SIGN = (s) => (s === "Capricornus" ? "Capricorn" : s);

export const YETZIRAH_LETTERS = Object.freeze(Object.fromEntries(DATA.letters.map((l) => [ID[l.letter], Object.freeze({
  id: ID[l.letter],
  westcott_name: l.letter,
  class: l.class,
  element: l.element ?? null,
  planet: l.planet ?? null,
  sign: l.sign ? SIGN(l.sign) : null,
  season: l.season ?? null,
  day: l.day ?? null,
  month: l.month ?? null,
  body: l.body ?? null,
  function: l.function ?? null,
  opposites: l.opposites ?? null,
  direction: null,
  tradition: l.class === "double" ? "kalisch" : "sepher_yetzirah",
  modern_supplement: true,
  display: false,
})])));

export function yetzirahLetter(id) {
  return YETZIRAH_LETTERS[id] ?? null;
}
