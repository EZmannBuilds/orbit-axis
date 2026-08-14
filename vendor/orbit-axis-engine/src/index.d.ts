// Type declarations for the Orbit Axis Engine public entry point.
//
// Hand-written and intentionally pragmatic: the domain results are typed to
// the fields the engine promises; diagnostic and adapter records use looser
// shapes. The runtime contract lives in src/index.js — if the two disagree,
// the JavaScript is the truth and this file has a bug.

// ── shared shapes ───────────────────────────────────────────────────────────

export type Sign =
  | "Aries" | "Taurus" | "Gemini" | "Cancer" | "Leo" | "Virgo"
  | "Libra" | "Scorpio" | "Sagittarius" | "Capricorn" | "Aquarius" | "Pisces";

export type HouseSystem = "placidus" | "whole" | "whole-sign" | "koch" | "equal";

export interface BodyPosition {
  longitude: number;
  sign: Sign;
  degrees: number;
  minutes: number;
  retrograde?: boolean;
  speed?: number;
  house?: number | null;
}

export interface Aspect {
  a: string;
  b: string;
  aspect: string;
  orb: number;
  [key: string]: unknown;
}

/** Anything accepted by `new Date(value)` that yields a valid instant. */
export type Instant = Date | string | number;

// ── contract ────────────────────────────────────────────────────────────────

export const CONTRACT_VERSION: string;
export function engineVersion(): string;
export function buildMetadata(options?: {
  houseSystem?: string;
  timezone?: string;
  [key: string]: unknown;
}): Record<string, unknown>;

// ── runtime and diagnostics ─────────────────────────────────────────────────

export function runtimeManifest(): Record<string, unknown>;
export function runtimeKey(): string;
export function resolveRuntime(): Record<string, unknown>;
export function currentRuntimeStatus(): Record<string, unknown>;
export function requireRuntime(): Record<string, unknown>;
export function checkEphemerisData(): Record<string, unknown>;
export function ephemerisDataDir(): string;
export function sha256File(path: string): string;
export const ENGINE_ROOT: string;

export class OrbitRuntimeError extends Error {
  code?: string;
}
export class OrbitCalculationError extends Error {
  code?: string;
}
export class EphemerisUnavailableError extends Error {
  code?: string;
}

export function runEphemeris(args: string[], options?: Record<string, unknown>): string;
export function validateCalculationInput(input: unknown): void;
export function assertSafeArgs(args: string[]): void;
export function classifyExecutionError(error: unknown): string;
export function customerSafeMessage(error: unknown): string;
export function diagnosticRecord(error: unknown): Record<string, unknown>;
export const HOUSE_SYSTEMS: readonly string[];
export const DEFAULT_TIMEOUT_MS: number;
export const MAX_OUTPUT_BYTES: number;

export function engineHealth(): { ok: boolean; runtime: string; detail: string };

// ── raw ephemeris access ────────────────────────────────────────────────────

export interface EphemerisPositions {
  planets: Record<string, BodyPosition>;
  /** Chiron and Lilith (mean + osculating apogee). Never inside `planets`. */
  points: Record<string, BodyPosition>;
  nodes?: Record<string, BodyPosition>;
  houses: Array<{ house: number; longitude: number; sign: Sign }>;
  ascendant?: BodyPosition | null;
  midheaven?: BodyPosition | null;
  [key: string]: unknown;
}

export function positionsAtUT(input: {
  year: number;
  month: number;
  day: number;
  hourDecimal?: number;
  lat?: number;
  lon?: number;
  houseSystem?: string;
  withHouses?: boolean;
  [key: string]: unknown;
}): EphemerisPositions;

export function positionsNow(date?: Instant): EphemerisPositions;

export function ephemerisCapability(options?: {
  fresh?: boolean;
  verifyChecksum?: boolean;
}): { ok: boolean; runtime: string; detail: string };

export const EPHEMERIS_VERSION: string;
export const PLANETS: readonly string[];
export const POINTS: readonly string[];
export const SIGNS: readonly Sign[];
export const SIGN_ABBR: Record<string, string>;

export function offsetToMinutes(offset: string | number | null | undefined): number;

/**
 * Minutes east of UTC that an IANA zone was on at a local wall-clock time.
 * Throws TypeError (code "invalid_input") for an unknown zone. Ambiguous local
 * times resolve to the offset in force before the transition.
 */
export function zoneOffsetMinutes(
  timeZone: string,
  local: { year: number; month: number; day: number; hour?: number; minute?: number },
): number;
export function localToUT(input: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  offsetMinutes?: number;
}): { year: number; month: number; day: number; hourDecimal: number };

// ── natal chart ─────────────────────────────────────────────────────────────

export interface NatalInput {
  /** "YYYY-MM-DD" */
  birth_date: string;
  /** "HH:MM" local time; omit (or time_accuracy "unknown") for a no-time chart */
  birth_time?: string;
  time_accuracy?: "exact" | "approximate" | "unknown";
  latitude: number;
  longitude: number;
  /** e.g. "-05:00". Takes precedence over `timezone_name` when both are given. */
  utc_offset_at_birth?: string | number;
  /**
   * IANA zone, e.g. "America/Chicago". Used when no explicit offset is given;
   * resolves historical daylight-saving rules for the birth date. Preferred
   * over a hand-written offset, which is where one-hour errors come from.
   */
  timezone_name?: string;
  zodiac_system?: "tropical";
  house_system?: HouseSystem;
}

export interface NatalChart {
  calculation_version: string;
  time_known: boolean;
  time_accuracy: string;
  planets: Record<string, BodyPosition>;
  /** Chiron and Lilith. Outside `planets`, so aspects and balance are unchanged. */
  points: Record<string, BodyPosition>;
  point_houses: Record<string, number>;
  nodes: Record<string, BodyPosition>;
  angles: { ascendant: BodyPosition | null; midheaven: BodyPosition | null };
  houses: Array<{ house: number; longitude: number; sign: Sign }>;
  planet_houses: Record<string, number>;
  aspects: Aspect[];
  big_three: {
    sun: { sign: Sign; degrees: number; minutes: number } | null;
    moon: { sign: Sign; degrees: number; minutes: number } | null;
    rising:
      | { sign: Sign; degrees: number; minutes: number }
      | { unavailable: true; reason: string };
  };
  element_balance: { counts: Record<string, number>; percentages: Record<string, number>; dominant: string };
  modality_balance: { counts: Record<string, number>; percentages: Record<string, number>; dominant: string };
  [key: string]: unknown;
}

export function computeNatalChart(input: NatalInput): NatalChart;
export function computeAspects(
  bodies: Array<{ name: string; longitude: number; isLuminary?: boolean }>,
): Aspect[];
export function chartInputHash(input: NatalInput): string;
export function elementOf(sign: Sign | string): "Fire" | "Earth" | "Air" | "Water" | null;
export function modalityOf(sign: Sign | string): "Cardinal" | "Fixed" | "Mutable" | null;
export function normalizePercentages(
  counts: Record<string, number>,
  keys: string[],
): Record<string, number>;
export const CALCULATION_VERSION: string;
export function natalComputeCount(): number;
export function resetNatalComputeCount(): void;

// ── current sky ─────────────────────────────────────────────────────────────

export interface MoonPhaseResult {
  /** Sun–Moon elongation, 0..360 degrees, rounded to 2 dp */
  elongation: number;
  phase_name:
    | "New Moon" | "Waxing Crescent" | "First Quarter" | "Waxing Gibbous"
    | "Full Moon" | "Waning Gibbous" | "Last Quarter" | "Waning Crescent";
  waxing: boolean;
  waning: boolean;
  /** 0..100, rounded to 1 dp */
  illumination_percent: number;
}

/**
 * Two call forms:
 *   moonPhase(sunLon, moonLon) — longitudes already in hand.
 *   moonPhase(date?)           — one instant (defaults to now); longitudes
 *                                come from the ephemeris.
 * Throws TypeError (code "invalid_input") on an invalid instant or
 * non-finite longitudes.
 */
export function moonPhase(sunLon: number, moonLon: number): MoonPhaseResult;
export function moonPhase(date?: Instant): MoonPhaseResult;

export interface SkySnapshot {
  sky_version: string;
  instant_utc: string;
  zodiac_season: Sign;
  sun: { sign: Sign; degrees: number; minutes: number; longitude: number };
  moon: {
    sign: Sign;
    degrees: number;
    minutes: number;
    longitude: number;
    phase_name: MoonPhaseResult["phase_name"];
    illumination_percent: number;
    phase_fraction: number;
    elongation_degrees: number;
    waxing: boolean;
    waning: boolean;
  };
  dominant_element: string | null;
  retrogrades: string[];
  aspects: Aspect[];
  planets: Record<string, BodyPosition>;
  /** Chiron and Lilith. Excluded from aspects, retrogrades, and snapshot_hash. */
  points: Record<string, BodyPosition>;
  snapshot_hash: string;
}

export function currentSky(date?: Instant): SkySnapshot;

export interface LunarEvents {
  events_version: string;
  calculated_from_utc: string;
  full_moon: { kind: "full_moon"; instant_utc: string };
  new_moon: { kind: "new_moon"; instant_utc: string };
}

export function nextLunarEvents(date?: Instant): LunarEvents;
export function skySnapshotHash(sky: SkySnapshot): string;
export const SKY_VERSION: string;
export const LUNAR_EVENTS_VERSION: string;

// ── upcoming events ─────────────────────────────────────────────────────────

export interface Station {
  body: string;
  kind: "station_retrograde" | "station_direct";
  instant_utc: string;
  sign: Sign;
  degrees: number;
  minutes: number;
  longitude: number;
}

export interface Ingress {
  body: string;
  from_sign: Sign;
  to_sign: Sign;
  retrograde: boolean;
  instant_utc: string;
}

/** Next station per body within the horizon (default 800 days), sorted by time. */
export function nextStations(
  date?: Instant,
  options?: { bodies?: readonly string[]; horizonDays?: number },
): {
  events_version: string;
  calculated_from_utc: string;
  horizon_days: number;
  stations: Station[];
};

/**
 * Next sign ingress per body within the horizon (default 400 days), sorted by
 * time. Bodies whose next crossing lies beyond the horizon are omitted.
 */
export function nextIngresses(
  date?: Instant,
  options?: { bodies?: readonly string[]; horizonDays?: number },
): {
  events_version: string;
  calculated_from_utc: string;
  horizon_days: number;
  ingresses: Ingress[];
};

export const STATION_BODIES: readonly string[];
export const INGRESS_BODIES: readonly string[];
export const UPCOMING_EVENTS_VERSION: string;

// ── transits ────────────────────────────────────────────────────────────────

export interface Transit {
  transiting: string;
  natal: string;
  aspect: string;
  plain: string;
  orb: number;
  applying: boolean;
  soft: boolean;
  hard: boolean;
  t_lon: number;
  n_lon: number;
  [key: string]: unknown;
}

/**
 * Transits from moving bodies to fixed natal bodies, tightest orb first.
 *
 * Defaults cover the ten planets plus Chiron as transiting bodies, and those
 * plus the nodes and the angles as targets. Pass `scope` to narrow or widen —
 * Lilith is available as a target but not included by default, because the mean
 * and osculating apogees disagree by degrees.
 */
export function personalTransits(
  sky: { planets?: Record<string, BodyPosition>; points?: Record<string, BodyPosition>; nodes?: object; angles?: object },
  chart: { planets?: Record<string, BodyPosition>; points?: Record<string, BodyPosition>; nodes?: object; angles?: object },
  orbLimit?: number,
  scope?: { bodies?: readonly string[]; targets?: readonly string[] },
): Transit[];
export const TRANSIT_VERSION: string;

// ── synastry ────────────────────────────────────────────────────────────────

export function computeSynastryAspects(
  chartA: { planets?: Record<string, { longitude: number }> },
  chartB: { planets?: Record<string, { longitude: number }> },
  options?: { bodies?: readonly string[] },
): Aspect[];
export function summariseSynastry(aspects: Aspect[]): Record<string, unknown>;
export const SYNASTRY_ASPECTS: readonly unknown[];
export const SYNASTRY_BODIES: readonly string[];
export const SYNASTRY_VERSION: string;
