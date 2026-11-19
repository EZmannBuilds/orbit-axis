"""Fine-tune a small image classifier on the synthesised tarot dataset.

156 classes (78 cards x upright/reversed). Default backbone: MobileNetV3-Small
from timm with ImageNet weights, which is small enough for on-device Core ML
and for onnxruntime-web.

Writes .cache/tarot-vision/model.pt (best by validation accuracy) and
.cache/tarot-vision/eval.json:
    top1                card AND orientation right
    card_accuracy       card right, orientation ignored
    orientation_accuracy  orientation right, given the card was right
    worst               the classes most often wrong, and what they were taken for
The numbers are reported, not asserted: a synthetic validation set says how
well the model learned the synthetic world, not how it does on a real table.

Usage (from the repo root):
    python scripts/tarot-vision/train.py --epochs 12
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from pathlib import Path

import timm
import torch
from torch import nn
from torch.utils.data import DataLoader
from torchvision import datasets, transforms

REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / ".cache" / "tarot-vision"
DATA = CACHE / "dataset"
MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)


def loaders(batch: int, workers: int, classes: list[str]):
    # Light extra augmentation on top of synthesis. No flips: a mirrored card
    # is not a real card, and a vertical flip would mislabel orientation.
    train_tf = transforms.Compose([
        transforms.RandomResizedCrop(224, scale=(0.85, 1.0), ratio=(0.9, 1.1)),
        transforms.ColorJitter(0.2, 0.2, 0.2, 0.03),
        transforms.ToTensor(),
        transforms.Normalize(MEAN, STD),
    ])
    eval_tf = transforms.Compose([transforms.Resize((224, 224)), transforms.ToTensor(), transforms.Normalize(MEAN, STD)])

    def folder(split, tf):
        ds = datasets.ImageFolder(DATA / split, transform=tf)
        # ImageFolder sorts class folders alphabetically; remap to the manifest's
        # order so index i means classes[i] everywhere (model, labels.json, app).
        remap = {ds.class_to_idx[c]: i for i, c in enumerate(classes)}
        ds.samples = [(p, remap[t]) for p, t in ds.samples]
        ds.targets = [t for _, t in ds.samples]
        return ds

    mk = lambda ds, shuffle: DataLoader(ds, batch_size=batch, shuffle=shuffle, num_workers=workers, pin_memory=True, persistent_workers=workers > 0)
    optional = lambda split: mk(folder(split, eval_tf), False) if (DATA / split).is_dir() else None
    return mk(folder("train", train_tf), True), mk(folder("val", eval_tf), False), optional("stress"), optional("real")


@torch.no_grad()
def evaluate(model, loader, device, classes):
    model.eval()
    n = top1 = card_ok = orient_ok = 0
    confusions = Counter()
    for x, y in loader:
        pred = model(x.to(device, non_blocking=True)).argmax(1).cpu()
        for p, t in zip(pred.tolist(), y.tolist()):
            n += 1
            same_card = classes[p].removesuffix("__reversed") == classes[t].removesuffix("__reversed")
            top1 += p == t
            card_ok += same_card
            orient_ok += same_card and p == t
            if p != t:
                confusions[(classes[t], classes[p])] += 1
    return {
        "samples": n,
        "top1": round(top1 / n, 4),
        "card_accuracy": round(card_ok / n, 4),
        "orientation_accuracy": round(orient_ok / max(card_ok, 1), 4),
        "worst": [{"true": t, "predicted": p, "count": c} for (t, p), c in confusions.most_common(15)],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--arch", default="mobilenetv3_small_100")
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--eval-only", action="store_true", help="score the saved model.pt on every split; no training")
    args = ap.parse_args()

    classes = json.loads((DATA / "manifest.json").read_text())["classes"]
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"device: {device} ({torch.cuda.get_device_name(0) if device.type == 'cuda' else 'cpu'})", flush=True)

    train_dl, val_dl, stress_dl, real_dl = loaders(args.batch, args.workers, classes)

    if args.eval_only:
        ckpt = torch.load(CACHE / "model.pt", map_location=device)
        model = timm.create_model(ckpt["arch"], pretrained=False, num_classes=len(classes)).to(device)
        model.load_state_dict(ckpt["state_dict"])
        report = json.loads((CACHE / "eval.json").read_text()) if (CACHE / "eval.json").exists() else {"arch": ckpt["arch"]}
        report["validation_synthetic"] = evaluate(model, val_dl, device, classes)
        report["stress_synthetic"] = evaluate(model, stress_dl, device, classes) if stress_dl else None
        report["validation_real"] = evaluate(model, real_dl, device, classes) if real_dl else None
        (CACHE / "eval.json").write_text(json.dumps(report, indent=2))
        for k in ("validation_synthetic", "stress_synthetic", "validation_real"):
            if report.get(k):
                print(k, json.dumps({m: report[k][m] for m in ("samples", "top1", "card_accuracy", "orientation_accuracy")}))
        return

    model = timm.create_model(args.arch, pretrained=True, num_classes=len(classes)).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.02)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.epochs * len(train_dl), pct_start=0.15)
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.05)
    scaler = torch.amp.GradScaler(enabled=device.type == "cuda")

    best, history = -1.0, []
    for epoch in range(1, args.epochs + 1):
        model.train()
        t0, total = time.time(), 0.0
        for x, y in train_dl:
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            with torch.autocast(device.type, enabled=device.type == "cuda"):
                loss = loss_fn(model(x), y)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            sched.step()
            total += loss.item() * len(y)
        val = evaluate(model, val_dl, device, classes)
        row = {"epoch": epoch, "loss": round(total / len(train_dl.dataset), 4), "val_top1": val["top1"],
               "val_orientation": val["orientation_accuracy"], "seconds": round(time.time() - t0, 1)}
        history.append(row)
        print(json.dumps(row), flush=True)
        if val["top1"] > best:
            best = val["top1"]
            torch.save({"arch": args.arch, "classes": classes, "state_dict": model.state_dict()}, CACHE / "model.pt")

    ckpt = torch.load(CACHE / "model.pt", map_location=device)
    model.load_state_dict(ckpt["state_dict"])
    report = {
        "arch": args.arch,
        "classes": len(classes),
        "epochs": args.epochs,
        "trained_on": "synthetic scenes from the Waite-Smith 1909 plates",
        "validation_synthetic": evaluate(model, val_dl, device, classes),
        "stress_synthetic": evaluate(model, stress_dl, device, classes) if stress_dl else None,
        "validation_real": evaluate(model, real_dl, device, classes) if real_dl else None,
        "history": history,
        "note": "Synthetic validation measures the synthetic world. Real-table accuracy needs real photos (synth.py --real).",
    }
    (CACHE / "eval.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report["validation_synthetic"][k] for k in ("top1", "card_accuracy", "orientation_accuracy")}))


if __name__ == "__main__":
    main()
