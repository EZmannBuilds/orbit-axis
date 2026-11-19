// Score the model's held-out outputs with the app's own checks.
//
//   node scripts/tarot-lora/eval-guard.mjs [generations.jsonl]
//
// Readings are checked exactly as the app would before showing a rewrite
// (checkWovenText: forbidden claims, added cards, study-only language), and
// for faithfulness: does every card's approved meaning survive, and is every
// fact line carried through unchanged? Study answers are checked for the
// forbidden patterns and for naming their source.
// Writes .cache/tarot-lora/eval/report.json and prints a summary.

import { readFileSync, writeFileSync } from "node:fs";

import { PRODUCTION_CARDS } from "../../lib/tarot/deck.js";
import { auditReadingText, checkWovenText } from "../../lib/tarot/scan-reading.js";

const file = process.argv[2] ?? new URL("../../.cache/tarot-lora/eval/generations.jsonl", import.meta.url);
const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const SOURCE_WORDS = { book_t: /Book T|Golden Dawn/i, lilly: /Lilly/i, agrippa: /Agrippa/i, liber_777: /777/, westcott: /Westcott|Yetzirah/i, lenain: /Lenain/i };

const readings = [];
const study = [];
for (const r of rows) {
  if (r.kind === "reading") {
    const slugs = r.meta.cards.map((c) => c.replace(/~r$/, ""));
    const reading = { positions: slugs.map((slug) => ({ slug })), text: r.expected };
    const guard = checkWovenText(reading, r.output);
    const meanings = [...r.user.matchAll(/^Meaning: (.*)$/gm)].map((m) => m[1]);
    const facts = [...r.user.matchAll(/^- (.*)$/gm)].map((m) => m[1]);
    readings.push({
      shown: guard.ok,
      reasons: guard.reasons,
      meanings_kept: meanings.filter((m) => r.output.includes(m)).length / Math.max(meanings.length, 1),
      facts_kept: facts.filter((f) => r.output.includes(f)).length / Math.max(facts.length, 1),
      exact: r.output.trim() === r.expected.trim(),
    });
  } else {
    study.push({
      clean: auditReadingText(r.output).length === 0,
      names_source: SOURCE_WORDS[r.source]?.test(r.output) ?? false,
      exact: r.output.trim() === r.expected.trim(),
    });
  }
}

const mean = (xs, k) => (xs.length ? Math.round((xs.reduce((n, x) => n + Number(x[k]), 0) / xs.length) * 1000) / 1000 : null);
const report = {
  readings: {
    n: readings.length,
    passes_guard: mean(readings, "shown"),
    meanings_kept: mean(readings, "meanings_kept"),
    facts_kept: mean(readings, "facts_kept"),
    identical_to_composer: mean(readings, "exact"),
    refusal_reasons: readings.flatMap((r) => r.reasons).reduce((acc, r) => ({ ...acc, [r.split(":")[0]]: (acc[r.split(":")[0]] || 0) + 1 }), {}),
  },
  study: { n: study.length, clean: mean(study, "clean"), names_source: mean(study, "names_source"), identical: mean(study, "exact") },
};
writeFileSync(new URL("../../.cache/tarot-lora/eval/report.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
