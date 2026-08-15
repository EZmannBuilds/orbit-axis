// Orbit Axis :: source the Tarot card scans.
//
// Downloads the Waite-Smith card images from Wikimedia Commons, verifies each
// one is actually public domain BEFORE keeping it, resizes it, and writes a
// manifest the deck reads its image dimensions from.
//
// WHY THIS IS A SCRIPT AND NOT A ONE-OFF
//
// Seventy-eight files fetched by hand is seventy-eight chances to grab the
// wrong card, miss one, or quietly keep an image whose licence turned out to
// be something else. The script asserts what it assumed: every file must exist,
// every licence must be a public-domain one, and the count must come to 78 or
// nothing is written. Re-running it reproduces the same set.
//
// The Waite-Smith deck (1909) entered the United States public domain in 1966
// and the United Kingdom's in 2021-22, seventy years after Pamela Colman
// Smith's death in 1951. The licence check below is not a formality — it reads
// what Commons actually says about each file today.
//
//   node scripts/tarot-images.mjs            download, resize, write manifest
//   node scripts/tarot-images.mjs --verify   check the manifest matches disk
//
// Output: public/images/tarot/cards/<slug>.jpg  (ships with the app)
//         lib/tarot/image-manifest.json

import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { REPO_ROOT } from "../lib/local-llm/config.js";
import { DRAFT_CARDS } from "../lib/tarot/draft-deck.js";

// UNDER public/, deliberately. Capacitor bundles public/ into the iOS binary,
// so the cards travel with the app: on a phone they are local files that need
// no network, work with no signal, and cost no egress. On the web they are
// ordinary static assets.
const OUT_DIR = join(REPO_ROOT, "public", "images", "tarot", "cards");
const MANIFEST = join(REPO_ROOT, "lib", "tarot", "image-manifest.json");

/** Target height. The card renders at ~200 CSS px, so this covers 2-3x DPR. */
const HEIGHT = 800;
/** JPEG quality. 45 holds up at this size; see the note on WebP below. */
const QUALITY = 45;

/**
 * Licence values Commons reports that mean "free to use without attribution
 * conditions we cannot meet". Anything else stops the run rather than being
 * downloaded and sorted out later.
 */
const ACCEPTED_LICENCES = [/public domain/i, /^cc0/i, /^pd/i];

/** Our slug -> the Commons file title. */
const MAJOR_FILES = {
  "the-fool": "RWS_Tarot_00_Fool.jpg",
  "the-magician": "RWS_Tarot_01_Magician.jpg",
  "the-high-priestess": "RWS_Tarot_02_High_Priestess.jpg",
  "the-empress": "RWS_Tarot_03_Empress.jpg",
  "the-emperor": "RWS_Tarot_04_Emperor.jpg",
  "the-hierophant": "RWS_Tarot_05_Hierophant.jpg",
  "the-lovers": "RWS_Tarot_06_Lovers.jpg",
  "the-chariot": "RWS_Tarot_07_Chariot.jpg",
  "strength": "RWS_Tarot_08_Strength.jpg",
  "the-hermit": "RWS_Tarot_09_Hermit.jpg",
  "wheel-of-fortune": "RWS_Tarot_10_Wheel_of_Fortune.jpg",
  "justice": "RWS_Tarot_11_Justice.jpg",
  // Our card is "The Hanged One"; the 1909 plate is titled "Hanged Man".
  "the-hanged-one": "RWS_Tarot_12_Hanged_Man.jpg",
  "death": "RWS_Tarot_13_Death.jpg",
  "temperance": "RWS_Tarot_14_Temperance.jpg",
  "the-devil": "RWS_Tarot_15_Devil.jpg",
  "the-tower": "RWS_Tarot_16_Tower.jpg",
  "the-star": "RWS_Tarot_17_Star.jpg",
  "the-moon": "RWS_Tarot_18_Moon.jpg",
  "the-sun": "RWS_Tarot_19_Sun.jpg",
  "judgement": "RWS_Tarot_20_Judgement.jpg",
  "the-world": "RWS_Tarot_21_World.jpg",
};

/** Commons names the minors by suit abbreviation and two-digit rank. */
const SUIT_PREFIX = { wands: "Wands", cups: "Cups", swords: "Swords", pentacles: "Pents" };

function commonsFile(card) {
  if (card.arcana === "major") return MAJOR_FILES[card.slug];
  const prefix = SUIT_PREFIX[card.suit];
  return prefix ? `${prefix}${String(card.number).padStart(2, "0")}.jpg` : null;
}

/**
 * Commons asks for a descriptive User-Agent and rate-limits anonymous clients
 * that do not send one. Seventy-eight separate metadata requests earned a wall
 * of 429s on the first run; the API accepts up to fifty titles per query, so
 * the whole deck is two requests.
 */
/** One spelling of a file title: underscores and spaces are the same character. */
function titleKey(title) {
  return String(title).replace(/_/g, " ").trim();
}

const UA = "orbit-axis-tarot-image-script/1.0 (https://orbit-axis.vercel.app; tarot deck imagery)";

async function apiFetch(url, attempt = 0) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { "user-agent": UA, accept: "application/json" },
  });
  if (res.status === 429 && attempt < 4) {
    // Back off rather than hammering. A public archive that says "slow down"
    // is telling us something we should honour, not route around.
    const wait = 2000 * (attempt + 1);
    await new Promise((r) => setTimeout(r, wait));
    return apiFetch(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Commons API ${res.status}`);
  return res.json();
}

/** Metadata for many files at once. Returns a Map keyed by file title. */
async function commonsInfoBatch(titles) {
  const found = new Map();
  for (let i = 0; i < titles.length; i += 40) {
    const chunk = titles.slice(i, i + 40);
    const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
      action: "query",
      titles: chunk.map((t) => `File:${t}`).join("|"),
      prop: "imageinfo", iiprop: "url|size|extmetadata", format: "json",
    });
    const data = await apiFetch(url);
    for (const page of Object.values(data.query?.pages ?? {})) {
      if (!page?.imageinfo?.length) continue;
      const info = page.imageinfo[0];
      // Commons NORMALISES titles in its response: "File:RWS_Tarot_00_Fool.jpg"
      // comes back as "File:RWS Tarot 00 Fool.jpg" with spaces. Keying the map
      // on the raw response title meant every filename containing an
      // underscore — all twenty-two majors — looked missing while the
      // underscore-free minors resolved fine.
      found.set(titleKey(String(page.title).replace(/^File:/, "")), {
        url: info.url,
        width: info.width,
        height: info.height,
        licence: info.extmetadata?.LicenseShortName?.value ?? "(none stated)",
      });
    }
    if (i + 40 < titles.length) await new Promise((r) => setTimeout(r, 1000));
  }
  return found;
}

async function download(url, to, attempt = 0) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(120000),
    headers: { "user-agent": UA },
  });
  // The metadata API had backoff; the image host did not, and the last six
  // cards of a 78-file run were exactly where the limiter noticed. Same
  // courtesy applies to both: a public archive asking us to slow down is worth
  // honouring rather than routing around.
  if (res.status === 429 && attempt < 5) {
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    return download(url, to, attempt + 1);
  }
  if (!res.ok) throw new Error(`download ${res.status} for ${url}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

/**
 * Resize with sips.
 *
 * WebP would be roughly 30% smaller and the spec asks for it, but this machine
 * has no WebP encoder (no cwebp, no ImageMagick; sips on this macOS build
 * refuses the format). JPEG at this size is 80-100KB, which is acceptable, and
 * converting the set later is one re-run of this script on a machine that has
 * an encoder. Recorded rather than silently accepted.
 */
function resize(from, to) {
  execFileSync("sips", [
    "-s", "format", "jpeg",
    "-s", "formatOptions", String(QUALITY),
    "-Z", String(HEIGHT),
    from, "--out", to,
  ], { stdio: "ignore" });
  const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", to], { encoding: "utf8" });
  const width = Number(out.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(out.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!width || !height) throw new Error(`could not read dimensions of ${to}`);
  return { width, height };
}

async function main() {
  if (process.argv.includes("--verify")) return verify();

  mkdirSync(OUT_DIR, { recursive: true });
  const staging = join(OUT_DIR, ".original");
  mkdirSync(staging, { recursive: true });

  const manifest = {};
  const problems = [];
  let done = 0;

  const titles = DRAFT_CARDS.map(commonsFile).filter(Boolean);
  console.log(`Resolving ${titles.length} files on Commons…`);
  const infoByTitle = await commonsInfoBatch(titles);

  for (const card of DRAFT_CARDS) {
    const title = commonsFile(card);
    if (!title) { problems.push(`${card.slug}: no Commons file mapped`); continue; }

    try {
      const info = infoByTitle.get(titleKey(title));
      if (!info) throw new Error(`no such file on Commons: ${title}`);
      if (!ACCEPTED_LICENCES.some((re) => re.test(info.licence))) {
        problems.push(`${card.slug}: licence is "${info.licence}", not public domain`);
        continue;
      }
      const original = join(staging, title);
      if (!existsSync(original)) {
        await download(info.url, original);
        await new Promise((r) => setTimeout(r, 250));   // be a considerate client
      }
      const target = join(OUT_DIR, `${card.slug}.jpg`);
      const { width, height } = resize(original, target);

      manifest[card.slug] = {
        file: `${card.slug}.jpg`,
        width, height,
        bytes: statSync(target).size,
        license: "public-domain",
        source: `Wikimedia Commons, File:${title} — Waite-Smith deck (1909)`,
        source_licence_as_stated: info.licence,
      };
      done += 1;
      process.stdout.write(`\r  ${done}/${DRAFT_CARDS.length}  ${card.slug.padEnd(24)}`);
    } catch (error) {
      problems.push(`${card.slug}: ${error.message}`);
    }
  }
  process.stdout.write("\n");

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
  }
  // All or nothing. A 74-card manifest would produce a deck where four cards
  // silently render text while the rest render art, which looks like a bug in
  // the four rather than an incomplete download.
  if (Object.keys(manifest).length !== DRAFT_CARDS.length) {
    console.error(`\nRefusing to write a partial manifest: ${Object.keys(manifest).length}/${DRAFT_CARDS.length}.`);
    process.exit(1);
  }

  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  const total = Object.values(manifest).reduce((sum, m) => sum + m.bytes, 0);
  console.log(`\nWrote ${Object.keys(manifest).length} cards, ${(total / 1e6).toFixed(1)}MB total.`);
  console.log(`Manifest: ${MANIFEST}`);
}

function verify() {
  if (!existsSync(MANIFEST)) { console.error("No manifest. Run without --verify first."); process.exit(1); }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const missing = Object.entries(manifest).filter(([, m]) => !existsSync(join(OUT_DIR, m.file)));
  if (missing.length) {
    console.error(`${missing.length} file(s) in the manifest are not on disk.`);
    process.exit(1);
  }
  console.log(`${Object.keys(manifest).length} cards present and accounted for.`);
}

await main();
