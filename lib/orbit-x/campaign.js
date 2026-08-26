// Orbit Axis :: outbound campaign keys for Orbit X posts (Dev Update 6.0).
//
// THE PROBLEM THIS SOLVES
//
// Orbit X exports a carousel; a human posts it somewhere Orbit has no
// connection to. Nothing links the post that went out to the visits that came
// back, and the referrer cannot supply it — mobile apps routinely strip it,
// which is precisely the case that matters here.
//
// So the link carried in the caption identifies the content itself. The key is
// DERIVED FROM THE POST ID rather than stored, which means:
//
//   - no new column, and no second concept competing with the reserved
//     external_media_id / performance_metrics fields, which remain unused and
//     belong to a publisher that does not exist yet
//   - the same post always produces the same key, so a link written by hand
//     and a link generated a month later agree
//   - nothing about the account, the reader, or the content leaks into it
//
// EXPORTING IS NOT PUBLISHING. A key existing says a link was generated, never
// that anything was posted. Orbit does not know whether an exported graphic was
// ever used, and nothing here pretends otherwise.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The query parameter the client reads. Short, because it rides in a caption. */
export const CAMPAIGN_PARAM = "oxc";

/**
 * The stable content key for a post.
 *
 * The first block of the uuid is enough to be unique across anything Orbit X
 * will ever produce, and short enough to sit in a caption without looking like
 * a tracking string — which it is not: it identifies the POST, not the person.
 *
 * @param {string} postId
 * @returns {string|null}
 */
export function campaignKeyForPost(postId) {
  if (typeof postId !== "string" || !UUID.test(postId)) return null;
  return `ox-${postId.slice(0, 8).toLowerCase()}`;
}

/**
 * The link to put in the caption.
 *
 * utm_source is left to the person posting, because only they know where it is
 * going. utm_medium is fixed to "social" and utm_campaign to the reading type
 * or event type, so the metrics panel can group without anyone hand-typing a
 * taxonomy.
 *
 * @param {{ baseUrl: string, post: object, source?: string }} options
 * @returns {string|null}
 */
export function campaignUrl({ baseUrl, post, source = null } = {}) {
  const key = campaignKeyForPost(post?.id);
  if (!key || typeof baseUrl !== "string" || !baseUrl.trim()) return null;
  let url;
  try { url = new URL(baseUrl.trim()); } catch { return null; }
  if (url.protocol !== "https:" && url.hostname !== "localhost") return null;

  const campaign = String(post?.reading_type || post?.event_type || "post")
    .toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 64);

  url.searchParams.set("utm_medium", "social");
  if (campaign) url.searchParams.set("utm_campaign", campaign);
  if (source) {
    const clean = String(source).toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 64);
    if (clean) url.searchParams.set("utm_source", clean);
  }
  url.searchParams.set(CAMPAIGN_PARAM, key);
  return url.toString();
}

/**
 * What the desk shows beside an export.
 *
 * @returns {{ key: string, url: string|null }|null}
 */
export function campaignForPost(post, { baseUrl = null, source = null } = {}) {
  const key = campaignKeyForPost(post?.id);
  if (!key) return null;
  return { key, url: baseUrl ? campaignUrl({ baseUrl, post, source }) : null };
}
