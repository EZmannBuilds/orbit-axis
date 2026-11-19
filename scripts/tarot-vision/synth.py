"""Synthesise training photos of tarot cards from the 78 public-domain plates.

Each output image imitates what the phone's classifier will actually see: the
camera finds a card-shaped rectangle (Vision), perspective-corrects it, and
hands over the crop. So a sample here is a card placed into a generated scene
(tilted, lit, blurred, on a table or cloth), photographed, and then cropped
back out with an imperfect quad, the way a real detector would.

156 classes: every card upright and reversed. "Reversed" means the card is
upside down relative to the phone, so a reversed sample is the same scene with
the card turned 180 degrees before it is placed.

Everything is generated: no third-party photos or backgrounds. Output goes to
.cache/tarot-vision/dataset/{train,val}/<class>/NNN.jpg, which is gitignored.
Train and val use different seeds, so val scenes are never seen in training.

Usage (from the repo root):
    python scripts/tarot-vision/synth.py --per-class 60 --val-per-class 15
    python scripts/tarot-vision/synth.py --real path/to/your/photos   # optional
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parents[2]
PLATES = REPO / "public" / "images" / "tarot" / "cards"
OUT = REPO / ".cache" / "tarot-vision" / "dataset"
SIZE = 224  # classifier input, square
SCENE = 640  # scene canvas before the crop

# How hard the conditions are. TRAIN is what the model learns from; STRESS is
# an evaluation-only split that goes well beyond it (steeper tilt, darker and
# brighter light, heavier blur and JPEG, a worse detector crop, and a finger or
# object covering part of the card), to see how fast accuracy falls off.
TRAIN = dict(rot=12, tilt=0.12, exposure=(0.6, 1.3), blur_p=0.5, blur_max=2.2, noise=8, jitter=0.025, jpeg_min=45, occlude_p=0.0)
STRESS = dict(rot=25, tilt=0.30, exposure=(0.3, 1.7), blur_p=0.9, blur_max=4.0, noise=20, jitter=0.06, jpeg_min=20, occlude_p=0.6)
P = dict(TRAIN)


def class_names(slugs: list[str]) -> list[str]:
    """Stable class order: every slug upright, then every slug reversed."""
    return [s for s in slugs] + [f"{s}__reversed" for s in slugs]


# ── Backgrounds ──────────────────────────────────────────────────────────────

def background(rng: np.random.Generator) -> np.ndarray:
    kind = rng.choice(["wood", "cloth", "plain", "noise", "stone"])
    base = rng.integers(20, 235, size=3).astype(np.float32)
    img = np.ones((SCENE, SCENE, 3), np.float32) * base
    yy, xx = np.mgrid[0:SCENE, 0:SCENE].astype(np.float32)
    if kind == "wood":
        angle = rng.uniform(0, math.pi)
        u = xx * math.cos(angle) + yy * math.sin(angle)
        grain = np.sin(u / rng.uniform(4, 14) + np.sin(u / rng.uniform(40, 90)) * rng.uniform(1, 4))
        img += grain[..., None] * rng.uniform(8, 30)
    elif kind == "cloth":
        f = rng.uniform(0.15, 0.6)
        weave = np.sin(xx * f) * np.sin(yy * f)
        img += weave[..., None] * rng.uniform(5, 20)
        if rng.random() < 0.5:  # a printed pattern
            stripes = (np.sin((xx + yy) / rng.uniform(10, 40)) > 0).astype(np.float32)
            img += stripes[..., None] * (rng.integers(-60, 60, size=3).astype(np.float32))
    elif kind == "noise":
        small = rng.uniform(-40, 40, size=(SCENE // 32, SCENE // 32, 3)).astype(np.float32)
        img += cv2.resize(small, (SCENE, SCENE), interpolation=cv2.INTER_CUBIC)
    elif kind == "stone":
        n = rng.normal(0, rng.uniform(6, 20), size=(SCENE, SCENE, 1)).astype(np.float32)
        img += cv2.GaussianBlur(n, (0, 0), rng.uniform(0.5, 2.5))[..., None]
    # Vignette or uneven lamp light across the table.
    cx, cy = rng.uniform(0, SCENE, 2)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / SCENE
    img *= (1.0 - d * rng.uniform(0, 0.6))[..., None]
    return np.clip(img, 0, 255)


# ── Placing the card ─────────────────────────────────────────────────────────

def card_quad(rng: np.random.Generator, w: int, h: int) -> np.ndarray:
    """Where the card's four corners land in the scene: scale, rotation, tilt."""
    scale = rng.uniform(0.45, 0.8) * SCENE / h
    cw, ch = w * scale, h * scale
    cx = SCENE / 2 + rng.uniform(-0.1, 0.1) * SCENE
    cy = SCENE / 2 + rng.uniform(-0.1, 0.1) * SCENE
    corners = np.array([[-cw / 2, -ch / 2], [cw / 2, -ch / 2], [cw / 2, ch / 2], [-cw / 2, ch / 2]], np.float32)
    a = math.radians(rng.uniform(-P["rot"], P["rot"]))
    rot = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]], np.float32)
    corners = corners @ rot.T
    # Perspective: the phone is not quite parallel to the table.
    tilt = rng.uniform(0, P["tilt"])
    side = rng.integers(0, 4)
    if side == 0:
        corners[[0, 1], 0] *= 1 - tilt
    elif side == 1:
        corners[[2, 3], 0] *= 1 - tilt
    elif side == 2:
        corners[[0, 3], 1] *= 1 - tilt
    else:
        corners[[1, 2], 1] *= 1 - tilt
    return corners + np.array([cx, cy], np.float32)


def place(scene: np.ndarray, card: np.ndarray, quad: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    h, w = card.shape[:2]
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    m = cv2.getPerspectiveTransform(src, quad)
    warped = cv2.warpPerspective(card.astype(np.float32), m, (SCENE, SCENE), flags=cv2.INTER_LINEAR)
    mask = cv2.warpPerspective(np.ones((h, w), np.float32), m, (SCENE, SCENE), flags=cv2.INTER_LINEAR)
    # A soft shadow under the card.
    if rng.random() < 0.7:
        off = rng.uniform(-12, 12, 2)
        shadow = cv2.warpAffine(mask, np.float32([[1, 0, off[0]], [0, 1, off[1]]]), (SCENE, SCENE))
        shadow = cv2.GaussianBlur(shadow, (0, 0), rng.uniform(4, 12))
        scene = scene * (1 - shadow[..., None] * rng.uniform(0.2, 0.5))
    return scene * (1 - mask[..., None]) + warped * mask[..., None]


# ── The camera ───────────────────────────────────────────────────────────────

def photograph(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    # Colour temperature and exposure.
    warm = rng.uniform(-0.12, 0.12)
    img = img * np.array([1 - warm, 1.0, 1 + warm], np.float32)  # BGR
    img = img * rng.uniform(*P["exposure"]) + rng.uniform(-25, 25)
    # A highlight or glare patch from an overhead lamp.
    if rng.random() < 0.3:
        yy, xx = np.mgrid[0:SCENE, 0:SCENE].astype(np.float32)
        cx, cy = rng.uniform(0, SCENE, 2)
        r = rng.uniform(40, 160)
        img += (np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * r * r)) * rng.uniform(30, 110))[..., None]
    # Focus and motion blur.
    if rng.random() < P["blur_p"]:
        img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.3, P["blur_max"]))
    if rng.random() < 0.2:
        k = int(rng.integers(3, 9))
        kernel = np.zeros((k, k), np.float32)
        kernel[k // 2, :] = 1.0 / k
        rot = cv2.getRotationMatrix2D((k / 2, k / 2), rng.uniform(0, 180), 1)
        img = cv2.filter2D(img, -1, cv2.warpAffine(kernel, rot, (k, k)))
    img = img + rng.normal(0, rng.uniform(0, P["noise"]), img.shape).astype(np.float32)
    return np.clip(img, 0, 255).astype(np.uint8)


def detector_crop(photo: np.ndarray, quad: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Cut the card back out, the way Vision + perspective correction would: a
    slightly wrong quad (a few percent of slack or overshoot), straightened
    into the classifier's square."""
    jitter = quad + rng.normal(0, P["jitter"], quad.shape).astype(np.float32) * np.linalg.norm(quad[0] - quad[2])
    dst = np.array([[0, 0], [SIZE, 0], [SIZE, SIZE], [0, SIZE]], np.float32)
    m = cv2.getPerspectiveTransform(jitter.astype(np.float32), dst)
    crop = cv2.warpPerspective(photo, m, (SIZE, SIZE), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)
    ok, enc = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(P["jpeg_min"], 95))])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR)


def sample(card: np.ndarray, reversed_: bool, rng: np.random.Generator) -> np.ndarray:
    if reversed_:
        card = cv2.rotate(card, cv2.ROTATE_180)
    h, w = card.shape[:2]
    quad = card_quad(rng, w, h)
    scene = place(background(rng), card, quad, rng)
    if rng.random() < P["occlude_p"]:
        scene = occlude(scene, quad, rng)
    return detector_crop(photograph(scene, rng), quad, rng)


def occlude(scene: np.ndarray, quad: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """A fingertip or object over one edge of the card, up to about a quarter of it."""
    edge = int(rng.integers(0, 4))
    a, b = quad[edge], quad[(edge + 1) % 4]
    centre = quad.mean(axis=0)
    t = rng.uniform(0.15, 0.85)
    p = a + (b - a) * t
    inward = (centre - p) * rng.uniform(0.15, 0.5)
    tip = p + inward
    w = np.linalg.norm(b - a) * rng.uniform(0.12, 0.3)
    skin = rng.random() < 0.6
    colour = (rng.uniform(70, 160), rng.uniform(100, 190), rng.uniform(150, 235)) if skin else tuple(rng.uniform(10, 245, 3))
    out = scene.copy()
    cv2.line(out, tuple(int(v) for v in (p - inward)), tuple(int(v) for v in tip), colour, int(w), cv2.LINE_AA)
    cv2.circle(out, tuple(int(v) for v in tip), int(w / 2), colour, -1, cv2.LINE_AA)
    return out


# ── Main ─────────────────────────────────────────────────────────────────────

def write_split(name: str, per_class: int, seed: int, plates: dict[str, np.ndarray]) -> int:
    rng = np.random.default_rng(seed)
    n = 0
    for slug, card in plates.items():
        for reversed_ in (False, True):
            cls = f"{slug}__reversed" if reversed_ else slug
            d = OUT / name / cls
            d.mkdir(parents=True, exist_ok=True)
            for i in range(per_class):
                cv2.imwrite(str(d / f"{i:03d}.jpg"), sample(card, reversed_, rng), [cv2.IMWRITE_JPEG_QUALITY, 92])
                n += 1
        print(f"{name}: {slug}", flush=True)
    return n


def add_real(real_dir: Path, slugs: list[str]) -> int:
    """Optional real photos, kept local. Layout: <dir>/<slug>/*.jpg, upright as
    photographed; each is also used turned 180 degrees as the reversed class.
    They go into a separate 'real' split, used only for evaluation."""
    n = 0
    for slug in slugs:
        src = real_dir / slug
        if not src.is_dir():
            continue
        for f in sorted(src.glob("*.[jp][pn]g")):
            img = cv2.imread(str(f))
            if img is None:
                continue
            img = cv2.resize(img, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
            for reversed_ in (False, True):
                cls = f"{slug}__reversed" if reversed_ else slug
                d = OUT / "real" / cls
                d.mkdir(parents=True, exist_ok=True)
                cv2.imwrite(str(d / f.name), cv2.rotate(img, cv2.ROTATE_180) if reversed_ else img)
                n += 1
    return n


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--per-class", type=int, default=60)
    ap.add_argument("--val-per-class", type=int, default=15)
    ap.add_argument("--seed", type=int, default=20261119)
    ap.add_argument("--real", type=Path, help="folder of your own photos, <slug>/*.jpg (kept local)")
    ap.add_argument("--clean", action="store_true", help="delete the previous dataset first")
    ap.add_argument("--stress", type=int, default=0, help="also write a harsher evaluation-only split, N per class")
    ap.add_argument("--only-stress", action="store_true", help="write only the stress split; keep train/val as they are")
    args = ap.parse_args()

    slugs = sorted(p.stem for p in PLATES.glob("*.jpg"))
    if len(slugs) != 78:
        raise SystemExit(f"expected 78 plates in {PLATES}, found {len(slugs)}")
    if args.clean and OUT.exists():
        shutil.rmtree(OUT)
    plates = {s: cv2.imread(str(PLATES / f"{s}.jpg")) for s in slugs}

    manifest_path = OUT / "manifest.json"
    if args.only_stress:
        if not manifest_path.exists():
            raise SystemExit("no dataset yet: run without --only-stress first")
        counts = json.loads(manifest_path.read_text())["counts"]
    else:
        counts = {
            "train": write_split("train", args.per_class, args.seed, plates),
            "val": write_split("val", args.val_per_class, args.seed + 1, plates),
        }
    if args.stress or args.only_stress:
        if (OUT / "stress").exists():
            shutil.rmtree(OUT / "stress")
        P.update(STRESS)
        counts["stress"] = write_split("stress", args.stress or 10, args.seed + 2, plates)
        P.update(TRAIN)
    if args.real:
        counts["real"] = add_real(args.real, slugs)

    if args.only_stress:
        manifest = json.loads(manifest_path.read_text())
        manifest["counts"] = counts
        manifest["stress"] = STRESS
        manifest_path.write_text(json.dumps(manifest, indent=2))
        print(json.dumps(counts))
        return

    manifest = {
        "classes": class_names(slugs),
        "per_class": {"train": args.per_class, "val": args.val_per_class},
        "counts": counts,
        "seeds": {"train": args.seed, "val": args.seed + 1, "stress": args.seed + 2},
        "train_conditions": TRAIN,
        "stress": STRESS if args.stress else None,
        "input_size": SIZE,
        "source": "Waite-Smith 1909 plates, public domain (lib/tarot/image-manifest.json); scenes generated",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
