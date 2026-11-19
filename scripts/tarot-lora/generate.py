"""Generate answers for held-out examples with the trained adapter, for evaluation.

Writes .cache/tarot-lora/eval/generations.jsonl: one row per example with the
model's output beside the expected one. `eval-guard.mjs` then scores them with
the same checks the app uses.

    python scripts/tarot-lora/generate.py --base Qwen/Qwen3-1.7B --readings 60 --study 30
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / ".cache" / "tarot-lora"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="Qwen/Qwen3-1.7B")
    ap.add_argument("--readings", type=int, default=60)
    ap.add_argument("--study", type=int, default=30)
    ap.add_argument("--max-new", type=int, default=700)
    ap.add_argument("--no-adapter", action="store_true", help="score the base model, for comparison")
    args = ap.parse_args()

    rows = [json.loads(l) for l in (CACHE / "data" / "val.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    chosen = [r for r in rows if r["kind"] == "reading"][: args.readings] + [r for r in rows if r["kind"] == "study"][: args.study]

    tok = AutoTokenizer.from_pretrained(args.base)
    model = AutoModelForCausalLM.from_pretrained(args.base, dtype=torch.bfloat16).to("cuda")
    if not args.no_adapter:
        model = PeftModel.from_pretrained(model, CACHE / "adapter")
    model.eval()

    out_dir = CACHE / "eval"
    out_dir.mkdir(parents=True, exist_ok=True)
    name = "generations-base.jsonl" if args.no_adapter else "generations.jsonl"
    with (out_dir / name).open("w", encoding="utf-8") as f:
        for i, ex in enumerate(chosen):
            prompt = tok.apply_chat_template(ex["messages"][:2], tokenize=False, add_generation_prompt=True, enable_thinking=False)
            ids = tok(prompt, return_tensors="pt", add_special_tokens=False).to("cuda")
            with torch.no_grad():
                gen = model.generate(**ids, max_new_tokens=args.max_new, do_sample=False, repetition_penalty=1.05)
            text = tok.decode(gen[0, ids["input_ids"].shape[1]:], skip_special_tokens=True).strip()
            f.write(json.dumps({"kind": ex["kind"], "source": ex.get("source"), "meta": ex.get("meta"),
                                "user": ex["messages"][1]["content"], "expected": ex["messages"][2]["content"], "output": text}) + "\n")
            print(f"{i + 1}/{len(chosen)} {ex['kind']}", flush=True)


if __name__ == "__main__":
    main()
