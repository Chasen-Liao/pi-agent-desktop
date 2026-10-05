#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from _asset_regions import normalize_assets, response_assets
from _common import (
    DEFAULT_API_BASE,
    artifact_path,
    env,
    format_size,
    image_data_url,
    image_items,
    image_pixel_size,
    item_bytes,
    post_json,
    require_env,
    validate_image_bytes,
)


DEFAULT_MODEL = "ming-image-0.1-design-layer"
DEFAULT_SIZE = "auto"
DEFAULT_ROLES = ("text", "image", "container", "background")
EXTRACTABLE_ROLES = ("image", "background")
DEFAULT_PROMPT = """Decompose this image into 4 layers with the following specifications:

Number of layers: 4
Preserve the source composition and geometry exactly. Keep reusable photographs and illustrations high-detail with clean boundaries; do not resize, reposition, blur, or simplify them.
Layer 1 (text): All designed overlay text.
Layer 2 (image): All photographs and illustrations, complete and text-free, including pictures that appear inside cards.
Layer 3 (container): Empty UI chrome: navigation bars, buttons, badges, ribbons, colored section banners, and empty card or panel frames. Keep their colors and shapes. Do not include photographs.
Layer 4 (background): Remaining empty page canvas only. No photographs. No overlay text."""


def selected_prompt(args: argparse.Namespace) -> str:
    if args.prompt_file:
        prompt = Path(args.prompt_file).read_text(encoding="utf-8").strip()
        if not prompt:
            raise SystemExit("error: prompt file is empty")
        return prompt
    if args.layers == 4:
        return DEFAULT_PROMPT
    return f"""Decompose this image into {args.layers} layers with the following specifications:

Number of layers: {args.layers}
Preserve the source composition and geometry exactly. Keep reusable photographs and illustrations high-detail with clean boundaries; do not resize, reposition, blur, or simplify them.
""" + "\n".join(
        f"Layer {index}: A distinct front-to-back visual ownership group."
        for index in range(1, args.layers + 1)
    )


def layer_roles(count: int, *, fallback: bool = False) -> tuple[str, ...] | None:
    if count == len(DEFAULT_ROLES):
        return DEFAULT_ROLES
    if not fallback or count < 1:
        return None
    if count == 1:
        return ("image",)
    if count == 2:
        return ("image", "background")
    if count == 3:
        return ("text", "image", "background")
    return ("text", *(("image",) * (count - 3)), "container", "background")


def layer_file_entries(
    output_dir: Path,
    names: list[str],
    roles: tuple[str, ...] | None = None,
) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    for index, name in enumerate(names):
        item = {"file": name, "size": format_size(*image_pixel_size(output_dir / name))}
        if roles and index < len(roles):
            item["role"] = roles[index]
        entries.append(item)
    return entries


def clear_previous_outputs(output_dir: Path) -> None:
    for path in output_dir.glob("layer_*.png"):
        if path.is_file():
            path.unlink()
    manifest = output_dir / "manifest.json"
    if manifest.is_file():
        manifest.unlink()


def validate_layers(layer_data: list[bytes], expected: int) -> None:
    if not layer_data:
        raise SystemExit("error: service returned no layers")
    for index, raw in enumerate(layer_data):
        validate_image_bytes(raw, label=f"layer {index + 1}")
    if len(layer_data) != expected:
        print(
            f"[decompose_layers] Warning: returned {len(layer_data)} layers; expected {expected}. "
            "Roles were inferred from layer order; crops may be inaccurate. Inspect before use."
        )


def build_manifest(
    *,
    source: str,
    source_size: str,
    requested_size: str,
    model: str,
    layers_requested: int,
    server_prompt_enhancement: bool,
    prompt: str,
    layers: list[dict[str, str]],
    assets: dict[str, Any] | None = None,
) -> dict[str, Any]:
    files = [item["file"] for item in layers]
    sizes = {item["size"] for item in layers}
    manifest: dict[str, Any] = {
        "source": source,
        "source_size": source_size,
        "requested_size": requested_size,
        "model": model,
        "layers_requested": layers_requested,
        "server_prompt_enhancement": server_prompt_enhancement,
        "prompt": prompt,
        "files": files,
        "layers": layers,
    }
    if len(sizes) == 1:
        manifest["size"] = next(iter(sizes))
    if len(layers) != layers_requested:
        manifest["roles_inferred"] = True
        manifest["layers_returned"] = len(layers)
    if any("role" in item for item in layers):
        manifest["extractable_roles"] = list(EXTRACTABLE_ROLES)
    assets = normalize_assets(assets)
    if assets:
        manifest["assets"] = assets
    return manifest


def build_payload(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "model": args.model,
        "prompt": selected_prompt(args),
        "size": args.size,
        "images": [{"image_url": image_data_url(args.image, args.resize)}],
        "output_format": "png",
        "response_format": "url",
        "watermark": True,
        "use_pe": not args.no_pe,
        "get_assets": True,
        "num_inference_steps": args.steps,
        "seed": args.seed,
        "num_layers": args.layers,
        "stream": False,
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Decompose one design image into layers.")
    result.add_argument("--image", required=True)
    result.add_argument("--outdir", required=True)
    result.add_argument("--layers", type=int, default=4)
    result.add_argument("--prompt-file")
    result.add_argument("--no-pe", action="store_true", help="prompt was already enhanced")
    result.add_argument("--resize", type=int, help="exceptional input downscale")
    result.add_argument(
        "--size",
        choices=("512", "1k", "2k", "auto"),
        default=env("LING_UI_DESIGN_DECOMPOSE_SIZE", DEFAULT_SIZE),
        help="target output resolution (default: auto)",
    )
    result.add_argument(
        "--steps", type=int, default=int(env("LING_UI_DESIGN_DECOMPOSE_STEPS", "14"))
    )
    result.add_argument(
        "--seed", type=int, default=int(env("LING_UI_DESIGN_DECOMPOSE_SEED", "42"))
    )
    result.add_argument(
        "--api-base", default=env("LING_UI_DESIGN_API_BASE", DEFAULT_API_BASE)
    )
    result.add_argument("--model", default=env("LING_UI_DESIGN_DECOMPOSE_MODEL", DEFAULT_MODEL))
    return result


def main() -> None:
    args = parser().parse_args()
    output_dir = artifact_path(args.outdir)
    if not 2 <= args.layers <= 7:
        raise SystemExit("error: --layers must be between 2 and 7")
    api_key = require_env("LING_UI_DESIGN_API_KEY")
    timeout = float(env("LING_UI_DESIGN_DECOMPOSE_TIMEOUT", "600"))
    payload = build_payload(args)
    started = time.perf_counter()
    body = post_json(
        f"{args.api_base.rstrip('/')}/images/edits",
        payload,
        timeout=timeout,
        api_key=api_key,
        multipart=True,
    )
    layer_data = [item_bytes(item, timeout) for item in image_items(body)]
    validate_layers(layer_data, args.layers)
    output_dir.mkdir(parents=True, exist_ok=True)
    clear_previous_outputs(output_dir)
    files: list[str] = []
    for index, raw in enumerate(layer_data):
        path = output_dir / f"layer_{index}.png"
        path.write_bytes(raw)
        files.append(path.name)
    source_path = Path(args.image).resolve()
    roles = layer_roles(len(files), fallback=len(files) != args.layers)
    manifest = build_manifest(
        source=str(source_path),
        source_size=format_size(*image_pixel_size(source_path)),
        requested_size=payload["size"],
        model=args.model,
        layers_requested=args.layers,
        server_prompt_enhancement=not args.no_pe,
        prompt=payload["prompt"],
        layers=layer_file_entries(output_dir, files, roles),
        assets=response_assets(body),
    )
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    elapsed = time.perf_counter() - started
    actual = manifest.get("size") or ", ".join(
        f"{item['file']} {item['size']}" for item in manifest["layers"]
    )
    print(
        f"[decompose_layers] OK in {elapsed:.1f}s -> {output_dir} "
        f"({len(files)} layers, {actual}; requested {payload['size']})"
    )
    print("[decompose_layers] Inspect every layer; review asset candidates before considering a retry.")
    print(
        f'[decompose_layers] Next: python "{Path(__file__).resolve().with_name("crop_elements.py")}" '
        f'--layers "{output_dir}" --outdir <crops-dir>'
    )


if __name__ == "__main__":
    main()
