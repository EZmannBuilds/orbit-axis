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
  assert.equal((html.match(/\/brand\/orbit-logo-motion-orbital-relay\.svg/g) || []).length, 1,
    "startup uses the promoted Orbital Relay loader");
  assert.equal((app.match(/\/brand\/orbit-logo-motion-signal-lock\.svg/g) || []).length, 1,
    "authentication uses Signal Lock while acquiring a session");
  assert.equal((app.match(/\/brand\/orbit-logo-motion-deep-scan\.svg/g) || []).length, 1,
    "Tarot uses Deep Scan while drawing cards");
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

test("the social avatar is the same mark, and clears the circular crop", async () => {
  // Every social platform masks a profile picture to the inscribed circle. The
  // app icon's 62deg axis runs corner to corner, so reusing it would clip both
  // tips — the avatar renders the same geometry with the camera pulled back.
  const { RING, AXIS } = await import("../lib/brand/mark-raster.js");
  const { SPAN, FILL, markExtent } = await import("../scripts/build-social-images.js");

  const png = readFileSync(join(ROOT, "assets", "social", "orbit-axis-avatar-1080.png"));
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1080);
  assert.equal(png[25], 2, "PNG colour type 2 is opaque RGB with no alpha channel");

  // The crop circle is inscribed in the square: its radius is half the window
  // onto the design grid. Nothing the mark draws may reach it.
  const cropRadius = SPAN / 2;
  assert.ok(markExtent() < cropRadius, "the mark fits inside the circular crop");
  assert.equal(Math.round((markExtent() / cropRadius) * 100), Math.round(FILL * 100),
    "and fills the designed share of it");
  const axisTip = Math.hypot(AXIS.x2 - RING.x, AXIS.y2 - RING.y) + AXIS.stroke / 2;
  assert.ok(cropRadius - axisTip > 100, "the axis tips keep real clearance, not a hairline");
});

test("a pasted link carries a preview card that actually exists", () => {
  // Without these the link renders as a bare URL everywhere that unfurls one.
  // The failure is silent — the page looks perfect, and only the paste is
  // wrong — so the contract is asserted rather than eyeballed once.
  const html = read("public", "index.html");
  const tag = (property) =>
    new RegExp(`<meta property="${property}" content="([^"]+)"`).exec(html)?.[1] ?? null;

  const image = tag("og:image");
  const url = tag("og:url");
  assert.ok(image && url, "og:image and og:url are declared");
  for (const value of [image, url]) {
    assert.match(value, /^https:\/\//, `${value} is absolute — X and Slack will not resolve a relative one`);
  }
  assert.equal(new URL(image).host, new URL(url).host,
    "the card and the canonical URL name the same host, or one of them is stale");

  // The declared image must exist in public/ and be the size it claims: a
  // mismatch is how a card silently becomes a grey box in someone's DMs.
  const png = readFileSync(join(ROOT, "public", new URL(image).pathname));
  assert.equal(png.readUInt32BE(16), Number(tag("og:image:width")));
  assert.equal(png.readUInt32BE(20), Number(tag("og:image:height")));
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(html, /<meta property="og:image:alt" content="[^"]{40,}"/, "the card is described, not just shown");

  // /favicon.ico is requested by path regardless of what the document says.
  const ico = readFileSync(join(ROOT, "public", "favicon.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1, "ICO type 1 = icon");
  assert.ok(ico.readUInt16LE(4) >= 1, "at least one size is packed");
  assert.match(html, /<link rel="icon" href="\/favicon.ico"/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon.png"/);
});

test("the page cover survives both crops AND the profile picture on top", async () => {
  // Two failures, not one. The crops are arithmetic: Facebook fills each box
  // and centre-crops, so only the intersection is on every screen. The profile
  // picture is NOT arithmetic — it lands over the bottom CENTRE, and the first
  // version of this cover put the wordmark and tagline exactly there. The
  // preview read "Calc———nted." Both are asserted here because neither is
  // visible from the machine that uploads the file.
  const { COVER, LEFT_STRIP, coverSvg } = await import("../lib/brand/social-cover.js");
  const { width: W, height: H, safe, avatar } = COVER;

  const shows = (boxW, boxH) => {
    const scale = Math.max(boxW / W, boxH / H);   // fill, then centre-crop
    return { w: Math.min(W, boxW / scale), h: Math.min(H, boxH / scale) };
  };
  const desktop = shows(820, 312);
  const mobile = shows(640, 360);
  assert.equal(Math.round(Math.min(desktop.w, mobile.w)), safe.w, "safe width is the crops' intersection");
  assert.equal(Math.round(Math.min(desktop.h, mobile.h)), safe.h, "safe height is the crops' intersection");
  assert.equal(safe.x, Math.round((W - safe.w) / 2), "and it is centred");
  assert.equal(safe.y, Math.round((H - safe.h) / 2));
  assert.equal(LEFT_STRIP.w, avatar.x - safe.x, "the clear column ends where the avatar begins");

  const svg = coverSvg();
  assert.match(svg, new RegExp(`viewBox="0 0 ${W} ${H}"`));
  assert.ok(!/aria-label="Orbit Axis"/.test(svg.replace(/aria-label="Orbit Axis — [^"]*"/, "")),
    "the mark is NOT drawn: the profile picture is already the mark, inches away");

  // Same width model the slide renderer fits with, so the two agree about what
  // a string costs. Conservative on purpose — an overestimate here is a margin,
  // an underestimate is type sliding under a profile picture.
  const FACTOR = { serif: 0.54, sans: 0.50 };
  const texts = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*font-family="([^"]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]+)</g)];
  assert.ok(texts.length >= 2, "the cover carries an eyebrow and a statement");

  for (const [, x, y, family, size, label] of texts) {
    const width = label.length * Number(size) * (/Georgia/.test(family) ? FACTOR.serif : FACTOR.sans);
    const right = Number(x) + width;
    assert.ok(Number(x) >= safe.x, `"${label}" starts inside the safe zone`);
    assert.ok(Number(y) > safe.y && Number(y) < safe.y + safe.h, `"${label}" sits in the safe band`);
    assert.ok(avatar.x - right >= 48,
      `"${label}" ends at ${right.toFixed(0)}, which crowds the profile picture at ${avatar.x}`);
  }
});

test("brand motion is finite and withdraws under reduced motion", () => {
  const css = read("public", "styles", "orbit-mark.css");
  const loader = read("public", "brand", "orbit-logo-motion-orbital-relay.svg");
  assert.match(css, /orbit-mark-arrive var\(--duration-brand-reveal\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  assert.ok(!/infinite/.test(css), "identity reveal motion may not loop indefinitely");
  assert.match(loader, /class="relay__phase"[\s\S]*class="relay__signal"[\s\S]*class="relay__satellite"/,
    "the promoted loader combines orbit phase, signal transit, and satellite motion");
  assert.match(loader, /animation: relay-spin 3\.2s linear infinite/,
    "the orbital phase loops continuously");
  assert.match(loader, /transform-origin: 64px 64px/,
    "the relay layers move around the observer");
  assert.match(loader, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/,
    "the functional loader becomes static when reduced motion is requested");
});

test("promoted logo motion preserves the mark and withdraws under reduced motion", () => {
  const html = read("public", "index.html");
  const app = read("public", "app.js");
  const css = read("public", "styles", "orbit-mark.css");
  const studies = ["signal-lock", "orbital-relay", "deep-scan"];

  for (const name of studies) {
    const svg = read("public", "brand", `orbit-logo-motion-${name}.svg`);
    assert.match(svg, /viewBox="0 0 128 128"/);
    assert.match(svg, /<title id="title">/);
    assert.match(svg, /<desc id="desc">/);
    assert.match(svg, /<circle[^>]+cx="64" cy="64" r="35"/, `${name} keeps the primary orbit`);
    assert.match(svg, /<path[^>]+d="M37 115 91 13"/, `${name} keeps the 62deg axis`);
    assert.match(svg, /<circle[^>]+cx="64" cy="64" r="7"/, `${name} keeps the observer`);
    assert.match(svg, /<circle[^>]+cx="89" cy="40" r="8"/, `${name} keeps the orbital point`);
    assert.match(svg, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/,
      `${name} becomes a static mark when reduced motion is requested`);
    assert.ok((svg.match(/animation:/g) || []).length >= 4, `${name} is a layered motion system`);
  }

  assert.match(html, /class="orbit-loader orbit-motion-mark" src="\/brand\/orbit-logo-motion-orbital-relay\.svg"/);
  assert.match(app, /class="auth-pending__mark orbit-motion-mark" src="\/brand\/orbit-logo-motion-signal-lock\.svg"/);
  assert.match(app, /class="tarot-card-loader__mark orbit-motion-mark"[\s\S]{0,100}orbit-logo-motion-deep-scan\.svg/);
  assert.match(css, /:root\[data-motion="reduced"\] \.orbit-motion-mark[\s\S]{0,100}orbit-axis-mark\.svg/,
    "the in-app reduced-motion setting swaps every animated image to the static mark");
});

test("the desktop lockup does not become a sixth row in the mobile tab bar", () => {
  const app = read("public", "styles", "app.css");
  assert.match(app, /\.rail__brand\.brand-lockup,[^}]+display: none;/,
    "the later brand-lockup display rule must not override mobile navigation");
});
