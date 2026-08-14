// Orbit Axis API v1 :: calculation endpoints.
//
// natal · transits · synastry · reading evidence
//
// Every one is a pure function of its input: same request, same response, with
// no database read and no user identity involved. That is deliberate. Orbit has
// always let someone explore a chart before creating an account, and coupling
// calculation to persistence would break that and make the endpoints useless to
// a future iOS client doing local-first work.
//
// Facts come from the engine and only from the engine. No interpretation prose
// is mixed into a calculation payload — a client that wants wording asks for it
// separately, so "what is true" and "how we said it" never blur.

import {
  computeNatalChart, personalTransits,
  computeSynastryAspects, summariseSynastry,
  buildMetadata, CONTRACT_VERSION,
} from "@ezmannbuilds/orbit-axis-engine";
import { createCurrentSkyContext } from "../../../astro/current-sky-context.js";
import { buildAskContext } from "../../../ask-orbit/context-engine.js";
import { ApiError } from "../errors/codes.js";
import {
  validateBirthInput, validateInstant, validateTimezone, toEngineProfile,
} from "../validation/input.js";

/**
 * Run an engine calculation, converting its structured failures into API
 * errors. The engine distinguishes "this machine cannot calculate" from "this
 * calculation failed", and that distinction survives to the client as
 * ENGINE_UNAVAILABLE vs ENGINE_CALCULATION_FAILED — different causes, different
 * fixes, different retry advice.
 *
 * The original error is attached as `cause` for server-side logging and is
 * never serialised into a response.
 */
function runEngine(fn) {
  try {
    return fn();
  } catch (error) {
    const code = error?.code;
    if (code === "unsupported_platform" || code === "runtime_missing"
      || code === "runtime_not_executable" || code === "runtime_wrong_platform"
      || code === "runtime_checksum_mismatch" || code === "ephemeris_data_missing"
      || code === "ephemeris_data_corrupt") {
      throw new ApiError("ENGINE_UNAVAILABLE", { cause: error });
    }
    if (code === "invalid_input") {
      // The API validated already, so reaching here means the two layers
      // disagree — a bug worth surfacing as a 400 rather than a 500.
      throw new ApiError("INVALID_INPUT", { cause: error });
    }
    throw new ApiError("ENGINE_CALCULATION_FAILED", { cause: error });
  }
}

/** Shape a chart for the wire: no internal paths, no engine internals. */
function serialiseChart(chart) {
  return {
    calculationVersion: chart.calculation_version,
    timeKnown: chart.time_known,
    timeAccuracy: chart.time_accuracy,
    planets: chart.planets,
    // Chiron and Lilith. Kept in their own field rather than folded into
    // `planets`, exactly as the engine keeps them: `planets` is what aspects,
    // element balance, and the chart ruler are computed from, and a client that
    // iterates it expects the ten it has always received. Additive, so an
    // existing v1 consumer is unaffected.
    points: chart.points ?? {},
    pointHouses: chart.point_houses ?? {},
    nodes: chart.nodes,
    angles: chart.angles ?? null,
    houses: chart.houses,
    planetHouses: chart.planet_houses,
    aspects: chart.aspects,
    bigThree: chart.big_three,
    elementBalance: chart.element_balance,
    modalityBalance: chart.modality_balance,
    chartRuler: chart.chart_ruler,
    retrogrades: chart.retrogrades,
    warnings: chart.warnings,
    status: chart.calculation_status,
  };
}

/**
 * Limitations a client must show the user. When the birth time is unknown,
 * houses, the Ascendant, and the Midheaven cannot be computed, and the Moon may
 * be off by several degrees. Saying so is not optional — a chart that silently
 * omits its own uncertainty invites a user to trust it more than they should.
 */
function limitationsFor(input, chart) {
  const limitations = [];
  if (!input.birthTimeKnown) {
    limitations.push({
      code: "BIRTH_TIME_UNKNOWN",
      message: "Birth time is unknown, so houses, Rising sign, and Midheaven are not calculated. "
        + "The Moon's position may be approximate.",
      affects: ["houses", "angles", "planetHouses", "moonPrecision"],
    });
  }
  for (const warning of chart.warnings || []) {
    if (!limitations.some((l) => l.affects.includes(warning))) {
      limitations.push({ code: "ENGINE_WARNING", message: warning, affects: [warning] });
    }
  }
  return limitations;
}

// ── GET /api/v1/sky/current ─────────────────────────────────────────────────
export function skyContext(query = {}) {
  const timezoneName = query.tz === undefined && query.timezone === undefined
    ? null
    : validateTimezone(query.tz ?? query.timezone, query.tz === undefined ? "timezone" : "tz");
  const at = validateInstant(query.at, "at");

  return runEngine(() => createCurrentSkyContext({
    at,
    timezoneName,
    timezoneSource: timezoneName ? "request" : null,
  }));
}

// ── POST /api/v1/charts/natal ───────────────────────────────────────────────
export function natal(body) {
  const input = validateBirthInput(body);
  const chart = runEngine(() => computeNatalChart(toEngineProfile(input)));
  return {
    chart: serialiseChart(chart),
    input: {
      birthDate: input.birthDate,
      birthTime: input.birthTime,
      birthTimeKnown: input.birthTimeKnown,
      timezone: input.timezone,
      houseSystem: input.houseSystem,
      zodiacType: input.zodiacType,
    },
    limitations: limitationsFor(input, chart),
    metadata: buildMetadata({ houseSystem: input.houseSystem, timezone: input.timezone }),
  };
}

// ── POST /api/v1/charts/transits ────────────────────────────────────────────
export function transits(body) {
  const input = validateBirthInput(body);
  const at = validateInstant(body.at, "at");
  const orbLimit = validateOrb(body.orbLimit);

  const chart = runEngine(() => computeNatalChart(toEngineProfile(input)));
  const sky = runEngine(() => createCurrentSkyContext({
    at,
    timezoneName: input.timezone,
    timezoneSource: "request",
  }));
  const found = runEngine(() => personalTransits(sky, chart, orbLimit));

  return {
    at: at.toISOString(),
    orbLimit,
    sky: {
      contextVersion: sky.context_version,
      calculatedAtUtc: sky.calculated_at_utc,
      userTimezone: sky.user_timezone,
      timezoneSource: sky.timezone_source,
      localDate: sky.local_date,
      localDateTime: sky.local_date_time,
      zodiacSeason: sky.zodiac_season,
      sun: sky.sun,
      moon: sky.moon,
      nextFullMoon: sky.next_full_moon,
      nextNewMoon: sky.next_new_moon,
      retrogrades: sky.retrogrades,
      aspects: sky.aspects,
      planets: sky.planets,
      snapshotHash: sky.snapshot_hash,
      skyVersion: sky.sky_version,
      source: sky.source,
    },
    transits: found.map((t) => ({
      transiting: t.transiting, natal: t.natal, aspect: t.aspect, plain: t.plain,
      orb: t.orb,
      // applying / exact / separating, rather than a bare boolean: a client
      // showing "exact" for a 0.0 orb is more truthful than "applying".
      motion: t.orb === 0 ? "exact" : (t.applying ? "applying" : "separating"),
      applying: t.applying,
      quality: t.soft ? "easy" : (t.hard ? "challenging" : "neutral"),
    })),
    limitations: limitationsFor(input, chart),
    metadata: buildMetadata({ houseSystem: input.houseSystem, timezone: input.timezone }),
  };
}

function validateOrb(value) {
  if (value === undefined || value === null) return 3;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 10) {
    throw new ApiError("INVALID_INPUT", {
      message: "orbLimit must be a number between 0 and 10 degrees.",
      details: { field: "orbLimit" },
    });
  }
  return value;
}

// ── POST /api/v1/charts/synastry ────────────────────────────────────────────
export function synastry(body) {
  if (!body?.chartA || !body?.chartB) {
    throw new ApiError("INVALID_INPUT", {
      message: "Provide chartA and chartB.",
      details: { field: !body?.chartA ? "chartA" : "chartB" },
    });
  }
  // Validated independently and prefixed, so an error names which person's
  // details were wrong instead of leaving the user to guess.
  const inputA = validateBirthInput(body.chartA, { prefix: "chartA." });
  const inputB = validateBirthInput(body.chartB, { prefix: "chartB." });

  const chartA = runEngine(() => computeNatalChart(toEngineProfile(inputA)));
  const chartB = runEngine(() => computeNatalChart(toEngineProfile(inputB)));
  const aspects = runEngine(() => computeSynastryAspects(chartA, chartB));

  return {
    aspects,
    summary: summariseSynastry(aspects),
    charts: {
      a: { bigThree: chartA.big_three, timeKnown: chartA.time_known },
      b: { bigThree: chartB.big_three, timeKnown: chartB.time_known },
    },
    limitations: [
      ...limitationsFor(inputA, chartA).map((l) => ({ ...l, chart: "a" })),
      ...limitationsFor(inputB, chartB).map((l) => ({ ...l, chart: "b" })),
      {
        code: "SYNASTRY_SCOPE",
        message: "Synastry compares planetary contacts between two charts. It does not measure "
          + "compatibility and does not predict how a relationship will go.",
        affects: ["interpretation"],
      },
    ],
    metadata: buildMetadata({ houseSystem: inputA.houseSystem, timezone: inputA.timezone }),
  };
}

// ── POST /api/v1/readings/evidence ──────────────────────────────────────────
/**
 * Deterministic reading evidence: the calculated facts a reading may be built
 * on, with no language model involved anywhere in the path.
 *
 * `generatedBy: "deterministic-engine"` is part of the contract. A client must
 * never present engine output as AI-written, and must never present AI wording
 * as calculated fact. Stating the provenance in the payload is what makes that
 * checkable rather than a convention someone can forget.
 */
export function evidence(body) {
  const input = validateBirthInput(body);
  const at = validateInstant(body.at, "at");
  const question = typeof body.question === "string" ? body.question.slice(0, 500) : "";
  const detailMode = body.detailMode === "Advanced" ? "Advanced" : "Simple";

  const chart = runEngine(() => computeNatalChart(toEngineProfile(input)));
  const sky = runEngine(() => createCurrentSkyContext({
    at,
    timezoneName: input.timezone,
    timezoneSource: "request",
  }));
  const context = runEngine(() => buildAskContext({
    active: { profile: { id: null, nickname: null }, chart },
    sky, detailMode, question, limit: 6,
  }));

  return {
    generatedBy: "deterministic-engine",
    aiAssisted: false,
    questionTypes: context.questionType,
    birthTimeReliability: context.birthTimeReliability,
    detailMode: context.detailMode,
    evidence: context.evidence,
    limitations: [
      ...(context.limitations || []).map((l) => ({ code: "CONTEXT_LIMITATION", message: l.note, affects: [l.type] })),
      ...limitationsFor(input, chart),
    ],
    answerPlan: context.answerPlan,
    seed: {
      skySnapshotHash: sky.snapshot_hash,
      engineVersion: context.engineVersion,
      at: at.toISOString(),
    },
    metadata: buildMetadata({ houseSystem: input.houseSystem, timezone: input.timezone }),
    contractVersion: CONTRACT_VERSION,
  };
}
