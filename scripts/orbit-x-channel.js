#!/usr/bin/env node
// Orbit X :: preview the automatic channel locally (Dev Update 6.1).
//
//   node scripts/orbit-x-channel.js preview [--from YYYY-MM-DD] [--days 7]
//        [--yellow] [--ai] [--out DIR]
//
// Runs the REAL channel tick (planning, rotation, writing, every per-post
// check, rendering) against real Orbit engine facts, day by day, with:
//   - an in-memory store instead of Supabase (nothing is written anywhere),
//   - every registry type approved IN MEMORY ONLY, so the rotation has
//     something to rotate (in production each type waits for the founder),
//   - dry run forced: ORBIT_X_AUTOPUBLISH_LIVE is removed, and the Graph API
//     is unreachable by construction (any network call except the AI provider
//     throws),
//   - labelled sample copy, unless --ai is given AND ORBIT_X_AI_API_KEY is set,
//     in which case Claude writes the copy exactly as it would in production.
//
// With --out DIR every slide is written as the PNG the desk would export and
// the JPEG Meta would receive. Nothing is published, ever.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { memoryChannelStore, previewCopy } from "../lib/orbit-x/memory-store.js";
import { runChannelTick } from "../lib/orbit-x/channel.js";
import { syncRegistry, samplePost } from "../lib/orbit-x/post-types.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };

if (args[0] !== "preview") {
  console.log("usage: node scripts/orbit-x-channel.js preview [--from YYYY-MM-DD] [--days 7] [--yellow] [--ai] [--out DIR]");
  process.exit(args.length ? 1 : 0);
}

const from = value("from", new Date().toISOString().slice(0, 10));
const days = Math.max(1, Math.min(60, Number(value("days", 7)) || 7));
const out = value("out", null);
const useAi = flag("ai") && Boolean(process.env.ORBIT_X_AI_API_KEY);

const env = { ...process.env, ORBIT_X_ENABLED: "true", ORBIT_X_AUTOPUBLISH: "true",
  ORBIT_X_AUTOPUBLISH_YELLOW: flag("yellow") ? "true" : "", ORBIT_X_DRY_RUN_UPLOAD: out ? "true" : "",
  ...(useAi ? {} : { ORBIT_X_AI_API_KEY: "preview-sample-copy" }) };
delete env.ORBIT_X_AUTOPUBLISH_LIVE;
delete env.ORBIT_X_KILL_SWITCH;

let clock = new Date(`${from}T13:05:00Z`);
const store = memoryChannelStore({ now: () => clock });
await syncRegistry(store);
await store.approveAll();

const allowAiOnly = async (url, init) => {
  if (useAi && String(url).startsWith("https://api.anthropic.com/")) return fetch(url, init);
  throw new Error(`preview blocks network access (${new URL(String(url)).host})`);
};
const media = out ? {
  async upload(path, bytes) {
    const file = join(resolve(out), path.split("/").slice(1).join("_"));
    mkdirSync(resolve(out), { recursive: true });
    writeFileSync(file, bytes);
    return `file://${file}`;
  },
} : null;

console.log(`Orbit X channel preview · ${days} day(s) from ${from} · ${flag("yellow") ? "green + yellow" : "green only"} · copy: ${useAi ? "Claude" : "labelled sample"}`);
for (let d = 0; d < days; d += 1) {
  for (let tick = 0; tick < 3; tick += 1) {
    clock = new Date(Date.parse(`${from}T13:05:00Z`) + d * 86_400_000 + tick * 3_600_000);
    await runChannelTick({ env, store, deps: { now: () => clock, fetchImpl: allowAiOnly, media, budgetMs: 120_000,
      ...(useAi ? {} : { generate: (packet) => previewCopy(packet, { samplePost }) }) } });
  }
  const date = clock.toISOString().slice(0, 10);
  const run = store.db.runs.find((r) => r.slot_date === date);
  const failed = (run?.checks || []).filter((c) => !c.passed && c.blocking).map((c) => c.id);
  console.log([date, run?.state || "-", run?.format || "-", run?.post_type_label || "-",
    run?.plan?.hookStyle || "-", run?.plan?.captionStructure || "-",
    run?.generated?.headline ? `"${run.generated.headline}"` : "", failed.length ? `failed: ${failed.join(",")}` : "",
    run?.state === "skipped" ? `(${run.error})` : ""].join("  "));
}
if (out) console.log(`Slides written to ${resolve(out)}`);
