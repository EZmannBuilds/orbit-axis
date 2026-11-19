// Orbit Axis :: William Lilly's Table of Essential Dignities.
//
// Source: Lilly, Christian Astrology (London, 1647), p. 104, "A Table of the
// Essentiall Dignities of the Planets according to Ptolomy", and the scores on
// p. 115. Public domain. Every cell was read from a scan of the 1647 first
// edition (Wellcome Library copy, archive.org b30338724); see
// sources/lilly.json for the page references and the transcription notes.
//
// Reference facts. They describe where a planet is "dignified" in the
// tradition; they are not a judgement about a reader.

import { readFileSync } from "node:fs";

const DATA = JSON.parse(readFileSync(new URL("./sources/lilly.json", import.meta.url), "utf8"));

export const LILLY_SOURCE = Object.freeze({ ...DATA.source, id: "lilly_christian_astrology" });
export const LILLY_SCORES = Object.freeze({ ...DATA.scores });

/** The table row for a sign, keyed by sign name. */
export const DIGNITY_TABLE = Object.freeze(Object.fromEntries(DATA.signs.map((s) => [s.sign, Object.freeze(s)])));

const SIGNS = DATA.signs.map((s) => s.sign);
const SEVEN = ["Saturn", "Jupiter", "Mars", "Sun", "Venus", "Mercury", "Moon"];

function at(longitude) {
  const lon = ((longitude % 360) + 360) % 360;
  const row = DATA.signs[Math.floor(lon / 30)];
  return { row, degree: lon - Math.floor(lon / 30) * 30 };
}

/**
 * The essential dignities and debilities of a planet at a longitude, by
 * Lilly's table. `day` chooses the day or night triplicity ruler; when it is
 * not known, triplicity is reported for either and not scored.
 *
 * Returns { sign, dignities: [...], debilities: [...], score, peregrine }.
 * Peregrine: no essential dignity at all (Lilly scores it -5).
 */
export function essentialDignity(planet, longitude, { day = null } = {}) {
  if (!SEVEN.includes(planet) || !Number.isFinite(longitude)) return null;
  const { row, degree } = at(longitude);
  const dignities = [];
  const debilities = [];
  if (row.domicile === planet) dignities.push("house");
  if (row.exaltation?.planet === planet) dignities.push("exaltation");
  const trip = day === true ? [row.triplicity.day] : day === false ? [row.triplicity.night] : [row.triplicity.day, row.triplicity.night];
  if (trip.includes(planet)) dignities.push(day === null ? "triplicity (day or night)" : "triplicity");
  const term = row.terms.find((t) => degree < t.to_degree);
  if (term?.planet === planet) dignities.push("term");
  if (row.faces[Math.min(2, Math.floor(degree / 10))] === planet) dignities.push("face");
  if (row.detriment === planet) debilities.push("detriment");
  if (row.fall === planet) debilities.push("fall");

  const scoreOf = { house: 5, exaltation: 4, triplicity: 3, term: 2, face: 1 };
  let score = dignities.reduce((n, d) => n + (scoreOf[d] ?? 0), 0);
  score += debilities.reduce((n, d) => n + LILLY_SCORES[d], 0);
  const peregrine = dignities.length === 0;
  if (peregrine) score += LILLY_SCORES.peregrine;
  return { planet, sign: row.sign, degree: Math.floor(degree), dignities, debilities, peregrine, score };
}

/**
 * The sign-level standing of a planet (house, exaltation, detriment, fall),
 * independent of degree. Null when it has none of the four.
 */
export function signStanding(planet, sign) {
  const row = DIGNITY_TABLE[sign];
  if (!row) return null;
  if (row.domicile === planet) return "house";
  if (row.exaltation?.planet === planet) return "exaltation";
  if (row.detriment === planet) return "detriment";
  if (row.fall === planet) return "fall";
  return null;
}

export const SIGN_ORDER = Object.freeze(SIGNS);
