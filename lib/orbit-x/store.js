// Orbit X :: persistence (Dev Update 5.0).
//
// Every operation runs under the SIGNED-IN ADMIN'S OWN TOKEN. There is no
// service-role lane here at all: the RLS policies on orbit_x_posts ask the
// orbit_x_admins membership table, so the database enforces the same
// authorization the API checks — a non-admin token gets empty reads and
// refused writes even if a bug let the request through.
//
// FACTS ARE WRITE-ONCE. update() has an allow-list of columns and
// event_payload is not on it. The verified packet a row was created with is
// the packet it dies with; copy changes beside it, never over it.

export class OrbitXStoreError extends Error {
  constructor(message, { code = "store_failed", status = 502 } = {}) {
    super(message);
    this.name = "OrbitXStoreError";
    this.code = code;
    this.status = status;
  }
}

const UPDATABLE = new Set([
  "edited_copy", "editor_notes", "status", "rejection_reason", "selected_format",
  "template", "updated_at", "approved_at", "exported_at",
]);

export function orbitXStore(auth, { fetchImpl = fetch } = {}) {
  const root = String(auth.url).replace(/\/+$/, "");
  const headers = {
    apikey: auth.anonKey,
    authorization: `Bearer ${auth.accessToken}`,
    "content-type": "application/json",
    accept: "application/json",
  };
  const rest = (path) => `${root}/rest/v1/${path}`;

  async function rows(path, options = {}) {
    const res = await fetchImpl(rest(path), { headers, ...options });
    if (!res.ok) throw new OrbitXStoreError("Editorial storage refused the request.",
      { status: res.status === 401 ? 401 : 502 });
    return res.json().catch(() => []);
  }

  return {
    /** The membership check. RLS only lets a person see their own row, so a
     *  non-empty answer means "the signed-in account is an admin" and nothing
     *  a client asserts can widen it. */
    async isAdmin() {
      const list = await rows(`orbit_x_admins?owner_id=eq.${encodeURIComponent(auth.ownerId)}&select=owner_id&limit=1`);
      return Array.isArray(list) && list.length === 1;
    },

    async history({ status = null, limit = 50 } = {}) {
      const filter = status ? `&status=eq.${encodeURIComponent(status)}` : "";
      return rows(`orbit_x_posts?select=id,event_key,event_type,selected_format,status,editorial_score,rejection_reason,created_at,updated_at,approved_at,exported_at${filter}&order=created_at.desc&limit=${Math.min(Number(limit) || 50, 200)}`);
    },

    async byId(id) {
      const list = await rows(`orbit_x_posts?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
      return list[0] || null;
    },

    /** Duplicate protection: living coverage of the same real event. */
    async coverageFor(eventKey) {
      return rows(`orbit_x_posts?event_key=eq.${encodeURIComponent(eventKey)}&status=in.(draft,approved,exported)&select=id,status,created_at&limit=10`);
    },

    async insert(row) {
      const res = await fetchImpl(rest("orbit_x_posts"), {
        method: "POST",
        headers: { ...headers, prefer: "return=representation" },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new OrbitXStoreError("The draft could not be saved.",
        { code: "insert_failed", status: res.status === 401 ? 401 : 502 });
      const saved = await res.json().catch(() => []);
      if (!saved[0]) throw new OrbitXStoreError("The draft could not be saved.", { code: "insert_unconfirmed" });
      return saved[0];
    },

    async update(id, fields) {
      const clean = {};
      for (const [key, value] of Object.entries(fields || {})) {
        // Silently dropping a disallowed column would hide a bug; refusing
        // names it. event_payload lands here if anything ever tries.
        if (!UPDATABLE.has(key)) throw new OrbitXStoreError(`"${key}" is not an editable column.`,
          { code: "column_refused", status: 400 });
        clean[key] = value;
      }
      clean.updated_at = new Date().toISOString();
      const res = await fetchImpl(rest(`orbit_x_posts?id=eq.${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: { ...headers, prefer: "return=representation" },
        body: JSON.stringify(clean),
      });
      if (!res.ok) throw new OrbitXStoreError("The change could not be saved.",
        { code: "update_failed", status: res.status === 401 ? 401 : 502 });
      const saved = await res.json().catch(() => []);
      if (!saved[0]) throw new OrbitXStoreError("Nothing was updated — the row may not exist.",
        { code: "update_missed", status: 404 });
      return saved[0];
    },
  };
}
