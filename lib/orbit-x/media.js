// Orbit X :: media hosting for the channel (Dev Update 6.1).
//
// Meta publishes an image by FETCHING it: image_url must be a public HTTPS
// URL that answers a plain GET. Orbit already runs on Supabase, so the slides
// go to a public Storage bucket (orbit-x-media, created by the channel
// migration) under channel/<slot-date>/<post-id>/<export filename>. The path
// carries the post id, so it is not enumerable, and nothing in it identifies
// a person.
//
// Objects stay until removed, which comfortably covers Meta's fetch (it
// happens within seconds of container creation, and containers expire after
// 24 hours). They are finished brand graphics that become public on Instagram
// anyway. Cleanup is a documented manual step, not a timer that could delete
// something Meta has not fetched yet.
//
// Writes use the service-role key under the "orbit-x-channel" purpose; there
// is no client upload path at all.

export const MEDIA_BUCKET = "orbit-x-media";

export class OrbitXMediaError extends Error {
  constructor(message, { code = "media_failed" } = {}) {
    super(message);
    this.name = "OrbitXMediaError";
    this.code = code;
  }
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function mediaPath({ slotDate, postId, filename }) {
  const parts = ["channel", String(slotDate || ""), String(postId || ""), String(filename || "")];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[1]) || !parts.slice(2).every((p) => SAFE_SEGMENT.test(p))) {
    throw new OrbitXMediaError("Refusing an unsafe media path.", { code: "media_path" });
  }
  return parts.join("/");
}

/**
 * @param {{ url: string, serviceKey: string }} admin
 */
export function mediaStore(admin, { fetchImpl = fetch, bucket = MEDIA_BUCKET } = {}) {
  const root = String(admin?.url || "").replace(/\/+$/, "");
  if (!root || !admin?.serviceKey) throw new OrbitXMediaError("Media storage is not configured.", { code: "media_unconfigured" });

  const publicUrl = (path) => `${root}/storage/v1/object/public/${bucket}/${path}`;

  return {
    bucket,
    publicUrl,

    /** Upload (idempotent: upsert) and return the public URL. */
    async upload(path, bytes, contentType) {
      if (!["image/png", "image/jpeg"].includes(contentType)) {
        throw new OrbitXMediaError(`Refusing content type ${contentType}.`, { code: "media_type" });
      }
      let res;
      try {
        res = await fetchImpl(`${root}/storage/v1/object/${bucket}/${path}`, {
          method: "POST",
          headers: {
            apikey: admin.serviceKey,
            authorization: `Bearer ${admin.serviceKey}`,
            "content-type": contentType,
            "x-upsert": "true",
            "cache-control": "max-age=31536000",
          },
          body: bytes,
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        throw new OrbitXMediaError("Media storage could not be reached.", { code: "media_unreachable" });
      }
      if (!res.ok) throw new OrbitXMediaError(`Media upload was refused (${res.status}).`, { code: "media_refused" });
      return publicUrl(path);
    },

    /** Is the public URL actually fetchable, the way Meta will fetch it? */
    async verifyPublic(url) {
      try {
        const res = await fetchImpl(url, { method: "HEAD", signal: AbortSignal.timeout(10000) });
        return res.ok && /^image\//.test(res.headers?.get?.("content-type") || "image/");
      } catch { return false; }
    },
  };
}
