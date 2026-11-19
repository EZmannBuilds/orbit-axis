# Tarot card classifier

Step 2 of `docs/tarot-camera-plan.md`: a small model that tells which
Waite–Smith card the camera is looking at, and whether it is reversed.
156 classes: 78 cards × upright/reversed.

It is trained only on synthetic photos made from the 78 public-domain plates in
`public/images/tarot/cards/`. It recognises the Waite–Smith deck and close
printings of it, not Thoth, Marseille or modern art decks.

## What runs where

| Step | Where | Why |
|---|---|---|
| `synth.py` (dataset) | Windows or anywhere | OpenCV + NumPy only |
| `train.py` | Windows, CUDA GPU | an RTX 3060 trains it in minutes |
| `export.py --onnx` | Windows | for the browser (onnxruntime-web) |
| `export.py --coreml` | WSL (Linux) or a Mac | coremltools has no Windows build |

Everything it writes goes under `.cache/tarot-vision/`, which is gitignored:
the dataset (~9,400 images at the default sizes), `model.pt`, and `export/`.

## Setup (Windows, once)

```powershell
py -3.12 -m venv .cache\tarot-vision\venv
.cache\tarot-vision\venv\Scripts\python -m pip install --upgrade pip
.cache\tarot-vision\venv\Scripts\python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126
.cache\tarot-vision\venv\Scripts\python -m pip install -r scripts\tarot-vision\requirements.txt
```

## Run

```powershell
$py = ".cache\tarot-vision\venv\Scripts\python"
& $py scripts\tarot-vision\synth.py --clean --per-class 60 --val-per-class 15
& $py scripts\tarot-vision\train.py --epochs 12
& $py scripts\tarot-vision\export.py --onnx
```

If the machine shares its GPU with other jobs through a turn-taking script or
lock, run `train.py` through it rather than directly. Synthesis and export use
the CPU only.

Then the Core ML export, under WSL, using a CPU-only torch:

```bash
cd "$(wslpath -a 'C:\path\to\orbit-axis')"   # the repo, seen from WSL
python3 -m venv .cache/tarot-vision/venv-linux
.cache/tarot-vision/venv-linux/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
.cache/tarot-vision/venv-linux/bin/pip install timm coremltools
.cache/tarot-vision/venv-linux/bin/python scripts/tarot-vision/export.py --coreml
```

## What comes out (`.cache/tarot-vision/export/`)

- `TarotCards.onnx`: input `image` [N,3,224,224], RGB, 0..1, normalised with
  the mean and std in `labels.json`; output `logits` [N,156].
- `TarotCards.mlpackage`: a Core ML classifier. It takes a 224×224 RGB image
  (0..255); normalisation is built in. It returns a class label and
  probabilities.
- `labels.json`: class index → `{ slug, reversed }`, and the input contract.
- `eval.json`: accuracy on the held-out synthetic set (and on real photos if
  given).

## Honest limits

- Synthetic validation accuracy measures how well the model learned the
  synthetic world. It is not how it will do on your table.
- About 20 phone photos of your own deck would do more for real accuracy than
  anything else. Put them in a folder as `<slug>/*.jpg`, photographed upright,
  and run `synth.py --real <folder>`. They go into an evaluation-only split,
  `real`, are never committed, and `eval.json` reports them separately.
- The crop it expects is the card alone, perspective-corrected and stretched
  to a square, as the iOS plugin's Vision rectangle step produces.
