"""Exportiert einen Token-Theater-Trace aus einem Mixture-of-Experts-Modell (SPEC-0011 §3.8).

Der Lauf wird per Forward-Hooks aufgenommen, so wie das Modell rechnet, und als Trace nach
CON-0001 v0.5.0 geschrieben. Regeln: CON-0023 EX-01 bis EX-08.

    uv run --project scripts/moe-export scripts/moe-export/export_trace.py --help
"""

from __future__ import annotations

import argparse
import base64
import datetime
import json
import math
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import torch
from torch import nn

REFERENCE_MODEL = "ibm-granite/granite-3.1-1b-a400m-base"
TINY_MODEL_NAME = "tiny-random-granitemoe"
TINY_PROMPT = "die katze sitzt"
TINY_MAX_TOKENS = 3
TINY_CREATED_AT = "2026-10-23T00:00:00Z"
MAX_TOKENS_LIMIT = 32
MAX_LENS_TOP_N = 20
CAPABILITIES = ["tokenize", "attention", "moe", "residual", "logits", "sample"]


class UnsupportedModelError(Exception):
    """Die Architektur des Modells hat keinen Adapter."""


# ── Adapter je Modellfamilie (Strategy, SPEC-0011 §3.10) ──


class MoeAdapter:
    """Familienspezifische Teile der Aufnahme; der Ablauf steht in `record_run`."""

    architecture = ""

    def moe_block(self, layer: nn.Module) -> nn.Module:
        raise NotImplementedError

    def router(self, layer: nn.Module) -> nn.Module:
        raise NotImplementedError

    def route(self, output: Any) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Aus der Router-Ausgabe: (gewählte Experten, Gates, Router-Logits), je [n, …]."""
        raise NotImplementedError

    def residual_multiplier(self, config: Any) -> float:
        return 1.0

    def logits_scaling(self, config: Any) -> float:
        return 1.0


class GraniteMoeAdapter(MoeAdapter):
    """IBM Granite MoE: Gates = Softmax über die Top-k-Logits, Residual- und Logit-Faktoren."""

    architecture = "GraniteMoeForCausalLM"

    def moe_block(self, layer: nn.Module) -> nn.Module:
        return layer.block_sparse_moe

    def router(self, layer: nn.Module) -> nn.Module:
        return layer.block_sparse_moe.router

    def route(self, output: Any) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        index, weights, logits = output
        return index, weights, logits

    def residual_multiplier(self, config: Any) -> float:
        return float(config.residual_multiplier)

    def logits_scaling(self, config: Any) -> float:
        return float(config.logits_scaling)


class MixtralAdapter(MoeAdapter):
    """Mixtral: Gates = Softmax über alle, Top-k, renormiert."""

    architecture = "MixtralForCausalLM"

    def moe_block(self, layer: nn.Module) -> nn.Module:
        return layer.mlp

    def router(self, layer: nn.Module) -> nn.Module:
        return layer.mlp.gate

    def route(self, output: Any) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        logits, scores, index = output
        return index, scores, logits


ADAPTERS: dict[str, type[MoeAdapter]] = {
    adapter.architecture: adapter for adapter in (GraniteMoeAdapter, MixtralAdapter)
}


def adapter_for(architectures: list[str] | None) -> MoeAdapter:
    for name in architectures or []:
        if name in ADAPTERS:
            return ADAPTERS[name]()
    supported = ", ".join(sorted(ADAPTERS))
    raise UnsupportedModelError(
        f"Architektur {architectures} wird nicht unterstützt (unsupported); möglich: {supported}"
    )


# ── Serialisierung ──


def tensor_json(value: torch.Tensor) -> dict[str, Any]:
    data = value.detach().to(torch.float32).contiguous().numpy().astype("<f4").tobytes()
    return {
        "shape": list(value.shape),
        "dtype": "float32",
        "data": base64.b64encode(data).decode("ascii"),
    }


def token_json(token_id: int, tokenizer: Any) -> dict[str, Any]:
    return {"id": int(token_id), "text": tokenizer.decode([int(token_id)])}


def candidates(
    logits: torch.Tensor, probs: torch.Tensor, ids: list[int], tokenizer: Any, scale: float
) -> list[dict[str, Any]]:
    return [
        {
            "token": token_json(i, tokenizer),
            "logit": float(logits[i]),
            "prob": float(probs[i]) * scale,
        }
        for i in ids
    ]


def top_ids(probs: torch.Tensor, count: int) -> list[int]:
    """Absteigend nach prob, bei Gleichstand kleinere ID zuerst (CON-0001 INV-10)."""
    values, ids = torch.sort(probs, descending=True, stable=True)
    del values
    return [int(i) for i in ids[:count]]


# ── Aufnahme ──


@dataclass
class LayerRecord:
    attn_in: torch.Tensor | None = None
    attn_ln: torch.Tensor | None = None
    q: torch.Tensor | None = None
    k: torch.Tensor | None = None
    v: torch.Tensor | None = None
    weights: torch.Tensor | None = None
    attn_out: torch.Tensor | None = None
    moe_ln: torch.Tensor | None = None
    route: tuple[torch.Tensor, torch.Tensor, torch.Tensor] | None = None
    moe_out: torch.Tensor | None = None
    layer_out: torch.Tensor | None = None


@dataclass
class Recorder:
    layers: list[LayerRecord] = field(default_factory=list)

    def reset(self, count: int) -> None:
        self.layers = [LayerRecord() for _ in range(count)]


def first(value: Any) -> torch.Tensor:
    return value[0] if isinstance(value, tuple) else value


def install_hooks(model: nn.Module, adapter: MoeAdapter, recorder: Recorder) -> None:
    for index, layer in enumerate(model.model.layers):

        def keep(name: str, pick=first, i: int = index):
            def hook(_module, _inputs, output):
                value = pick(output)
                setattr(
                    recorder.layers[i], name, value if isinstance(value, tuple) else value.detach()
                )

            return hook

        def keep_input(_module, args, kwargs, i: int = index):
            hidden = args[0] if args else kwargs["hidden_states"]
            recorder.layers[i].attn_in = hidden.detach()

        layer.register_forward_pre_hook(keep_input, with_kwargs=True)
        layer.input_layernorm.register_forward_hook(keep("attn_ln"))
        layer.self_attn.q_proj.register_forward_hook(keep("q"))
        layer.self_attn.k_proj.register_forward_hook(keep("k"))
        layer.self_attn.v_proj.register_forward_hook(keep("v"))
        layer.self_attn.register_forward_hook(keep("attn_out"))
        layer.self_attn.register_forward_hook(keep("weights", pick=lambda out: out[1]))
        layer.post_attention_layernorm.register_forward_hook(keep("moe_ln"))
        adapter.router(layer).register_forward_hook(
            keep("route", pick=lambda out: tuple(t.detach() for t in adapter.route(out)))
        )
        adapter.moe_block(layer).register_forward_hook(keep("moe_out"))
        layer.register_forward_hook(keep("layer_out"))


def expand_kv(value: torch.Tensor, heads: int, kv_heads: int) -> torch.Tensor:
    """[n, kv·hd] → [n, heads·hd] wie repeat_kv: Kopf h nutzt KV-Kopf h // (heads/kv_heads)."""
    n = value.shape[0]
    head_dim = value.shape[1] // kv_heads
    grouped = value.reshape(n, kv_heads, 1, head_dim).expand(
        n, kv_heads, heads // kv_heads, head_dim
    )
    return grouped.reshape(n, heads * head_dim)


@dataclass
class Settings:
    model_name: str
    prompt: str
    max_tokens: int
    strategy: str
    temperature: float
    seed: int
    top_n: int
    lens_top_n: int
    trace_id: str
    created_at: str


def softmax64(logits: torch.Tensor) -> torch.Tensor:
    return torch.softmax(logits.to(torch.float64), dim=-1)


def record_run(model: nn.Module, tokenizer: Any, adapter: MoeAdapter, s: Settings) -> dict:
    """Generiert Schritt für Schritt mit KV-Cache und baut den Trace (Template Method)."""
    config = model.config
    heads = config.num_attention_heads
    kv_heads = getattr(config, "num_key_value_heads", heads)
    multiplier = adapter.residual_multiplier(config)
    scaling = adapter.logits_scaling(config)
    eos = tokenizer.eos_token_id
    recorder = Recorder()
    install_hooks(model, adapter, recorder)
    generator = torch.Generator().manual_seed(s.seed)

    def to_logits(stream_row: torch.Tensor) -> torch.Tensor:
        return (model.lm_head(model.model.norm(stream_row)) / scaling).to(torch.float32)

    def lens(stream_row: torch.Tensor) -> list[dict[str, Any]]:
        logits = to_logits(stream_row)
        probs = softmax64(logits)
        return candidates(logits, probs, top_ids(probs, s.lens_top_n), tokenizer, 1.0)

    context: list[int] = tokenizer(s.prompt)["input_ids"]
    steps: list[dict[str, Any]] = []
    cache = None
    finish = "max-tokens"
    for index in range(s.max_tokens):
        a = 0 if index == 0 else len(context) - 1
        b = len(context)
        recorder.reset(config.num_hidden_layers)
        with torch.no_grad():
            output = model(
                input_ids=torch.tensor([context[a:b]]),
                past_key_values=cache,
                use_cache=True,
            )
        cache = output.past_key_values
        stations: list[dict[str, Any]] = []
        if index == 0:
            stations.append(
                {"kind": "tokenize", "tokens": [token_json(t, tokenizer) for t in context]}
            )
        for layer, rec in enumerate(recorder.layers):
            attn_out = rec.attn_out[0] * multiplier
            after_attention = rec.attn_in[0] + attn_out
            moe_out = rec.moe_out[0] * multiplier
            after_moe = rec.layer_out[0]
            chosen, gates, router_logits = rec.route
            check_routing(chosen, router_logits)
            stations.append(
                {
                    "kind": "attention",
                    "layer": layer,
                    "lnIn": tensor_json(rec.attn_ln[0]),
                    "q": tensor_json(rec.q[0]),
                    "k": tensor_json(expand_kv(rec.k[0], heads, kv_heads)),
                    "v": tensor_json(expand_kv(rec.v[0], heads, kv_heads)),
                    "weights": tensor_json(rec.weights[0]),
                    "out": tensor_json(attn_out),
                }
            )
            stations.append(
                {
                    "kind": "residual",
                    "layer": layer,
                    "after": "attention",
                    "stream": tensor_json(after_attention),
                }
            )
            stations.append(
                {
                    "kind": "moe",
                    "layer": layer,
                    "lnIn": tensor_json(rec.moe_ln[0]),
                    "routerLogits": tensor_json(router_logits.to(torch.float32)),
                    "experts": [[int(e) for e in row] for row in chosen],
                    "gates": [[float(g) for g in row] for row in gates.to(torch.float64)],
                    "out": tensor_json(moe_out),
                }
            )
            residual: dict[str, Any] = {
                "kind": "residual",
                "layer": layer,
                "after": "moe",
                "stream": tensor_json(after_moe),
            }
            if s.lens_top_n > 0:
                residual["lens"] = lens(after_moe[-1])
            stations.append(residual)

        final = recorder.layers[-1].layer_out[0][-1]
        logits = to_logits(final)
        model_logits = output.logits[0, -1].to(torch.float32)
        if not torch.allclose(logits, model_logits, atol=1e-4):
            raise RuntimeError("Logits aus dem Residual Stream weichen vom Modellausgang ab")
        probs = softmax64(logits)
        ids = top_ids(probs, s.top_n)
        coverage = float(sum(probs[i] for i in ids))
        distribution = candidates(logits, probs, ids, tokenizer, 1.0 / coverage)
        stations.append(
            {
                "kind": "logits",
                "vocabSize": int(config.vocab_size),
                "distribution": distribution,
                "coverage": min(coverage, 1.0),
            }
        )
        sample, chosen_id, random = choose(distribution, s, generator)
        stations.append(
            {
                "kind": "sample",
                "distribution": sample,
                "random": random,
                "chosen": token_json(chosen_id, tokenizer),
            }
        )
        steps.append(
            {
                "index": index,
                "contextTokens": [token_json(t, tokenizer) for t in context],
                "newPositions": [a, b],
                "stations": stations,
                "chosen": token_json(chosen_id, tokenizer),
                "text": tokenizer.decode(context + [chosen_id]),
            }
        )
        if eos is not None and chosen_id == eos:
            finish = "eos"
            break
        context = context + [chosen_id]

    return {
        "schemaVersion": 1,
        "id": s.trace_id,
        "createdAt": s.created_at,
        "engine": {
            "kind": "transformers",
            "model": s.model_name,
            "capabilities": CAPABILITIES,
            "architecture": {
                "nLayers": int(config.num_hidden_layers),
                "nHeads": int(heads),
                "dModel": int(config.hidden_size),
                "dMlp": int(config.intermediate_size),
                "vocabSize": int(config.vocab_size),
                "contextLength": int(config.max_position_embeddings),
                "nExperts": int(config.num_local_experts),
                "topK": int(config.num_experts_per_tok),
            },
            "eosTokenId": None if eos is None else int(eos),
        },
        "prompt": s.prompt,
        "maxTokens": s.max_tokens,
        "sampling": {
            "strategy": s.strategy,
            "seed": s.seed,
            "params": {} if s.strategy == "greedy" else {"temperature": s.temperature},
        },
        "steps": steps,
        "finishReason": finish,
    }


def check_routing(chosen: torch.Tensor, router_logits: torch.Tensor) -> None:
    """Selbstprüfung: die gewählten Experten sind die Top-k der Router-Logits."""
    k = chosen.shape[-1]
    weakest = torch.gather(router_logits, 1, chosen).min(dim=-1).values
    mask = torch.ones_like(router_logits, dtype=torch.bool).scatter(1, chosen, False)
    others = router_logits.masked_fill(~mask, -math.inf).max(dim=-1).values
    if k < router_logits.shape[-1] and bool((weakest < others).any()):
        raise RuntimeError("Gewählte Experten sind nicht die Top-k der Router-Logits")


def choose(
    distribution: list[dict[str, Any]], s: Settings, generator: torch.Generator
) -> tuple[list[dict[str, Any]], int, float | None]:
    """Greedy oder Ziehen mit Temperatur aus den Top-N-Kandidaten (wie der Client-Sampler)."""
    if s.strategy == "greedy":
        return distribution, int(distribution[0]["token"]["id"]), None
    logits = torch.tensor([c["logit"] for c in distribution], dtype=torch.float64)
    probs = torch.softmax(logits / s.temperature, dim=-1)
    order = sorted(range(len(distribution)), key=lambda i: (-float(probs[i]), i))
    sample = [{**distribution[i], "prob": float(probs[i])} for i in order]
    random = float(torch.rand(1, generator=generator, dtype=torch.float64))
    total = 0.0
    chosen = sample[-1]
    for candidate in sample:
        total += candidate["prob"]
        if random < total:
            chosen = candidate
            break
    return sample, int(chosen["token"]["id"]), random


# ── Modelle laden ──


def load_model(name: str) -> tuple[nn.Module, Any, MoeAdapter]:
    from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer

    config = AutoConfig.from_pretrained(name)
    adapter = adapter_for(getattr(config, "architectures", None))
    model = AutoModelForCausalLM.from_pretrained(
        name, dtype=torch.float32, attn_implementation="eager"
    )
    tokenizer = AutoTokenizer.from_pretrained(name)
    return model.eval(), tokenizer, adapter


def tiny_random_model(seed: int) -> tuple[nn.Module, Any, MoeAdapter]:
    """Granite-MoE mit 2 Layern und Zufallsgewichten; Faktoren und Tokenizer von Granite."""
    from transformers import AutoConfig, AutoTokenizer, GraniteMoeConfig, GraniteMoeForCausalLM

    reference = AutoConfig.from_pretrained(REFERENCE_MODEL)
    config = GraniteMoeConfig(
        vocab_size=reference.vocab_size,
        hidden_size=64,
        intermediate_size=32,
        num_hidden_layers=2,
        num_attention_heads=4,
        num_key_value_heads=2,
        num_local_experts=4,
        num_experts_per_tok=2,
        embedding_multiplier=reference.embedding_multiplier,
        residual_multiplier=reference.residual_multiplier,
        logits_scaling=reference.logits_scaling,
        attention_multiplier=reference.attention_multiplier,
        tie_word_embeddings=reference.tie_word_embeddings,
        bos_token_id=reference.bos_token_id,
        eos_token_id=reference.eos_token_id,
        pad_token_id=reference.pad_token_id,
        architectures=["GraniteMoeForCausalLM"],
        attn_implementation="eager",
    )
    torch.manual_seed(seed)
    model = GraniteMoeForCausalLM(config).to(torch.float32)
    tokenizer = AutoTokenizer.from_pretrained(REFERENCE_MODEL)
    return model.eval(), tokenizer, GraniteMoeAdapter()


# ── Kommandozeile ──


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--model", default=REFERENCE_MODEL, help="Hugging-Face-ID oder Ordner")
    parser.add_argument("--prompt", default="Die Katze sitzt auf der")
    parser.add_argument("--max-tokens", type=int, default=8)
    parser.add_argument("--strategy", choices=["greedy", "sample"], default="greedy")
    parser.add_argument("--temperature", type=float, default=0.8)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--top-n", type=int, default=50, help="Kandidaten der logits-Station")
    parser.add_argument("--lens-top-n", type=int, default=5, help="0 schaltet die Lens ab")
    parser.add_argument("--out", required=True, type=Path, help="Zieldatei *.trace.json")
    parser.add_argument(
        "--tiny-random",
        action="store_true",
        help="kleines Granite-MoE mit Zufallsgewichten (Fixture, CON-0023 EX-04)",
    )
    args = parser.parse_args(argv)
    if not 1 <= args.max_tokens <= MAX_TOKENS_LIMIT:
        parser.error(f"--max-tokens muss zwischen 1 und {MAX_TOKENS_LIMIT} liegen")
    if not 0 <= args.lens_top_n <= MAX_LENS_TOP_N:
        parser.error(f"--lens-top-n muss zwischen 0 und {MAX_LENS_TOP_N} liegen")
    if args.top_n < 1:
        parser.error("--top-n muss mindestens 1 sein")
    if args.temperature <= 0:
        parser.error("--temperature muss größer als 0 sein")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    torch.set_grad_enabled(False)
    try:
        if args.tiny_random:
            model, tokenizer, adapter = tiny_random_model(args.seed)
            settings = Settings(
                model_name=TINY_MODEL_NAME,
                prompt=TINY_PROMPT,
                max_tokens=TINY_MAX_TOKENS,
                strategy="greedy",
                temperature=args.temperature,
                seed=args.seed,
                top_n=args.top_n,
                lens_top_n=args.lens_top_n,
                trace_id=f"{TINY_MODEL_NAME}-seed-{args.seed}",
                created_at=TINY_CREATED_AT,
            )
        else:
            model, tokenizer, adapter = load_model(args.model)
            settings = Settings(
                model_name=args.model,
                prompt=args.prompt,
                max_tokens=args.max_tokens,
                strategy=args.strategy,
                temperature=args.temperature,
                seed=args.seed,
                top_n=args.top_n,
                lens_top_n=args.lens_top_n,
                trace_id=str(uuid.uuid4()),
                created_at=datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            )
        trace = record_run(model, tokenizer, adapter, settings)
    except UnsupportedModelError as error:
        print(f"Fehler: {error}", file=sys.stderr)
        return 2
    args.out.write_text(json.dumps(trace, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Trace geschrieben: {args.out} ({len(trace['steps'])} Schritte)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
