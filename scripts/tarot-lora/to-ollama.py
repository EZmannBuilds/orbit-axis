"""Merge the adapter into the base model and import it into Ollama as orbit-tarot.

    python scripts/tarot-lora/to-ollama.py --base Qwen/Qwen3-1.7B --name orbit-tarot --quantize q4_K_M

Writes the merged safetensors to .cache/tarot-lora/merged/ and a Modelfile,
then runs `ollama create`. Ollama quantises on import. The model runs only
where Ollama runs; production on Vercel never calls it and always serves the
composer's deterministic reading.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / ".cache" / "tarot-lora"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="Qwen/Qwen3-1.7B")
    ap.add_argument("--name", default="orbit-tarot")
    ap.add_argument("--quantize", default="q4_K_M")
    ap.add_argument("--skip-create", action="store_true")
    args = ap.parse_args()

    merged = CACHE / "merged"
    tok = AutoTokenizer.from_pretrained(args.base)
    model = AutoModelForCausalLM.from_pretrained(args.base, dtype=torch.bfloat16)
    model = PeftModel.from_pretrained(model, CACHE / "adapter").merge_and_unload()
    model.save_pretrained(merged, safe_serialization=True)
    tok.save_pretrained(merged)
    print(f"merged model in {merged}")

    modelfile = CACHE / "Modelfile"
    modelfile.write_text(
        f"FROM {merged.as_posix()}\n"
        "PARAMETER temperature 0.3\n"
        "PARAMETER top_p 0.9\n"
        "PARAMETER num_ctx 4096\n"
        'PARAMETER stop "<|im_end|>"\n',
        encoding="utf-8",
    )
    if args.skip_create:
        return
    subprocess.run(["ollama", "create", args.name, "-q", args.quantize, "-f", str(modelfile)], check=True)
    print(f"created Ollama model {args.name}")


if __name__ == "__main__":
    main()
