// Orbit Axis API v1 :: account operations.
//
// The first AUTHENTICATED route in v1. Everything else here is public and
// stateless; this one is neither, and it is destructive, so it carries its own
// checks rather than inheriting the permissive defaults the calculation routes
// were designed around.

import { ApiError } from "../errors/codes.js";
import { deleteAccount, DELETION_CONFIRMATION, AccountDeletionError } from "../../../account/deletion.js";
import { buildAccountExport, exportFilename, AccountExportError } from "../../../account/export.js";
import { decodeSessionToken, getSessionCookie } from "../../../auth/supabase-auth.js";

/**
 * DELETE /api/v1/account
 *
 * Identity comes from the session cookie or an Authorization header, and is
 * verified with Supabase before anything is removed. A `userId` in the request
 * body is IGNORED — not rejected with a special message, simply never read,
 * because the only id this endpoint can act on is the one the token proves.
 */
export async function remove(body, { req, deps = {} } = {}) {
  const accessToken = bearerToken(req);
  if (!accessToken) {
    throw new ApiError("UNAUTHORIZED", {
      message: "Sign in to delete your account.",
    });
  }

  const confirmation = typeof body?.confirmation === "string" ? body.confirmation : "";
  if (confirmation !== DELETION_CONFIRMATION) {
    throw new ApiError("CONFIRMATION_REQUIRED", {
      message: `Type ${DELETION_CONFIRMATION} to confirm. This cannot be undone.`,
      details: { field: "confirmation" },
    });
  }

  try {
    const result = await deleteAccount({ accessToken, confirmation, ...deps });
    return {
      deleted: true,
      // Reported so a client can tell the difference between "we just deleted
      // it" and "it was already gone" — both are success, but only one is worth
      // a confirmation message.
      alreadyRemoved: result.alreadyGone,
      sessionsRevoked: result.sessionsRevoked,
      verifiedTables: result.tablesVerified,
    };
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      // Stages map to distinct codes so a client can respond appropriately: a
      // confirmation problem is the user's to fix, an authentication problem
      // means sign in again, and an incomplete deletion means contact support.
      if (error.stage === "confirmation") {
        throw new ApiError("CONFIRMATION_REQUIRED", { message: error.message, details: { field: "confirmation" } });
      }
      if (error.stage === "authentication") {
        throw new ApiError("UNAUTHORIZED", { message: error.message });
      }
      if (error.stage === "verification") {
        throw new ApiError("DELETION_INCOMPLETE", { message: error.message, cause: error });
      }
      if (error.stage === "configuration") {
        throw new ApiError("ENGINE_UNAVAILABLE", { message: error.message, cause: error });
      }
      throw new ApiError("INTERNAL_ERROR", { message: error.message, cause: error });
    }
    throw error;
  }
}

/**
 * GET /api/v1/account/export
 *
 * The other half of the ownership promise. Deletion without a way to take your
 * data first is not ownership, it is just a delete button.
 *
 * Free, always. Whatever plans eventually exist, the two operations that let
 * someone LEAVE — export and deletion — are never behind one.
 *
 * Returns `{ filename, document }`. The router turns the filename into a
 * Content-Disposition header; the handler stays a plain function of its input
 * and does not reach for the response object.
 */
export async function exportData(_body, { req, deps = {} } = {}) {
  const accessToken = bearerToken(req);
  if (!accessToken) {
    throw new ApiError("UNAUTHORIZED", { message: "Sign in to export your data." });
  }

  try {
    const document = await buildAccountExport({
      accessToken,
      timezone: requestedTimezone(req),
      ...deps,
    });
    return { filename: exportFilename(), document };
  } catch (error) {
    if (error instanceof AccountExportError) {
      if (error.stage === "authentication") {
        throw new ApiError("UNAUTHORIZED", { message: error.message });
      }
      if (error.stage === "configuration") {
        throw new ApiError("ENGINE_UNAVAILABLE", { message: error.message, cause: error });
      }
      // A read failure is transient and says nothing about the database's
      // internals; the original message is already safe by construction.
      throw new ApiError("INTERNAL_ERROR", { message: error.message, cause: error });
    }
    throw error;
  }
}

/**
 * The caller's IANA timezone, used only to add a readable local timestamp
 * beside the UTC one.
 *
 * Validated by shape before use. It is interpolated into an Intl formatter,
 * and an unvalidated value there is a needless place for junk to reach a
 * platform API. An unusable value degrades to UTC rather than failing an export
 * the person is entitled to.
 */
function requestedTimezone(req) {
  const raw = new URL(req?.url || "/", "http://localhost").searchParams.get("timezone") || "";
  return /^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+){0,2}$/.test(raw) ? raw : "UTC";
}

/**
 * The access token, from either transport.
 *
 * The cookie is Orbit's own web session. The Authorization header is what a
 * future iOS client will send, since a native app has no cookie jar shared with
 * a browser. Supporting both here means the contract does not have to change
 * when that client arrives.
 */
function bearerToken(req) {
  const header = String(req?.headers?.authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match) {
    // Two kinds of caller present a bearer here. The public contract is a raw
    // Supabase access token. Orbit's iOS shell presents its whole session
    // blob, because a cross-origin fetch cannot keep the cookie that normally
    // carries it. Decoding tells them apart — a JWT does not decode to JSON
    // holding an access_token, so neither can be mistaken for the other.
    const raw = match[1].trim();
    return decodeSessionToken(raw)?.access_token || raw;
  }
  const session = getSessionCookie(req);
  return session?.access_token || "";
}

export { bearerToken };
