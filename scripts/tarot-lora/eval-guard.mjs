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

const COMMON = new Set(["The", "In", "It", "Its", "He", "His", "Her", "She", "They", "Where", "Name", "Who", "What", "Give", "How", "Which", "Summarise", "Source", "Some", "Answer", "This", "And", "Of"]);
const groundTerms = (s) => new Set([...(s.match(/\b[A-Z][a-z]{2,}\b/g) || []).filter((w) => !COMMON.has(w)), ...(s.match(/\b\d+\b/g) || [])]);

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
    // Fact accuracy. Fluent, clean, well-cited answers can still be wrong.
    //   facts_recalled  names and numbers of the expected answer that the output has
    //   facts_invented  names and numbers in the output that are NOT in the prompt
    //                   (the source rows): facts the model made up
    const want = groundTerms(r.expected);
    const got = groundTerms(r.output);
    const prompt = groundTerms(r.user);
    const hit = [...want].filter((t) => got.has(t)).length;
    const invented = [...got].filter((t) => !prompt.has(t));
    study.push({
      clean: auditReadingText(r.output).length === 0,
      names_source: SOURCE_WORDS[r.source]?.test(r.output) ?? false,
      exact: r.output.trim() === r.expected.trim(),
      facts_recalled: hit / Math.max(want.size, 1),
      facts_invented: invented.length / Math.max(got.size, 1),
      invented_terms: invented,
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
  study: {
    n: study.length, clean: mean(study, "clean"), names_source: mean(study, "names_source"), identical: mean(study, "exact"),
    facts_recalled: mean(study, "facts_recalled"), facts_invented: mean(study, "facts_invented"),
  },
};
// The gate. A model that fails it is not imported into Ollama.
const GATE = { readings_pass_guard: 0.95, readings_meanings_kept: 0.95, study_clean: 1, study_facts_recalled: 0.9, study_facts_invented_max: 0.05 };
const failures = [];
if (report.readings.n && report.readings.passes_guard < GATE.readings_pass_guard) failures.push(`readings passing the guard ${report.readings.passes_guard} < ${GATE.readings_pass_guard}`);
if (report.readings.n && report.readings.meanings_kept < GATE.readings_meanings_kept) failures.push(`meanings kept ${report.readings.meanings_kept} < ${GATE.readings_meanings_kept}`);
if (report.study.n && report.study.clean < GATE.study_clean) failures.push(`study answers with forbidden claims`);
if (report.study.n && report.study.facts_recalled < GATE.study_facts_recalled) failures.push(`study facts recalled ${report.study.facts_recalled} < ${GATE.study_facts_recalled}`);
if (report.study.n && report.study.facts_invented > GATE.study_facts_invented_max) failures.push(`study facts invented ${report.study.facts_invented} > ${GATE.study_facts_invented_max}`);
report.gate = { thresholds: GATE, passed: failures.length === 0, failures };
report.study.invented_examples = study.flatMap((s) => s.invented_terms).reduce((acc, t) => ({ ...acc, [t]: (acc[t] || 0) + 1 }), {});

writeFileSync(new URL("../../.cache/tarot-lora/eval/report.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
