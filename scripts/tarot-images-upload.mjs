// Orbit Axis :: upload the Tarot card fronts to Supabase Storage.
//
// The backs are local and the fronts are not — see [[Tarot Card Imagery]] for
// why. This puts the fronts where the app expects them.
//
//   node scripts/tarot-images-upload.mjs            upload missing files
//   node scripts/tarot-images-upload.mjs --force    re-upload everything
//   node scripts/tarot-images-upload.mjs --check    report what is there
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment. The
// service-role key is required because creating a bucket and writing objects
// are not things an anonymous client may do — and it is exactly why this is a
// script somebody runs deliberately rather than anything the server does at
// request time. The key never reaches a browser and is never written to a file
// by this script.
//
// The bucket is PUBLIC on purpose. The deck is reference content, identical
// for every reader, carrying nothing about anyone. Signed URLs would add
// per-request work and defeat CDN caching in order to protect public-domain
// artwork from 1909.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../lib/local-llm/config.js";

const BUCKET = "tarot-cards";
const STAGING = join(REPO_ROOT, "assets", "tarot-cards");
const MANIFEST = join(REPO_ROOT, "lib", "tarot", "image-manifest.json");
const DECK_PATH = "waite-smith/1909";

/** A year, immutable: a path is never reused for different bytes. */
const CACHE_CONTROL = "31536000";

const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  console.error("For the local stack: eval \"$(npx supabase status -o env | sed 's/^/export /')\"");
  process.exit(1);
}

const headers = { apikey: key, authorization: `Bearer ${key}` };

async function ensureBucket() {
  const res = await fetch(`${url}/storage/v1/bucket/${BUCKET}`, { headers });
  if (res.ok) {
    const bucket = await res.json();
    if (!bucket.public) {
      console.warn(`Bucket "${BUCKET}" exists but is not public; card images will 404 for readers.`);
    }
    return "existing";
  }
  const created = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      id: BUCKET, name: BUCKET, public: true,
      file_size_limit: 5_000_000,
      allowed_mime_types: ["image/jpeg", "image/webp", "image/png"],
    }),
  });
  if (!created.ok) throw new Error(`could not create bucket: ${created.status} ${await created.text()}`);
  return "created";
}

async function upload(objectPath, bytes, { force }) {
  const target = `${url}/storage/v1/object/${BUCKET}/${objectPath}`;
  if (!force) {
    // HEAD through the public path: if it is already there and readable, this
    // run has nothing to do for it. Re-uploading identical bytes would churn
    // the CDN for no reason.
    const head = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${objectPath}`, { method: "HEAD" });
    if (head.ok) return "skipped";
  }
  const res = await fetch(target, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "image/jpeg",
      "cache-control": CACHE_CONTROL,
      "x-upsert": force ? "true" : "false",
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`${objectPath}: ${res.status} ${await res.text()}`);
  return "uploaded";
}

async function main() {
  if (!existsSync(MANIFEST)) {
    console.error("No image manifest. Run: node scripts/tarot-images.mjs");
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const entries = Object.entries(manifest);
  const force = process.argv.includes("--force");
  const checkOnly = process.argv.includes("--check");

  if (checkOnly) {
    let present = 0;
    for (const [, meta] of entries) {
      const res = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${DECK_PATH}/${meta.file}`, { method: "HEAD" });
      if (res.ok) present += 1;
    }
    console.log(`${present}/${entries.length} card fronts are in ${BUCKET}/${DECK_PATH}.`);
    console.log(`Base URL: ${url}/storage/v1/object/public/${BUCKET}`);
    return;
  }

  console.log(`Bucket: ${await ensureBucket()}`);

  const counts = { uploaded: 0, skipped: 0 };
  const failures = [];
  for (const [slug, meta] of entries) {
    const file = join(STAGING, meta.file);
    if (!existsSync(file)) { failures.push(`${slug}: ${meta.file} missing from staging`); continue; }
    try {
      counts[await upload(`${DECK_PATH}/${meta.file}`, readFileSync(file), { force })] += 1;
      process.stdout.write(`\r  ${counts.uploaded + counts.skipped}/${entries.length}`);
    } catch (error) {
      failures.push(error.message);
    }
  }
  process.stdout.write("\n");

  if (failures.length) {
    console.error(`${failures.length} failure(s):`);
    for (const f of failures.slice(0, 10)) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(`Uploaded ${counts.uploaded}, already present ${counts.skipped}.`);
  console.log("\nSet this so the server can resolve card images:");
  console.log(`  ORBIT_TAROT_IMAGE_BASE_URL=${url}/storage/v1/object/public/${BUCKET}`);
}

await main();
