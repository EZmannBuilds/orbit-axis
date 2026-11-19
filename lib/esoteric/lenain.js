// Orbit Axis :: the 72 angels of the Shem ha-Mephorash, after Lenain.
//
// Source: Lazare Lenain, La Science cabalistique (Amiens, 1823), ch. IV–VI,
// read from a scan of the printed edition. Public domain. English glosses are
// our translation and say so. One gap (n° 58, Ieialel, a missing page-break
// passage) and two illegible numbers were filled from Papus, La Cabbale (1903),
// and are flagged in the entry. sources/lenain.json lists every problem.
//
// Two placements of the same 72 names:
//   - Book T (Golden Dawn, used by the tarot): two angels per decan from 0° Leo.
//   - Lenain: angel n rules 5° from 0° Aries, so angel 1 is 0°–5° Aries.
// Same order, same pairing, a 120° (four-sign) offset. Both are kept; the tarot
// table (correspondences.js) uses Book T's.
//
// Reference and training context: the attributes are devotional, and the
// "invoked for" clauses are magical claims. Not shown to readers.

import { readFileSync } from "node:fs";

const DATA = JSON.parse(readFileSync(new URL("./sources/lenain.json", import.meta.url), "utf8"));

export const LENAIN_SOURCE = Object.freeze({ ...DATA.source, id: "lenain_science_cabalistique" });
export const LENAIN_PROBLEMS = Object.freeze([...DATA.problems]);
export const LENAIN_ORDERING_NOTE = DATA.ordering_note;

/** Lenain's placement: angel n starts at 5(n − 1)° from 0° Aries. */
export function lenainStartLongitude(number) {
  return (number - 1) * 5;
}

/** Book T's placement of the same angel: Lenain's plus 120°. */
export function bookTStartLongitude(number) {
  return (lenainStartLongitude(number) + 120) % 360;
}

export const LENAIN_ANGELS = Object.freeze(DATA.angels.map((a) => Object.freeze({
  ...a,
  lenain_start_longitude: lenainStartLongitude(a.number),
  book_t_start_longitude: bookTStartLongitude(a.number),
  display: false,
})));

export function lenainAngel(number) {
  return LENAIN_ANGELS[number - 1] ?? null;
}
