// Orbit Axis :: brand-system contract (Update 4.0.6).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

test("the palette and axis angle have one canonical token definition", () => {
  const tokens = read("public", "styles", "tokens.css");
  const required = {
    "brand-deep-space": "#080a12",
    "brand-surface": "#101321",
    "brand-orbit-purple": "#4a28b8",
    "brand-active-violet": "#7657e8",
    "brand-celestial-highlight": "#b9a7ff",
    "brand-star-white": "#f4f2fa",
    "brand-muted-starlight": "#8e93a8",
    "brand-axis-angle": "62deg",
  };
  for (const [name, value] of Object.entries(required)) {
    assert.match(tokens, new RegExp(`--${name}: ${value.replace("#", "\\#")};`), `${name} must stay canonical`);
  }
  assert.match(tokens, /--font-display: "Inter"/);
  assert.match(tokens, /--font-mono: "IBM Plex Mono"/);
});

test("Pure Orbit carries the four required geometric elements", () => {
  const mark = read("public", "brand", "orbit-axis-mark.svg");
  assert.match(mark, /<circle cx="64" cy="64" r="35"/, "circular orbit");
  assert.match(mark, /<path d="M37 115 91 13"/, "diagonal axis");
  assert.match(mark, /<circle cx="64" cy="64" r="7" fill="#f4f2fa" stroke="#080a12"/, "central observer");
  assert.match(mark, /<circle cx="89" cy="40" r="8" fill="#b9a7ff"/, "orbital point");

  const angle = Math.atan2(115 - 13, 91 - 37) * 180 / Math.PI;
  assert.ok(Math.abs(angle - 62) < 0.2, `axis must remain 62deg, saw ${angle}`);
});

test("the Instrument motif is technical and the Pure Orbit mark is universal", () => {
  const html = read("public", "index.html");
  const app = read("public", "app.js");
  assert.ok((html.match(/\/brand\/orbit-axis-mark\.svg/g) || []).length >= 2,
    "shell and auth reuse the primary mark");
  assert.equal((html.match(/\/brand\/orbit-axis-loader\.svg/g) || []).length, 1,
    "startup uses the functional Pure Orbit loader");
  assert.equal((app.match(/\/brand\/orbit-axis-instrument\.svg/g) || []).length, 1,
    "the technical motif has one deliberate app placement");
  assert.ok(!html.includes("rail__orb"), "the retired ring-and-dot mark is gone");
  assert.match(html, /Your access to the sky\./, "the primary tagline appears in a brand context");
});

test("every browser surface uses the canonical mark as its favicon", () => {
  for (const page of ["index", "privacy", "terms", "support", "source", "account-deletion", "reset-password"]) {
    const html = read("public", `${page}.html`);
    assert.match(html, /rel="icon" type="image\/svg\+xml" href="\/brand\/orbit-axis-mark\.svg"/,
      `${page}.html must use the canonical favicon`);
  }
});

test("the native icon is opaque RGB and derived from Pure Orbit", () => {
  const svg = read("assets", "icon.svg");
  assert.match(svg, /M300 910 724 114/, "native source carries the 62deg axis");
  assert.match(svg, /cx="512" cy="512" r="54" fill="#f4f2fa"/, "native observer point");

  const png = readFileSync(join(ROOT, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-512@2x.png"));
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
  assert.equal(png[25], 2, "PNG colour type 2 is opaque RGB with no alpha channel");
});

test("brand motion is finite and withdraws under reduced motion", () => {
  const css = read("public", "styles", "orbit-mark.css");
  const loader = read("public", "brand", "orbit-axis-loader.svg");
  assert.match(css, /orbit-mark-arrive var\(--duration-brand-reveal\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  assert.ok(!/infinite/.test(css), "identity reveal motion may not loop indefinitely");
  assert.match(loader, /class="orbit-loader__moving-group"[\s\S]*<path d="M37 115 91 13"[\s\S]*<circle cx="89" cy="40"/,
    "the canonical loader moves the axis and orbital point as one group");
  assert.match(loader, /animation: orbit-loader-sweep 1\.4s linear infinite/,
    "the axis and point sweep continuously at a constant rate");
  assert.match(loader, /transform-origin: 64px 64px/,
    "the moving group sweeps around the observer");
  assert.match(loader, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/,
    "the functional loader becomes static when reduced motion is requested");
});

test("the desktop lockup does not become a sixth row in the mobile tab bar", () => {
  const app = read("public", "styles", "app.css");
  assert.match(app, /\.rail__brand\.brand-lockup,[^}]+display: none;/,
    "the later brand-lockup display rule must not override mobile navigation");
});
