#!/usr/bin/env node
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? javascriptFiles(file) : entry.name.endsWith(".js") ? [file] : [];
  }).sort();
}

export function checkSyntax(files) {
  let failed = false;
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
    if (result.status !== 0) failed = true;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  // Vercel deliberately excludes tests from the upload. Source directories
  // remain mandatory; tests are checked whenever they are present.
  const directories = ["api", "lib", "public", "scripts"];
  if (existsSync(join(root, "test"))) directories.push("test");
  const files = [join(root, "server.js"), ...directories
    .flatMap((dir) => javascriptFiles(join(root, dir)))];
  process.exitCode = checkSyntax(files);
  if (!process.exitCode) console.log(`Syntax checked ${files.length} JavaScript files.`);
}
