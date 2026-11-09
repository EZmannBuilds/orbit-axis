// Orbit X :: OrbitXPublisher, the Instagram Content Publishing boundary
// (Dev Update 6.1).
//
// THE ONLY CODE IN ORBIT THAT TALKS TO META, AND IT ONLY USES THE OFFICIAL
// API. No browser automation, no scraping, no unofficial endpoints. A
// carousel is published exactly the documented way:
//
//   1. POST /{ig-user-id}/media           one image container per slide
//                                          (image_url, is_carousel_item, alt_text)
//   2. POST /{ig-user-id}/media           the carousel container
//                                          (media_type=CAROUSEL, children, caption)
//   3. GET  /{container-id}?fields=status_code   until FINISHED
//   4. POST /{ig-user-id}/media_publish   (creation_id)
//
// Instagram Login uses graph.instagram.com; Facebook Login (a Page linked to
// the Business account) uses graph.facebook.com. The paths are the same.
// ORBIT_X_IG_API names which one, exactly; unset means unconfigured, never a
// guess.
//
// SAFETY PROPERTIES, EACH TESTED WITH A MOCKED GRAPH API:
//   - shouldStop() is asked immediately before every WRITE to Meta, so the
//     kill switch and the desk's pause stop a run between any two calls.
//   - The publishing quota (content_publishing_limit, ~100 per 24 hours) is
//     read before the carousel is created and again before publishing.
//   - Retries are bounded, back off exponentially, and only happen for
//     failures Meta documents as transient. A bad token or a refused image
//     fails at once.
//   - The access token travels in the request and nowhere else: not in an
//     error, not in a log line, not in the audit record. Anything Meta echoes
//     back is scrubbed before it is stored.
//   - Publishing is never retried blindly. A lost response or a 5xx from
//     media_publish is "outcome unknown", not "failed": the channel asks the
//     container whether it was published, and recoverPublished() finds the
//     media id instead of posting twice. Only answers that prove nothing went
//     out (not ready yet, rate limited) are retried.

export const DEFAULT_GRAPH_VERSION = "v25.0";
export const GRAPH_HOSTS = Object.freeze({
  instagram: "graph.instagram.com",
  facebook: "graph.facebook.com",
});
export const CAROUSEL_MIN = 2;
export const CAROUSEL_MAX = 10;
export const META_DAILY_LIMIT = 100;

export class OrbitXPublishError extends Error {
  constructor(message, { code = "publish_failed", retryable = false, graph = null } = {}) {
    super(message);
    this.name = "OrbitXPublishError";
    this.code = code;
    this.retryable = retryable;
    this.graph = graph;
  }
}

/** Publisher configuration from the environment. The token is held in the
 *  returned closure only; the summary never contains it. */
export function graphConfig(env = process.env) {
  const problems = [];
  const api = String(env.ORBIT_X_IG_API || "");
  const host = GRAPH_HOSTS[api] || null;
  if (!host) problems.push("ORBIT_X_IG_API must be exactly \"instagram\" or \"facebook\"");
  const igUserId = String(env.ORBIT_X_IG_USER_ID || "");
  if (!/^\d{5,30}$/.test(igUserId)) problems.push("ORBIT_X_IG_USER_ID must be the numeric Instagram professional account id");
  const token = String(env.ORBIT_X_IG_ACCESS_TOKEN || "");
  if (token.length < 20) problems.push("ORBIT_X_IG_ACCESS_TOKEN is not set");
  const versionRaw = String(env.ORBIT_X_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION);
  const version = /^v\d{2}\.\d$/.test(versionRaw) ? versionRaw : null;
  if (!version) problems.push("ORBIT_X_GRAPH_API_VERSION must look like v25.0");
  return Object.freeze({
    configured: problems.length === 0,
    problems: Object.freeze(problems),
    summary: Object.freeze({ api: host ? api : null, host, version, igUserIdSet: Boolean(igUserId), tokenSet: token.length >= 20 }),
    host, version, igUserId,
    token: () => token,
  });
}

/** Meta's error codes that are worth one more try. Everything else is final.
 *  1/2: unknown/service; 4/17/32/613: rate limits; 9007 with 2207027: the
 *  container is not ready to publish yet. */
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);
function isTransient(status, err) {
  if (status === 429 || status >= 500) return true;
  if (err?.is_transient === true) return true;
  if (TRANSIENT_CODES.has(Number(err?.code))) return true;
  if (Number(err?.code) === 9007 && Number(err?.error_subcode) === 2207027) return true;
  return false;
}

function scrub(text, token) {
  let out = String(text || "");
  if (token) out = out.split(token).join("[redacted]");
  return out.replace(/access_token=[^&\s"]+/gi, "access_token=[redacted]").slice(0, 300);
}

/**
 * @param {object} deps
 * @param {object} deps.config      graphConfig(env)
 * @param {function} [deps.fetchImpl]
 * @param {function} [deps.sleep]    ms => Promise, injectable for tests
 * @param {function} [deps.shouldStop] async () => string|null — a reason to stop, or null
 * @param {object} [deps.retry]      { attempts, baseMs }
 * @param {function} [deps.log]      (step, outcome, detail) => void — never receives the token
 */
export function createPublisher({
  config, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  shouldStop = async () => null, retry = { attempts: 3, baseMs: 1000 }, log = () => {},
} = {}) {
  if (!config?.configured) {
    throw new OrbitXPublishError(`Instagram publishing is not configured: ${(config?.problems || []).join("; ")}`,
      { code: "publish_unconfigured" });
  }
  const token = config.token();
  const base = `https://${config.host}/${config.version}`;

  async function guard(step) {
    const reason = await shouldStop();
    if (reason) {
      log(step, "fail", { stopped: reason });
      throw new OrbitXPublishError(`Stopped before ${step}: ${reason}`, { code: "killed" });
    }
  }

  /**
   * `outcomeMatters` marks a write whose effect cannot be undone (publishing).
   * For it, a lost response or a server error is NOT retried here: Meta may
   * have done it. The caller asks the container instead.
   */
  async function call(step, method, path, params = {}, { outcomeMatters = false } = {}) {
    const attempts = Math.max(1, Number(retry?.attempts) || 1);
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let res;
      let body = null;
      try {
        if (method === "GET") {
          const qs = new URLSearchParams({ ...params, access_token: token });
          res = await fetchImpl(`${base}${path}?${qs}`, { method: "GET", signal: AbortSignal.timeout(15000) });
        } else {
          const form = new URLSearchParams({ ...params, access_token: token });
          res = await fetchImpl(`${base}${path}`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: form.toString(),
            signal: AbortSignal.timeout(20000),
          });
        }
        body = await res.json().catch(() => null);
      } catch {
        if (outcomeMatters) {
          log(step, "warn", { attempt, error: "outcome unknown" });
          throw new OrbitXPublishError(`${step}: the response was lost; the container will say whether it went out`,
            { code: "publish_outcome_unknown", retryable: true });
        }
        lastError = new OrbitXPublishError(`${step}: Meta could not be reached`, { code: "graph_unreachable", retryable: true });
        log(step, "warn", { attempt, error: "unreachable" });
        if (attempt < attempts) await sleep(retry.baseMs * 2 ** (attempt - 1));
        continue;
      }
      if (res.ok && body && !body.error) {
        log(step, "ok", { attempt });
        return body;
      }
      const err = body?.error || {};
      const graph = { status: res.status, code: err.code ?? null, subcode: err.error_subcode ?? null,
        type: err.type ? scrub(err.type, token) : null, message: err.message ? scrub(err.message, token) : null,
        traceId: err.fbtrace_id ? String(err.fbtrace_id).slice(0, 64) : null };
      const transient = isTransient(res.status, err);
      if (outcomeMatters && res.status >= 500) {
        log(step, "warn", { attempt, graph });
        throw new OrbitXPublishError(`${step}: Meta answered ${res.status}; the container will say whether it went out`,
          { code: "publish_outcome_unknown", retryable: true, graph });
      }
      lastError = new OrbitXPublishError(`${step}: Meta refused (${graph.code ?? res.status}${graph.subcode ? `/${graph.subcode}` : ""})`,
        { code: transient ? "graph_transient" : "graph_refused", retryable: transient, graph });
      log(step, transient ? "warn" : "fail", { attempt, graph });
      if (!transient) break;
      if (attempt < attempts) await sleep(retry.baseMs * 2 ** (attempt - 1));
    }
    throw lastError;
  }

  const ig = `/${config.igUserId}`;

  return {
    /** { used, total } for the rolling 24 hours. */
    async quota() {
      const body = await call("quota", "GET", `${ig}/content_publishing_limit`, { fields: "quota_usage,config" });
      const row = Array.isArray(body?.data) ? body.data[0] : body;
      const used = Number(row?.quota_usage);
      const total = Number(row?.config?.quota_total) || META_DAILY_LIMIT;
      return { used: Number.isFinite(used) ? used : null, total };
    },

    async assertQuota(step) {
      const q = await this.quota();
      if (q.used === null) throw new OrbitXPublishError("Publishing quota could not be read.", { code: "quota_unknown", retryable: true });
      if (q.used >= Math.min(q.total, META_DAILY_LIMIT)) {
        throw new OrbitXPublishError(`Publishing quota exhausted before ${step} (${q.used}/${q.total} in 24h).`,
          { code: "quota_exhausted", retryable: true });
      }
      return q;
    },

    async createImageItem({ imageUrl, altText }) {
      if (!/^https:\/\//.test(String(imageUrl))) {
        throw new OrbitXPublishError("Meta can only fetch public HTTPS image URLs.", { code: "image_url_not_https" });
      }
      await guard("create_item");
      const params = { image_url: imageUrl, is_carousel_item: "true" };
      if (altText) params.alt_text = String(altText).slice(0, 1000);
      const body = await call("create_item", "POST", `${ig}/media`, params);
      if (!body?.id) throw new OrbitXPublishError("Meta returned no container id.", { code: "graph_no_id" });
      return String(body.id);
    },

    async createCarousel({ children, caption }) {
      if (!Array.isArray(children) || children.length < CAROUSEL_MIN || children.length > CAROUSEL_MAX) {
        throw new OrbitXPublishError(`A carousel takes ${CAROUSEL_MIN} to ${CAROUSEL_MAX} items.`, { code: "carousel_size" });
      }
      await guard("create_carousel");
      await this.assertQuota("create_carousel");
      const body = await call("create_carousel", "POST", `${ig}/media`,
        { media_type: "CAROUSEL", children: children.join(","), caption: String(caption || "") });
      if (!body?.id) throw new OrbitXPublishError("Meta returned no carousel id.", { code: "graph_no_id" });
      return String(body.id);
    },

    /** EXPIRED | ERROR | FINISHED | IN_PROGRESS | PUBLISHED */
    async containerStatus(id) {
      const body = await call("container_status", "GET", `/${id}`, { fields: "status_code,status" });
      return { statusCode: String(body?.status_code || "UNKNOWN"), status: body?.status ? scrub(body.status, token) : null };
    },

    /**
     * Poll until FINISHED, within a deadline. Returns the last status rather
     * than throwing on IN_PROGRESS, so the job can save and resume next tick.
     */
    async waitForFinished(id, { deadline = Date.now() + 20000, intervalMs = 3000, now = () => Date.now(), maxPolls = 8 } = {}) {
      let last = null;
      // Bounded twice over: by the deadline, and by a poll count that holds
      // even if the clock it is given does not move.
      for (let poll = 1; ; poll += 1) {
        last = await this.containerStatus(id);
        if (["FINISHED", "PUBLISHED", "ERROR", "EXPIRED"].includes(last.statusCode)) return last;
        if (poll >= maxPolls || now() + intervalMs > deadline) return last;
        await sleep(intervalMs);
      }
    },

    async publish(creationId) {
      await guard("media_publish");
      await this.assertQuota("media_publish");
      const body = await call("media_publish", "POST", `${ig}/media_publish`, { creation_id: String(creationId) },
        { outcomeMatters: true });
      if (!body?.id) throw new OrbitXPublishError("Meta returned no media id.", { code: "graph_no_id" });
      return String(body.id);
    },

    async permalink(mediaId) {
      try {
        const body = await call("permalink", "GET", `/${mediaId}`, { fields: "id,permalink,timestamp" });
        return typeof body?.permalink === "string" && /^https:\/\/(www\.)?instagram\.com\//.test(body.permalink)
          ? body.permalink : null;
      } catch { return null; }
    },

    /**
     * A container reported PUBLISHED but the media id was never recorded (the
     * function died between Meta's answer and the database write). Find it by
     * caption among the account's most recent media instead of publishing
     * again.
     */
    async recoverPublished({ caption, after }) {
      const body = await call("recover", "GET", `${ig}/media`, { fields: "id,caption,timestamp", limit: "10" });
      const wanted = String(caption || "").trim();
      const since = after ? Date.parse(after) - 60_000 : 0;
      const hit = (body?.data || []).find((m) => String(m?.caption || "").trim() === wanted
        && (!since || Date.parse(m?.timestamp) >= since));
      return hit?.id ? String(hit.id) : null;
    },
  };
}
