// Orbit Axis Engine :: local playground server.
//
// Zero dependencies — node:http only. Binds to 127.0.0.1 and serves a single
// page plus JSON endpoints that call the engine directly. Nothing is stored,
// nothing leaves the machine. This is a playground for the engine, not an
// application: no accounts, no persistence, no interpretation.
//
// AGPL note: the engine is AGPL-3.0-or-later. This server offers its own
// source at /source (a redirect to the public repository), which satisfies
// the network-service source offer for anyone you let browse to it.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

const UI_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4747;
const HOST = "127.0.0.1";
const SOURCE_URL = "https://github.com/EZmannBuilds/orbit-axis-engine";
const MAX_BODY_BYTES = 64 * 1024;

const health = engineHealth();
if (!health.ok) {
  console.error(`Engine cannot calculate on this machine: ${health.detail}`);
  process.exit(1);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

// Engine errors carry codes; everything with invalid_input is the caller's.
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
        // Stop reading but keep the socket alive so the 400 reaches the client;
        // node closes the connection itself when a request goes unconsumed.
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

// ?date= accepts anything the engine accepts; absent means now.
function instantFrom(url) {
  const raw = url.searchParams.get("date");
  return raw ? raw : new Date();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      const page = await readFile(join(UI_DIR, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(page);
      return;
    }
    if (req.method === "GET" && url.pathname === "/source") {
      res.writeHead(302, { location: SOURCE_URL });
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, { ...engineHealth(), engine_version: engineVersion() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/sky") {
      const instant = instantFrom(url);
      json(res, 200, {
        sky: currentSky(instant),
        moon: moonPhase(instant),
        lunar_events: nextLunarEvents(instant),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/upcoming") {
      const instant = instantFrom(url);
      json(res, 200, {
        stations: nextStations(instant).stations,
        ingresses: nextIngresses(instant, { horizonDays: 120 }).ingresses,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/natal-chart") {
      const input = await readBody(req);
      json(res, 200, { chart: computeNatalChart(input) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/transits") {
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
});

server.listen(PORT, HOST, () => {
  console.log(`Orbit Axis playground → http://${HOST}:${PORT}  (engine ${engineVersion()}, ${health.runtime})`);
  console.log("Localhost only. Nothing is stored; nothing leaves this machine.");
});
