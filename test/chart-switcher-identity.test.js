// Orbit Axis :: identity in the unified form and the chart switchers
// (Dev Update 1.10). Served-surface contract — the browser pass verifies the
// behaviour; this pins the wiring it depends on.

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

// ── Switchers ───────────────────────────────────────────────────────────────

test("every chart selector shows nickname, relationship, and active state in text", () => {
  const label = section(APP, "function chartOptionLabel", "function renderPickerAvatar");
  assert.match(label, /relationshipDisplay\(chart\.relationship_type \?\? null\)/);
  assert.match(label, /parts\.push\("Active"\)/, "active state is words, not colour");
  // All three selectors use it.
  for (const renderer of ["function axisRenderChartPicker", "function renderChartSwitcher", "function renderTransitsSwitcher"]) {
    const body = section(APP, renderer, "\n}");
    assert.match(body, /chartOptionLabel\(/, `${renderer} names charts consistently`);
  }
});

test("each switcher has an avatar slot, hidden from assistive tech", () => {
  for (const id of ["today-chart-avatar", "chart-switcher-avatar", "transits-chart-avatar"]) {
    assert.match(HTML, new RegExp(`id="${id}"[^>]*aria-hidden="true"`),
      `${id} must not repeat the name the select already speaks`);
  }
  for (const slot of ["#today-chart-avatar", "#chart-switcher-avatar", "#transits-chart-avatar"]) {
    assert.ok(APP.includes(`renderPickerAvatar("${slot}")`), `${slot} is rendered`);
  }
});

test("no selector requests an avatar for a chart outside the owner's list", () => {
  const picker = section(APP, "function renderPickerAvatar", "\n}");
  assert.match(picker, /state\.charts\.find/, "the slot renders only owned, listed charts");
  assert.ok(!/avatarUrl\(\{/.test(APP), "no avatar URL is ever built from a hand-made chart object");
});

// ── Unified form ────────────────────────────────────────────────────────────

test("the form's picture is optional, create-only, and absent from birth-data edits", () => {
  assert.match(HTML, /id="cm-avatar-field"/);
  // The accept list was widened to include HEIC/HEIF on 2026-08-08 — an
  // iPhone photo is HEIC, and the old list refused the format the device Orbit
  // ships to actually produces. Matched loosely so adding another format is
  // not a test change, but the three originals must all survive.
  const accept = /id="cm-avatar-file"[^>]*accept="([^"]+)"/s.exec(HTML)?.[1] || "";
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic"]) {
    assert.ok(accept.includes(type), `the picker must accept ${type}`);
  }
  const modes = section(APP, "const CHART_MODES", "\n};");
  assert.match(section(modes, "first:", "add:"), /showAvatar: true/);
  assert.match(section(modes, "add:", "edit:"), /showAvatar: true/);
  assert.match(modes.slice(modes.indexOf("edit:")), /showAvatar: false/);
});

test("additional charts require a relationship at the field, with no default", () => {
  const validate = section(APP, "function validateChartForm", "function chartFormPayload");
  assert.match(validate, /chartForm\.mode === "add"/);
  assert.match(validate, /Choose how this chart relates to you\./);
  const open = section(APP, "function openChartForm", "/** Kept as the old name");
  assert.match(open, /mode === "first" \? "self" : ""/, "no default Friend, no resurrected other");
  const select = section(HTML, 'id="cm-relationship"', "</select>");
  assert.ok(!select.includes("other"), "the form offers no legacy value");
});

test("an empty relationship control is OMITTED from the payload, never sent as null", () => {
  const payload = section(APP, "function chartFormPayload", "function syncTimeCertainty");
  assert.match(payload, /else if \(relationshipChoice\) payload\.relationship_type = relationshipChoice;/);
  assert.ok(!payload.includes("relationship_type: chartForm.mode"),
    "the old always-send shape is gone — it turned birth edits of legacy charts into refusals");
});

test("create first, then upload: a failed picture never fails or duplicates the chart", () => {
  const submit = section(APP, '$("#chart-modal-form")?.addEventListener("submit"', "async function afterChartSaved");
  const createdAt = submit.indexOf("await post(\"/api/charts\", payload)");
  const uploadAt = submit.indexOf("uploadChartAvatar(");
  assert.ok(createdAt > -1 && uploadAt > createdAt, "the chart is saved before any upload starts");
  assert.match(submit, /avatarHandoff = \{ chartId: createdProfile\.id, blob: pendingBlob \}/,
    "the normalized bytes survive the failure for an avatar-specific retry");
  assert.match(submit, /openIdentityEditor\(fresh, \{\s*pendingBlob: avatarHandoff\.blob/s);
  assert.match(submit, /closeModal\(modal\)/);
  const failurePath = section(submit, "} catch {", "resetChartFormAvatar();");
  assert.ok(!failurePath.includes("post("), "the failure path never re-creates the chart");
});

test("the form releases its preview URL on open, discard, and success", () => {
  const reset = section(APP, "function resetChartFormAvatar", "function renderChartFormAvatar");
  assert.match(reset, /chartFormAvatar\.preview\?\.release\(\)/);
  const open = section(APP, "function openChartForm", "/** Kept as the old name");
  assert.match(open, /resetChartFormAvatar\(\)/);
  const chosen = section(APP, "async function onChartFormFileChosen", "function isRealCalendarDate");
  assert.match(chosen, /event\.target\.value = ""/, "the original File is not retained");
  assert.match(chosen, /chartFormAvatar\.preview\?\.release\(\)/, "reselection releases the old URL");
});
