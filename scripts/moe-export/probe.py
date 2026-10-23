"""Schickt die Prompt-Paare einer Sonde durch ein Modell und schreibt einen Bericht (SPEC-0012 §3.7).

Je Paar laufen beide Prompts einen Forward-Pass; verglichen werden die Wahrscheinlichkeiten der
Zielwörter an der letzten Position. Formate: CON-0024, Regeln: CON-0026 PT-03 bis PT-05.

    uv run --project scripts/moe-export scripts/moe-export/probe.py --help
"""

from __future__ import annotations

import argparse
import datetime
import json
import math
import sys
from pathlib import Path
from typing import Any

import torch
from jsonschema import Draft202012Validator, FormatChecker
from torch import nn

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "src/probe/probe-format.schema.json"
TOKENIZER_DIR = ROOT / "public/tokenizers/gpt2"
TINY_MODEL_NAME = "tiny-random-gpt2"
TINY_CREATED_AT = "2026-10-23T00:00:00Z"
GENERATOR = "probe.py"
MAX_TOP_N = 10


class ProbeError(Exception):
    """Sonde ungültig oder nicht auf das Modell anwendbar (Exit-Code 2, keine Ausgabe)."""


# ── Format (CON-0024) ──


def validator(definition: str) -> Draft202012Validator:
    """Validator für `$defs/<definition>` der Schema-Kopie unter src/probe/."""
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    root = {key: schema[key] for key in ("$schema", "$id", "$defs")}
    return Draft202012Validator(
        {**root, "$ref": f"#/$defs/{definition}"}, format_checker=FormatChecker()
    )


def schema_errors(definition: str, value: Any) -> list[str]:
    errors = sorted(validator(definition).iter_errors(value), key=lambda e: list(e.path))
    return [f"/{'/'.join(str(p) for p in error.path)}: {error.message}" for error in errors]


def probe_errors(probe: Any) -> list[str]:
    """Schema und PB-01/PB-02."""
    errors = schema_errors("Probe", probe)
    if errors:
        return errors
    seen: set[str] = set()
    for i, pair in enumerate(probe["pairs"]):
        if pair["id"] in seen:
            errors.append(f"/pairs/{i}/id (PB-01): Paar-ID {pair['id']} kommt doppelt vor")
        seen.add(pair["id"])
        targets: set[str] = set()
        for j, target in enumerate(pair["targets"]):
            if target in targets:
                errors.append(f"/pairs/{i}/targets/{j} (PB-02): Ziel „{target}“ doppelt")
            targets.add(target)
    return errors


def read_probe(path: Path) -> dict[str, Any]:
    try:
        probe = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ProbeError(f"Sonde {path} nicht lesbar: {error}") from error
    errors = probe_errors(probe)
    if errors:
        raise ProbeError("Sonde ungültig:\n  " + "\n  ".join(errors[:10]))
    return probe


# ── Rechnen ──


def target_ids(tokenizer: Any, probe: dict[str, Any]) -> dict[str, int]:
    """Jedes Ziel muss genau ein Token sein; kein stilles Kürzen (SPEC-0012 §3.7)."""
    ids: dict[str, int] = {}
    for pair in probe["pairs"]:
        for target in pair["targets"]:
            encoded = tokenizer(target, add_special_tokens=False)["input_ids"]
            if len(encoded) != 1:
                raise ProbeError(
                    f"Ziel „{target}“ in Paar „{pair['id']}“ ist kein einzelnes Token "
                    f"({len(encoded)} Tokens)."
                )
            ids[target] = int(encoded[0])
    return ids


def last_logits(model: nn.Module, tokenizer: Any, prompt: str) -> torch.Tensor:
    """Logits der letzten Position in float64."""
    input_ids = torch.tensor([tokenizer(prompt)["input_ids"]], dtype=torch.long)
    return model(input_ids=input_ids).logits[0, -1].to(torch.float64)


def js_divergence(p: torch.Tensor, q: torch.Tensor) -> float:
    """Jensen-Shannon-Divergenz, Basis 2, Terme mit 0 entfallen; in [0, 1]."""
    m = (p + q) / 2

    def kl(x: torch.Tensor) -> float:
        mask = x > 0
        return float(torch.sum(x[mask] * torch.log2(x[mask] / m[mask])))

    return min(1.0, max(0.0, (kl(p) + kl(q)) / 2))


def ranking(probs: torch.Tensor, tokenizer: Any, count: int) -> list[dict[str, Any]]:
    values, ids = torch.sort(probs, descending=True, stable=True)
    return [
        {"id": int(i), "text": tokenizer.decode([int(i)]), "prob": float(v)}
        for v, i in zip(values[:count], ids[:count], strict=True)
    ]


def pair_report(
    model: nn.Module, tokenizer: Any, pair: dict[str, Any], ids: dict[str, int], top_n: int
) -> dict[str, Any]:
    logits_a = last_logits(model, tokenizer, pair["a"])
    logits_b = last_logits(model, tokenizer, pair["b"])
    probs_a = torch.softmax(logits_a, dim=-1)
    probs_b = torch.softmax(logits_b, dim=-1)
    targets = [
        {
            "text": target,
            "id": ids[target],
            "pA": float(probs_a[ids[target]]),
            "pB": float(probs_b[ids[target]]),
        }
        for target in pair["targets"]
    ]
    ratio_a: float | None = None
    ratio_b: float | None = None
    flip: bool | None = None
    if len(targets) == 2:
        first, second = ids[pair["targets"][0]], ids[pair["targets"][1]]
        # ln(p0/p1) = Logit-Differenz: endlich, auch wenn eine Wahrscheinlichkeit unterläuft.
        ratio_a = float(logits_a[first] - logits_a[second])
        ratio_b = float(logits_b[first] - logits_b[second])
        flip = (ratio_a > 0 > ratio_b) or (ratio_a < 0 < ratio_b)
    return {
        "id": pair["id"],
        "attribute": pair["attribute"],
        "a": pair["a"],
        "b": pair["b"],
        "targets": targets,
        "logRatioA": ratio_a,
        "logRatioB": ratio_b,
        "flip": flip,
        "js": js_divergence(probs_a, probs_b),
        "topA": ranking(probs_a, tokenizer, top_n),
        "topB": ranking(probs_b, tokenizer, top_n),
    }


def summary(pairs: list[dict[str, Any]]) -> dict[str, Any]:
    shifts = [
        abs(p["logRatioB"] - p["logRatioA"])
        for p in pairs
        if p["logRatioA"] is not None and p["logRatioB"] is not None
    ]
    return {
        "pairs": len(pairs),
        "flips": sum(1 for p in pairs if p["flip"] is True),
        "meanAbsLogRatioShift": math.fsum(shifts) / len(shifts) if shifts else None,
    }


def build_report(
    model: nn.Module,
    tokenizer: Any,
    probe: dict[str, Any],
    model_name: str,
    top_n: int,
    created_at: str,
) -> dict[str, Any]:
    ids = target_ids(tokenizer, probe)
    pairs = [pair_report(model, tokenizer, pair, ids, top_n) for pair in probe["pairs"]]
    report = {
        "schemaVersion": 1,
        "kind": "probe-report",
        "probe": probe["name"],
        "model": model_name,
        "generator": GENERATOR,
        "createdAt": created_at,
        "pairs": pairs,
        "summary": summary(pairs),
    }
    errors = schema_errors("ProbeReport", report)
    if errors:
        raise RuntimeError("Selbstprüfung des Berichts fehlgeschlagen:\n  " + "\n  ".join(errors))
    return report


# ── Modelle ──


def gpt2_tokenizer() -> Any:
    """GPT-2-Tokenizer aus den gebündelten Dateien der App, ohne Netz."""
    from tokenizers import Tokenizer, decoders, models, pre_tokenizers
    from transformers import PreTrainedTokenizerFast

    bpe = models.BPE.from_file(str(TOKENIZER_DIR / "vocab.json"), str(TOKENIZER_DIR / "merges.txt"))
    tokenizer = Tokenizer(bpe)
    tokenizer.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tokenizer.decoder = decoders.ByteLevel()
    return PreTrainedTokenizerFast(tokenizer_object=tokenizer, eos_token="<|endoftext|>")


def tiny_random_model(seed: int) -> tuple[nn.Module, Any]:
    """GPT-2 mit 2 Layern, 2 Köpfen, n_embd 32 und Zufallsgewichten aus `seed`."""
    from transformers import GPT2Config, GPT2LMHeadModel

    config = GPT2Config(n_layer=2, n_head=2, n_embd=32, n_positions=64, vocab_size=50257)
    torch.manual_seed(seed)
    model = GPT2LMHeadModel(config).to(torch.float32)
    return model.eval(), gpt2_tokenizer()


def load_model(name: str) -> tuple[nn.Module, Any]:
    from transformers import AutoModelForCausalLM, AutoTokenizer

    model = AutoModelForCausalLM.from_pretrained(name, dtype=torch.float32)
    return model.eval(), AutoTokenizer.from_pretrained(name)


def load_moe_model(name: str) -> tuple[nn.Module, Any, Any]:
    """Modell mit MoE-Adapter aus SPEC-0011 für --traces; ohne Adapter ein ProbeError."""
    import export_trace

    try:
        return export_trace.load_model(name)
    except export_trace.UnsupportedModelError as error:
        raise ProbeError(f"--traces braucht ein Modell mit MoE-Adapter: {error}") from error


def write_traces(
    model: nn.Module, tokenizer: Any, adapter: Any, args: argparse.Namespace, probe: dict[str, Any]
) -> int:
    """Je Paar zwei Traces mit einem Schritt über den Exporter aus SPEC-0011."""
    import export_trace

    directory: Path = args.traces
    directory.mkdir(parents=True, exist_ok=True)
    count = 0
    for pair in probe["pairs"]:
        for side in ("a", "b"):
            settings = export_trace.Settings(
                model_name=args.model,
                prompt=pair[side],
                max_tokens=1,
                strategy="greedy",
                temperature=1.0,
                seed=args.seed,
                top_n=50,
                lens_top_n=5,
                trace_id=f"{probe['name']}-{pair['id']}-{side}",
                created_at=now(),
            )
            trace = export_trace.record_run(model, tokenizer, adapter, settings)
            path = directory / f"{pair['id']}.{side}.trace.json"
            path.write_text(json.dumps(trace, ensure_ascii=False) + "\n", encoding="utf-8")
            count += 1
    return count


def now() -> str:
    return datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Kommandozeile ──


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--model", help="Hugging-Face-ID oder Ordner eines Causal-LM")
    source.add_argument(
        "--tiny-random",
        action="store_true",
        help="kleines GPT-2 mit Zufallsgewichten (Fixture, CON-0026 PT-05)",
    )
    parser.add_argument("--probe", required=True, type=Path, help="Sonde *.probe.json")
    parser.add_argument("--out", required=True, type=Path, help="Bericht *.probe-report.json")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--top-n", type=int, default=5, help="Einträge in topA/topB (1–10)")
    parser.add_argument("--traces", type=Path, help="Ordner für je Paar zwei Traces (nur MoE)")
    args = parser.parse_args(argv)
    if not 1 <= args.top_n <= MAX_TOP_N:
        parser.error(f"--top-n muss zwischen 1 und {MAX_TOP_N} liegen")
    if args.traces is not None and args.tiny_random:
        parser.error("--traces braucht --model mit MoE-Adapter")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    torch.set_grad_enabled(False)
    adapter = None
    try:
        probe = read_probe(args.probe)
        if args.tiny_random:
            model, tokenizer = tiny_random_model(args.seed)
            name, created_at = TINY_MODEL_NAME, TINY_CREATED_AT
        elif args.traces is not None:
            # Den Adapter vor dem ersten Forward-Pass prüfen.
            model, tokenizer, adapter = load_moe_model(args.model)
            name, created_at = args.model, now()
        else:
            model, tokenizer = load_model(args.model)
            name, created_at = args.model, now()
        report = build_report(model, tokenizer, probe, name, args.top_n, created_at)
    except ProbeError as error:
        print(f"Fehler: {error}", file=sys.stderr)
        return 2
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    flips = report["summary"]["flips"]
    noun = "Umschwung" if flips == 1 else "Umschwünge"
    print(f"Bericht geschrieben: {args.out} ({len(report['pairs'])} Paare, {flips} {noun})")
    if adapter is not None:
        count = write_traces(model, tokenizer, adapter, args, probe)
        print(f"{count} Traces in {args.traces}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
