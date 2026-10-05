from __future__ import annotations

import sys
import base64
import io
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import _common
import capture_page
import crop_elements
import decompose_layers
import generate_image
import refine_crop


@pytest.mark.parametrize("kind", ["generate", "decompose", "crop", "refine", "capture"])
def test_helpers_reject_skill_output_before_work(
    kind: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    skill = tmp_path / "skill"
    skill.mkdir()
    marker = skill / "manifest.json"
    marker.write_text("preserve")
    monkeypatch.setattr(_common, "SKILL_ROOT", skill)
    monkeypatch.chdir(skill)
    output = "artifacts/out.png"
    with pytest.raises(SystemExit, match="outside the skill directory"):
        if kind == "generate":
            monkeypatch.setattr(sys, "argv", ["generate_image.py", "--prompt", "test", "--out", output])
            monkeypatch.setattr(generate_image, "require_env", lambda _: pytest.fail("key lookup before output validation"))
            generate_image.main()
        elif kind == "decompose":
            monkeypatch.setattr(sys, "argv", ["decompose_layers.py", "--image", "missing.png", "--outdir", "."])
            monkeypatch.setattr(decompose_layers, "require_env", lambda _: pytest.fail("key lookup before output validation"))
            decompose_layers.main()
        elif kind == "crop":
            crop_elements.extract_from_layers(tmp_path / "missing", skill)
        elif kind == "refine":
            refine_crop.write_png(Image.new("RGBA", (4, 4)), output)
        else:
            monkeypatch.setattr(sys, "argv", ["capture_page.py", "--url", "http://localhost", "--outdir", "."])
            capture_page.main()
    assert marker.read_text() == "preserve"
    assert not (skill / "artifacts").exists()


def test_symlink_alias_cannot_redirect_outputs_into_skill(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill = tmp_path / "skill"
    skill.mkdir()
    alias = tmp_path / "alias"
    try:
        alias.symlink_to(skill, target_is_directory=True)
    except OSError:
        pytest.skip("symlinks unavailable")
    monkeypatch.setattr(_common, "SKILL_ROOT", skill)
    with pytest.raises(SystemExit, match="outside the skill directory"):
        refine_crop.write_png(Image.new("RGBA", (4, 4)), alias / "asset.png")
    assert not (skill / "asset.png").exists()


def test_project_assets_remain_writable_for_project_scoped_install(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    project = tmp_path / "app"
    skill = project / ".agents/skills/ling-ui-design"
    skill.mkdir(parents=True)
    monkeypatch.setattr(_common, "SKILL_ROOT", skill)
    monkeypatch.chdir(project)
    output = refine_crop.write_png(Image.new("RGBA", (4, 4), "red"), "assets/hero.png")
    with Image.open(output) as image:
        assert image.size == (4, 4)
        assert image.getpixel((0, 0)) == (255, 0, 0, 255)
    assert not (skill / "assets").exists()


@pytest.mark.parametrize("kind", ["generate", "decompose"])
def test_api_helpers_write_results_in_target_app(
    kind: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    skill = tmp_path / "skill"
    project = tmp_path / "app"
    skill.mkdir()
    project.mkdir()
    monkeypatch.setattr(_common, "SKILL_ROOT", skill)
    monkeypatch.chdir(project)
    source = project / "reference.png"
    Image.new("RGBA", (4, 4), "red").save(source)
    buffer = io.BytesIO()
    Image.new("RGBA", (4, 4), "blue").save(buffer, "PNG")
    item = {"b64_json": base64.b64encode(buffer.getvalue()).decode()}
    module = generate_image if kind == "generate" else decompose_layers
    monkeypatch.setattr(module, "require_env", lambda _: "test-only")
    monkeypatch.setattr(module, "post_json", lambda *a, **kw: {"data": [item] * (1 if kind == "generate" else 4)})
    if kind == "generate":
        monkeypatch.setattr(sys, "argv", ["generate_image.py", "--prompt", "test", "--out", "artifacts/reference.png"])
        generate_image.main()
        with Image.open(project / "artifacts/reference.png") as image:
            assert image.size == (4, 4)
    else:
        monkeypatch.setattr(sys, "argv", ["decompose_layers.py", "--image", str(source), "--outdir", "artifacts/layers"])
        decompose_layers.main()
        crops = crop_elements.extract_from_layers(project / "artifacts/layers", project / "artifacts/crops", min_area=4)
        assert len(crops) == 2
        assert (project / "artifacts/layers/manifest.json").is_file()
        assert (project / "artifacts/crops/manifest.json").is_file()
    assert list(skill.iterdir()) == []
