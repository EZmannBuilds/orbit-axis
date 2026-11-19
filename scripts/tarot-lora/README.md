# Local tarot model (LoRA)

Step 3 of `docs/tarot-camera-plan.md`: a small local model, `orbit-tarot`, that
rewrites the composer's deterministic reading into Orbit's voice and answers
questions about the tradition. It runs only where Ollama runs. Production on
Vercel never calls it and always serves the composer's reading.

## What it learns from

`npm run tarot:export-training` writes `.cache/tarot-lora/data/`:

- **Reading examples.** The input is everything the composer knows about a
  spread: each card's approved meaning and prompt, and the facts it may state
  (correspondences, Lilly's dignities, Book T's elemental dignities, sky links).
  The target is the composer's reading. The model never sees a meaning that
  isn't the deck's own.
- **Study examples.** A question about one source, answered with that source
  named: Book T, Liber 777, Lilly, Agrippa, Westcott and Lenain, from
  `lib/esoteric/`. A separate system prompt keeps this mode apart from
  readings.
- **Left out:** Mathers and Papus. Their fortune-telling keywords would pull the
  model toward the predictive register Orbit forbids.

Every target is checked against `FORBIDDEN_CONTENT_PATTERNS` before it's
written, and anything that fails is dropped and counted in `manifest.json`.

**Sky positions in the training data are synthetic by default** and labelled
so. They teach the model to carry sky sentences through unchanged. They are
never shown to anyone. To train on real positions, generate `currentSky()`
snapshots where the engine runs (macOS or Linux) and pass `--sky-file`.

## Guard at run time

Before the app shows a rewrite, `checkWovenText()` in
`lib/tarot/scan-reading.js` refuses it if it:

- trips a forbidden pattern,
- names a card that isn't in the reading, or
- uses study-only language (`lib/esoteric/study-language.js`: distinctive
  phrases from Agrippa, Lenain and the fortune-telling glosses).

A refused rewrite falls back to the composer's text.

## Run

Uses the same Python environment as `scripts/tarot-vision` (see its README),
plus `pip install -r scripts/tarot-lora/requirements.txt`. Run the GPU steps
through the machine's GPU turn-taking script if it has one.

```powershell
$py = ".cache\tarot-vision\venv\Scripts\python"
$env:HF_HOME = "$PWD\.cache\tarot-lora\hf"          # keep the base model inside .cache
npm run tarot:export-training
& $py scripts\tarot-lora\train.py --base Qwen/Qwen3-1.7B --epochs 1
& $py scripts\tarot-lora\generate.py --readings 60 --study 30
node scripts\tarot-lora\eval-guard.mjs
& $py scripts\tarot-lora\to-ollama.py --name orbit-tarot --quantize q4_K_M
```

### Stopping and resuming

A full run of Qwen3-1.7B on an RTX 3060 takes about three hours with gradient
checkpointing on. It saves a checkpoint every 20 steps (`--save-every`), so
it can be stopped at any time. Restart it with the same arguments plus
`--resume`; at most 20 steps are lost. `--no-grad-checkpointing` is faster and
uses more VRAM. These examples are about 1,000 tokens at most, which should
fit on 12 GB with batch 4.

## What the evaluation measures

`eval-guard.mjs` scores held-out examples with the app's own checks:

- **passes_guard:** the share of rewrites the app would show.
- **meanings_kept:** the share of cards whose approved meaning appears word for
  word.
- **facts_kept:** the share of fact lines carried through unchanged.
- **study clean / names_source:** whether study answers avoid forbidden claims
  and say where they come from.

## Licences

- Base model: Qwen3 (Apache-2.0).
- Training text: Orbit's approved deck and public-domain sources (see
  `docs/tarot-correspondences-research.md`).
- The adapter and merged model stay in `.cache/` and are not committed.
