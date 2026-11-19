"""Export the trained classifier for the web (ONNX) and for iOS (Core ML).

    python scripts/tarot-vision/export.py --onnx      # any OS
    python scripts/tarot-vision/export.py --coreml    # macOS or Linux only

coremltools publishes no usable Windows build (pip falls back to a 2020 beta),
so on Windows run the Core ML step under WSL; see README.md.

Both formats take a 1x3x224x224 float image, RGB, scaled to 0..1 and then
normalised with the ImageNet mean/std given in labels.json, and return 156
logits in the order of labels.json. Outputs go to .cache/tarot-vision/export/:
    TarotCards.onnx, TarotCards.mlpackage, labels.json, eval.json
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import timm
import torch

REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / ".cache" / "tarot-vision"
EXPORT = CACHE / "export"
MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)


def load():
    ckpt = torch.load(CACHE / "model.pt", map_location="cpu")
    model = timm.create_model(ckpt["arch"], pretrained=False, num_classes=len(ckpt["classes"]))
    model.load_state_dict(ckpt["state_dict"])
    return model.eval(), ckpt


def write_labels(ckpt) -> None:
    classes = ckpt["classes"]
    labels = {
        "version": 1,
        "arch": ckpt["arch"],
        "input": {"width": 224, "height": 224, "channels": "RGB", "scale": "0..1", "mean": MEAN, "std": STD,
                  "crop": "perspective-corrected card, stretched to a square, top of the card at the top of the phone"},
        "classes": [{"index": i, "slug": c.removesuffix("__reversed"), "reversed": c.endswith("__reversed")} for i, c in enumerate(classes)],
    }
    (EXPORT / "labels.json").write_text(json.dumps(labels, indent=2))
    if (CACHE / "eval.json").exists():
        shutil.copy(CACHE / "eval.json", EXPORT / "eval.json")


def export_onnx(model) -> None:
    x = torch.randn(1, 3, 224, 224)
    path = EXPORT / "TarotCards.onnx"
    torch.onnx.export(model, x, path, input_names=["image"], output_names=["logits"], opset_version=17,
                      dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}}, dynamo=False)
    print(f"wrote {path} ({path.stat().st_size / 1e6:.1f} MB)")
    # Parity: the exported graph must give the same answer as PyTorch.
    import onnxruntime as ort
    batch = torch.randn(8, 3, 224, 224)
    with torch.no_grad():
        want = model(batch).numpy()
    got = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"]).run(None, {"image": batch.numpy()})[0]
    diff = float(abs(want - got).max())
    same = bool((want.argmax(1) == got.argmax(1)).all())
    print(f"onnx parity: max |diff| {diff:.2e}, same predictions: {same}")
    if not same or diff > 1e-3:
        raise SystemExit("ONNX export does not match PyTorch")


def export_coreml(model, ckpt) -> None:
    import coremltools as ct  # macOS / Linux only

    traced = torch.jit.trace(model, torch.randn(1, 3, 224, 224))
    # Fold the normalisation into the model so the app can pass camera pixels
    # (0..255) straight in. Core ML applies: y = scale * x + bias, per channel;
    # with one scalar scale, we use the mean std (they differ by under 2%).
    std = sum(STD) / 3
    image = ct.ImageType(name="image", shape=(1, 3, 224, 224), color_layout=ct.colorlayout.RGB,
                         scale=1 / (255.0 * std), bias=[-m / std for m in MEAN])
    labels = [c for c in ckpt["classes"]]
    mlmodel = ct.convert(traced, inputs=[image], classifier_config=ct.ClassifierConfig(labels),
                         convert_to="mlprogram", compute_precision=ct.precision.FLOAT16,
                         minimum_deployment_target=ct.target.iOS16)
    mlmodel.short_description = "Waite-Smith tarot card and orientation (156 classes). Trained on synthetic photos."
    mlmodel.license = "Model: Orbit Axis. Training images derived from the public-domain Waite-Smith 1909 plates."
    path = EXPORT / "TarotCards.mlpackage"
    if path.exists():
        shutil.rmtree(path)
    mlmodel.save(str(path))
    print(f"wrote {path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", action="store_true")
    ap.add_argument("--coreml", action="store_true")
    args = ap.parse_args()
    if not (args.onnx or args.coreml):
        ap.error("choose --onnx and/or --coreml")
    EXPORT.mkdir(parents=True, exist_ok=True)
    model, ckpt = load()
    write_labels(ckpt)
    if args.onnx:
        export_onnx(model)
    if args.coreml:
        export_coreml(model, ckpt)


if __name__ == "__main__":
    main()
