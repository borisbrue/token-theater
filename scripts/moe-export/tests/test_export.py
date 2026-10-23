"""Tests des Exporters (CON-0023 EX-03), ohne Modell-Download: `uv run pytest`."""

import json

import pytest

import export_trace


def test_unsupported_architecture_raises():
    with pytest.raises(export_trace.UnsupportedModelError, match="unsupported"):
        export_trace.adapter_for(["LlamaForCausalLM"])


def test_known_architectures_have_adapters():
    assert isinstance(
        export_trace.adapter_for(["GraniteMoeForCausalLM"]), export_trace.GraniteMoeAdapter
    )
    assert isinstance(export_trace.adapter_for(["MixtralForCausalLM"]), export_trace.MixtralAdapter)


def test_unsupported_model_exits_without_output(tmp_path, capsys):
    model = tmp_path / "llama"
    model.mkdir()
    (model / "config.json").write_text(
        json.dumps({"architectures": ["LlamaForCausalLM"], "model_type": "llama"})
    )
    out = tmp_path / "trace.json"
    code = export_trace.main(["--model", str(model), "--out", str(out)])
    assert code != 0
    assert not out.exists()
    assert "nicht unterstützt" in capsys.readouterr().err


def test_max_tokens_is_limited(tmp_path):
    with pytest.raises(SystemExit):
        export_trace.parse_args(["--max-tokens", "33", "--out", str(tmp_path / "t.json")])
