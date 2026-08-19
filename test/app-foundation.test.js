// Orbit Axis :: application foundation (Update 1.1.1).
//
// The native container cannot be built on a machine without Xcode, so these
// cover the parts that are testable anywhere: the configuration contract, and
// the promise that the browser build is unchanged.
//
// That second one matters most. The web application is the source application,
// and the way this update could quietly damage it is by making the browser
// depend on something only the app has.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { auditApiOrigin, normalizeApiBase } from "../scripts/app-config.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ── The API origin contract ─────────────────────────────────────────────────

test("no configuration means same-origin", () => {
  // The browser default. Anything else here would break every web visitor.
  for (const value of ["", "   ", undefined, null]) {
    assert.equal(normalizeApiBase(value), "");
  }
});

test("an https origin is accepted and normalised", () => {
  assert.equal(normalizeApiBase("https://example.test"), "https://example.test");
  assert.equal(normalizeApiBase("  https://example.test  "), "https://example.test");
});

test("http is allowed only for localhost", () => {
  // There is no transport to protect on a loopback address, and refusing it
  // would make local native development impossible.
  assert.equal(normalizeApiBase("http://localhost:3002"), "http://localhost:3002");
  assert.equal(normalizeApiBase("http://127.0.0.1:3002"), "http://127.0.0.1:3002");
  // Anywhere else, http would send session cookies and birth data in clear
  // text, so it is refused rather than warned about.
  assert.throws(() => normalizeApiBase("http://example.test"), /must use https/);
});

test("a URL with a path, query, or fragment is refused", () => {
  // apiUrl() concatenates this with "/api/...". A path here silently produces
  // "https://host/base/api/..." and every request 404s.
  for (const value of ["https://example.test/api", "https://example.test/?a=1", "https://example.test/#x"]) {
    assert.throws(() => normalizeApiBase(value), /must be an origin with no path/);
  }
});

test("an unparsable value fails loudly rather than shipping", () => {
  assert.throws(() => normalizeApiBase("not-a-url"), /not a valid URL/);
});

// ── The API origin audit: real in the bundle, inert in the repository ───────
// One file, two opposite requirements, judged as a pure function so both
// directions of the 2026-08-19 failure are held: the check that refused a
// correctly configured checkout, and the empty default that shipped to a phone
// and answered every /api request itself with a 200.

// The fixture carries the real file's trap: a header comment that mentions
// `apiBaseUrl: ""` as prose ABOVE the declaration. A whole-file regex finds
// the comment first and reports every config as empty — which is how the
// previous guard passed a configured and an unconfigured checkout alike.
const configWith = (origin) => [
  "// Orbit Axis :: runtime application configuration.",
  '//   apiBaseUrl: ""  →  the application calls its own origin.',
  "globalThis.ORBIT_APP_CONFIG = {",
  `  apiBaseUrl: ${JSON.stringify(origin)},`,
  "};",
  "",
].join("\n");

test("a native bundle cannot ship the empty same-origin default", () => {
  const inert = configWith("");
  const { problems } = auditApiOrigin({ workingTree: inert, committed: inert });
  assert.equal(problems.length, 1);
  // The failure names the mechanism and the fix, because the symptom it
  // prevents — 200s from capacitor://localhost — looks like success.
  assert.match(problems[0], /capacitor:\/\/localhost/);
  assert.match(problems[0], /ORBIT_APP_API_BASE_URL=<https origin> npm run app:config/);
});

test("a configured checkout passes — the build chain must not refuse its own contract", () => {
  const { problems, notes } = auditApiOrigin({
    workingTree: configWith("https://example.test"),
    committed: configWith(""),
  });
  assert.deepEqual(problems, [], "a real origin locally plus the inert default in git is the documented flow");
  assert.ok(notes.some((n) => n.includes("https://example.test")),
    "the origin the bundle will call is stated, not silent");
});

test("a real origin in git is refused, wherever the working tree stands", () => {
  // Committing the value would override every browser visitor's own origin.
  for (const workingTree of [configWith(""), configWith("https://example.test")]) {
    const { problems } = auditApiOrigin({ workingTree, committed: configWith("https://example.test") });
    assert.ok(problems.some((p) => /committed public\/app-config\.js has apiBaseUrl/.test(p)),
      "the commit guard must hold independently of the bundle-side answer");
  }
});

test("a missing or undeclared config is a problem, not a pass", () => {
  assert.ok(auditApiOrigin({ workingTree: null, committed: configWith("") })
    .problems.some((p) => /missing/.test(p)));
  assert.ok(auditApiOrigin({ workingTree: "// nothing here", committed: configWith("") })
    .problems.some((p) => /does not declare apiBaseUrl/.test(p)));
  assert.ok(auditApiOrigin({ workingTree: configWith("https://example.test"), committed: "// nothing" })
    .problems.some((p) => /committed .* does not declare/.test(p)));
});

test("no answer from git skips the commit guard honestly", () => {
  // A tarball checkout has no index to ask. That is a skipped check to report,
  // not a failure to invent and not a pass to assume.
  const { problems, notes } = auditApiOrigin({
    workingTree: configWith("https://example.test"), committed: null,
  });
  assert.deepEqual(problems, []);
  assert.ok(notes.some((n) => /skipped/.test(n)));
});

test("every native sync path runs the audit first", () => {
  // The guard exists only if the build chain actually consults it before
  // `cap sync` copies the working tree into the device bundle.
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.scripts["app:build"], /npm run app:check && npx cap sync ios/);
  assert.match(pkg.scripts["app:sync"], /npm run app:check && npx cap sync ios/,
    "the standalone sync must not bypass the check the build chain relies on");
  const check = read("scripts/app-check.js");
  assert.match(check, /auditApiOrigin\(/);
  assert.match(check, /"show", ":public\/app-config\.js"/,
    "the commit side is read from git's index, not inferred from the working tree");
});

// ── The web build must not depend on the native container ───────────────────

test("the committed app config is the inert same-origin default", () => {
  // `npm run app:config` writes a real origin for a native build. Committing
  // that value would override every browser visitor's own origin. Read from
  // git's INDEX: the working tree legitimately holds a real origin on a
  // machine that builds the app, and that is not what this test polices.
  let config;
  try {
    config = execFileSync("git", ["show", ":public/app-config.js"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    config = read("public/app-config.js");   // no git: the shipped file IS the commit
  }
  assert.match(config, /apiBaseUrl:\s*""/,
    "public/app-config.js must be committed with an empty apiBaseUrl");
});

test("index.html references the app config, so the build cannot lose it", () => {
  // scripts/build.js fails when index.html references a missing file. That is
  // the mechanism keeping this config present on a clean checkout.
  assert.match(read("public/index.html"), /src="\/app-config\.js"/);
});

test("application code reaches the platform through the adapter, not Capacitor", () => {
  // One place knows which container this is. Scattered window.Capacitor checks
  // are how a web build breaks for a native reason.
  const appJs = read("public/app.js");
  assert.ok(!/window\.Capacitor|globalThis\.Capacitor/.test(appJs),
    "public/app.js must not reference Capacitor directly");
  // The import list grew when the native container needed to carry its own
  // session, so this pins the SOURCE rather than one exact set of names — the
  // guarantee is that platform knowledge arrives from one module, not that the
  // module exports exactly what it did on the day this was written.
  assert.match(appJs, /^import \{[^}]*\} from "\.\/platform\.js";$/m,
    "public/app.js must import its platform knowledge from platform.js");
  assert.match(appJs, /import \{[^}]*\bapiUrl\b[^}]*\} from "\.\/platform\.js"/,
    "apiUrl() is how every API path is resolved");
});

test("no API call bypasses the platform adapter", () => {
  // A bare fetch("/api/...") works in a browser and 404s inside the app
  // bundle, which is exactly the kind of bug that only appears on a device.
  const appJs = read("public/app.js");
  const bare = appJs.match(/fetch\(\s*[`"]\/api\//g) || [];
  assert.deepEqual(bare, [], "every /api request must go through apiUrl()");
});

test("the platform adapter is a no-op without Capacitor", () => {
  // Read as source rather than imported: this module is browser-targeted and
  // the guarantee is structural — every native branch is behind isNativeApp().
  const platform = read("public/platform.js");
  assert.match(platform, /if \(!isNativeApp\(\)\) return "";/,
    "apiBase() must return same-origin in a browser");
  assert.match(platform, /typeof cap\.isNativePlatform === "function"/,
    "native detection must be feature-detected, not assumed");
});

test("no bare module specifier is imported by browser-served code", () => {
  // Orbit ships no bundler, so `import "@capacitor/browser"` is unresolvable
  // in both the browser and the WebView. Plugins are reached through the
  // global bridge instead.
  //
  // Matched as STATEMENTS, not as the substring `from "…"`. The looser version
  // read English: a comment saying one thing is different `from "Leo season"`
  // was reported as a bare import, and the failure named a specifier that does
  // not exist. A guard that fires on prose is a guard people learn to silence.
  const SPECIFIERS = [
    /^[ \t]*(?:import|export)[^\n]*?\bfrom\s+"([^"]+)"/gm,  // import x from "…"
    /^[ \t]*import\s+"([^"]+)"/gm,                          // side-effect import
    /\bimport\(\s*"([^"]+)"\s*\)/g,                        // dynamic import()
  ];
  for (const file of ["public/platform.js", "public/native-shell.js", "public/app.js"]) {
    const source = read(file);
    const bare = [];
    for (const pattern of SPECIFIERS) {
      for (const [, specifier] of source.matchAll(pattern)) {
        // Relative or absolute resolves without a bundler; anything else does not.
        if (!specifier.startsWith(".") && !specifier.startsWith("/")) bare.push(specifier);
      }
    }
    assert.deepEqual(bare, [], `${file} must not import a bare specifier`);
  }
});

test("the bare-specifier guard actually detects one", () => {
  // The regexes above are the whole test, so they get their own fixture — the
  // previous version passed for years while matching the wrong thing.
  const fixture = [
    'import { a } from "@capacitor/core";',
    'import "./fine.js";',
    'const m = await import("/also-fine.js");',
    '// a comment that is different from "Leo season"',
  ].join("\n");
  const found = [...fixture.matchAll(/^[ \t]*(?:import|export)[^\n]*?\bfrom\s+"([^"]+)"/gm)]
    .map((m) => m[1])
    .filter((s) => !s.startsWith(".") && !s.startsWith("/"));
  assert.deepEqual(found, ["@capacitor/core"],
    "the guard must catch a real bare import and ignore prose");
});

// ── Capacitor configuration ─────────────────────────────────────────────────

test("webDir matches what Vercel actually serves", () => {
  // The app and the website must ship the same files, or they are two
  // products built from one repository.
  const cap = JSON.parse(read("capacitor.config.json"));
  const vercel = JSON.parse(read("vercel.json"));
  assert.equal(cap.webDir, vercel.outputDirectory);
});

test("the bundle identifier is a reversible development one", () => {
  const cap = JSON.parse(read("capacitor.config.json"));
  assert.match(cap.appId, /^dev\./,
    "a production bundle identifier is an Apple registration the owner makes deliberately");
});

test("the Capacitor config contains no secret and no hardcoded origin", () => {
  const raw = read("capacitor.config.json");
  // A committed server.url would pin every build to one environment and, on a
  // developer's machine, point the app at whatever was last debugged.
  assert.ok(!/https?:\/\//.test(raw), "no server URL may be committed");

  // Credential-shaped KEY NAMES, walked rather than pattern-matched over the
  // raw text — a substring scan for "key" flags the Keyboard plugin, which is
  // how a security check becomes noise everyone learns to ignore.
  const suspicious = [];
  const walk = (node, path = "") => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (/^(api)?key$|token|secret|password|credential/i.test(key)) {
        suspicious.push(`${path}${key}`);
      }
      walk(value, `${path}${key}.`);
    }
  };
  walk(JSON.parse(raw));
  assert.deepEqual(suspicious, [], "no credential-shaped field belongs in a committed config");
});

// ── Safe areas ──────────────────────────────────────────────────────────────

test("viewport-fit=cover is set, or every safe-area inset resolves to zero", () => {
  // navigation.css has always padded the phone bottom bar with
  // env(safe-area-inset-bottom). Without this meta value that padding is 0 and
  // silently does nothing — on a notched browser as well as in the app.
  assert.match(read("public/index.html"), /viewport-fit=cover/);
});
