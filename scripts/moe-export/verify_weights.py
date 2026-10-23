"""Prüft Gewichtsdateien gegen Hugging Face oder vergleicht zwei Checkpoints (SPEC-0012 §3.7).

Hash-Abgleich: SHA-256 jeder *.safetensors-Datei, gestreamt, gegen `lfs.sha256` des Hubs.
Tensor-Vergleich (`--reference`): je gleichnamigem Tensor maximale und relative Abweichung.
Regeln: CON-0026 PT-03.

    uv run --project scripts/moe-export scripts/moe-export/verify_weights.py --help
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

EXIT_OK = 0
EXIT_DIFFERS = 1
EXIT_UNCHECKABLE = 3
CHUNK_BYTES = 1 << 20
OK = "ok"
DIFFERS = "abweichend"
UNCHECKABLE = "nicht prüfbar"
SUFFIX = ".safetensors"


class HubUnavailable(Exception):
    """Hub nicht erreichbar oder ohne verwertbare Metadaten."""


# ── Hash-Abgleich ──


def sha256_file(path: Path) -> str:
    """SHA-256 in Blöcken zu 1 MiB, ohne die Datei ganz zu laden."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(CHUNK_BYTES):
            digest.update(block)
    return digest.hexdigest()


def hub_hashes(repo: str, revision: str | None) -> dict[str, str | None]:
    """`lfs.sha256` je *.safetensors-Datei des Repos; ohne LFS-Metadaten `None`."""
    from huggingface_hub import HfApi

    try:
        info = HfApi().model_info(repo, revision=revision, files_metadata=True)
    except Exception as error:  # Netz, HTTP-Fehler, unbekanntes Repo
        raise HubUnavailable(str(error)) from error
    hashes: dict[str, str | None] = {}
    for sibling in info.siblings or []:
        if sibling.rfilename.endswith(SUFFIX):
            lfs = sibling.lfs
            hashes[sibling.rfilename] = None if lfs is None else lfs.sha256
    return hashes


def hub_file(repo: str, revision: str | None, name: str) -> Path:
    from huggingface_hub import hf_hub_download

    try:
        return Path(hf_hub_download(repo, name, revision=revision))
    except Exception as error:  # Netz, HTTP-Fehler
        raise HubUnavailable(str(error)) from error


def check_hashes(
    repo: str,
    revision: str | None,
    local: Path | None,
    hashes: Callable[[str, str | None], dict[str, str | None]] | None = None,
    download: Callable[[str, str | None, str], Path] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Ergebnis je Datei und Exit-Code (0 alle ok, 1 eine abweichend, 3 eine nicht prüfbar)."""
    hashes = hashes or hub_hashes
    download = download or hub_file
    local_names = (
        sorted(p.relative_to(local).as_posix() for p in local.rglob(f"*{SUFFIX}"))
        if local is not None
        else []
    )
    try:
        expected = hashes(repo, revision)
    except HubUnavailable as error:
        names = local_names or [repo]
        results = [{"file": n, "status": UNCHECKABLE, "reason": str(error)} for n in names]
        return results, EXIT_UNCHECKABLE
    if not expected:
        return [
            {"file": repo, "status": UNCHECKABLE, "reason": "keine *.safetensors"}
        ], EXIT_UNCHECKABLE
    results: list[dict[str, Any]] = []
    for name in sorted(expected):
        sha = expected[name]
        path = (local / name) if local is not None else None
        if sha is None:
            results.append({"file": name, "status": UNCHECKABLE, "reason": "ohne LFS-Metadaten"})
            continue
        if path is not None and not path.is_file():
            results.append({"file": name, "status": UNCHECKABLE, "reason": "lokal nicht vorhanden"})
            continue
        try:
            actual = sha256_file(path if path is not None else download(repo, revision, name))
        except HubUnavailable as error:
            results.append({"file": name, "status": UNCHECKABLE, "reason": str(error)})
            continue
        status = OK if actual == sha else DIFFERS
        results.append({"file": name, "status": status, "sha256": actual, "expected": sha})
    for name in local_names:
        if name not in expected:
            results.append({"file": name, "status": DIFFERS, "reason": "nicht auf dem Hub"})
    statuses = {r["status"] for r in results}
    if DIFFERS in statuses:
        return results, EXIT_DIFFERS
    return results, EXIT_UNCHECKABLE if UNCHECKABLE in statuses else EXIT_OK


# ── Tensor-Vergleich ──


def checkpoint_dir(source: str, revision: str | None) -> Path:
    """Ordner wie angegeben, sonst die *.safetensors des Repos aus dem Hub-Cache."""
    path = Path(source)
    if path.is_dir():
        return path
    from huggingface_hub import snapshot_download

    try:
        folder = snapshot_download(source, revision=revision, allow_patterns=[f"*{SUFFIX}"])
    except Exception as error:
        raise HubUnavailable(str(error)) from error
    return Path(folder)


def tensor_files(directory: Path) -> dict[str, Path]:
    """Tensorname → Datei über alle *.safetensors eines Ordners."""
    from safetensors import safe_open

    index: dict[str, Path] = {}
    for file in sorted(directory.rglob(f"*{SUFFIX}")):
        with safe_open(str(file), framework="pt") as handle:
            names = handle.keys()
            for name in names:
                index[name] = file
    return index


def load_tensor(file: Path, name: str) -> Any:
    from safetensors import safe_open

    with safe_open(str(file), framework="pt") as handle:
        return handle.get_tensor(name)


def tensor_shape(file: Path, name: str) -> list[int]:
    from safetensors import safe_open

    with safe_open(str(file), framework="pt") as handle:
        return list(handle.get_slice(name).get_shape())


def compare_checkpoints(model: Path, reference: Path, top: int) -> dict[str, Any]:
    """Je gemeinsamem Tensor gleicher Form maxAbs und relFrobenius, gerechnet in float64."""
    import torch

    ours = tensor_files(model)
    theirs = tensor_files(reference)
    common = sorted(set(ours) & set(theirs))
    rows: list[dict[str, Any]] = []
    mismatch: list[dict[str, Any]] = []
    compared = 0
    for name in common:
        shape = tensor_shape(ours[name], name)
        reference_shape = tensor_shape(theirs[name], name)
        if shape != reference_shape:
            mismatch.append({"name": name, "shape": shape, "referenceShape": reference_shape})
            continue
        a = load_tensor(ours[name], name).to(torch.float64)
        b = load_tensor(theirs[name], name).to(torch.float64)
        compared += 1
        diff = a - b
        max_abs = float(diff.abs().max()) if diff.numel() > 0 else 0.0
        norm = float(torch.linalg.vector_norm(b))
        if norm > 0:
            relative: float | None = float(torch.linalg.vector_norm(diff)) / norm
        else:
            relative = 0.0 if max_abs == 0 else None
        if max_abs > 0:
            rows.append({"name": name, "shape": shape, "maxAbs": max_abs, "relFrobenius": relative})
    rows.sort(
        key=lambda r: (
            r["relFrobenius"] is None,
            -(r["relFrobenius"] or 0.0),
            -r["maxAbs"],
            r["name"],
        )
    )
    missing = sorted(set(theirs) - set(ours))
    extra = sorted(set(ours) - set(theirs))
    return {
        "model": str(model),
        "reference": str(reference),
        "tensors": compared,
        "identical": not rows and not missing and not extra and not mismatch,
        "top": rows[:top],
        "missing": missing,
        "extra": extra,
        "shapeMismatch": mismatch,
    }


# ── Kommandozeile ──


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--model", required=True, help="Hugging-Face-ID oder Ordner")
    parser.add_argument("--revision", help="Branch, Tag oder Commit des Repos")
    parser.add_argument("--local", type=Path, help="lokaler Ordner statt Download (Hash-Abgleich)")
    parser.add_argument("--reference", help="Repo oder Ordner zum Tensor-Vergleich")
    parser.add_argument("--out", type=Path, help="Bericht als JSON")
    parser.add_argument("--top", type=int, default=20, help="stärkste Abweichungen im Bericht")
    args = parser.parse_args(argv)
    if args.top < 1:
        parser.error("--top muss mindestens 1 sein")
    if args.local is not None and args.reference is not None:
        parser.error("--local gilt nur für den Hash-Abgleich; für --reference --model ORDNER")
    return args


def write_json(path: Path | None, value: dict[str, Any]) -> None:
    if path is not None:
        path.write_text(json.dumps(value, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def run_reference(args: argparse.Namespace) -> int:
    try:
        model = checkpoint_dir(args.model, args.revision)
        reference = checkpoint_dir(args.reference, None)
    except HubUnavailable as error:
        print(f"{UNCHECKABLE} {args.model}: {error}")
        return EXIT_UNCHECKABLE
    report = compare_checkpoints(model, reference, args.top)
    write_json(args.out, report)
    print(f"{report['tensors']} Tensoren verglichen")
    for row in report["top"]:
        rel = "–" if row["relFrobenius"] is None else f"{row['relFrobenius']:.3e}"
        print(f"{DIFFERS} {row['name']} {row['shape']}: maxAbs {row['maxAbs']:.3e}, rel {rel}")
    for row in report["shapeMismatch"]:
        print(f"Form verschieden {row['name']}: {row['shape']} statt {row['referenceShape']}")
    for name in report["missing"]:
        print(f"fehlt {name}")
    for name in report["extra"]:
        print(f"zusätzlich {name}")
    print("identisch" if report["identical"] else "verschieden")
    return EXIT_OK if report["identical"] else EXIT_DIFFERS


def run_hashes(args: argparse.Namespace) -> int:
    results, code = check_hashes(args.model, args.revision, args.local)
    write_json(args.out, {"model": args.model, "revision": args.revision, "files": results})
    for result in results:
        reason = f" ({result['reason']})" if "reason" in result else ""
        print(f"{result['status']} {result['file']}{reason}")
    return code


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    return run_reference(args) if args.reference is not None else run_hashes(args)


if __name__ == "__main__":
    sys.exit(main())
