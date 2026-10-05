from __future__ import annotations

import argparse
import io
import base64
import json
import os
import sys
from pathlib import Path

import pytest
from PIL import Image


ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import capture_page  # noqa: E402
import crop_elements  # noqa: E402
import decompose_layers  # noqa: E402
import generate_image  # noqa: E402
import install  # noqa: E402
import refine_crop  # noqa: E402
import _common  # noqa: E402


def test_capture_page_allows_slow_pages_by_default() -> None:
    args = capture_page.parser().parse_args(["--url", "http://localhost", "--outdir", "out"])

    assert args.timeout == 300.0


def test_generation_payload_omits_size_and_image_input() -> None:
    args = argparse.Namespace(
        prompt="museum website",
        format="png",
        model=generate_image.DEFAULT_MODEL,
    )

    route, payload = generate_image.build_payload(args)

    assert route == "images/generations"
    assert payload["model"] == "ming-image-0.1-design"
    assert "size" not in payload
    assert "images" not in payload


@pytest.mark.parametrize("flags", [
    ["--image", "source.png"], ["--size", "2048x2048"],
    ["--resize", "1024"], ["--seed", "42"], ["--steps", "30"], ["--use-pe"],
])
def test_generation_rejects_removed_options(flags) -> None:
    with pytest.raises(SystemExit) as error:
        generate_image.parser().parse_args(["--prompt", "test", "--out", "out.jpg", *flags])
    assert error.value.code == 2


@pytest.mark.parametrize("format_name", ["jpg", "jpeg", "png", "webp"])
def test_generation_format_alias_reaches_api(format_name: str, tmp_path: Path) -> None:
    flags = ["--prompt", "test", "--format", format_name, "--out", str(tmp_path / f"out.{format_name}")]
    route, payload = generate_image.build_payload(generate_image.parser().parse_args(flags))
    assert route == "images/generations"
    assert payload["output_format"] == ("jpeg" if format_name == "jpg" else format_name)


@pytest.mark.parametrize("encoding,extension", [
    ("JPEG", "jpg"), ("JPEG", "jpeg"), ("PNG", "png"), ("WEBP", "webp"),
    ("PNG", "jpg"), ("JPEG", "png"),
])
def test_decomposition_upload_mime_matches_encoded_pixels(
    encoding: str, extension: str, tmp_path: Path,
) -> None:
    source = tmp_path / f"reference.{extension}"
    Image.new("RGB", (12, 8), "blue").save(source, format=encoding)
    args = decompose_layers.parser().parse_args(["--image", str(source), "--outdir", str(tmp_path / "layers")])
    payload = decompose_layers.build_payload(args)
    header, data = payload["images"][0]["image_url"].split(",", 1)
    assert header == f"data:image/{encoding.lower()};base64"
    decoded = base64.b64decode(data, validate=True)
    assert decoded == source.read_bytes()
    with Image.open(io.BytesIO(decoded)) as uploaded:
        assert uploaded.format == encoding
        assert uploaded.size == (12, 8)


def test_decomposition_uses_verified_prompt_and_server_pe(tmp_path: Path) -> None:
    source = tmp_path / "source.png"
    Image.new("RGB", (12, 8), "blue").save(source)
    args = argparse.Namespace(
        image=str(source),
        model=decompose_layers.DEFAULT_MODEL,
        prompt_file=None,
        layers=4,
        size=decompose_layers.DEFAULT_SIZE,
        resize=None,
        no_pe=False,
        steps=14,
        seed=42,
    )

    payload = decompose_layers.build_payload(args)

    assert payload["size"] == "auto"
    assert payload["prompt"] == decompose_layers.DEFAULT_PROMPT
    assert "do not resize, reposition, blur, or simplify them" in payload["prompt"]
    assert payload["use_pe"] is True
    assert payload["get_assets"] is True
    assert payload["num_layers"] == 4
    assert "use_sr" not in payload


def test_decomposition_accepts_explicit_target_resolution(tmp_path: Path) -> None:
    source = tmp_path / "source.png"
    Image.new("RGB", (12, 8), "blue").save(source)
    args = argparse.Namespace(
        image=str(source),
        model=decompose_layers.DEFAULT_MODEL,
        prompt_file=None,
        layers=4,
        size="2k",
        resize=None,
        no_pe=False,
        steps=14,
        seed=42,
    )

    assert decompose_layers.build_payload(args)["size"] == "2k"
    assert "use_sr" not in decompose_layers.build_payload(args)


@pytest.mark.parametrize("size", ["512", "1k", "2k", "auto"])
def test_decomposition_cli_exposes_supported_target_resolutions(size: str) -> None:
    args = decompose_layers.parser().parse_args(
        ["--image", "reference.png", "--outdir", "layers", "--size", size]
    )

    assert args.size == size


def test_decomposition_manifest_records_actual_layer_pixels(tmp_path: Path) -> None:
    source = tmp_path / "source.png"
    Image.new("RGB", (2688, 1536), "blue").save(source)
    Image.new("RGB", (1344, 768), "red").save(tmp_path / "layer_0.png")
    Image.new("RGB", (1344, 768), "green").save(tmp_path / "layer_1.png")

    manifest = decompose_layers.build_manifest(
        source=str(source),
        source_size="2688x1536",
        requested_size="1792x1024",
        model=decompose_layers.DEFAULT_MODEL,
        layers_requested=4,
        server_prompt_enhancement=True,
        prompt="test",
        layers=decompose_layers.layer_file_entries(tmp_path, ["layer_0.png", "layer_1.png"]),
    )

    assert manifest["source_size"] == "2688x1536"
    assert manifest["requested_size"] == "1792x1024"
    assert manifest["size"] == "1344x768"
    assert manifest["files"] == ["layer_0.png", "layer_1.png"]
    assert manifest["layers"] == [
        {"file": "layer_0.png", "size": "1344x768"},
        {"file": "layer_1.png", "size": "1344x768"},
    ]
    assert "extractable_roles" not in manifest


def test_default_four_layers_record_roles_for_asset_extraction(tmp_path: Path) -> None:
    for index, color in enumerate(("red", "green", "blue", "white")):
        Image.new("RGB", (8, 8), color).save(tmp_path / f"layer_{index}.png")

    layers = decompose_layers.layer_file_entries(
        tmp_path,
        [f"layer_{index}.png" for index in range(4)],
        decompose_layers.layer_roles(4),
    )
    manifest = decompose_layers.build_manifest(
        source="reference.png",
        source_size="8x8",
        requested_size="auto",
        model=decompose_layers.DEFAULT_MODEL,
        layers_requested=4,
        server_prompt_enhancement=True,
        prompt=decompose_layers.DEFAULT_PROMPT,
        layers=layers,
    )

    assert [item["role"] for item in manifest["layers"]] == [
        "text",
        "image",
        "container",
        "background",
    ]
    assert manifest["extractable_roles"] == ["image", "background"]


def test_decomposition_clears_only_previous_layer_outputs(tmp_path: Path) -> None:
    (tmp_path / "layer_0.png").write_bytes(b"old")
    (tmp_path / "layer_3.png").write_bytes(b"stale")
    (tmp_path / "manifest.json").write_text("{}", encoding="utf-8")
    (tmp_path / "keep.txt").write_text("keep", encoding="utf-8")

    decompose_layers.clear_previous_outputs(tmp_path)

    assert not list(tmp_path.glob("layer_*.png"))
    assert not (tmp_path / "manifest.json").exists()
    assert (tmp_path / "keep.txt").read_text(encoding="utf-8") == "keep"


def test_decomposition_accepts_wrong_layer_count_with_warning(capsys) -> None:
    buffer = io.BytesIO()
    Image.new("RGBA", (4, 4), "red").save(buffer, "PNG")

    decompose_layers.validate_layers([buffer.getvalue()], 4)
    assert "returned 1 layers; expected 4" in capsys.readouterr().out


def test_decomposition_rejects_empty_layers() -> None:
    with pytest.raises(SystemExit, match="no layers"):
        decompose_layers.validate_layers([], 4)


@pytest.mark.parametrize("count,roles", [
    (1, ("image",)),
    (2, ("image", "background")),
    (3, ("text", "image", "background")),
    (4, ("text", "image", "container", "background")),
    (5, ("text", "image", "image", "container", "background")),
])
def test_fallback_layer_roles(count, roles) -> None:
    assert decompose_layers.layer_roles(count, fallback=True) == roles
    assert decompose_layers.layer_roles(count) == (roles if count == 4 else None)


def test_unlabelled_layers_use_image_before_container() -> None:
    entries = [{"file": f"layer_{index}.png"} for index in (3, 1, 0, 2)]
    assigned = crop_elements.assign_roles(entries)
    assert {item["file"]: item["role"] for item in assigned} == {
        "layer_0.png": "text", "layer_1.png": "image",
        "layer_2.png": "container", "layer_3.png": "background",
    }


def test_decomposition_rejects_invalid_layer_data() -> None:
    with pytest.raises(SystemExit, match="invalid layer 1 data"):
        decompose_layers.validate_layers([b"not an image"], 1)


def test_revised_decomposition_prompt_can_disable_second_pe(tmp_path: Path) -> None:
    prompt_file = tmp_path / "prompt.txt"
    prompt_file.write_text("revised five-layer prompt", encoding="utf-8")
    args = argparse.Namespace(prompt_file=str(prompt_file), layers=5)

    assert decompose_layers.selected_prompt(args) == "revised five-layer prompt"


def test_largest_alpha_component_removes_detached_noise() -> None:
    image = Image.new("RGBA", (12, 10), (0, 0, 0, 0))
    for y in range(3, 8):
        for x in range(4, 10):
            image.putpixel((x, y), (255, 0, 0, 255))
    image.putpixel((0, 0), (255, 0, 0, 100))

    cleaned = refine_crop.largest_alpha_component(image)

    assert cleaned.size == (6, 5)
    assert cleaned.getchannel("A").getextrema() == (255, 255)


def test_alpha_components_return_each_visible_blob() -> None:
    image = Image.new("RGBA", (20, 10), (0, 0, 0, 0))
    for y in range(1, 4):
        for x in range(1, 5):
            image.putpixel((x, y), (200, 40, 40, 255))
    for y in range(6, 9):
        for x in range(12, 18):
            image.putpixel((x, y), (40, 80, 200, 255))
    image.putpixel((19, 0), (255, 255, 255, 255))

    components = refine_crop.alpha_components(image, min_area=4)

    assert [box for box, _crop in components] == [(12, 6, 18, 9), (1, 1, 5, 4)]
    assert components[0][1].size == (6, 3)
    assert components[1][1].size == (4, 3)


def test_placement_hints_flags_wide_merged_strips() -> None:
    hints = crop_elements.placement_hints((0, 139, 2048, 892), (2048, 2048))

    assert hints["aspect_ratio"] > 2
    assert hints["review"] is True
    assert hints["review_reason"]


@pytest.mark.parametrize("image_index,container_index", [(1, 2), (2, 1)])
def test_crop_elements_extracts_only_image_and_background(
    tmp_path: Path, image_index: int, container_index: int,
) -> None:
    layers = tmp_path / "layers"
    crops = tmp_path / "crops"
    layers.mkdir()
    Image.new("RGBA", (20, 12), (0, 0, 0, 0)).save(layers / "layer_0.png")
    Image.new("RGBA", (20, 12), (0, 0, 0, 0)).save(layers / f"layer_{container_index}.png")
    photos = Image.new("RGBA", (20, 12), (0, 0, 0, 0))
    for y in range(1, 5):
        for x in range(1, 6):
            photos.putpixel((x, y), (180, 60, 40, 255))
    for y in range(7, 11):
        for x in range(12, 18):
            photos.putpixel((x, y), (40, 90, 160, 255))
    photos.save(layers / f"layer_{image_index}.png")
    canvas = Image.new("RGBA", (20, 12), (245, 242, 237, 255))
    canvas.save(layers / "layer_3.png")
    (layers / "manifest.json").write_text(
        json.dumps(
            {
                "source_size": "40x24",
                "extractable_roles": ["image", "background"],
                "layers": [
                    {"file": "layer_0.png", "role": "text", "size": "20x12"},
                    {"file": f"layer_{container_index}.png", "role": "container", "size": "20x12"},
                    {"file": f"layer_{image_index}.png", "role": "image", "size": "20x12"},
                    {"file": "layer_3.png", "role": "background", "size": "20x12"},
                ],
            }
        ),
        encoding="utf-8",
    )

    files = crop_elements.extract_from_layers(layers, crops, min_area=4)
    names = [item["file"] for item in files]

    assert names == ["asset_00.png", "asset_01.png", "asset_02.png"]
    assert files[0]["bbox"] == [12, 7, 18, 11]
    assert files[0]["layer"] == f"layer_{image_index}.png"
    assert files[0]["canvas"] == "20x12"
    assert files[0]["width_fraction"] == 0.3
    assert files[1]["bbox"] == [1, 1, 6, 5]
    assert files[2]["bbox"] == [0, 0, 20, 12]
    assert (crops / "asset_00.png").is_file()
    assert files[2]["source_role"] == "background"
    assert "role" not in files[2]
    assert not any(path.name.startswith("text_") for path in crops.iterdir())


def test_crop_elements_scales_original_box_onto_layer(tmp_path: Path) -> None:
    original = tmp_path / "reference.png"
    Image.new("RGB", (20, 10), "white").save(original)
    layer = Image.new("RGBA", (40, 20), (0, 0, 0, 0))
    for y in range(4, 16):
        for x in range(8, 24):
            layer.putpixel((x, y), (200, 40, 40, 255))
    layer_path = tmp_path / "layer_3.png"
    layer.save(layer_path)
    output = tmp_path / "hero.png"

    source_size = _common.resolve_source_size(from_image=str(original), required=True)
    image, mapped = refine_crop.crop_asset(
        refine_crop.load_rgba(layer_path),
        box=(4, 2, 12, 8),
        source_size=source_size,
    )
    refine_crop.write_png(image, output)

    assert mapped == (8, 4, 24, 16)
    assert image.size == (16, 12)
    with Image.open(output) as written:
        assert written.size == (16, 12)
        assert written.getpixel((0, 0)) == (200, 40, 40, 255)


def test_crop_elements_cli_requires_a_source_canvas(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    layer = tmp_path / "layer_3.png"
    Image.new("RGBA", (8, 8), (255, 0, 0, 255)).save(layer)
    output = tmp_path / "out.png"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "crop_elements.py",
            "--image",
            str(layer),
            "--box",
            "1,1,4,4",
            "--out",
            str(output),
        ],
    )

    with pytest.raises(SystemExit, match="from-image"):
        crop_elements.main()


def test_crop_elements_cli_uses_manifest_source_size(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    layer = Image.new("RGBA", (40, 20), (0, 0, 0, 0))
    for y in range(4, 16):
        for x in range(8, 24):
            layer.putpixel((x, y), (10, 20, 200, 255))
    layer_path = tmp_path / "layer_3.png"
    layer.save(layer_path)
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps({"source_size": "20x10", "files": ["layer_3.png"]}),
        encoding="utf-8",
    )
    output = tmp_path / "card.png"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "crop_elements.py",
            "--image",
            str(layer_path),
            "--from-manifest",
            str(manifest),
            "--box",
            "4,2,12,8",
            "--out",
            str(output),
        ],
    )

    crop_elements.main()

    with Image.open(output) as written:
        assert written.size == (16, 12)
        assert written.getpixel((0, 0)) == (10, 20, 200, 255)


def test_refine_crop_from_image_scales_like_crop_elements(tmp_path: Path) -> None:
    original = tmp_path / "reference.png"
    Image.new("RGB", (20, 10), "white").save(original)
    layer = Image.new("RGBA", (40, 20), (12, 12, 12, 255))
    layer_path = tmp_path / "layer.png"
    layer.save(layer_path)
    image, mapped = refine_crop.crop_asset(
        refine_crop.load_rgba(layer_path),
        box=(4, 2, 12, 8),
        source_size=_common.resolve_source_size(from_image=str(original)),
    )

    assert mapped == (8, 4, 24, 16)
    assert image.size == (16, 12)


def test_trim_alpha_ignores_rgb_hidden_under_transparency() -> None:
    image = Image.new("RGBA", (8, 6), (255, 0, 0, 0))
    for y in range(2, 5):
        for x in range(3, 7):
            image.putpixel((x, y), (0, 0, 255, 255))

    cleaned = refine_crop.trim_alpha(image)

    assert cleaned.size == (4, 3)
    assert cleaned.getchannel("A").getextrema() == (255, 255)


def test_capture_viewport_parser() -> None:
    assert capture_page.parse_viewport("mobile=390x844") == ("mobile", 390, 844)


def test_full_page_capture_scrolls_and_reports_unloaded_images() -> None:
    class FakePage:
        script = ""

        def evaluate(self, script: str) -> list[str]:
            self.script = script
            return ["broken.png"]

    page = FakePage()

    assert capture_page.prepare_full_page(page) == ["broken.png"]
    assert "window.scrollTo" in page.script
    assert "document.images" in page.script


def test_dotenv_empty_duplicate_does_not_wipe_earlier_value(tmp_path: Path) -> None:
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "LING_UI_DESIGN_API_KEY=first-value\nLING_UI_DESIGN_API_KEY=\n",
        encoding="utf-8",
    )

    assert _common.read_dotenv(dotenv)["LING_UI_DESIGN_API_KEY"] == "first-value"


def test_project_dotenv_is_loaded_and_process_environment_wins(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "# local only\nexport LING_UI_DESIGN_API_KEY='from-file'\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(_common, "ENV_FILE", dotenv)
    monkeypatch.delenv("LING_UI_DESIGN_API_KEY", raising=False)

    assert _common.configured_value("LING_UI_DESIGN_API_KEY") == "from-file"

    monkeypatch.setenv("LING_UI_DESIGN_API_KEY", "from-process")
    assert _common.configured_value("LING_UI_DESIGN_API_KEY") == "from-process"


def test_missing_key_initializes_private_project_dotenv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dotenv = tmp_path / ".env"
    example = tmp_path / ".env.example"
    example.write_text("LING_UI_DESIGN_API_KEY=\n", encoding="utf-8")
    monkeypatch.setattr(_common, "ENV_FILE", dotenv)
    monkeypatch.setattr(_common, "ENV_EXAMPLE", example)
    monkeypatch.delenv("LING_UI_DESIGN_API_KEY", raising=False)

    with pytest.raises(SystemExit, match=r"is not configured") as error:
        _common.require_env("LING_UI_DESIGN_API_KEY")

    assert dotenv.read_text(encoding="utf-8") == example.read_text(encoding="utf-8")
    assert str(dotenv) in str(error.value)
    if os.name == "posix":
        assert dotenv.stat().st_mode & 0o077 == 0


def test_env_initializer_never_overwrites_existing_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dotenv = tmp_path / ".env"
    example = tmp_path / ".env.example"
    dotenv.write_text("LING_UI_DESIGN_API_KEY=keep-me\n", encoding="utf-8")
    example.write_text("LING_UI_DESIGN_API_KEY=\n", encoding="utf-8")
    monkeypatch.setattr(_common, "ENV_FILE", dotenv)
    monkeypatch.setattr(_common, "ENV_EXAMPLE", example)

    path, created = _common.initialize_env_file()

    assert path == dotenv
    assert created is False
    assert dotenv.read_text(encoding="utf-8") == "LING_UI_DESIGN_API_KEY=keep-me\n"


def test_installer_maps_project_and_user_scopes(tmp_path: Path) -> None:
    assert install.destination_for(
        "universal", "project", project_root=tmp_path
    ) == tmp_path / ".agents/skills/ling-ui-design"
    assert install.destination_for(
        "claude", "user", home=tmp_path
    ) == tmp_path / ".claude/skills/ling-ui-design"


def test_installer_links_without_overwriting(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "SKILL.md").write_text("skill", encoding="utf-8")
    (source / ".env.example").write_text("API_KEY=\n", encoding="utf-8")
    destination = tmp_path / "target" / "ling-ui-design"

    config, created = install.install(source, destination, "link")
    repeated_config, repeated = install.install(source, destination, "link")

    assert destination.resolve() == source
    assert config == source / ".env"
    assert config.read_text(encoding="utf-8") == "API_KEY=\n"
    assert created is True
    assert repeated_config == config
    assert repeated is False


def test_installer_copy_excludes_local_secrets(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "SKILL.md").write_text("skill", encoding="utf-8")
    (source / ".env.example").write_text("API_KEY=\n", encoding="utf-8")
    (source / ".env").write_text("API_KEY=secret\n", encoding="utf-8")
    (source / ".git").mkdir()
    destination = tmp_path / "copy" / "ling-ui-design"

    config, created = install.install(source, destination, "copy")

    assert created is True
    assert config == destination / ".env"
    assert config.read_text(encoding="utf-8") == "API_KEY=\n"
    assert not (destination / ".git").exists()


def test_installer_refuses_an_existing_destination(tmp_path: Path) -> None:
    source = tmp_path / "source"
    destination = tmp_path / "existing"
    source.mkdir()
    destination.mkdir()
    (source / "SKILL.md").write_text("skill", encoding="utf-8")

    with pytest.raises(ValueError, match="destination already exists"):
        install.install(source, destination, "copy")
