// Orbit Axis :: read the cards on your own table.
//
// Step 4 of docs/tarot-camera-plan.md, the web half. A reader lays out one or
// three cards from their own Waite–Smith deck; the camera recognises them (or
// the reader picks them by hand), the reader confirms, and the server composes
// the reading from approved text.
//
//   choose a spread → camera with card guides → confirm → reading → keep it
//
// What leaves the device: card names and orientations, nothing else. Camera
// frames are classified here, in the browser, by public/models/tarot/
// TarotCards.onnx, and are never uploaded.
//
// Recognition is a suggestion. Nothing is read until the reader has looked at
// the cards it found and confirmed or corrected them; a low-confidence guess is
// shown as a question, not an answer.
//
// This file owns its own UI and stylesheet (public/styles/tarot-scan.css) and
// adds one button to the Tarot panel. It does not touch app.js.

import { apiUrl, authHeaders, rememberSession } from "./platform.js";

const MODEL_URL = "/models/tarot/TarotCards.onnx";
const LABELS_URL = "/models/tarot/labels.json";
// Pinned, loaded only when the reader opens the camera.
const ORT_VERSION = "1.20.1";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

const CARD_ASPECT = 0.57; // Waite–Smith width / height
const STABLE_FRAMES = 5; // same answer this many times in a row
const CONFIDENT = 0.6; // and at least this sure, on average
const FRAME_MS = 220;

const SPREADS = {
  one_card: { count: 1, label: "One card", positions: ["Your card"] },
  three_card: { count: 3, label: "Three cards", positions: ["What shaped this", "What is present", "What to consider next"] },
};

// ── Small helpers ───────────────────────────────────────────────────────────

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function call(path, { method = "GET", body } = {}) {
  const response = await fetch(apiUrl(path), {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    credentials: "same-origin",
    body: body ? JSON.stringify(body) : undefined,
  });
  rememberSession(response);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || "Orbit could not read those cards.");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

let deckPromise = null;
function loadDeck() {
  deckPromise ??= call("/api/tarot/cards").then((d) => d.cards).catch((e) => { deckPromise = null; throw e; });
  return deckPromise;
}

// ── Recognition (in the browser) ────────────────────────────────────────────

let recogniserPromise = null;

/** Load onnxruntime-web, the model and its labels once. */
function loadRecogniser() {
  recogniserPromise ??= (async () => {
    const ort = await import(/* @vite-ignore */ `${ORT_BASE}ort.wasm.min.mjs`);
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = 1; // no cross-origin isolation required
    const [session, labels] = await Promise.all([
      ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] }),
      fetch(LABELS_URL).then((r) => r.json()),
    ]);
    return { ort, session, labels };
  })().catch((e) => { recogniserPromise = null; throw e; });
  return recogniserPromise;
}

/** Classify N square crops (each a 224×224 ImageData). Returns [{ slug, reversed, confidence }]. */
async function classify(rec, crops) {
  const { ort, session, labels } = rec;
  const size = labels.input.width;
  const plane = size * size;
  const data = new Float32Array(crops.length * 3 * plane);
  crops.forEach((img, n) => {
    const px = img.data;
    const base = n * 3 * plane;
    for (let i = 0; i < plane; i++) {
      for (let c = 0; c < 3; c++) {
        data[base + c * plane + i] = (px[i * 4 + c] / 255 - labels.input.mean[c]) / labels.input.std[c];
      }
    }
  });
  const out = await session.run({ image: new ort.Tensor("float32", data, [crops.length, 3, size, size]) });
  const logits = out.logits.data;
  const k = labels.classes.length;
  return crops.map((_, n) => {
    let max = -Infinity, arg = 0;
    for (let j = 0; j < k; j++) if (logits[n * k + j] > max) { max = logits[n * k + j]; arg = j; }
    let sum = 0;
    for (let j = 0; j < k; j++) sum += Math.exp(logits[n * k + j] - max);
    const cls = labels.classes[arg];
    return { slug: cls.slug, reversed: cls.reversed, confidence: 1 / sum };
  });
}

/**
 * Where each guide sits in the video's own pixels. The video is shown with
 * object-fit: cover, so the visible area is a centred crop of the frame; the
 * guides are laid out over what is visible.
 */
function guideRects(video, guides) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const box = video.getBoundingClientRect();
  const scale = Math.max(box.width / vw, box.height / vh);
  const offX = (vw * scale - box.width) / 2;
  const offY = (vh * scale - box.height) / 2;
  return guides.map((g) => {
    const r = g.getBoundingClientRect();
    return {
      x: (r.left - box.left + offX) / scale,
      y: (r.top - box.top + offY) / scale,
      w: r.width / scale,
      h: r.height / scale,
    };
  });
}

// ── The dialog ──────────────────────────────────────────────────────────────

class TarotScan {
  constructor() {
    this.spread = "one_card";
    this.picks = []; // [{ slug, reversed, confidence|null }]
    this.method = "manual";
    this.stream = null;
    this.timer = null;
    this.history = [];
    this.root = null;
    this.returnFocus = null;
  }

  open() {
    this.returnFocus = document.activeElement;
    this.root = document.createElement("div");
    this.root.className = "tscan";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-labelledby", "tscan-title");
    this.root.innerHTML = `
      <div class="tscan__sheet">
        <header class="tscan__head">
          <h2 class="tscan__title" id="tscan-title" tabindex="-1">Read your own cards</h2>
          <button class="o-btn o-btn--utility tscan__close" type="button" data-act="close">Close</button>
        </header>
        <div class="tscan__body" aria-live="polite"></div>
      </div>`;
    document.body.append(this.root);
    document.body.classList.add("tscan-open");
    this.root.addEventListener("click", (e) => this.onClick(e));
    this.root.addEventListener("change", (e) => this.onChange(e));
    this.onKey = (e) => { if (e.key === "Escape") this.close(); };
    document.addEventListener("keydown", this.onKey);
    this.showChoose();
  }

  close() {
    this.stopCamera();
    document.removeEventListener("keydown", this.onKey);
    document.body.classList.remove("tscan-open");
    this.root?.remove();
    this.root = null;
    this.returnFocus?.focus?.();
  }

  get body() { return this.root.querySelector(".tscan__body"); }

  focusTitle() { this.root.querySelector(".tscan__body h3, .tscan__title")?.focus?.(); }

  // Step 1: the spread.
  showChoose() {
    this.stopCamera();
    const camera = Boolean(navigator.mediaDevices?.getUserMedia);
    this.body.innerHTML = `
      <h3 class="tscan__step" tabindex="-1">Lay your cards out face up</h3>
      <p class="tscan__help">Use your own Waite–Smith deck. Orbit recognises the cards from the camera,
        on this device. Only the card names are sent.</p>
      <fieldset class="tscan__spread">
        <legend class="tscan__label">How many cards?</legend>
        ${Object.entries(SPREADS).map(([id, s]) => `
          <label class="tscan__choice"><input type="radio" name="tscan-spread" value="${id}" ${id === this.spread ? "checked" : ""}> ${s.label}</label>`).join("")}
      </fieldset>
      <div class="tscan__actions">
        ${camera ? `<button class="o-btn o-btn--primary" type="button" data-act="camera">Use the camera</button>` : ""}
        <button class="o-btn ${camera ? "o-btn--secondary" : "o-btn--primary"}" type="button" data-act="manual">Pick the cards by hand</button>
      </div>
      ${camera ? "" : `<p class="tscan__note">This browser has no camera access, so pick your cards by hand.</p>`}`;
    this.focusTitle();
  }

  // Step 2a: the camera.
  async showCamera() {
    const n = SPREADS[this.spread].count;
    this.method = "scan";
    this.picks = Array.from({ length: n }, () => null);
    this.history = Array.from({ length: n }, () => []);
    this.body.innerHTML = `
      <h3 class="tscan__step" tabindex="-1">Fit each card inside a frame</h3>
      <div class="tscan__camera">
        <video class="tscan__video" playsinline muted></video>
        <div class="tscan__guides tscan__guides--${n}">
          ${Array.from({ length: n }, (_, i) => `
            <div class="tscan__guide" style="--aspect:${CARD_ASPECT}">
              <span class="tscan__guide-label" data-slot="${i}">Looking…</span>
            </div>`).join("")}
        </div>
      </div>
      <p class="tscan__status" role="status">Starting the camera…</p>
      <div class="tscan__actions">
        <button class="o-btn o-btn--primary" type="button" data-act="confirm" disabled>Use these cards</button>
        <button class="o-btn o-btn--secondary" type="button" data-act="manual">Pick by hand instead</button>
      </div>`;
    this.focusTitle();
    const status = this.body.querySelector(".tscan__status");
    const video = this.body.querySelector("video");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
    } catch (error) {
      const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      status.textContent = denied
        ? "Camera access was not given. You can allow it in your browser's settings, or pick the cards by hand."
        : "No camera could be opened. Pick the cards by hand instead.";
      return;
    }
    if (!this.root) { this.stopCamera(); return; }
    video.srcObject = this.stream;
    await video.play().catch(() => {});
    status.textContent = "Loading the card recogniser…";
    let rec;
    try {
      rec = await loadRecogniser();
    } catch {
      status.textContent = "The card recogniser could not load. Pick the cards by hand instead.";
      return;
    }
    if (!this.root) return;
    status.textContent = "Hold steady. A card is kept once it has been recognised several times in a row.";
    this.loop(rec, video);
  }

  loop(rec, video) {
    const guides = [...this.body.querySelectorAll(".tscan__guide")];
    const frame = document.createElement("canvas");
    const crop = document.createElement("canvas");
    crop.width = crop.height = rec.labels.input.width;
    const fctx = frame.getContext("2d", { willReadFrequently: true });
    const cctx = crop.getContext("2d", { willReadFrequently: true });
    let busy = false;
    this.timer = setInterval(async () => {
      if (busy || !this.root || !video.videoWidth) return;
      busy = true;
      try {
        frame.width = video.videoWidth;
        frame.height = video.videoHeight;
        fctx.drawImage(video, 0, 0);
        const rects = guideRects(video, guides);
        const crops = rects.map((r) => {
          cctx.drawImage(frame, r.x, r.y, r.w, r.h, 0, 0, crop.width, crop.height);
          return cctx.getImageData(0, 0, crop.width, crop.height);
        });
        const results = await classify(rec, crops);
        results.forEach((res, i) => this.observe(i, res));
      } catch {
        /* a dropped frame is not an error worth showing */
      } finally {
        busy = false;
      }
    }, FRAME_MS);
  }

  observe(slot, res) {
    const h = this.history[slot];
    h.push(res);
    if (h.length > STABLE_FRAMES) h.shift();
    const same = h.length === STABLE_FRAMES && h.every((x) => x.slug === res.slug && x.reversed === res.reversed);
    const avg = h.reduce((s, x) => s + x.confidence, 0) / h.length;
    const label = this.body.querySelector(`[data-slot="${slot}"]`);
    if (same && avg >= CONFIDENT) {
      this.picks[slot] = { slug: res.slug, reversed: res.reversed, confidence: avg };
      if (label) {
        label.textContent = `${this.nameOf(res.slug)}${res.reversed ? ", reversed" : ""}`;
        label.closest(".tscan__guide")?.classList.add("is-found");
      }
    } else if (!this.picks[slot] && label) {
      label.textContent = "Looking…";
    }
    const ready = this.picks.every(Boolean) && new Set(this.picks.map((p) => p.slug)).size === this.picks.length;
    const button = this.body.querySelector('[data-act="confirm"]');
    if (button) button.disabled = !ready;
  }

  nameOf(slug) {
    return this.deck?.find((c) => c.slug === slug)?.name ?? slug;
  }

  stopCamera() {
    clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  // Step 2b / 3: confirm or pick by hand. Same sheet either way.
  showConfirm() {
    this.stopCamera();
    const spread = SPREADS[this.spread];
    if (this.picks.length !== spread.count) this.picks = Array.from({ length: spread.count }, () => null);
    const options = (selected) => [`<option value="">Choose a card…</option>`, ...this.deck.map((c) =>
      `<option value="${esc(c.slug)}" ${c.slug === selected ? "selected" : ""}>${esc(c.name)}</option>`)].join("");
    this.body.innerHTML = `
      <h3 class="tscan__step" tabindex="-1">${this.method === "scan" ? "Are these your cards?" : "Which cards did you lay out?"}</h3>
      <p class="tscan__help">${this.method === "scan"
        ? "Check each one. Tap to change a card or turn it the other way. Nothing is read until you say so."
        : "Choose each card, and whether it lies upright or reversed as you look at it."}</p>
      <ol class="tscan__confirm">
        ${spread.positions.map((pos, i) => {
          const p = this.picks[i];
          const card = p && this.deck.find((c) => c.slug === p.slug);
          const unsure = p?.confidence != null && p.confidence < 0.85;
          return `<li class="tscan__pick">
            <div class="tscan__thumb ${p?.reversed ? "is-reversed" : ""}">${card?.image
              ? `<img src="${esc(card.image.url)}" alt="" width="${card.image.width}" height="${card.image.height}" loading="lazy">` : ""}</div>
            <div class="tscan__fields">
              <span class="tscan__position">${esc(pos)}</span>
              ${unsure ? `<span class="tscan__unsure">Is this the ${esc(card.name)}?</span>` : ""}
              <label class="tscan__label" for="tscan-card-${i}">Card</label>
              <select class="tscan__select" id="tscan-card-${i}" data-slot="${i}">${options(p?.slug)}</select>
              <div class="tscan__orient" role="group" aria-label="Orientation">
                <button type="button" class="tscan__toggle" data-act="orient" data-slot="${i}" data-value="up" aria-pressed="${!p?.reversed}">Upright</button>
                <button type="button" class="tscan__toggle" data-act="orient" data-slot="${i}" data-value="rev" aria-pressed="${Boolean(p?.reversed)}">Reversed</button>
              </div>
            </div>
          </li>`;
        }).join("")}
      </ol>
      <p class="tscan__error" role="alert" hidden></p>
      <div class="tscan__actions">
        <button class="o-btn o-btn--primary" type="button" data-act="read">Read these cards</button>
        <button class="o-btn o-btn--secondary" type="button" data-act="back">Start again</button>
      </div>`;
    this.focusTitle();
  }

  // Step 4: the reading.
  async read() {
    const error = this.body.querySelector(".tscan__error");
    const picks = this.picks;
    if (!picks.every((p) => p?.slug)) { error.hidden = false; error.textContent = "Choose every card first."; return; }
    if (new Set(picks.map((p) => p.slug)).size !== picks.length) { error.hidden = false; error.textContent = "Each card can only appear once."; return; }
    this.body.innerHTML = `<p class="tscan__status" role="status">Reading your cards…</p>`;
    let data;
    try {
      data = await call("/api/tarot/scan-reading", {
        method: "POST",
        body: { spread_type: this.spread, cards: picks.map((p) => ({ slug: p.slug, reversed: Boolean(p.reversed) })) },
      });
    } catch (e) {
      this.body.innerHTML = `<p class="tscan__error" role="alert">${esc(e.message)}</p>
        <div class="tscan__actions"><button class="o-btn o-btn--secondary" type="button" data-act="back">Start again</button></div>`;
      return;
    }
    this.reading = data.reading;
    this.cards = data.cards;
    this.body.innerHTML = `
      <h3 class="tscan__step" tabindex="-1">Your reading</h3>
      <div class="tscan__reading">
        ${data.reading.positions.map((p, i) => {
          const card = data.cards[i];
          const facts = [p.correspondence, p.standing, p.dignity, ...p.sky_links].filter(Boolean);
          return `<article class="tscan__card">
            <div class="tscan__thumb tscan__thumb--large ${p.orientation === "reversed" ? "is-reversed" : ""}">${card.image
              ? `<img src="${esc(card.image.url)}" alt="${esc(card.name)}${p.orientation === "reversed" ? ", reversed" : ""}" width="${card.image.width}" height="${card.image.height}">` : ""}</div>
            <div class="tarot-meaning tarot-meaning--shown">
              ${data.reading.positions.length > 1 ? `<p class="tarot-meaning__position">${esc(p.position)}</p>` : ""}
              <p class="tarot-meaning__name">${esc(p.name)}</p>
              <p class="u-meta tarot-meaning__kind">${p.orientation === "reversed" ? `<span class="tarot-meaning__reversed">Reversed</span>` : "Upright"}</p>
              <p class="tarot-meaning__body">${esc(p.meaning)}</p>
              <p class="tarot-meaning__prompt"><span class="tarot-meaning__prompt-label">To reflect on</span> ${esc(p.reflection_prompt)}</p>
              ${facts.length ? `<details class="tscan__facts"><summary>In the tradition</summary><ul>${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></details>` : ""}
            </div>
          </article>`;
        }).join("")}
      </div>
      <p class="tscan__note">A prompt for reflection, not a prediction.</p>
      <p class="tscan__saved" role="status"></p>
      <div class="tscan__actions">
        <button class="o-btn o-btn--primary" type="button" data-act="save">Keep this reading</button>
        <button class="o-btn o-btn--secondary" type="button" data-act="back">Read other cards</button>
      </div>`;
    this.focusTitle();
  }

  async save(button) {
    const note = this.body.querySelector(".tscan__saved");
    button.disabled = true;
    try {
      await call("/api/tarot/readings", {
        method: "POST",
        body: {
          reading: {
            spread_type: this.spread,
            source: this.method,
            cards: this.reading.positions.map((p) => ({ slug: p.slug, orientation: p.orientation })),
          },
        },
      });
      note.textContent = "Kept in your reflections.";
    } catch (e) {
      button.disabled = false;
      note.textContent = e.status === 401 ? "Sign in to keep this reading in your reflections." : e.message;
    }
  }

  async onClick(event) {
    const el = event.target.closest("[data-act]");
    if (!el || !this.root?.contains(el)) return;
    const act = el.dataset.act;
    if (act === "close") return this.close();
    if (act === "back") return this.showChoose();
    if (act === "camera" || act === "manual") {
      try { this.deck = await loadDeck(); } catch (e) {
        this.body.insertAdjacentHTML("beforeend", `<p class="tscan__error" role="alert">${esc(e.message)}</p>`);
        return;
      }
      if (act === "camera") return this.showCamera();
      this.method = "manual";
      this.picks = [];
      return this.showConfirm();
    }
    if (act === "confirm") return this.showConfirm();
    if (act === "orient") {
      const i = Number(el.dataset.slot);
      const reversed = el.dataset.value === "rev";
      this.picks[i] = { ...(this.picks[i] ?? { slug: "" }), reversed, confidence: null };
      el.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
      el.closest(".tscan__pick").querySelector(".tscan__thumb").classList.toggle("is-reversed", reversed);
      return undefined;
    }
    if (act === "read") return this.read();
    if (act === "save") return this.save(el);
    return undefined;
  }

  onChange(event) {
    if (event.target.name === "tscan-spread") this.spread = event.target.value;
    if (event.target.matches(".tscan__select")) {
      const i = Number(event.target.dataset.slot);
      const slug = event.target.value;
      this.picks[i] = { slug, reversed: Boolean(this.picks[i]?.reversed), confidence: null };
      const card = this.deck.find((c) => c.slug === slug);
      const thumb = event.target.closest(".tscan__pick").querySelector(".tscan__thumb");
      thumb.innerHTML = card?.image ? `<img src="${esc(card.image.url)}" alt="" width="${card.image.width}" height="${card.image.height}">` : "";
      event.target.closest(".tscan__pick").querySelector(".tscan__unsure")?.remove();
    }
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

function mount() {
  if (!document.querySelector('link[href="/styles/tarot-scan.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/styles/tarot-scan.css";
    document.head.append(link);
  }
  const actions = document.querySelector("#tarot-manual .tarot-form__actions");
  if (!actions || actions.querySelector("[data-tscan-open]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "o-btn o-btn--secondary";
  button.dataset.tscanOpen = "";
  button.textContent = "Read my own cards";
  button.addEventListener("click", () => new TarotScan().open());
  actions.append(button);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
else mount();
