// Orbit Axis :: selected columns of Liber 777, for the ten Sephiroth and the
// twenty-two paths.
//
// Source: Aleister Crowley, Liber 777 (1909; public domain in the US). Read
// from a cell-per-line e-text and checked row by row against an independent
// scan of the 1909 tables (the Weiser facsimile). Where they disagree the scan
// was used; sources/liber777.json lists every variant. Crowley's additions
// from 777 Revised (1955) are deliberately left out: only the 1909 tables are
// here.
//
// Columns (777's numbering): XIX Egyptian, XXXIV Greek, XXXV Roman gods; XCIX
// archangels and C angels "of Assiah" (keys 1–10); LXXXV/LXXXVI angels and
// choirs of Briah (1–10); XV–XVIII the King, Queen, Emperor and Empress colour
// scales; XL stones; XXXIX plants; XLIII vegetable drugs; XXXVIII animals;
// XLII perfumes; XLI magical weapons.
//
// Reference and training context. Not shown to readers as a reading.

import { readFileSync } from "node:fs";

const DATA = JSON.parse(readFileSync(new URL("./sources/liber777.json", import.meta.url), "utf8"));

export const LIBER777_SOURCE = Object.freeze({ ...DATA.source, id: "liber_777" });
export const LIBER777_COLUMNS = Object.freeze({ ...DATA.columns });
export const LIBER777_PROBLEMS = Object.freeze([...DATA.problems]);

/** Rows keyed by 777 key number, 1–32. */
export const LIBER777 = Object.freeze(Object.fromEntries(DATA.keys.map((k) => [k.key, Object.freeze({ ...k, display: false })])));

/** The 777 row for a key (1–10 Sephiroth, 11–32 paths), or null. */
export function liber777Row(key) {
  return LIBER777[key] ?? null;
}
