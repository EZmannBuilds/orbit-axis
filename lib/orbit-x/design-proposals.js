// Orbit X :: AI-proposed post types (Dev Update 6.1).
//
// THE MODEL PROPOSES; ERIK DISPOSES. Claude is shown the closed design
// vocabulary (families, densities, alignments, logo positions, the motif
// library, the hook and caption banks, the channel formats) and the types that
// already exist, and asked for new combinations as JSON. Every proposal is
// then:
//
//   1. validated against that vocabulary (post-types.js), unknown values
//      refused rather than coerced;
//   2. audited: its name, description and rationale pass the same editorial
//      audit as post copy, so a proposal cannot smuggle a claim into the desk;
//   3. rendered against the fixed fixtures in every format it claims, and
//      refused if the renderer reports a single fitting warning or the layout
//      check finds text on the brand mark or on other text;
//   4. de-duplicated against every live design in the registry;
//   5. inserted as `proposed`. The database refuses any other initial status.
//
// What the model cannot do, by construction: write SVG, choose a colour that
// is not a brand token, add a format, touch facts, or approve anything. A
// proposal carries no text that reaches a post; its voice settings are only
// choices among instructions Orbit already wrote.

import { generateCopy, aiConfig } from "./ai.js";
import { parseModelJson } from "./schemas.js";
import { auditCopy } from "./editorial.js";
import { FORMATS } from "./formats.js";
import {
  TEMPLATES, DENSITIES, LOGO_POSITIONS, HEADLINE_ALIGNMENTS,
  MOTIF_KINDS, MOTIF_TONES, MOTIF_PLACEMENTS, MOTIF_INTENSITIES,
} from "./templates.js";
import {
  CHANNEL_FORMATS, HOOK_STYLES, CAPTION_STRUCTURES, POST_TYPE_TEMPLATES, TEMPLATE_FORMATS,
  validatePostTypeSpec, validateTypeMetadata, templateVersion, specHash, renderFingerprint,
} from "./post-types.js";

export const MAX_PROPOSALS_PER_CALL = 3;
/** The founder reviews these by hand; the desk never holds more than this many
 *  unreviewed AI proposals at once. */
export const MAX_PENDING_AI_PROPOSALS = 4;

export const DESIGN_SYSTEM_PROMPT = `You are the visual systems designer for Orbit Axis, an astrology app whose astronomy is calculated, not generated.

You propose NEW Instagram post types for an automatic channel. A post type is a JSON specification built ONLY from the vocabulary you are given: a visual family, a design preset, at most one decorative motif, the formats it may carry, and which hook styles and caption structures its copy may use. You never write SVG, colours, coordinates, copy, facts, dates, or astrology claims. You are proposing designs for a human to approve; you approve nothing.

Aim for genuine variety against the existing types: a different family-and-motif pairing, a different density, a different alignment, a narrower and more deliberate voice. Stay inside the brand: quiet, precise, observatory-like, never loud or clickbait.

Respond with ONLY a JSON object, no markdown fences, no commentary.`;

/** The packet the model sees. Vocabulary, existing types, and rules. */
export function designPacket({ existing = [], count = 2 } = {}) {
  return {
    task: `Propose ${count} new post types that differ clearly from the existing ones.`,
    vocabulary: {
      families: Object.fromEntries(POST_TYPE_TEMPLATES.map((id) => [id, {
        version: templateVersion(id), variants: TEMPLATES[id].variants || 1, intendedUse: TEMPLATES[id].intendedUse,
        carries: TEMPLATE_FORMATS[id] }])),
      densities: Object.keys(DENSITIES),
      headlineAlignments: Object.keys(HEADLINE_ALIGNMENTS),
      logoPositions: Object.keys(LOGO_POSITIONS),
      motif: { kinds: MOTIF_KINDS, tones: Object.keys(MOTIF_TONES), placements: MOTIF_PLACEMENTS,
        intensities: Object.keys(MOTIF_INTENSITIES) },
      visuals: ["moon", "strip", "diagram"],
      metadata: ["date", "time", "sign", "illumination", "retro", "calculated"],
      formats: Object.fromEntries(CHANNEL_FORMATS.map((id) => [id, { name: FORMATS[id].name, purpose: FORMATS[id].purpose }])),
      hookStyles: HOOK_STYLES,
      captionStructures: CAPTION_STRUCTURES,
    },
    rules: [
      "key is \"<family>.<short_name>\": lowercase letters, digits and underscores, and it must be new.",
      "familyVersion must equal the family's current version.",
      "family is one of the listed families, and formats may only include what that family \"carries\".",
      "aspect is \"portrait\" or \"square\"; a square type cannot carry daily_reading, weekly_reading or monthly_reading.",
      "A type carrying any non-reading format must use logoPosition \"upper_corner\".",
      "variant is an integer below the family's variants count.",
      "At least one of visuals.moon, visuals.strip, visuals.diagram is true. metadata.calculated is always true.",
      "motif is null or one object with kind, tone, placement and intensity from the vocabulary.",
      "voice lists at least one hook style and one caption structure.",
      "name is at most 48 characters; description at most 280; rationale at most 400. They describe the DESIGN only: no astrology claims, no predictions, no promises.",
    ],
    existingTypes: existing.slice(0, 40).map((row) => ({
      key: row.type_key, status: row.status, family: row.spec?.family, aspect: row.spec?.aspect,
      density: row.spec?.design?.density, variant: row.spec?.design?.variant,
      alignment: row.spec?.design?.headlineAlignment, motif: row.spec?.motif || null,
    })),
    respondWith: {
      proposals: [{
        key: "family.short_name", name: "string", description: "string", rationale: "string",
        spec: {
          family: "string", familyVersion: "string", formats: ["string"], aspect: "portrait",
          design: { density: "string", variant: 0, headlineAlignment: "string", logoPosition: "string",
            visuals: { moon: true, strip: true, diagram: true },
            metadata: { date: true, time: true, sign: true, illumination: true, retro: true, calculated: true } },
          motif: { kind: "string", tone: "string", placement: "string", intensity: "string" },
          voice: { hookStyles: ["string"], captionStructures: ["string"] },
        },
      }],
    },
  };
}

/**
 * Check one raw proposal. Pure apart from rendering, so it is tested directly.
 *
 * @returns {{ ok: true, row: object } | { ok: false, key: string, problems: string[] }}
 */
export function vetProposal(raw, { existing = [], fingerprintOf = renderFingerprint } = {}) {
  const key = String(raw?.key || "");
  const problems = [...validateTypeMetadata({ key, name: raw?.name, description: raw?.description })];
  const rationale = String(raw?.rationale || "").trim().slice(0, 400);
  const checked = validatePostTypeSpec(raw?.spec);
  problems.push(...checked.problems);
  if (checked.ok && !key.startsWith(`${checked.spec.family}.`)) problems.push(`key must start with "${checked.spec.family}."`);
  if (existing.some((row) => row.type_key === key)) problems.push(`key "${key}" already exists; a proposal must be new`);
  const findings = auditCopy({ name: raw?.name, description: raw?.description, rationale });
  for (const f of findings) problems.push(`${f.path}: ${f.why}`);
  if (problems.length) return { ok: false, key, problems };

  const hash = specHash(checked.spec);
  const { fingerprint, warnings, layout = [] } = fingerprintOf(checked.spec);
  if (warnings.length) return { ok: false, key, problems: warnings.map((w) => `renders with a warning: ${w}`) };
  if (layout.length) return { ok: false, key, problems: layout.slice(0, 6).map((c) => `layout: ${c}`) };
  if (existing.some((row) => row.status !== "superseded" && row.spec_hash === hash && row.render_fingerprint === fingerprint)) {
    return { ok: false, key, problems: ["an identical design already exists"] };
  }
  return { ok: true, row: {
    type_key: key, version: 1, name: String(raw.name).trim(), description: String(raw.description).trim(),
    spec: checked.spec, spec_hash: hash, render_fingerprint: fingerprint, status: "proposed", source: "ai",
    proposal_notes: rationale || null,
  } };
}

/**
 * Ask the model for new types and vet them. Never inserts; the caller does.
 *
 * @returns {Promise<{ accepted: Array<object>, refused: Array<object>, usage: object|null }>}
 */
export async function proposePostTypes({ env = process.env, fetchImpl = fetch, existing = [], count = 2 } = {}) {
  if (!aiConfig(env).configured) return { accepted: [], refused: [{ key: "*", problems: ["AI is not configured"] }], usage: null };
  const pending = existing.filter((row) => row.source === "ai" && row.status === "proposed").length;
  const room = Math.max(0, Math.min(MAX_PROPOSALS_PER_CALL, count, MAX_PENDING_AI_PROPOSALS - pending));
  if (!room) return { accepted: [], refused: [{ key: "*", problems: [`${pending} AI proposals already await review`] }], usage: null };

  const generated = await generateCopy({ system: DESIGN_SYSTEM_PROMPT, packet: designPacket({ existing, count: room }), env, fetchImpl });
  const parsed = parseModelJson(generated.text);
  const raws = Array.isArray(parsed?.proposals) ? parsed.proposals.slice(0, room) : [];
  const accepted = [];
  const refused = [];
  const seen = [...existing];
  for (const raw of raws) {
    const result = vetProposal(raw, { existing: seen });
    if (result.ok) { accepted.push(result.row); seen.push(result.row); }
    else refused.push({ key: result.key, problems: result.problems });
  }
  if (!raws.length) refused.push({ key: "*", problems: ["the model returned no proposals"] });
  return { accepted, refused, usage: generated.usage };
}
