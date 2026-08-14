// Orbit Axis Engine :: Vercel Node Function entry point.
//
// The same endpoints `ui/server.mjs` serves locally, adapted to the one thing
// Vercel changes: it invokes a function per request rather than running a
// long-lived server. The routing and the responses are identical, so the local
// playground and the deployed one cannot drift in behaviour.
//
// This function reaches the Swiss Ephemeris by PATH — the executable and the
// .se1 data are opened as files, not imported — so `includeFiles` in
// vercel.json must force them into the bundle. Import tracing cannot see them.
//
// Nothing is stored and nothing is logged. Every response is computed from the
// ephemeris on the instant it is asked for.

import {
  engineHealth,
  engineVersion,
  currentSky,
  moonPhase,
  nextLunarEvents,
  nextStations,
  nextIngresses,
  computeNatalChart,
  personalTransits,
} from "../src/index.js";

const MAX_BODY_BYTES = 64 * 1024;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

// The engine marks caller mistakes with code "invalid_input"; everything else
// is ours and must not be reported as the caller's fault.
function jsonError(res, error) {
  const status = error?.code === "invalid_input" ? 400 : 500;
  json(res, status, { error: error?.message ?? "Calculation failed", code: error?.code ?? null });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("Request body too large");
        error.code = "invalid_input";
        // Stop reading but leave the socket alive so the 400 reaches the client.
        req.pause();
        req.removeAllListeners("data");
        req.removeAllListeners("end");
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        const error = new Error("Body must be JSON");
        error.code = "invalid_input";
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  const url = new URL(req.url, "https://orbit-axis-engine.invalid");
  const route = url.pathname;
  const instant = url.searchParams.get("date") ?? new Date();

  try {
    if (req.method === "GET" && route === "/api/health") {
      json(res, 200, { ...engineHealth(), engine_version: engineVersion() });
      return;
    }
    if (req.method === "GET" && route === "/api/sky") {
      json(res, 200, {
        sky: currentSky(instant),
        moon: moonPhase(instant),
        lunar_events: nextLunarEvents(instant),
      });
      return;
    }
    if (req.method === "GET" && route === "/api/upcoming") {
      json(res, 200, {
        stations: nextStations(instant).stations,
        ingresses: nextIngresses(instant, { horizonDays: 120 }).ingresses,
      });
      return;
    }
    if (req.method === "POST" && route === "/api/natal-chart") {
      const input = await readBody(req);
      json(res, 200, { chart: computeNatalChart(input) });
      return;
    }
    if (req.method === "POST" && route === "/api/transits") {
      const body = await readBody(req);
      const chart = computeNatalChart(body.natal ?? {});
      const sky = currentSky(body.date ?? new Date());
      const orb = Number.isFinite(Number(body.orb)) ? Number(body.orb) : 3;
      json(res, 200, { transits: personalTransits(sky, chart, orb), instant_utc: sky.instant_utc });
      return;
    }
    json(res, 404, { error: "Not found", code: "not_found" });
  } catch (error) {
    jsonError(res, error);
  }
}
