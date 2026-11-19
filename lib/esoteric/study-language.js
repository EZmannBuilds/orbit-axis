// Orbit Axis :: detect study-only language leaking into a reading.
//
// The LoRA is trained on two kinds of example: readings (approved deck text and
// the facts the composer may state) and study (Agrippa, Lenain, 777, Westcott,
// with their sources named). A model blends what it learns, so a reading could
// pick up "causeth boldness" from Agrippa or "Riches, success" from Book T's
// fortune-telling table. This module lists the distinctive phrases of every
// study-only source so a reading that contains one can be refused.
//
// Method: every run of four words (lower-cased, punctuation stripped) from the
// longer study texts, plus whole multi-word glosses from the short keyword
// sources. A phrase counts as leaked only when it is in the rewrite and NOT in
// the composed reading the rewrite started from.

import { DECAN_IMAGES, LUNAR_MANSIONS, BEHENIAN_STARS } from "./agrippa.js";
import { LENAIN_ANGELS } from "./lenain.js";
import { MATHERS_MEANINGS, PAPUS_MEANINGS } from "../tarot/historical-meanings.js";
import { MAJORITIES, RANK_COMBINATIONS } from "../tarot/dignities.js";

export const NGRAM = 4;

export function words(text) {
  return String(text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}

export function ngrams(text, n = NGRAM) {
  const w = words(text);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

// Common English four-word runs that also occur in study texts and would
// cause false alarms in ordinary prose.
const ORDINARY = new Set(["one of the most", "at the same time", "in the form of", "on the other hand", "the end of the", "in the midst of"]);

function collect() {
  const long = [];
  for (const d of DECAN_IMAGES) long.push(d.image, d.virtue);
  for (const m of LUNAR_MANSIONS) long.push(m.effects, m.image_ch46);
  for (const s of BEHENIAN_STARS) long.push(s.note);
  for (const a of LENAIN_ANGELS) long.push(a.attribute_en, a.rules_en);
  const phrases = new Set();
  for (const t of long) for (const g of ngrams(t)) if (!ORDINARY.has(g)) phrases.add(g);

  // Short keyword sources: whole glosses of three or more words.
  const glosses = new Set();
  const short = [
    ...Object.values(MATHERS_MEANINGS).flatMap((m) => [m.upright, m.reversed]),
    ...Object.values(PAPUS_MEANINGS).map((p) => p.meaning),
    ...Object.values(MAJORITIES),
    ...Object.values(RANK_COMBINATIONS).flatMap((r) => Object.values(r)),
  ];
  for (const g of short) {
    const w = words(g).join(" ");
    if (w.split(" ").length >= 3) glosses.add(w);
  }
  return { phrases, glosses };
}

const STUDY = collect();

export const STUDY_PHRASE_COUNT = STUDY.phrases.size + STUDY.glosses.size;

/**
 * Study-only phrases in `text` that are not in `baseline` (the composed
 * reading). Empty when clean.
 */
export function studyLeaks(text, baseline = "") {
  const have = ngrams(baseline);
  const leaks = [];
  for (const g of ngrams(text)) if (STUDY.phrases.has(g) && !have.has(g)) leaks.push(g);
  const flat = words(text).join(" ");
  const base = words(baseline).join(" ");
  for (const g of STUDY.glosses) if (flat.includes(g) && !base.includes(g)) leaks.push(g);
  return [...new Set(leaks)];
}
