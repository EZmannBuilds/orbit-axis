// Orbit Axis :: Agrippa's images of the decans, mansions of the Moon, and
// Behenian fixed stars.
//
// Source: Henry Cornelius Agrippa, Three Books of Occult Philosophy (Latin
// 1533; English by J. F., London 1651), Book I ch. 32 and Book II ch. 31, 33,
// 37, 46 and 47, as transcribed by Joseph H. Peterson (esotericarchives.com).
// Public domain. Spelling is the 1651 spelling. Gaps in the text are left as
// gaps; sources/agrippa.json lists them under `problems`.
//
// Reference and training context only. The images and "virtues" are
// Renaissance magical claims ("causeth boldness", "for the destruction of some
// one"); several would fail Orbit's content rules, and none are shown to
// readers as a reading. `display: false` marks that on every lookup.

import { readFileSync } from "node:fs";

const DATA = JSON.parse(readFileSync(new URL("./sources/agrippa.json", import.meta.url), "utf8"));

export const AGRIPPA_SOURCE = Object.freeze({ ...DATA.source, id: "agrippa_occult_philosophy" });
export const AGRIPPA_PROBLEMS = Object.freeze([...DATA.problems]);

export const DECAN_IMAGES = Object.freeze(DATA.decan_images.map((d) => Object.freeze({ ...d, display: false })));
export const LUNAR_MANSIONS = Object.freeze(DATA.lunar_mansions.map((m) => Object.freeze({ ...m, display: false })));
export const BEHENIAN_STARS = Object.freeze(DATA.behenian_stars.map((s) => Object.freeze({ ...s, display: false })));

/** Agrippa's image for a sign's face (1, 2 or 3), or null. */
export function decanImage(sign, face) {
  return DECAN_IMAGES.find((d) => d.sign === sign && d.face === face) ?? null;
}

/**
 * The lunar mansion for a longitude, by the equal division Agrippa describes
 * (28 mansions of 12°51′26″ from the head of Aries). Agrippa states exact
 * starts only for the first seven; this is the rule he gives for the rest, and
 * the result is labelled as computed.
 */
export function mansionAt(longitude) {
  if (!Number.isFinite(longitude)) return null;
  const lon = ((longitude % 360) + 360) % 360;
  const index = Math.floor(lon / (360 / 28));
  return { ...LUNAR_MANSIONS[index], computed_by: "equal division, 360/28 from 0° Aries" };
}
