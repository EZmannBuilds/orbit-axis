import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { javascriptFiles, checkSyntax } from "../scripts/lint.js";

test("syntax checking catches a broken second file and nested modules", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-lint-test-"));
  try {
    writeFileSync(join(dir, "a.js"), "const valid = 1;");
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested/b.js"), "const = ;");
    const files = javascriptFiles(dir);
    assert.equal(files.length, 2);
    assert.equal(checkSyntax(files), 1);
    writeFileSync(join(dir, "nested/b.js"), "const fixed = 2;");
    assert.equal(checkSyntax(files), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the deployment layout can be checked without the excluded test directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-upload-lint-test-"));
  try {
    writeFileSync(join(dir, "package.json"), '{"type":"module"}');
    writeFileSync(join(dir, "server.js"), "const valid = 1;");
    for (const name of ["api", "lib", "public", "scripts"]) mkdirSync(join(dir, name));
    copyFileSync(new URL("../scripts/lint.js", import.meta.url), join(dir, "scripts/lint.js"));
    const result = spawnSync(process.execPath, [join(dir, "scripts/lint.js")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Syntax checked/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
