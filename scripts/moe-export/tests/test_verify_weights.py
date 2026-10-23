"""Tests von verify_weights.py (CON-0026 PT-03) mit kleinen safetensors-Dateien, ohne Netz."""

import hashlib
import json

import pytest
import torch
from safetensors.torch import save_file

import verify_weights as vw


def checkpoint(folder, tensors):
    folder.mkdir(parents=True, exist_ok=True)
    save_file(tensors, str(folder / "model.safetensors"))
    return folder


@pytest.fixture
def tensors():
    generator = torch.Generator().manual_seed(7)
    return {
        "embed.weight": torch.randn(8, 4, generator=generator),
        "layers.0.mlp.weight": torch.randn(4, 4, generator=generator),
        "layers.1.mlp.weight": torch.randn(4, 4, generator=generator),
        "norm.bias": torch.zeros(4),
    }


def test_sha256_streams_like_hashlib(tmp_path):
    data = bytes(range(256)) * 9000  # über 1 MiB, mehrere Blöcke
    path = tmp_path / "blob.bin"
    path.write_bytes(data)
    assert vw.sha256_file(path) == hashlib.sha256(data).hexdigest()


def test_reference_identical(tmp_path, tensors):
    model = checkpoint(tmp_path / "model", tensors)
    reference = checkpoint(tmp_path / "reference", {k: v.clone() for k, v in tensors.items()})
    out = tmp_path / "report.json"
    code = vw.main(["--model", str(model), "--reference", str(reference), "--out", str(out)])
    report = json.loads(out.read_text())
    assert code == 0
    assert report["identical"] is True
    assert report["tensors"] == 4
    assert report["top"] == []


def test_reference_names_changed_tensor(tmp_path, tensors):
    changed = {k: v.clone() for k, v in tensors.items()}
    changed["layers.1.mlp.weight"][2, 3] += 0.5
    model = checkpoint(tmp_path / "model", changed)
    reference = checkpoint(tmp_path / "reference", tensors)
    out = tmp_path / "report.json"
    code = vw.main(["--model", str(model), "--reference", str(reference), "--out", str(out)])
    report = json.loads(out.read_text())
    assert code == 1
    assert report["identical"] is False
    assert [row["name"] for row in report["top"]] == ["layers.1.mlp.weight"]
    assert report["top"][0]["maxAbs"] == pytest.approx(0.5, abs=1e-6)
    assert report["top"][0]["relFrobenius"] > 0


def test_reference_orders_by_relative_change(tmp_path, tensors):
    changed = {k: v.clone() for k, v in tensors.items()}
    changed["embed.weight"] += 0.01
    changed["layers.0.mlp.weight"] *= 2
    model = checkpoint(tmp_path / "model", changed)
    reference = checkpoint(tmp_path / "reference", tensors)
    report = vw.compare_checkpoints(model, reference, top=20)
    assert [row["name"] for row in report["top"]] == ["layers.0.mlp.weight", "embed.weight"]
    assert report["top"][0]["relFrobenius"] == pytest.approx(1.0, abs=1e-6)


def test_reference_zero_tensor_changed_has_null_relative(tmp_path, tensors):
    changed = {k: v.clone() for k, v in tensors.items()}
    changed["norm.bias"][0] = 1.0
    report = vw.compare_checkpoints(
        checkpoint(tmp_path / "model", changed), checkpoint(tmp_path / "ref", tensors), top=20
    )
    assert report["top"][-1]["name"] == "norm.bias"
    assert report["top"][-1]["relFrobenius"] is None


def test_reference_shapeMismatch_missing_and_extra(tmp_path, tensors):
    changed = {k: v.clone() for k, v in tensors.items()}
    changed["layers.0.mlp.weight"] = torch.zeros(2, 8)
    del changed["norm.bias"]
    changed["extra.weight"] = torch.ones(2)
    report = vw.compare_checkpoints(
        checkpoint(tmp_path / "model", changed), checkpoint(tmp_path / "ref", tensors), top=20
    )
    assert report["identical"] is False
    assert report["shapeMismatch"] == [
        {"name": "layers.0.mlp.weight", "shape": [2, 8], "referenceShape": [4, 4]}
    ]
    assert report["missing"] == ["norm.bias"]
    assert report["extra"] == ["extra.weight"]
    assert report["tensors"] == 2


def test_top_limits_entries(tmp_path, tensors):
    changed = {k: v + 1 for k, v in tensors.items()}
    report = vw.compare_checkpoints(
        checkpoint(tmp_path / "model", changed), checkpoint(tmp_path / "ref", tensors), top=2
    )
    assert len(report["top"]) == 2


def stub_hub(monkeypatch, hashes):
    def fake(repo, revision):
        if isinstance(hashes, Exception):
            raise hashes
        return hashes

    monkeypatch.setattr(vw, "hub_hashes", fake)


def test_hashes_ok(tmp_path, tensors, monkeypatch, capsys):
    local = checkpoint(tmp_path / "local", tensors)
    stub_hub(monkeypatch, {"model.safetensors": vw.sha256_file(local / "model.safetensors")})
    results, code = vw.check_hashes("org/model", None, local)
    assert code == 0
    assert [r["status"] for r in results] == ["ok"]


def test_hashes_differ(tmp_path, tensors, monkeypatch, capsys):
    local = checkpoint(tmp_path / "local", tensors)
    stub_hub(monkeypatch, {"model.safetensors": "0" * 64})
    code = vw.main(["--model", "org/model", "--local", str(local)])
    assert code == 1
    assert "abweichend model.safetensors" in capsys.readouterr().out


def test_hub_unreachable_is_not_ok(tmp_path, tensors, monkeypatch, capsys):
    local = checkpoint(tmp_path / "local", tensors)
    stub_hub(monkeypatch, vw.HubUnavailable("keine Verbindung"))
    code = vw.main(["--model", "org/model", "--local", str(local)])
    out = capsys.readouterr().out
    assert code == 3
    assert "nicht prüfbar model.safetensors" in out
    assert "ok " not in out


def test_missing_lfs_metadata_is_not_checkable(tmp_path, tensors, monkeypatch):
    local = checkpoint(tmp_path / "local", tensors)
    stub_hub(monkeypatch, {"model.safetensors": None})
    results, code = vw.check_hashes("org/model", None, local)
    assert code == 3
    assert results[0]["status"] == "nicht prüfbar"


def test_local_file_not_on_hub_differs(tmp_path, tensors, monkeypatch):
    local = checkpoint(tmp_path / "local", tensors)
    save_file({"x": torch.ones(1)}, str(local / "extra.safetensors"))
    stub_hub(monkeypatch, {"model.safetensors": vw.sha256_file(local / "model.safetensors")})
    results, code = vw.check_hashes("org/model", None, local)
    assert code == 1
    assert {r["file"]: r["status"] for r in results} == {
        "model.safetensors": "ok",
        "extra.safetensors": "abweichend",
    }


def test_download_is_used_without_local(tmp_path, tensors, monkeypatch):
    local = checkpoint(tmp_path / "cache", tensors)
    sha = vw.sha256_file(local / "model.safetensors")
    results, code = vw.check_hashes(
        "org/model",
        None,
        None,
        hashes=lambda repo, revision: {"model.safetensors": sha},
        download=lambda repo, revision, name: local / name,
    )
    assert code == 0
    assert results[0]["sha256"] == sha


def test_local_and_reference_exclude_each_other(tmp_path):
    with pytest.raises(SystemExit):
        vw.parse_args(["--model", "a", "--local", str(tmp_path), "--reference", "b"])
