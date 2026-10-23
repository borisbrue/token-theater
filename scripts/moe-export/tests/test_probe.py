"""Tests von probe.py (CON-0026 PT-03, PT-05) mit dem Tiny-GPT-2, ohne Netz."""

import json

import pytest
import torch

import probe

ROOT = probe.ROOT
OCCUPATION = ROOT / "scripts/probes/occupation-gender-en.probe.json"


@pytest.fixture(scope="module")
def tiny():
    torch.set_grad_enabled(False)
    return probe.tiny_random_model(2)


def write_probe(tmp_path, pairs):
    path = tmp_path / "test.probe.json"
    value = {
        "schemaVersion": 1,
        "kind": "probe",
        "name": "test",
        "language": "en",
        "description": "",
        "pairs": pairs,
    }
    path.write_text(json.dumps(value))
    return path


def pair(pair_id, targets, a="The doctor said that", b="The nurse said that"):
    return {"id": pair_id, "attribute": "gender", "a": a, "b": b, "targets": targets}


def test_multi_token_target_exits_without_output(tmp_path, capsys):
    path = write_probe(tmp_path, [pair("pflege", [" er", " sie"])])
    out = tmp_path / "report.json"
    code = probe.main(["--tiny-random", "--probe", str(path), "--out", str(out)])
    assert code == 2
    assert not out.exists()
    assert "Ziel „ sie“ in Paar „pflege“ ist kein einzelnes Token (2 Tokens)." in (
        capsys.readouterr().err
    )


def test_invalid_probe_exits_without_output(tmp_path, capsys):
    path = write_probe(tmp_path, [pair("x", [" he", " she"]), pair("x", [" he", " she"])])
    out = tmp_path / "report.json"
    assert probe.main(["--tiny-random", "--probe", str(path), "--out", str(out)]) == 2
    assert not out.exists()
    assert "PB-01" in capsys.readouterr().err


def test_schema_error_exits(tmp_path):
    path = write_probe(tmp_path, [pair("Doctor", [" he"])])
    assert probe.main(["--tiny-random", "--probe", str(path), "--out", str(tmp_path / "r")]) == 2


def test_report_is_valid_and_consistent(tiny):
    model, tokenizer = tiny
    value = probe.read_probe(OCCUPATION)
    report = probe.build_report(model, tokenizer, value, "tiny", 5, probe.TINY_CREATED_AT)
    assert probe.schema_errors("ProbeReport", report) == []
    assert report["summary"]["pairs"] == 12
    assert report["summary"]["flips"] == sum(1 for p in report["pairs"] if p["flip"])
    for entry in report["pairs"]:
        first, second = entry["targets"]
        assert entry["logRatioA"] == pytest.approx(
            float(torch.log(torch.tensor(first["pA"] / second["pA"], dtype=torch.float64))),
            abs=1e-6,
        )
        assert [t["prob"] for t in entry["topA"]] == sorted(
            (t["prob"] for t in entry["topA"]), reverse=True
        )
    control = report["pairs"][-1]
    assert control["id"] == "control"
    assert control["js"] == 0
    assert control["flip"] is False


def test_three_targets_have_no_log_ratio(tiny, tmp_path):
    model, tokenizer = tiny
    value = probe.read_probe(write_probe(tmp_path, [pair("p", [" he", " she", " they"])]))
    report = probe.build_report(model, tokenizer, value, "tiny", 3, probe.TINY_CREATED_AT)
    entry = report["pairs"][0]
    assert entry["logRatioA"] is None and entry["flip"] is None
    assert report["summary"]["meanAbsLogRatioShift"] is None
    assert len(entry["topA"]) == 3


def test_js_divergence_bounds():
    p = torch.tensor([0.5, 0.5, 0.0], dtype=torch.float64)
    q = torch.tensor([0.0, 0.0, 1.0], dtype=torch.float64)
    assert probe.js_divergence(p, p) == 0
    assert probe.js_divergence(p, q) == pytest.approx(1.0)


def test_traces_need_moe_model(tmp_path):
    with pytest.raises(SystemExit):
        probe.parse_args(["--tiny-random", "--probe", "x", "--out", "y", "--traces", str(tmp_path)])


def test_top_n_is_limited():
    with pytest.raises(SystemExit):
        probe.parse_args(["--tiny-random", "--probe", "x", "--out", "y", "--top-n", "11"])
