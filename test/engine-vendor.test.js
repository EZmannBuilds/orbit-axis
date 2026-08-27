// Orbit Axis :: the vendored engine cannot silently disagree with its source.
//
// scripts/engine-sync.js promises that a test runs its drift check. This is
// that test. The full comparison needs the engine repository on disk, so it
// runs wherever a contributor has one checked out (or ORBIT_ENGINE_PATH set)
// and states plainly when it skipped — a skip is visible in the output, a
// missing test is not. The structural half needs nothing but this repository,
// so it always runs: CI without the engine still proves the vendor copy is
// present, whole, and the version the application says it depends on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../lib/local-llm/config.js";
import { VENDOR_DIR, compareVendorToSource, engineSourceDir } from "../scripts/engine-sync.js";

test("the vendored engine is present and importable", () => {
  assert.ok(existsSync(VENDOR_DIR), "vendor/orbit-axis-engine is missing. Run: npm run engine:sync");
  const pkg = JSON.parse(readFileSync(join(VENDOR_DIR, "package.json"), "utf8"));
  assert.equal(pkg.name, "@ezmannbuilds/orbit-axis-engine");
  const entry = join(VENDOR_DIR, pkg.main ?? "src/index.js");
  assert.ok(existsSync(entry), `the vendored engine's entry point ${entry} does not exist`);
});

test("the application depends on the exact vendored copy", () => {
  const app = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(
    app.dependencies["@ezmannbuilds/orbit-axis-engine"],
    "file:vendor/orbit-axis-engine",
    "the dependency must point at vendor/ with a relative file: path — see scripts/engine-sync.js",
  );
  // The lockfile must agree with the vendored version, or `npm ci` installs a
  // stale copy of the engine while the tree holds a newer one.
  const lock = JSON.parse(readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8"));
  const vendored = JSON.parse(readFileSync(join(VENDOR_DIR, "package.json"), "utf8"));
  const locked = lock.packages?.["vendor/orbit-axis-engine"];
  assert.ok(locked, "package-lock.json has no entry for vendor/orbit-axis-engine");
  assert.equal(
    locked.version, vendored.version,
    "package-lock.json disagrees with vendor/orbit-axis-engine/package.json — run: npm install --package-lock-only",
  );
});

test("vendor/ has not drifted from the engine repository", (t) => {
  const verdict = compareVendorToSource();
  if (verdict.skipped) {
    t.skip(`engine repository not at ${engineSourceDir()} — drift not checkable here`);
    return;
  }
  assert.ok(verdict.ok, verdict.detail + (verdict.changed?.length ? `\n  changed: ${verdict.changed.join(", ")}` : ""));
});
