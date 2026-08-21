// Generate the founder-facing Orbit X Template Review artifact from real
// Orbit engine data. Symbolic lines are deliberately labelled editorial demo
// copy; no language model or external API is used.

import { writeFileSync } from "node:fs";
import { currentSky } from "@ezmannbuilds/orbit-axis-engine";
import { createCurrentSkyContext } from "../lib/astro/current-sky-context.js";
import { upcomingEvents } from "../lib/sky.js";
import {
  READING_TYPES, READING_FORMATS, calculateReadingPeriod, buildReadingCandidate,
} from "../lib/orbit-x/readings.js";
import { buildReadingScaffold } from "../lib/orbit-x/language.js";
import { TEMPLATE_FAMILY_IDS, TEMPLATES, normalizeDesign, renderPost } from "../lib/orbit-x/templates.js";

const date = process.argv[2] || "2026-08-20";
const timezone = process.env.ORBIT_X_EDITORIAL_TIMEZONE || "America/Chicago";
const output = new URL("../docs/orbit-x-template-review.html", import.meta.url);
const esc = (value) => String(value ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const DEMO = Object.freeze({
  daily: Object.freeze({
    theme: "Notice the movement before naming the outcome.",
    one: "Today's editorial thread holds attention on the shift itself, leaving individual meaning open.",
    reading: "Editorial demo: the selected sky movements can be read as a change in pace and emphasis—not a prediction that everyone will experience the same result.",
    reflection: "What becomes easier to notice when the pace changes?",
  }),
  weekly: Object.freeze({
    theme: "The week changes shape as it moves.",
    one: "This week's editorial arc follows the verified opening, pivot, and landing without turning shared symbolism into a personal forecast.",
    reading: "Editorial demo: read together, the selected movements suggest an arc of adjustment and clarification while leaving every natal relationship distinct.",
    reflection: "Where would a cleaner signal make the next step simpler?",
  }),
  monthly: Object.freeze({
    theme: "A month of movement, contrast, and return.",
    one: "This month's editorial arc follows a curated set of verified changes rather than treating the ephemeris as the story.",
    reading: "Editorial demo: the selected movements create a symbolic thread of changing emphasis across the month, offered for collective reflection rather than prediction.",
    reflection: "What deserves another look before the month moves on?",
  }),
});

function candidateFor(type) {
  const period = calculateReadingPeriod(type, date, timezone);
  const at = new Date(period.start_utc);
  const context = createCurrentSkyContext({ at, timezoneName: timezone, timezoneSource: "orbit-x-editorial" });
  const events = upcomingEvents(at, 64, { currentSkyContext: context });
  return buildReadingCandidate({ type, period, events, context,
    skyAt: (instantUtc) => currentSky(new Date(instantUtc)) });
}

function authoredPost(candidate, type) {
  const { post } = buildReadingScaffold(candidate, READING_FORMATS[type]);
  const demo = DEMO[type];
  return { ...post, headline: demo.theme,
    reading: { ...post.reading, theme: demo.theme, oneSentence: demo.one },
    slides: post.slides.map((slide) => slide.role === "one_sentence" ? { ...slide, body: demo.one }
      : slide.role === "reading" ? { ...slide, body: demo.reading }
        : slide.role === "reflection" ? { ...slide, body: demo.reflection } : slide),
    caption: `Editorial demo for ${candidate.facts.period.label}. Astronomical facts are Orbit engine output; symbolic copy is manually authored for template review.`,
  };
}

const sections = [];
const manifest = [];
for (const type of READING_TYPES) {
  const candidate = candidateFor(type);
  const post = authoredPost(candidate, type);
  const events = candidate.facts.selected_events;
  const cards = TEMPLATE_FAMILY_IDS.map((id) => {
    const design = normalizeDesign({ template: id, aspect: "portrait" }, candidate.eventType, post.format);
    const rendered = renderPost({ ...post, design }, { eventType: candidate.eventType,
      title: candidate.title, facts: candidate.facts, sky: candidate.facts.planets, design });
    const readingIndex = post.slides.findIndex((slide) => slide.role === "reading");
    const detailIndex = post.slides.findIndex((slide) => ["reflection", "evidence", "key_dates"].includes(slide.role));
    const indexes = [...new Set([0, 1, readingIndex, detailIndex])].filter((i) => i >= 0).slice(0, 4);
    manifest.push({ type, family: id, version: TEMPLATES[id].version,
      period: candidate.facts.period, selectedEventKeys: events.map((event) => event.key), slideCount: rendered.slides.length });
    return `<article><span class="demo">EDITORIAL DEMO · REAL ENGINE FACTS</span><h3>${esc(TEMPLATES[id].name)}</h3>`
      + `<p>${esc(TEMPLATES[id].intendedUse)}</p><div class="slides">`
      + indexes.map((i) => rendered.slides[i].svg).join("")
      + `</div><small>${esc(id)}/${esc(TEMPLATES[id].version)} · ${rendered.slides.length} slides</small></article>`;
  }).join("");
  sections.push(`<section><h2>${esc(type[0].toUpperCase() + type.slice(1))} Reading · ${esc(candidate.facts.period.label)}</h2>`
    + `<p class="facts"><strong>Period:</strong> ${esc(candidate.facts.period.start_utc)} → ${esc(candidate.facts.period.end_utc)} (exclusive) · ${esc(candidate.facts.period.timezone)}<br>`
    + `<strong>Selected verified movements:</strong> ${events.length ? events.map((event) => `${event.date} · ${event.title}`).map(esc).join(" · ") : "None; no event was invented."}</p>`
    + `<div class="grid">${cards}</div></section>`);
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
  + `<title>Orbit X Founder Template Review · ${esc(date)}</title><style>`
  + `:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;background:#05070d;color:#f4f2fa}body{margin:0 auto;max-width:1680px;padding:32px}h1{font-size:42px;margin-bottom:8px}h2{margin-top:64px}.lede,.facts,article p,small{color:#aab0c4}.facts{border:1px solid #232842;border-radius:12px;padding:14px;line-height:1.65}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}article{border:1px solid #232842;border-radius:16px;padding:14px;background:#0b0e18}article h3{margin:7px 0}.demo{font-size:10px;letter-spacing:2px;color:#b9a7ff}.slides{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:12px 0}.slides svg{width:100%;height:auto;border-radius:5px}@media(max-width:700px){body{padding:16px}.grid{grid-template-columns:1fr}.slides{grid-template-columns:1fr 1fr}}`
  + `</style></head><body><h1>Orbit X Founder Template Review</h1>`
  + `<p class="lede">Dev Update 5.2 · Generated ${esc(date)} · Five versioned portrait families · One structured reading per period. Founder defaults: Lunar Field daily, Planetary Grid weekly, and Orbit Signal monthly or special. Symbolic lines are visibly labelled editorial demo copy; every Moon state, position, period, and selected event comes from Orbit's deterministic engine.</p>`
  + sections.join("")
  + `<script type="application/json" id="review-manifest">${JSON.stringify(manifest).replace(/</g, "\\u003c")}</script>`
  + `</body></html>`;

writeFileSync(output, html);
console.log(`Wrote ${output.pathname} (${manifest.length} family-period combinations)`);
