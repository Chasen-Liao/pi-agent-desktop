#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageStat

from _asset_regions import normalize_assets
from decompose_layers import DEFAULT_ROLES, EXTRACTABLE_ROLES
from refine_crop import (
    alpha_components,
    crop_asset,
    load_rgba,
    parse_box,
    report_crop,
    write_png,
)
from _common import artifact_path, resolve_source_size, scale_box


LAYER_FILE = re.compile(r"^layer_(\d+)\.png$")
CROP_FILE = re.compile(r"^(asset|image|background)_\d+\.png$")


@dataclass
class LayerCandidates:
    name: str
    role: str
    image: Image.Image
    min_area: int
    components: list[tuple[tuple[int, int, int, int], Image.Image]]


def appearance_similarity(
    candidate: Image.Image, reference_preview: Image.Image, alpha: Image.Image,
) -> float:
    """Compare low-resolution color only on the candidate's visible component."""
    preview = candidate.convert("RGB").resize((32, 32), Image.Resampling.BILINEAR)
    mask = alpha.resize((32, 32), Image.Resampling.NEAREST).point([0] * 8 + [255] * 248)
    if not mask.getbbox():
        return 0.0
    difference = ImageStat.Stat(ImageChops.difference(preview, reference_preview), mask)
    return 1.0 - sum(difference.mean) / (3 * 255)


def detected_candidates(
    assets: dict[str, Any] | None,
    layers: list[LayerCandidates],
    *,
    reference: Image.Image | None = None,
) -> list[tuple[LayerCandidates, tuple[int, int, int, int], Image.Image]]:
    """Rank layer crops by alpha overlap with optional reference appearance support."""
    assets = normalize_assets(assets)
    if not assets:
        return []
    # Cache component masks once. A frame has less visible support than a photograph
    # with the same bounding rectangle; a full canvas must not win every small box.
    masks = [
        (layer, bounds, alpha, sum(alpha.histogram()[8:]))
        for layer in layers if layer.role != "text"
        for bounds, crop in layer.components
        for alpha in [crop.getchannel("A")]
    ]
    selected: list[tuple[LayerCandidates, tuple[int, int, int, int], int]] = []
    for region in assets["regions"]:
        reference_preview = None
        if reference is not None:
            reference_box = scale_box(region["bbox"], assets["canvas"], reference.size)
            reference_preview = reference.crop(reference_box).convert("RGB").resize(
                (32, 32), Image.Resampling.BILINEAR
            )
        best = None
        best_rank = (0.0, False)
        for component_id, (layer, bounds, alpha, area) in enumerate(masks):
            box = scale_box(region["bbox"], assets["canvas"], layer.image.size)
            relative = (box[0] - bounds[0], box[1] - bounds[1],
                        box[2] - bounds[0], box[3] - bounds[1])
            overlap_alpha = alpha.crop(relative)
            intersection = sum(overlap_alpha.histogram()[8:])
            if intersection < layer.min_area:
                continue
            box_area = (box[2] - box[0]) * (box[3] - box[1])
            score = intersection / (area + box_area - intersection)
            if reference_preview is not None:
                similarity = appearance_similarity(layer.image.crop(box), reference_preview, overlap_alpha)
                # Bounded support, not an exact-pixel gate: occlusion and completion
                # change appearance. Geometry retains at least half its weight.
                score *= 0.5 + 0.5 * similarity
            rank = (score, layer.role == "image")
            if rank > best_rank:
                best_rank = rank
                best = (layer, box, component_id)
        if best is not None:
            selected.append(best)
    results = []
    seen = set()
    for layer, box, component_id in selected:
        # Nested boxes assigned to the same component do not establish two assets.
        # E.g. an avatar box must not cut a face-sized patch out of a recovered hero.
        if any(
            other_id == component_id and other != box
            and other[0] <= box[0] and other[1] <= box[1]
            and other[2] >= box[2] and other[3] >= box[3]
            for _, other, other_id in selected
        ):
            continue
        identity = (layer.name, box)
        if identity not in seen:
            seen.add(identity)
            # Crop the original RGBA layer: preserve disconnected parts, exact pixels
            # and alpha. Do not expand the detector box or crop the reference page.
            results.append((layer, box, layer.image.crop(box)))
    return results


def default_min_area(width: int, height: int) -> int:
    return max(64, (width * height) // 10_000)


def redundant_with_component(
    box: tuple[int, int, int, int],
    crop: Image.Image,
    bounds: tuple[int, int, int, int],
    component: Image.Image,
) -> bool:
    """Require near-identical geometry and coverage of effective alpha pixels."""
    width, height = box[2] - box[0], box[3] - box[1]
    cw, ch = bounds[2] - bounds[0], bounds[3] - bounds[1]
    if min(width, height, cw, ch) <= 0:
        return False
    tolerances = (min(width, cw) * 0.02, min(height, ch) * 0.02) * 2
    if any(abs(a - b) > tolerance for a, b, tolerance in zip(box, bounds, tolerances)):
        return False
    intersection = max(0, min(box[2], bounds[2]) - max(box[0], bounds[0])) * max(
        0, min(box[3], bounds[3]) - max(box[1], bounds[1])
    )
    if intersection / (width * height + cw * ch - intersection) < 0.95:
        return False
    visible = crop.getchannel("A").point([0] * 8 + [255] * 248)
    support = Image.new("L", crop.size)
    support.paste(component.getchannel("A").point([0] + [255] * 255),
                  (bounds[0] - box[0], bounds[1] - box[1]))
    return ImageChops.subtract(visible, support).getbbox() is None


def load_manifest(directory: Path) -> dict[str, Any]:
    path = directory / "manifest.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise SystemExit(f"error: invalid layer manifest: {path}") from exc
    if not isinstance(data, dict):
        raise SystemExit(f"error: invalid layer manifest: {path}")
    return data


def layer_entries(directory: Path, manifest: dict[str, Any]) -> list[dict[str, str]]:
    listed = manifest.get("layers")
    if isinstance(listed, list) and listed:
        entries: list[dict[str, str]] = []
        for item in listed:
            if not isinstance(item, dict) or not isinstance(item.get("file"), str):
                raise SystemExit(f"error: invalid layer entry in {directory / 'manifest.json'}")
            entry = {"file": item["file"]}
            if isinstance(item.get("role"), str):
                entry["role"] = item["role"]
            entries.append(entry)
        return entries
    names = sorted(path.name for path in directory.glob("layer_*.png") if path.is_file())
    if not names:
        raise SystemExit(f"error: no layer_*.png files in {directory}")
    return [{"file": name} for name in names]


def assign_roles(entries: list[dict[str, str]]) -> list[dict[str, str]]:
    if all("role" in item for item in entries):
        return entries
    names = [item["file"] for item in entries]
    matches = [LAYER_FILE.fullmatch(name) for name in names]
    if (
        len(entries) == len(DEFAULT_ROLES)
        and all(matches)
        and {int(match.group(1)) for match in matches if match} == set(range(len(DEFAULT_ROLES)))
    ):
        by_index = dict(enumerate(DEFAULT_ROLES))
        for item in entries:
            match = LAYER_FILE.fullmatch(item["file"])
            if match:
                item["role"] = by_index[int(match.group(1))]
        return entries
    raise SystemExit(
        "error: layer roles are unknown. Default 4-layer decompose writes "
        "text/image/container/background into manifest.json. Re-run decompose "
        "or pass only a default 4-layer folder."
    )


def extractable_layers(
    directory: Path,
    entries: list[dict[str, str]],
    roles: tuple[str, ...],
) -> list[tuple[str, str, Path]]:
    wanted = set(roles)
    selected: list[tuple[str, str, Path]] = []
    for item in entries:
        role = item.get("role", "")
        if role not in wanted:
            continue
        path = directory / item["file"]
        if not path.is_file():
            raise SystemExit(f"error: layer listed in manifest is missing: {path}")
        selected.append((item["file"], role, path))
    if not selected:
        raise SystemExit(
            "error: no image or background layer to extract. "
            "Asset extraction skips text and container layers."
        )
    return selected


def clear_previous_crops(output_dir: Path) -> None:
    for path in output_dir.iterdir():
        if path.is_file() and (CROP_FILE.fullmatch(path.name) or path.name == "manifest.json"):
            path.unlink()


def placement_hints(
    box: tuple[int, int, int, int],
    canvas_size: tuple[int, int],
) -> dict[str, Any]:
    left, top, right, bottom = box
    canvas_w, canvas_h = canvas_size
    width = right - left
    height = bottom - top
    width_fraction = width / max(canvas_w, 1)
    height_fraction = height / max(canvas_h, 1)
    aspect_ratio = round(width / max(height, 1), 3)
    merged_strip = width_fraction >= 0.6 and aspect_ratio >= 2.5
    return {
        "canvas": f"{canvas_w}x{canvas_h}",
        "aspect_ratio": aspect_ratio,
        "width_fraction": round(width_fraction, 3),
        "height_fraction": round(height_fraction, 3),
        "review": merged_strip,
        "review_reason": (
            "wide strip; likely multiple reference slots merged into one alpha component"
            if merged_strip
            else None
        ),
    }


def extract_from_layers(
    directory: Path,
    output_dir: Path,
    *,
    roles: tuple[str, ...] = EXTRACTABLE_ROLES,
    min_area: int | None = None,
) -> list[dict[str, Any]]:
    output_dir = artifact_path(output_dir)
    if not directory.is_dir():
        raise SystemExit(f"error: layer directory not found: {directory}")
    manifest = load_manifest(directory)
    entries = assign_roles(layer_entries(directory, manifest))
    assets = normalize_assets(manifest.get("assets"))
    source_roles = roles
    if assets and roles == EXTRACTABLE_ROLES:
        # Detector-located rasters can be misplaced on the container layer by PE.
        # This does not enable generic container/text component extraction.
        source_roles = (*roles, "container")
    layers = extractable_layers(directory, entries, source_roles)
    prepared = []
    for layer_name, role, path in layers:
        image = load_rgba(path)
        area = min_area if min_area is not None else default_min_area(*image.size)
        prepared.append(LayerCandidates(
            layer_name, role, image, area, alpha_components(image, min_area=area)
        ))
    reference = None
    source = manifest.get("source")
    if assets and isinstance(source, str):
        try:
            reference = load_rgba(source)
        except (OSError, ValueError, SystemExit):
            print("[crop_elements] Reference unavailable; using geometry-only layer matching.")
    candidates = detected_candidates(assets, prepared, reference=reference)
    matched_background = False
    if assets:
        matched_background = any(
            region["category"] == "BackgroundImage" and any(
                box == scale_box(region["bbox"], assets["canvas"], layer.image.size)
                for layer, box, _ in candidates
            )
            for region in assets["regions"]
        )
    alpha_candidates = [
        # Components locate bounds; their isolation masks must not erase interior pixels.
        (layer, box, layer.image.crop(box))
        for layer in prepared if layer.role in roles
        if not (matched_background and layer.role == "background")
        for box, _ in layer.components
    ]
    candidates = [
        (layer, box, crop) for layer, box, crop in candidates
        if not any(
            layer.name == other.name and redundant_with_component(box, crop, bounds, component)
            for other, bounds, component in alpha_candidates
        )
    ]
    detector_boxes = {(layer.name, box) for layer, box, _ in candidates}
    candidates.extend(alpha_candidates)
    output_dir.mkdir(parents=True, exist_ok=True)
    clear_previous_crops(output_dir)
    files: list[dict[str, Any]] = []
    for index, (layer, box, crop) in enumerate(candidates):
        layer_name, image = layer.name, layer.image
        filename = f"asset_{index:02d}.png"
        write_png(crop, output_dir / filename)
        item: dict[str, Any] = {
            "file": filename,
            "source_role": layer.role,
            "method": "ir" if (layer_name, box) in detector_boxes else "alpha",
            "layer": layer_name,
            "bbox": list(box),
            "size": f"{crop.width}x{crop.height}",
        }
        item.update(placement_hints(box, image.size))
        files.append(item)
        review = "  review: split or recrop" if item.get("review") else ""
        print(
            f"[crop_elements] {filename}  {crop.width}x{crop.height}  "
            f"bbox {','.join(map(str, box))}  from {layer_name} (source role: {layer.role}){review}"
        )
    if not files:
        raise SystemExit("error: no reusable raster component found on image or background layers")
    record = {
        "layers": str(directory),
        "roles": list(roles),
        "files": files,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"[crop_elements] OK -> {output_dir} ({len(files)} crops)")
    print("[crop_elements] Inspect each selected crop before using it.")
    print("[crop_elements] Generic text and container components were skipped by default.")
    if any(item.get("review") for item in files):
        print(
            "[crop_elements] Some crops are wide strips (review=true). "
            "If a crop spans multiple reference slots, split it with "
            "crop_elements.py --image --box --from-image before implementation."
        )
    return files


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description=(
            "Extract reusable rasters from decomposed image and background layers. "
            "Uses optional service boxes and connected alpha components."
        )
    )
    result.add_argument(
        "--layers",
        help="decompose output directory (preferred); extracts reusable raster candidates",
    )
    result.add_argument("--outdir", help="directory for auto-extracted crops")
    result.add_argument("--image", help="one layer PNG; requires --box and --out")
    result.add_argument("--out", help="one output PNG for manual --box mode")
    result.add_argument(
        "--box",
        type=parse_box,
        help="manual left,top,right,bottom on the original/reference",
    )
    result.add_argument("--from-image", help="original or reference the box was measured on")
    result.add_argument("--from-size", help="WIDTHxHEIGHT of that original/reference")
    result.add_argument(
        "--from-manifest",
        help="decompose manifest.json; uses its source_size as the box canvas",
    )
    result.add_argument(
        "--roles",
        default=",".join(EXTRACTABLE_ROLES),
        help="comma-separated layer roles to extract (default: image,background)",
    )
    result.add_argument("--min-area", type=int, help="ignore smaller alpha components")
    result.add_argument("--trim-alpha", action="store_true")
    result.add_argument("--keep-largest-alpha", action="store_true")
    return result


def parse_roles(value: str) -> tuple[str, ...]:
    roles = tuple(part.strip() for part in value.split(",") if part.strip())
    unknown = [role for role in roles if role not in DEFAULT_ROLES]
    if not roles or unknown:
        raise SystemExit(
            "error: --roles must be a subset of text,image,container,background"
        )
    return roles


def run_manual(args: argparse.Namespace) -> None:
    if not args.out or not args.box:
        raise SystemExit("error: --image mode requires --box and --out")
    source_size = resolve_source_size(
        from_image=args.from_image,
        from_size=args.from_size,
        from_manifest=args.from_manifest,
        required=True,
    )
    image = load_rgba(args.image)
    layer_size = image.size
    image, mapped = crop_asset(
        image,
        box=args.box,
        source_size=source_size,
        trim=args.trim_alpha,
        keep_largest_alpha=args.keep_largest_alpha,
    )
    output = write_png(image, args.out)
    report_crop(
        "crop_elements",
        output,
        image,
        box=args.box,
        mapped=mapped,
        source_size=source_size,
        layer_size=layer_size,
    )


def main() -> None:
    args = parser().parse_args()
    if args.layers:
        if args.image or args.box or args.out:
            raise SystemExit("error: --layers cannot be combined with --image/--box/--out")
        if not args.outdir:
            raise SystemExit("error: --layers requires --outdir")
        extract_from_layers(
            Path(args.layers),
            Path(args.outdir),
            roles=parse_roles(args.roles),
            min_area=args.min_area,
        )
        return
    if args.image:
        run_manual(args)
        return
    raise SystemExit(
        "error: preferred usage is --layers <decompose-dir> --outdir <crops-dir>"
    )


if __name__ == "__main__":
    main()
