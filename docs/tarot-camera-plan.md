# Tarot camera reading — idea and plan

Status 2026-11-19: idea session only. Erik approved the approach with the LoRA
option, on the Waite–Smith deck, with synthetic training data for now.
**All training runs on Erik's PC, not on this Mac.** See "Training on the PC" below.

Branch `feat/tarot-camera-reading`, cut from `origin/main` at `9cbe5c7`.
Nothing below has been downloaded or trained yet.

## What already exists (do not rebuild)

Tarot shipped on `main` (`14bea9f Ship Tarot` and later commits):

- `lib/tarot/draft-deck.js` — 78 cards, each with an upright meaning, a reversed
  meaning, and reflection prompts. Written for Orbit, public-domain-derived
  (Waite 1911 / Waite–Smith 1909), **owner-approved 2026-08-15 / 2026-08-18**.
- `lib/tarot/deck.js` — the content contract, `validateCard()`, and the
  forbidden-claim patterns (no prediction, no medical/financial/relationship advice).
- `lib/tarot/image-manifest.json` + `public/images/tarot/cards/` — the 78
  Waite–Smith 1909 plates from Wikimedia Commons. Each file's licence was checked
  by `scripts/tarot-images.mjs`. Total size is 6.3 MB.
- `lib/tarot/draw.js`, `service.js`, `api.js` — draws, spreads, saved readings,
  and the `/api/tarot/*` routes.

The card **does not** record any astrological correspondence yet. That is the
one content gap this feature has to fill.

## Constraints that shape the design

1. **Ollama is never reachable from Vercel** (`lib/local-llm/provider.js`).
   Anything a phone user sees in production must work without a model.
2. **The deck's own rule:** meanings must have provenance. A model improvising
   meanings has none (`deck.js` header). So a model may *arrange* approved text;
   it may not *author* a card's meaning.
3. **Disk: 19 GB free (98% full).** Fine-tuning `qwen3:8b` needs roughly
   16 GB+ of fp16 weights plus a Python ML stack. That does not fit safely.
4. Another session is editing `public/app.js` and `public/styles/*`. New UI goes
   in new files, and `app.js` gets only a small hook.
5. The machine is an M4 with 24 GB RAM, Xcode 27.2 and Create ML. Torch, MLX
   and coremltools are not installed.

## (a) Card recognition: on-device, Core ML

**Pipeline on iPhone (in the Capacitor shell):**

1. Live camera preview (`AVCaptureSession`) in a small custom Capacitor plugin
   `TarotScanner`, living in `ios/App/App/`. No third-party pod.
2. `VNDetectRectanglesRequest` finds each card in the frame. The aspect ratio is
   about 0.57, and up to 3 cards fit per frame. Each card is cropped with a
   perspective correction.
3. A Core ML image classifier labels each crop with one of **156 classes**:
   78 cards × {upright, reversed}. Orientation is learned directly, because a
   card turned 180° relative to the phone *is* reversed from the reader's seat.
4. Readings are kept only when they stay stable across about 5 frames and the
   confidence passes a threshold. Below the threshold the app asks the reader to
   confirm or correct ("Is this the Three of Cups?") instead of guessing.

**Training:** Create ML `MLImageClassifier`, a transfer-learning head on Apple's
built-in feature extractor. No download is needed, the model comes out in
the **hundreds of KB** range, and training takes minutes on the M4.

**Dataset:** a script, `scripts/tarot-vision/build-dataset.mjs` (built on Swift
Core Image, so no Python), synthesises photos from the 78 public-domain plates:

- 180° rotation for the reversed classes
- perspective warp, ±12° tilt, scale, crop jitter
- lighting, colour temperature, blur, JPEG and noise
- composites on table and cloth backgrounds that it generates itself, so no
  third-party photos are used

That makes about 60 images per class, roughly 9,400 images (~150 MB),
written under `.cache/` and gitignored. A held-out set uses different
augmentation seeds.

**Honest limit:** this recognises the **Waite–Smith deck and close printings of
it**. Many "Rider–Waite" boxes match closely, but the Thoth deck, Marseille
decks and modern art decks will not match. **Twenty phone photos of your own
deck would do more for real-world accuracy than anything else.** The dataset
script takes an optional `--real <dir>` folder, kept local and never committed.

**Web / desktop fallback:** the browser has no Core ML. The web flow uses
`getUserMedia` plus a manual "pick the card" confirmation sheet, with the
recogniser behind one interface (`recognise(frame) → [{slug, reversed,
confidence}]`). An in-browser model (ONNX via onnxruntime-web, about 5 MB) can
come later without changing the flow.

## (b) The meanings model: retrieval + deterministic composition, optional local LLM

Recommendation: **do not fine-tune for v1.**

- **Source of truth:** the approved deck, plus a new, authored
  `lib/tarot/correspondences.js`:
  - suit → element
  - majors → planet, sign or element
  - pips 2–10 → decan (sign + Chaldean planet ruler)
  - courts → elemental sub-element
  - aces → element root

  These come from the Golden Dawn attribution system (*Book T*, published in
  *The Equinox* I(7), 1912; public domain). They are tabulated facts, written
  in our own words, and each entry is tagged with its source.
- **Reading composer** (`lib/tarot/scan-reading.js`, pure and testable): takes the
  recognised cards and the spread positions and returns a reading made only from
  approved text and correspondence facts. It works on Vercel with no model.
- **Astrology tie-in:** the facts come from the engine, never from a model.
  For example, "this card's decan, Mercury in Sagittarius, is where the Sun is
  today", or a card's ruling planet matched against the reader's chart
  placements when they are signed in.
- **Optional local weaving:** when Ollama is available (`qwen3:8b` is already
  installed), the composer's output is handed to it to smooth into one paragraph.
  It runs under the existing provider, is checked by `validateCard`'s forbidden
  patterns plus a check that it introduced no card or claim that is not in the
  input, and falls back to the deterministic text on any failure. It is labelled
  the same way Ask Orbit labels its fallback.
- **If you still want a fine-tune:** a LoRA through MLX on a small model
  (`qwen3:1.7b`, about 4 GB on disk). It would train only on
  (cards → composed reading) pairs generated from approved text. It is feasible
  later, but it would mostly memorise what retrieval already returns exactly,
  and it never runs in production. I suggest deferring it.

## (c) Camera UI flow

New `public/tarot-scan.js` and `public/styles/tarot-scan.css`, plus one entry
button on the Tarot screen.

1. Choose a spread: one card, or three cards (Past/Present/Next, or the
   reflective set).
2. "Lay your cards out face up" opens a full-screen camera with a card-shaped
   guide and a live label under each detected card.
3. A confirm sheet shows each card's thumbnail, name and upright/reversed state.
   A tap corrects either one. Nothing is read until the reader confirms.
4. The reading is rendered with the existing Tarot reading styles, and the
   reader can save it through `POST /api/tarot/readings` with a new
   `source: "scan"` field.
5. Camera permission is denied → explain why, and offer manual pick. No camera →
   manual pick.

iOS needs `NSCameraUsageDescription` in `Info.plist`. Before any native build:
**confirm the API hostname with Erik** (production is `https://www.orbitaxis.app`).

## Datasets and licences (to be recorded in `docs/tarot-camera-datasets.md`)

| Dataset | Source | Licence |
|---|---|---|
| Card plates | Wikimedia Commons, Waite–Smith 1909 (already in repo) | Public domain |
| Synthetic training photos | Generated from the plates by our script | Derived from public domain; ours |
| Backgrounds | Procedurally generated by our script | Ours |
| Meanings | `lib/tarot/draft-deck.js` | Orbit Axis, public-domain-derived, owner-approved |
| Correspondences | Golden Dawn *Book T* (1912), re-tabulated | Public domain facts |
| Erik's own deck photos (optional) | Erik | Erik's; kept local, not committed |

## Tests that need no device

- correspondences: all 78 slugs are covered, every decan is consistent, and the
  ruler order is right
- composer: deterministic output, reversed text is used only when reversed, and
  the forbidden-claim audit passes on every card × orientation
- LLM weave guard: rejects added cards, rejects forbidden claims, and falls back
- dataset manifest: 156 classes and balanced counts
- model evaluation: top-1 accuracy and orientation accuracy on the held-out
  synthetic set, plus your photos if you provide them. The accuracy is reported,
  not asserted.
- API: the scan-reading route validates slugs and orientations from the client,
  and rejects unknown cards

## Training on the PC (supersedes the Create ML / MLX notes above)

Create ML and MLX are Mac-only, so the PC uses the standard PyTorch stack. The
Mac keeps only the app code and the small exported files.

**Card classifier (156 classes)**
- Dataset synthesis in Python (Pillow/OpenCV + albumentations) from the 78 plates
  in `public/images/tarot/cards/`: 180° rotation for the reversed classes,
  perspective warp, lighting, blur and procedural backgrounds. Same recipe as
  above, about 60 per class.
- Fine-tune MobileNetV3-Small or EfficientNet-Lite0 (timm, ImageNet weights,
  about 10–20 MB download). A few epochs on any CUDA GPU takes minutes.
- Export twice:
  - **Core ML** via `coremltools`, which runs on Windows and Linux, to
    `TarotCards.mlpackage` for the iOS plugin (about 3–6 MB, or less with fp16).
  - **ONNX** for the web via onnxruntime-web, which gives the browser real
    recognition rather than only manual pick.
- Card finding stays on-device with Vision rectangles, which needs no training.
  If multi-card layouts prove flaky, a later option is a small YOLO detector
  trained on synthetic layouts.
- Hand-off into the repo: the two model files, plus `labels.json` and an
  `eval.json` with top-1 and orientation accuracy on the held-out set.

**Meanings LoRA**
- Base model: `Qwen3-1.7B` or `Qwen3-4B` (Hugging Face), trained with Unsloth or
  PEFT on the PC GPU.
- Training pairs are generated by the repo's deterministic composer:
  (cards + positions + correspondences + engine sky facts) → composed reading.
  It learns Orbit's register and structure, never new meanings.
- Every training example and eval output is run through
  `FORBIDDEN_CONTENT_PATTERNS`, plus a check that the model added no cards.
- Export to GGUF (q4_K_M) → `ollama create orbit-tarot -f Modelfile` →
  set `ORBIT_LOCAL_MODEL` or a new `ORBIT_TAROT_MODEL`. It runs only where Ollama
  runs. Production on Vercel always serves the deterministic reading.

**What the Mac repo provides to the PC:** a `scripts/tarot-vision/` and
`scripts/tarot-lora/` folder, each with a README, `requirements.txt` and
scripts, plus a `npm run tarot:export-training` command that writes the
LoRA JSONL from the approved deck.

## Order of work after approval

1. Correspondences, the composer and tests. No download.
2. PC: dataset synthesis + classifier training → Core ML + ONNX + eval report.
3. PC: LoRA training on composer-generated pairs → GGUF → Ollama.
4. Web flow (camera and manual pick) wired to the composer, run locally.
5. iOS plugin, then a simulator build. A device build only after the hostname
   is confirmed.
