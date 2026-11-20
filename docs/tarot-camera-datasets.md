# Tarot camera reading: datasets and licences

Every dataset the camera reader and the local tarot model use, where it came
from, and on what terms. See `docs/tarot-camera-plan.md` for the feature, and
`docs/tarot-correspondences-research.md` for how the esoteric sources were read.

| Dataset | Used for | Source | Licence | In the repo? |
|---|---|---|---|---|
| Card plates, 78 | Card images; the classifier's training source | Waite–Smith deck, 1909, from Wikimedia Commons; each file's licence checked by `scripts/tarot-images.mjs` | Public domain | Yes, `public/images/tarot/cards/` |
| Synthetic training photos | Card classifier | Generated from the plates by `scripts/tarot-vision/synth.py` | Ours; derived from public domain | No: `.cache/`, regenerable |
| Backgrounds | Card classifier | Generated procedurally by the same script | Ours | No |
| Card classifier | In-browser recognition | Trained by `scripts/tarot-vision/train.py` from MobileNetV3-Small (timm, ImageNet weights) | Model: Orbit Axis. Base weights: Apache-2.0 (timm) | `public/models/tarot/TarotCards.onnx` and `labels.json`; the Core ML export is not in the repo yet |
| Meanings | Every reading | `lib/tarot/draft-deck.js` | Orbit Axis; public-domain-derived; owner-approved | Yes |
| Correspondences | Readings and study | Book T (*The Equinox*, 1912); *Liber 777* (1909) | Public domain | Yes, `lib/tarot/correspondences.js` |
| Essential dignities | Readings and study | Lilly, *Christian Astrology* (1647) | Public domain | Yes, `lib/esoteric/` |
| Decan images, mansions, stars | Study only | Agrippa, *Three Books of Occult Philosophy* (1651 English), Peterson transcription | Public domain | Yes |
| 777 columns | Study only | *Liber 777*, 1909 tables. The 1955 *777 Revised* additions are excluded. | Public domain (US) | Yes |
| Letters | Study only | Westcott, *Sepher Yetzirah* (1893) | Public domain | Yes |
| Angel attributes | Study only | Lenain, *La Science cabalistique* (1823). One gap filled from Papus (1903), flagged. | Public domain | Yes |
| Historical meanings | Owner's reference only; never shown, never trained on | Mathers (1888); Papus, tr. Morton (1892) | Public domain | Yes, `lib/tarot/historical-meanings.js` |
| LoRA training set | Local model | `npm run tarot:export-training`: source-row study answers. Reading examples only with `--readings`, for experiments. | Ours | No: `.cache/`, regenerable |
| Local model `orbit-tarot` | Study answers only; never rewords a reading | LoRA on Qwen3-1.7B, merged, Q8_0 GGUF | Base: Apache-2.0 (Qwen3). Adapter: Orbit Axis. | No: Ollama on the training machine only. Never runs in production. |
| The reader's own deck photos (optional) | Measuring real-world accuracy | The reader | Theirs; kept local, never committed | No |

## What leaves a reader's device

The camera flow (`public/tarot-scan.js`) classifies frames in the browser. Only
card names and orientations are sent to the server. Frames are not uploaded,
stored or logged.

## Runtime dependency

`onnxruntime-web` 1.20.1 is loaded from jsDelivr, pinned, and only when a reader
opens the camera. Picking cards by hand needs no download.
