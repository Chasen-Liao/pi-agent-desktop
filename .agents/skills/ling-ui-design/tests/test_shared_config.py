from __future__ import annotations

import base64
import io
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import _common
import configure
import decompose_layers
import generate_image


def test_multipart_preserves_image_and_fields_on_retry(monkeypatch):
    import requests
    calls = []
    payload = {
        "images": [{"image_url": "data:image/png;base64," + base64.b64encode(b"image-bytes").decode()}],
        "model": "test", "prompt": "original prompt", "use_pe": True,
        "stream": False, "num_inference_steps": 14,
    }

    def post(url, **kwargs):
        calls.append(kwargs)
        response = requests.Response()
        response.status_code = 500 if len(calls) == 1 else 200
        response._content = b'{"data": []}'
        return response

    monkeypatch.setattr(requests, "post", post)
    monkeypatch.setattr(_common.time, "sleep", lambda _: None)
    assert _common.post_json("https://example.invalid/images/edits", payload,
                             timeout=600, api_key="test-key", multipart=True) == {"data": []}
    assert len(calls) == 2
    for call in calls:
        assert "json" not in call
        assert "Content-Type" not in call["headers"]
        assert call["timeout"] == 600
        assert call["files"] == [("image", ("image_0.png", b"image-bytes", "image/png"))]
        assert call["data"] == {"model": "test", "prompt": "original prompt",
                                "use_pe": "true", "stream": "false", "num_inference_steps": "14"}
    assert "images" in payload


@pytest.mark.parametrize("count", [1, 2, 3, 4, 5])
def test_decompose_count_fallback_runs_crop_without_retry(count, tmp_path, monkeypatch, capsys):
    import json
    from crop_elements import extract_from_layers

    source = tmp_path / "source.png"
    Image.new("RGBA", (20, 20), "red").save(source)
    item = {"b64_json": base64.b64encode(source.read_bytes()).decode()}
    calls = []

    def post(*args, **kwargs):
        calls.append(1)
        return {"data": [item] * count}

    monkeypatch.setattr(decompose_layers, "post_json", post)
    monkeypatch.setattr(decompose_layers, "require_env", lambda name: "test-key")
    output = tmp_path / "layers"
    monkeypatch.setattr(sys, "argv", ["decompose_layers", "--image", str(source), "--outdir", str(output)])
    decompose_layers.main()
    assert len(calls) == 1
    record = json.loads((output / "manifest.json").read_text())
    assert len(record["layers"]) == count
    assert tuple(layer["role"] for layer in record["layers"]) == decompose_layers.layer_roles(count, fallback=True)
    assert ("roles_inferred" in record) == (count != 4)
    assert ("Warning:" in capsys.readouterr().out) == (count != 4)
    assert extract_from_layers(output, tmp_path / "crops", min_area=1)


@pytest.mark.parametrize("kind", ["generate", "decompose"])
def test_shared_endpoint_default_and_cli_override(
    kind: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(_common, "ENV_FILE", tmp_path / ".env")
    monkeypatch.delenv("LING_UI_DESIGN_API_BASE", raising=False)
    model_setting = "LING_UI_DESIGN_IMAGE_MODEL" if kind == "generate" else "LING_UI_DESIGN_DECOMPOSE_MODEL"
    monkeypatch.delenv(model_setting, raising=False)
    module = generate_image if kind == "generate" else decompose_layers
    args = (["--prompt", "test", "--out", "out.png"] if kind == "generate"
            else ["--image", "reference.png", "--outdir", "layers"])
    assert module.parser().parse_args(args).api_base == "https://api.novita.ai/openai/v1/"
    expected_model = "ming-image-0.1-design" + ("-layer" if kind == "decompose" else "")
    assert module.parser().parse_args(args).model == expected_model
    example = _common.read_dotenv(_common.ENV_EXAMPLE)
    assert example[model_setting] == expected_model
    assert example["LING_UI_DESIGN_API_BASE"] == _common.DEFAULT_API_BASE
    monkeypatch.setenv("LING_UI_DESIGN_API_BASE", "https://example.invalid/v1")
    assert module.parser().parse_args(args).api_base == "https://example.invalid/v1"
    assert module.parser().parse_args(args + ["--api-base", "https://override.invalid/v1"]).api_base == "https://override.invalid/v1"


@pytest.mark.parametrize("kind", ["generate", "decompose"])
@pytest.mark.parametrize("source", ["file", "environment"])
@pytest.mark.parametrize("configured_timeout", [None, 777])
def test_shared_key_and_prefixed_settings_reach_requests(
    kind: str, source: str, configured_timeout: int | None,
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in list(os.environ):
        if name.startswith("LING_UI_DESIGN_"):
            monkeypatch.delenv(name)
    dotenv = tmp_path / ".env"
    dotenv.write_text("LING_UI_DESIGN_API_KEY=file-test-key\n")
    monkeypatch.setattr(_common, "ENV_FILE", dotenv)
    if source == "environment":
        monkeypatch.setenv("LING_UI_DESIGN_API_KEY", "environment-test-key")
    expected_key = f"{source}-test-key"
    prefix = "LING_UI_DESIGN_DECOMPOSE" if kind == "decompose" else "LING_UI_DESIGN_IMAGE"
    settings = {
        "LING_UI_DESIGN_API_BASE": "https://example.invalid/v1/",
        f"{prefix}_MODEL": "test-model",
        # A legacy image-size setting must not reintroduce the rejected parameter.
        f"{prefix}_SIZE": "1k" if kind == "decompose" else "1024x1024",
        "LING_UI_DESIGN_DECOMPOSE_STEPS": "12",
        "LING_UI_DESIGN_DECOMPOSE_SEED": "7",
    }
    if configured_timeout is not None:
        settings[f"{prefix}_TIMEOUT"] = str(configured_timeout)
    default_timeout = float(_common.read_dotenv(_common.ENV_EXAMPLE)[f"{prefix}_TIMEOUT"])
    assert default_timeout == 600
    for name, value in settings.items():
        if source == "environment":
            monkeypatch.setenv(name, value)
    if source == "file":
        dotenv.write_text(dotenv.read_text() + "".join(f"{k}={v}\n" for k, v in settings.items()))
    image_path = tmp_path / "reference.png"
    Image.new("RGBA", (8, 8), "blue").save(image_path)
    buffer = io.BytesIO()
    Image.new("RGBA", (8, 8), "red").save(buffer, "PNG")
    item = {"b64_json": base64.b64encode(buffer.getvalue()).decode()}
    module = decompose_layers if kind == "decompose" else generate_image
    calls = []

    def post(url, payload, *, timeout, api_key, multipart=False):
        calls.append(url)
        assert multipart == (kind != "generate")
        if kind == "generate":
            assert payload["enable_thinking"] is True
        else:
            assert "enable_thinking" not in payload
        assert "thinking_effort" not in payload
        assert url == "https://example.invalid/v1/images/" + ("generations" if kind == "generate" else "edits")
        assert api_key == expected_key
        assert timeout == (configured_timeout if configured_timeout is not None else default_timeout)
        assert payload["model"] == "test-model"
        if kind == "decompose":
            assert payload["size"] == settings[f"{prefix}_SIZE"]
            assert payload["num_inference_steps"] == 12
            assert payload["seed"] == 7
        else:
            assert "size" not in payload
            assert "images" not in payload
        return {"data": [item] * (4 if kind == "decompose" else 1)}

    monkeypatch.setattr(module, "post_json", post)
    if kind == "decompose":
        args = ["--image", str(image_path), "--outdir", str(tmp_path / "layers")]
    else:
        args = ["--prompt", "test", "--out", str(tmp_path / "generated.png")]
    monkeypatch.setattr(sys, "argv", [module.__name__, *args])
    module.main()
    assert len(calls) == 1


@pytest.mark.parametrize("source", ["missing", "file", "environment"])
def test_configuration_reports_one_key_without_its_value(
    source: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    dotenv = tmp_path / ".env"
    dotenv.write_text("LING_UI_DESIGN_API_KEY=file-test-key\n" if source != "missing" else "")
    monkeypatch.setattr(_common, "ENV_FILE", dotenv)
    monkeypatch.delenv("LING_UI_DESIGN_API_KEY", raising=False)
    if source == "environment":
        monkeypatch.setenv("LING_UI_DESIGN_API_KEY", "environment-test-key")
    monkeypatch.setattr(sys, "argv", ["configure.py", "--check"])
    if source == "missing":
        with pytest.raises(SystemExit, match="is not configured") as error:
            configure.main()
        message = str(error.value)
        assert _common.KEY_SETUP_URL == "https://novita.ai/"
        assert _common.KEY_SETUP_URL in message
        assert "export LING_UI_DESIGN_API_KEY=" in message
        assert str(dotenv) in message
        assert capsys.readouterr().out == ""
        return
    configure.main()
    status = {"missing": "missing", "file": "configured (.env)", "environment": "configured (process environment)"}[source]
    assert capsys.readouterr().out == f"LING_UI_DESIGN_API_KEY: {status}\n"


@pytest.mark.parametrize("source", ["missing", "blank", "file", "environment"])
def test_configuration_cli_exit_status_and_environment_inheritance(
    source: str, tmp_path: Path,
) -> None:
    root = Path(__file__).parents[1]
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    for name in ("configure.py", "_common.py"):
        shutil.copyfile(root / "scripts" / name, scripts / name)
    shutil.copyfile(root / ".env.example", tmp_path / ".env.example")
    dotenv = tmp_path / ".env"
    if source != "missing":
        dotenv.write_text("LING_UI_DESIGN_API_KEY=\n" if source == "blank" else "LING_UI_DESIGN_API_KEY=file-test-key\n")
    environment = {k: v for k, v in os.environ.items() if not k.startswith("LING_UI_DESIGN_")}
    if source == "environment":
        environment["LING_UI_DESIGN_API_KEY"] = "environment-test-key"
        # An exported key must not depend on a readable dotenv file.
        dotenv.write_text("invalid dotenv content")
    result = subprocess.run(
        [sys.executable, "-B", str(scripts / "configure.py"), "--check"],
        env=environment, capture_output=True, text=True, check=False,
    )
    output = result.stdout + result.stderr
    assert "file-test-key" not in output and "environment-test-key" not in output
    if source in ("missing", "blank"):
        assert result.returncode == 1
        assert _common.KEY_SETUP_URL in result.stderr
        assert "export LING_UI_DESIGN_API_KEY=" in result.stderr
        assert str(dotenv) in result.stderr
        assert dotenv.is_file()
    else:
        assert result.returncode == 0
        status = "process environment" if source == "environment" else ".env"
        assert result.stdout == f"LING_UI_DESIGN_API_KEY: configured ({status})\n"
