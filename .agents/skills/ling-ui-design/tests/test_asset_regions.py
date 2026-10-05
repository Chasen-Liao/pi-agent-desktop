from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
from _asset_regions import normalize_assets, response_assets
from _common import image_data_url
from crop_elements import LayerCandidates, detected_candidates, extract_from_layers, redundant_with_component
from refine_crop import alpha_components


def regions(*boxes: tuple[str, list[int]]) -> dict:
    return {"canvas": [80, 40], "regions": [
        {"category": category, "bbox": box} for category, box in boxes
    ]}


def layer(name: str, role: str, boxes: list[tuple[int, int, int, int]]) -> LayerCandidates:
    image = Image.new("RGBA", (40, 20))
    for box in boxes:
        image.paste((20, 100, 200, 255), box)
    return LayerCandidates(name, role, image, 4, alpha_components(image, min_area=4))


def test_only_raster_metadata_is_saved_and_exact_boxes_are_deduplicated() -> None:
    data = regions(("Image", [2, 2, 10, 10]), ("Avatar", [2, 2, 10, 10]),
                   ("Text", [20, 2, 30, 10]), ("Icon", [32, 2, 38, 10]))
    data["token"] = "must-not-be-persisted"
    result = response_assets({"data": [{"revised_prompt": json.dumps(data)}]})
    assert result == regions(("Avatar", [2, 2, 10, 10]))


@pytest.mark.parametrize("value", [None, "enhanced natural language prompt", {},
    {"canvas": [80, 40], "regions": [{"category": "Image", "bbox": [-1, 0, 9, 9]}]},
    {"canvas": [80, 40], "regions": [{"category": "Image", "bbox": [0, 0, float('nan'), 9]}]},
    {"canvas": [80, 40], "regions": [{"category": "Image", "bbox": [0, 0, 10**400, 9]}]}])
def test_missing_or_invalid_metadata_is_optional(value: object) -> None:
    assert normalize_assets(value) is None
    assert response_assets({"data": 1}) is None


def test_boxes_scale_without_padding_and_recover_misplaced_raster() -> None:
    avatar = layer("layer_1.png", "container", [(2, 2, 8, 8)])
    photo = layer("layer_2.png", "image", [(15, 1, 35, 15)])
    text = layer("layer_0.png", "text", [(2, 2, 8, 8)])
    bg = layer("layer_3.png", "background", [(0, 0, 40, 20)])
    found = detected_candidates(regions(("Avatar", [4, 4, 16, 16]),
                                        ("Image", [32, 4, 64, 24])), [text, avatar, photo, bg])
    assert [(entry.name, box) for entry, box, _ in found] == [
        ("layer_1.png", (2, 2, 8, 8)), ("layer_2.png", (16, 2, 32, 12))]
    for entry, box, crop in found:
        assert crop.tobytes() == entry.image.crop(box).tobytes()


def test_nested_box_does_not_cut_avatar_from_same_hero_component() -> None:
    photo = layer("layer_2.png", "image", [(0, 0, 40, 20)])
    found = detected_candidates(regions(("BackgroundImage", [0, 0, 80, 40]),
                                        ("Avatar", [4, 4, 16, 16])), [photo])
    assert len(found) == 1
    assert found[0][1] == (0, 0, 40, 20)


def test_invalid_metadata_preserves_baseline_and_valid_metadata_keeps_unmatched_components(tmp_path: Path) -> None:
    inputs = tmp_path / "layers"
    inputs.mkdir()
    entries = [layer("layer_0.png", "text", []), layer("layer_1.png", "container", []),
               layer("layer_2.png", "image", [(1, 1, 10, 10), (20, 1, 30, 10)]),
               layer("layer_3.png", "background", [(0, 0, 40, 20)])]
    manifest: dict[str, Any] = {"layers": [{"file": item.name, "role": item.role} for item in entries]}
    for entry in entries:
        entry.image.save(inputs / entry.name)
    path = inputs / "manifest.json"
    path.write_text(json.dumps(manifest))
    baseline = extract_from_layers(inputs, tmp_path / "baseline", min_area=4)
    manifest["assets"] = {"canvas": [80, 40], "regions": "invalid"}
    path.write_text(json.dumps(manifest))
    fallback = extract_from_layers(inputs, tmp_path / "fallback", min_area=4)
    assert fallback == baseline
    for item in baseline:
        assert (tmp_path / "baseline" / item["file"]).read_bytes() == (tmp_path / "fallback" / item["file"]).read_bytes()
    manifest["assets"] = regions(("Image", [4, 4, 16, 16]))
    path.write_text(json.dumps(manifest))
    enriched = extract_from_layers(inputs, tmp_path / "enriched", min_area=4)
    assert len(enriched) == len(baseline) + 1
    assert {tuple(item["bbox"]) for item in baseline} <= {tuple(item["bbox"]) for item in enriched}


def test_non_image_file_cannot_be_uploaded(tmp_path: Path) -> None:
    source = tmp_path / "credentials.png"
    source.write_text("API_KEY=local-test-only")
    with pytest.raises(SystemExit, match="valid image") as error:
        image_data_url(str(source))
    assert "local-test-only" not in str(error.value)


@pytest.mark.parametrize("background_box,expected_backgrounds", [
    ([0, 0, 40, 20], 0),  # Matches the photo on the image layer.
    ([70, 30, 71, 31], 1),  # Too small to match; retain fallback.
    ([-1, 0, 40, 20], 1),  # Invalid service metadata; retain fallback.
])
def test_background_fallback_requires_no_matched_ir_background(
    tmp_path: Path, background_box: list[int], expected_backgrounds: int,
) -> None:
    inputs = tmp_path / "layers"
    inputs.mkdir()
    entries = [layer("layer_0.png", "text", []), layer("layer_1.png", "container", []),
               layer("layer_2.png", "image", [(0, 0, 20, 10), (25, 0, 35, 10)]),
               layer("layer_3.png", "background", [(0, 0, 40, 20)])]
    entries[3].image.paste((255, 255, 255, 255), (0, 0, 40, 20))
    for entry in entries:
        entry.image.save(inputs / entry.name)
    (inputs / "manifest.json").write_text(json.dumps({
        "layers": [{"file": entry.name, "role": entry.role} for entry in entries],
        "assets": regions(("BackgroundImage", background_box)),
    }))
    output = tmp_path / "crops"
    output.mkdir()
    for name in ("background_00.png", "image_00.png", "asset_99.png"):
        (output / name).write_bytes(b"stale candidate")
    (output / "hero.png").write_bytes(b"user-selected asset")

    result = extract_from_layers(inputs, output, min_area=4)

    assert sum(item["layer"] == "layer_3.png" for item in result) == expected_backgrounds
    assert any(item["bbox"] == [25, 0, 35, 10] for item in result)
    assert [item["file"] for item in result] == [f"asset_{i:02d}.png" for i in range(len(result))]
    assert not (output / "background_00.png").exists()
    assert not (output / "image_00.png").exists()
    assert not (output / "asset_99.png").exists()
    assert (output / "hero.png").read_bytes() == b"user-selected asset"


def test_reference_similarity_breaks_wrong_layer_tie_without_exporting_reference() -> None:
    wrong = layer("layer_2.png", "image", [(2, 2, 18, 18)])
    wrong.image.paste("white", (2, 2, 18, 18))
    correct = layer("layer_1.png", "container", [(2, 2, 18, 18)])
    reference = correct.image.copy()
    # Reference UI overlay must not appear in the exported layer asset.
    reference.paste("black", (4, 4, 8, 8))
    assets = regions(("Image", [4, 4, 36, 36]))
    assert detected_candidates(assets, [wrong, correct])[0][0].name == wrong.name
    found = detected_candidates(assets, [wrong, correct], reference=reference)
    assert found[0][0].name == correct.name
    assert found[0][2].tobytes() == correct.image.crop((2, 2, 18, 18)).tobytes()
    assert found[0][2].tobytes() != reference.crop((2, 2, 18, 18)).tobytes()


def test_similarity_does_not_override_strong_geometry_with_unrelated_background() -> None:
    subject = layer("layer_2.png", "image", [(2, 2, 8, 8)])
    subject.image.paste("blue", (2, 2, 8, 8))
    backdrop = layer("layer_3.png", "background", [(0, 0, 40, 20)])
    backdrop.image.paste("white", (0, 0, 40, 20))
    found = detected_candidates(regions(("Image", [4, 4, 16, 16])),
                                [subject, backdrop], reference=Image.new("RGB", (40, 20), "white"))
    assert found[0][0].name == subject.name


@pytest.mark.parametrize("reference_available", [True, False])
def test_extraction_reads_reference_for_scoring_only_and_tolerates_missing_file(
    tmp_path: Path, reference_available: bool,
) -> None:
    inputs = tmp_path / "layers"
    inputs.mkdir()
    wrong = layer("layer_2.png", "image", [(2, 2, 18, 18)])
    wrong.image.paste("white", (2, 2, 18, 18))
    correct = layer("layer_1.png", "container", [(2, 2, 18, 18)])
    source = tmp_path / "reference.png"
    if reference_available:
        reference = correct.image.copy()
        reference.paste("black", (4, 4, 8, 8))
        reference.save(source)
    for entry in [wrong, correct]:
        entry.image.save(inputs / entry.name)
    (inputs / "manifest.json").write_text(json.dumps({
        "source": str(source),
        "layers": [{"file": entry.name, "role": entry.role} for entry in [wrong, correct]],
        "assets": regions(("Image", [4, 4, 36, 36])),
    }))
    output = tmp_path / "crops"
    result = extract_from_layers(inputs, output, min_area=4)
    expected = correct if reference_available else wrong
    assert result[0]["layer"] == expected.name
    assert result[0]["source_role"] == expected.role
    assert result[0]["method"] == ("ir" if reference_available else "alpha")
    with Image.open(output / result[0]["file"]) as exported:
        assert exported.tobytes() == expected.image.crop((2, 2, 18, 18)).tobytes()


@pytest.mark.parametrize("ir_box,merge", [
    ((10, 10, 210, 210), True),
    ((11, 11, 209, 209), True),
    ((9, 9, 211, 211), True),
    ((13, 10, 210, 210), True),
    ((15, 10, 210, 210), False),
    ((7, 7, 213, 213), False),
    ((50, 50, 170, 170), False),
    ((200, 10, 400, 210), False),
])
def test_near_duplicate_geometry_is_strict(ir_box: tuple[int, int, int, int], merge: bool) -> None:
    image = Image.new("RGBA", (420, 240))
    bounds = (10, 10, 210, 210)
    image.paste("black", bounds)
    assert redundant_with_component(ir_box, image.crop(ir_box), bounds, image.crop(bounds)) is merge


@pytest.mark.parametrize("alpha,merge", [(1, True), (4, True), (7, True), (8, False), (255, False)])
def test_near_duplicate_faint_outer_fringe(alpha: int, merge: bool) -> None:
    image = Image.new("RGBA", (202, 202), (0, 0, 0, alpha))
    image.paste("black", (1, 1, 201, 201))
    assert redundant_with_component(
        (0, 0, 202, 202), image, (1, 1, 201, 201), image.crop((1, 1, 201, 201))
    ) is merge


def test_near_duplicate_does_not_drop_extra_visible_content() -> None:
    component = Image.new("RGBA", (200, 200), "black")
    larger = Image.new("RGBA", (202, 202), "red")
    assert not redundant_with_component((9, 9, 211, 211), larger, (10, 10, 210, 210), component)
    # Matching rectangles alone cannot equate a frame with its enclosed picture.
    hollow = component.copy()
    hollow.paste((0, 0, 0, 0), (20, 20, 180, 180))
    assert not redundant_with_component((10, 10, 210, 210), component, (10, 10, 210, 210), hollow)


def test_alpha_export_preserves_dark_disconnected_and_faint_internal_pixels(tmp_path: Path) -> None:
    inputs = tmp_path / "layers"
    inputs.mkdir()
    image = Image.new("RGBA", (40, 40))
    image.paste("black", (5, 5, 35, 35))
    image.paste((0, 0, 0, 0), (10, 10, 30, 30))
    image.paste("black", (15, 15, 25, 25))
    image.putpixel((12, 12), (20, 30, 40, 4))
    image.save(inputs / "layer_2.png")
    (inputs / "manifest.json").write_text(json.dumps({
        "layers": [{"file": "layer_2.png", "role": "image"}],
    }))
    output = tmp_path / "crops"
    files = extract_from_layers(inputs, output, min_area=4)
    outer = next(item for item in files if item["bbox"] == [5, 5, 35, 35])
    with Image.open(output / outer["file"]) as crop:
        assert crop.tobytes() == image.crop((5, 5, 35, 35)).tobytes()
        assert crop.getpixel((10, 10)) == (0, 0, 0, 255)
        assert crop.getpixel((7, 7)) == (20, 30, 40, 4)
        assert crop.getchannel("A").getpixel((6, 6)) == 0  # No invented upstream pixels.


def test_ir_alpha_merge_retains_alpha_pixels_unmatched_and_other_layers(tmp_path: Path) -> None:
    inputs = tmp_path / "layers"
    inputs.mkdir()
    image = Image.new("RGBA", (400, 240))
    image.paste("black", (10, 10, 210, 210))
    image.paste("red", (300, 10, 320, 30))
    for name in ("layer_2.png", "layer_3.png"):
        image.save(inputs / name)
    (inputs / "manifest.json").write_text(json.dumps({
        "layers": [{"file": "layer_2.png", "role": "image"},
                   {"file": "layer_3.png", "role": "background"}],
        "assets": {"canvas": [400, 240], "regions": [
            {"category": "Image", "bbox": [11, 11, 209, 209]},
            {"category": "Image", "bbox": [9, 9, 211, 211]},
        ]},
    }))
    output = tmp_path / "crops"
    files = extract_from_layers(inputs, output, min_area=4)
    assert len(files) == 4
    assert all(item["method"] == "alpha" for item in files)
    assert {item["layer"] for item in files} == {"layer_2.png", "layer_3.png"}
    for item in files:
        with Image.open(output / item["file"]) as crop:
            assert crop.tobytes() == image.crop(tuple(item["bbox"])).tobytes()
