"""Train a LoRA adapter on Qwen3 for Orbit's local tarot reader.

Reads .cache/tarot-lora/data/{train,val}.jsonl (from `npm run
tarot:export-training`) and writes the adapter to .cache/tarot-lora/adapter/.
Loss is computed on the assistant turn only. Base weights are never changed.

    python scripts/tarot-lora/train.py --base Qwen/Qwen3-1.7B --epochs 1
    python scripts/tarot-lora/train.py --base Qwen/Qwen3-1.7B --epochs 1 --resume

A checkpoint (adapter, optimizer, scheduler, position) is written to
.cache/tarot-lora/checkpoint/ every --save-every steps, so a run can be
stopped at any time and resumed with --resume, losing at most that many steps.
Use the same arguments when resuming.

Run it through the machine's GPU turn-taking script if it has one.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path

import torch
from peft import LoraConfig, get_peft_model, get_peft_model_state_dict, set_peft_model_state_dict
from transformers import AutoModelForCausalLM, AutoTokenizer, get_cosine_schedule_with_warmup

REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / ".cache" / "tarot-lora"


def load(split: str) -> list[dict]:
    return [json.loads(l) for l in (CACHE / "data" / f"{split}.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]


def encode(tok, ex: dict, max_len: int):
    """Prompt tokens masked with -100; the assistant turn and its end token are learned."""
    msgs = ex["messages"]
    prompt = tok.apply_chat_template(msgs[:2], tokenize=False, add_generation_prompt=True, enable_thinking=False)
    full = prompt + msgs[2]["content"] + "<|im_end|>\n"
    p_ids = tok(prompt, add_special_tokens=False)["input_ids"]
    ids = tok(full, add_special_tokens=False)["input_ids"]
    if len(ids) > max_len:
        return None
    labels = [-100] * len(p_ids) + ids[len(p_ids):]
    return ids, labels


def batches(items, size, pad_id, shuffle, seed):
    order = list(range(len(items)))
    if shuffle:
        random.Random(seed).shuffle(order)
    for i in range(0, len(order), size):
        chunk = [items[j] for j in order[i:i + size]]
        n = max(len(x[0]) for x in chunk)
        ids = torch.full((len(chunk), n), pad_id)
        lab = torch.full((len(chunk), n), -100)
        att = torch.zeros((len(chunk), n), dtype=torch.long)
        for k, (a, b) in enumerate(chunk):
            ids[k, :len(a)] = torch.tensor(a)
            lab[k, :len(b)] = torch.tensor(b)
            att[k, :len(a)] = 1
        yield ids, lab, att


@torch.no_grad()
def val_loss(model, items, pad_id, device, size):
    model.eval()
    total, n = 0.0, 0
    for ids, lab, att in batches(items, size, pad_id, False, 0):
        out = model(input_ids=ids.to(device), attention_mask=att.to(device), labels=lab.to(device))
        total += out.loss.item() * len(ids)
        n += len(ids)
    model.train()
    return total / max(n, 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="Qwen/Qwen3-1.7B")
    ap.add_argument("--epochs", type=float, default=1.0)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--accum", type=int, default=4)
    ap.add_argument("--max-len", type=int, default=1536)
    ap.add_argument("--study-repeat", type=int, default=3, help="repeat study examples; there are far fewer of them")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--save-every", type=int, default=20, help="checkpoint every N optimizer steps")
    ap.add_argument("--resume", action="store_true", help="continue from .cache/tarot-lora/checkpoint")
    ap.add_argument("--no-grad-checkpointing", action="store_true",
                    help="faster, more VRAM; fine for ~1k-token examples on 12 GB with batch 4")
    args = ap.parse_args()

    device = torch.device("cuda")
    tok = AutoTokenizer.from_pretrained(args.base)
    pad_id = tok.pad_token_id if tok.pad_token_id is not None else tok.eos_token_id

    def prep(rows, repeat_study):
        out, skipped = [], 0
        for ex in rows:
            e = encode(tok, ex, args.max_len)
            if e is None:
                skipped += 1
                continue
            out.extend([e] * (repeat_study if ex["kind"] == "study" else 1))
        return out, skipped

    train, skipped = prep(load("train"), args.study_repeat)
    val, _ = prep(load("val"), 1)
    print(json.dumps({"train_sequences": len(train), "val_sequences": len(val), "skipped_too_long": skipped}), flush=True)

    model = AutoModelForCausalLM.from_pretrained(args.base, dtype=torch.bfloat16, attn_implementation="sdpa").to(device)
    if not args.no_grad_checkpointing:
        model.gradient_checkpointing_enable()
        model.enable_input_require_grads()
    model = get_peft_model(model, LoraConfig(
        r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05, task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    ))
    model.print_trainable_parameters()

    steps = math.ceil(len(train) / args.batch / args.accum * args.epochs)
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=0.0)
    sched = get_cosine_schedule_with_warmup(opt, max(1, steps // 20), steps)

    ckpt_dir = CACHE / "checkpoint"
    history, step, micro, t0, seen = [], 0, 0, time.time(), 0
    epoch, skip = 0, 0
    if args.resume:
        state = torch.load(ckpt_dir / "state.pt", map_location="cpu", weights_only=False)
        if state["args"] != {k: v for k, v in vars(args).items() if k not in ("resume",)}:
            raise SystemExit(f"resume with the same arguments as the checkpoint: {state['args']}")
        from safetensors.torch import load_file
        set_peft_model_state_dict(model, load_file(ckpt_dir / "adapter.safetensors"))
        opt.load_state_dict(state["optimizer"])
        sched.load_state_dict(state["scheduler"])
        step, micro, seen, epoch, history = state["step"], state["micro"], state["seen"], state["epoch"], state["history"]
        skip = state["batches_done_in_epoch"]
        print(json.dumps({"resumed_at_step": step, "of": steps}), flush=True)

    def save_checkpoint(batches_done):
        from safetensors.torch import save_file
        ckpt_dir.mkdir(parents=True, exist_ok=True)
        save_file({k: v.contiguous() for k, v in get_peft_model_state_dict(model).items()}, ckpt_dir / "adapter.safetensors")
        torch.save({"args": {k: v for k, v in vars(args).items() if k not in ("resume",)}, "optimizer": opt.state_dict(),
                    "scheduler": sched.state_dict(), "step": step, "micro": micro, "seen": seen, "epoch": epoch,
                    "batches_done_in_epoch": batches_done, "history": history}, ckpt_dir / "state.pt.tmp")
        (ckpt_dir / "state.pt.tmp").replace(ckpt_dir / "state.pt")  # atomic: a kill mid-save leaves the old one

    model.train()
    while step < steps:
        for b, (ids, lab, att) in enumerate(batches(train, args.batch, pad_id, True, args.seed + epoch)):
            if b < skip:
                continue
            loss = model(input_ids=ids.to(device), attention_mask=att.to(device), labels=lab.to(device)).loss / args.accum
            loss.backward()
            micro += 1
            seen += len(ids)
            if micro % args.accum:
                continue
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
            step += 1
            if step % 25 == 0 or step == steps:
                row = {"step": step, "of": steps, "loss": round(loss.item() * args.accum, 4), "seq_seen": seen, "minutes": round((time.time() - t0) / 60, 1)}
                if step % 100 == 0 or step == steps:
                    row["val_loss"] = round(val_loss(model, val, pad_id, device, args.batch), 4)
                history.append(row)
                print(json.dumps(row), flush=True)
            if step % args.save_every == 0 and step < steps:
                save_checkpoint(b + 1)
            if step >= steps:
                break
        epoch += 1
        skip = 0

    out = CACHE / "adapter"
    model.save_pretrained(out)
    tok.save_pretrained(out)
    (CACHE / "train-report.json").write_text(json.dumps({"base": args.base, "args": vars(args), "history": history}, indent=2))
    print(f"saved adapter to {out}")


if __name__ == "__main__":
    main()
