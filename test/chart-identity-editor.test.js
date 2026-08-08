// Orbit Axis :: chart identity editor — served-surface contract (Dev Update 1.10).
//
// The editor is browser code; its real behaviour is verified in a real
// browser against the real endpoints. What THESE tests pin is the contract of
// the served surface — the markup and wiring that the browser pass depends
// on — so a refactor that quietly drops the retry button, re-adds a legacy
// relationship option, or starts sending unchanged fields fails here first,
// in CI, rather than in a manual pass nobody re-ran.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const HTML = readFileSync(join(ROOT, "public", "index.html"), "utf8");
const APP = readFileSync(join(ROOT, "public", "app.js"), "utf8");

function section(src, from, to) {
  const a = src.indexOf(from);
  assert.ok(a > -1, `anchor missing: ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `end anchor missing: ${to}`);
  return src.slice(a, b);
}

const MODAL = section(HTML, 'id="identity-modal"', "confirm-modal");

// ── The modal's structure ───────────────────────────────────────────────────

test("the editor offers exactly the four current relationship values", () => {
  const select = section(MODAL, 'id="identity-relationship"', "</select>");
  for (const value of ["self", "family", "friend", "partner"]) {
    assert.ok(select.includes(`value="${value}"`), value);
  }
  assert.ok(!select.includes('value="other"'), "no legacy 'other' choice");
  assert.ok(!select.includes('value="public_figure"'), "no legacy 'public_figure' choice");
  assert.match(select, /value="" selected disabled/, "the placeholder is not a choice");
});

test("the editor says what relationship type is FOR, without showing scores", () => {
  // This line used to promise compatibility "in a future update". Compatibility
  // shipped, so the copy now states what the field actually does today —
  // a promise kept is not the same as a promise still being made.
  assert.ok(MODAL.includes("Relationship type decides which questions Compatibility asks."));
  assert.ok(!/future update/i.test(MODAL), "the feature is built; stop promising it");
  assert.ok(!/compatibility score/i.test(MODAL), "no score UI, no dead panel");
  assert.ok(!/coming soon/i.test(MODAL), "no dead Coming Soon panel");
});

test("the file input accepts the formats a phone actually produces", () => {
  // Was "exactly the three normalizable source types". HEIC was added on
  // 2026-08-08: an iPhone photo IS HEIC, so the old list refused the format
  // the device Orbit ships to produces by default.
  const accept = /id="identity-file"[^>]*accept="([^"]+)"/s.exec(MODAL)?.[1] || "";
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic"]) {
    assert.ok(accept.includes(type), `the picker must accept ${type}`);
  }
});

test("errors are announced, focusable, and carry a named Retry", () => {
  assert.match(MODAL, /id="identity-error"[^>]*role="alert"/);
  assert.match(MODAL, /id="identity-error"[^>]*tabindex="-1"/);
  assert.match(MODAL, /id="identity-retry"/);
  assert.ok(MODAL.includes(">Retry<"), "the retry action is named, not an icon");
  assert.match(MODAL, /id="identity-hint"[^>]*role="status"/);
});

test("the avatar is hidden from assistive tech because adjacent text names the chart", () => {
  assert.match(MODAL, /id="identity-avatar"[^>]*aria-hidden="true"/);
});

test("the editor says it does not touch birth data, and offers no birth fields", () => {
  assert.ok(MODAL.includes("Birth details aren't changed here."));
  for (const field of ["cm-date", "cm-time", "cm-place", "birth_date", "birthplace"]) {
    assert.ok(!MODAL.includes(field), `${field} must not appear in the identity editor`);
  }
});

// ── The wiring ──────────────────────────────────────────────────────────────

const SAVE = section(APP, "async function saveIdentity()", "function wireIdentityEditor()");

test("saves are minimal: only changed fields are sent", () => {
  assert.match(SAVE, /nameChanged = typed !== \(chart\.nickname \|\| ""\)/);
  assert.match(SAVE, /if \(nameChanged\) textPatch\.nickname = typed;/);
  assert.match(SAVE, /Boolean\(chosen\) && chosen !== chart\.relationship_type/);
  assert.match(SAVE, /if \(relationshipChanged\) textPatch\.relationship_type = chosen;/);
  // An empty select (legacy stored value) is never sent, so a rename or
  // picture change cannot reclassify the chart.
  assert.ok(!SAVE.includes("relationship_type: chosen ||"), "no fallback value is invented");
});

test("a retry resumes rather than repeats: the landed PATCH is not re-sent", () => {
  assert.match(SAVE, /if \(!identityForm\.textDone && Object\.keys\(textPatch\)\.length\)/);
  assert.match(SAVE, /identityForm\.textDone = true;/);
});

test("uploads carry the version the editor read, and a conflict refreshes before retry", () => {
  assert.match(APP, /avatar\?expectedVersion=\$\{Number\(chart\.avatar_version\) \|\| 0\}/);
  assert.match(SAVE, /avatar_stale_write/);
  assert.match(SAVE, /await loadSavedCharts\(\)/);
});

test("editing a non-active chart never activates it", () => {
  assert.match(SAVE, /if \(editedId === state\.activeChartId\) await refreshActiveExperience\(\)/);
  assert.ok(!SAVE.includes("/activate"), "the save path contains no activation call");
});

test("object URLs are revoked on cancel, on replace, and after save", () => {
  const reset = section(APP, "function resetIdentityWorkingState()", "function openIdentityEditor(");
  assert.match(reset, /identityForm\.preview\?\.release\(\)/);
  assert.match(APP, /onClose: resetIdentityWorkingState/);
  const chosen = section(APP, "async function onIdentityFileChosen", "function onIdentityRemoveClicked");
  assert.match(chosen, /identityForm\.preview\?\.release\(\)/, "reselecting releases the previous URL");
  assert.match(chosen, /event\.target\.value = ""/, "the original File is not retained by the input");
  assert.match(SAVE, /identityForm\.preview\?\.release\(\)/, "a saved upload releases its preview");
});

test("the avatar fallback needs no JavaScript to appear when an image fails", () => {
  const avatar = section(APP, "function chartAvatarHtml", "document.addEventListener");
  assert.match(avatar, /chartInitials\(chart\.nickname\)/, "initials are always painted beneath");
  assert.match(APP, /classList\?\.contains\("chart-avatar__img"\)\) event\.target\.remove\(\)/,
    "a failed image is removed to reveal them");
  assert.match(avatar, /loading="lazy"/, "list avatars are lazy");
  assert.match(avatar, /aria-hidden="true"/);
});

test("saved-chart cards route identity, birth data, and delete to separate actions", () => {
  const card = section(APP, "function savedChartCardHtml", "async function refreshActiveExperience");
  assert.match(card, /data-action="identity"/);
  assert.match(card, /data-action="edit"/);
  assert.match(card, /data-action="delete"/);
  assert.match(card, /relationshipDisplay\(chart\.relationship_type \?\? null\)\.label/,
    "cards name legacy values honestly");
  assert.match(card, /chartAvatarHtml\(chart\)/);
});
