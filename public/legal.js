// Orbit Axis :: shared behaviour for the public information pages.
//
// These pages are static HTML. The only thing they need at runtime is the
// handful of facts Orbit refuses to hardcode — support address, publisher,
// governing law, minimum age, and the source repository URLs — because
// inventing any of them would ship a promise nobody made.
//
// Every slot degrades to an honest "not yet published" state rather than a
// dead mailto link or a plausible-looking placeholder.

const PENDING = "not yet published";

/** Fill every [data-legal] slot on the page. */
async function applyLegalConfig() {
  let config = null;
  try {
    const res = await fetch("/api/legal/config");
    if (res.ok) config = await res.json();
  } catch {
    // Leave the pending state in place. A page that cannot reach the server
    // should say a detail is unavailable, not guess at it.
  }

  const value = (key) => {
    switch (key) {
      case "supportEmail": return config?.supportEmail || null;
      case "legalEntity": return config?.legalEntity || null;
      case "jurisdiction": return config?.jurisdiction || null;
      case "minimumAge": return config?.minimumAge ? String(config.minimumAge) : null;
      case "sourceApp": return config?.source?.application || null;
      case "sourceEngine": return config?.source?.engine || null;
      default: return null;
    }
  };

  for (const el of document.querySelectorAll("[data-legal]")) {
    const key = el.dataset.legal;
    const resolved = value(key);

    if (!resolved) {
      // The repository URLs are checked-in public facts. If the runtime config
      // cannot be reached, keep those working static links instead of replacing
      // them with a stale publication state. An explicit invalid override is
      // blocked by deploy:check before a public deployment.
      if ((key === "sourceApp" || key === "sourceEngine") && el.getAttribute("href") !== "#") continue;
      el.textContent = el.dataset.legalPending || PENDING;
      el.classList.add("legal__pending");
      continue;
    }

    el.classList.remove("legal__pending");

    // A support address becomes a real mailto only once it is a real address.
    if (key === "supportEmail" && el.tagName === "A") {
      el.href = `mailto:${resolved}`;
      el.textContent = resolved;
      continue;
    }
    if ((key === "sourceApp" || key === "sourceEngine") && el.tagName === "A") {
      el.href = resolved;
      el.textContent = resolved.replace(/^https:\/\//, "");
      el.rel = "noopener";
      continue;
    }
    el.textContent = resolved;
  }
}

/** Live version facts, so the Source page never states a version by hand. */
async function applyVersions() {
  const slots = document.querySelectorAll("[data-version]");
  if (!slots.length) return;
  try {
    const res = await fetch("/api/v1/version");
    if (!res.ok) return;
    const { data } = await res.json();
    const map = {
      application: data?.applicationVersion,
      engine: data?.engineVersion,
      contract: data?.contractVersion,
      ephemeris: data?.ephemerisVersion,
    };
    for (const el of slots) {
      const v = map[el.dataset.version];
      if (v) el.textContent = v;
    }
  } catch { /* the page is still readable without version numbers */ }
}

/**
 * Build the table of contents from the headings that are actually on the page,
 * so it can never drift out of step with the document it describes.
 */
function buildTableOfContents() {
  const toc = document.querySelector("[data-toc]");
  if (!toc) return;
  const headings = [...document.querySelectorAll(".legal h2[id]")]
    .filter((h) => !h.closest(".legal__toc") && !h.closest(".legal__related"));
  if (headings.length < 3) { toc.hidden = true; return; }
  const list = document.createElement("ol");
  for (const h of headings) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${h.id}`;
    a.textContent = h.textContent;
    li.append(a);
    list.append(li);
  }
  toc.querySelector("ol")?.remove();
  toc.append(list);
}

document.addEventListener("DOMContentLoaded", () => {
  buildTableOfContents();
  applyLegalConfig();
  applyVersions();
});
