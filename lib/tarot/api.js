// Orbit Axis :: Tarot HTTP surface.
//
// Four routes, one boundary:
//
//   GET  /api/tarot/daily     today's card for this reader   (open)
//   POST /api/tarot/draw      a one- or three-card draw      (open)
//   POST /api/tarot/readings  save a reflection              (account)
//   GET  /api/tarot/readings  this account's reflections     (account)
//
// The split follows the rule in [[Signed-Out Experience]]: anything that only
// reads is open, anything that is about *you* asks for an account. A daily card
// is the same card for every signed-out visitor that day and is stored nowhere,
// so there is nothing to protect; a saved reflection is the reader's own
// content and is owner-scoped end to end.
//
// Errors are returned as codes with human sentences already attached, because
// the panel has to render several of them as first-class states — an empty
// deck is not an exception to report, it is a screen.

import {
  HISTORY_LIMIT, TarotError, dailyCard, listReadings, manualReading,
  deckReadiness, resolveDeck, saveReading, validateTimezone,
} from "./service.js";
import { SPREAD_POSITIONS, SPREAD_TYPES } from "./deck.js";
import { DRAW_CONTRACT_VERSION } from "./draw.js";

function fail(error) {
  if (error instanceof TarotError) {
    return { status: error.status, body: { ok: false, error: error.message, code: error.code } };
  }
  // Nothing internal is forwarded. A stack or a database message in a response
  // body is an information leak wearing the costume of helpfulness.
  return { status: 500, body: { ok: false, error: "Something went wrong drawing that card.", code: "internal" } };
}

/**
 * @param {string} method
 * @param {string} route      already normalized by the server
 * @param {URLSearchParams} params
 * @param {object} body       parsed JSON body ({} when absent)
 * @param {object} context    { auth, deck, deckVersion, now, fetchImpl, subject }
 * @returns {Promise<{status:number, body:object}|null>} null when unrouted
 */
export async function handleTarotRoute(method, route, params, body = {}, context = {}) {
  const { deck, deckVersion } = resolveDeck(context);
  const auth = context.auth ?? null;
  const now = context.now ?? new Date();
  const fetchImpl = context.fetchImpl ?? fetch;

  // The subject a daily card is keyed to. A signed-in reader gets their own
  // card; everyone else shares the day's card. Deriving this from the verified
  // session rather than from a parameter is what stops one reader asking for
  // another's daily draw.
  const subject = auth?.ownerId ? String(auth.ownerId) : "anonymous";

  try {
    if (route === "/api/tarot/daily" && method === "GET") {
      const timezone = validateTimezone(params?.get("timezone") ?? undefined);
      // Reversals are the reader's setting, so the client says which it wants.
      // The CARD is unaffected either way — orientation runs off its own seed
      // stream — so toggling the setting never changes today's card.
      const reversals = params?.get("reversals") === "on";
      const reading = dailyCard({ deck, deckVersion, timezone, subject, now, reversals });
      return { status: 200, body: { ok: true, reading } };
    }

    if (route === "/api/tarot/draw" && method === "POST") {
      const reading = manualReading({
        deck, deckVersion,
        spreadType: body?.spread_type,
        question: body?.question,
        timezone: body?.timezone,
        reversals: body?.reversals === true,
        now,
      });
      return { status: 200, body: { ok: true, reading } };
    }

    if (route === "/api/tarot/readings" && method === "POST") {
      const saved = await saveReading({ auth, payload: body?.reading ?? body, deck, deckVersion, fetchImpl });
      return { status: 201, body: { ok: true, reading: saved } };
    }

    if (route === "/api/tarot/readings" && method === "GET") {
      const limit = Number(params?.get("limit") ?? HISTORY_LIMIT);
      const readings = await listReadings({ auth, limit, fetchImpl });
      return { status: 200, body: { ok: true, readings } };
    }

    // What this instance can do, so the panel does not have to guess. Public:
    // it reports readiness, never content.
    if (route === "/api/tarot/status" && method === "GET") {
      const status = deckReadiness({ deck });
      return {
        status: 200,
        body: {
          ok: true,
          ready: status.ready,
          reason: status.reason,
          message: status.message,
          card_count: status.count,
          deck_version: deckVersion,
          contract_version: DRAW_CONTRACT_VERSION,
          spreads: SPREAD_TYPES.map((type) => ({ type, positions: SPREAD_POSITIONS[type] })),
        },
      };
    }

    return null;
  } catch (error) {
    return fail(error);
  }
}
