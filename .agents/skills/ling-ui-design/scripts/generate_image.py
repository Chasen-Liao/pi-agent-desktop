#!/usr/bin/env python3
from __future__ import annotations

import argparse
import time
from typing import Any

from _common import (
    DEFAULT_API_BASE,
    artifact_path,
    env,
    image_items,
    item_bytes,
    post_json,
    require_env,
    validate_image_bytes,
)


DEFAULT_MODEL = "ming-image-0.1-design"


def build_payload(args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    output_format = "jpeg" if args.format == "jpg" else args.format
    return "images/generations", {
        "model": args.model,
        "prompt": args.prompt,
        "output_format": output_format,
        "response_format": "b64_json",
        "enable_thinking": True,
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Generate a raster image from a text prompt.")
    result.add_argument("--prompt", required=True)
    result.add_argument("--out", required=True)
    result.add_argument("--format", choices=("jpg", "jpeg", "png", "webp"), default="jpeg")
    result.add_argument("--api-base", default=env("LING_UI_DESIGN_API_BASE", DEFAULT_API_BASE))
    result.add_argument("--model", default=env("LING_UI_DESIGN_IMAGE_MODEL", DEFAULT_MODEL))
    return result


def main() -> None:
    args = parser().parse_args()
    output = artifact_path(args.out)
    api_key = require_env("LING_UI_DESIGN_API_KEY")
    route, payload = build_payload(args)
    timeout = float(env("LING_UI_DESIGN_IMAGE_TIMEOUT", "600"))
    started = time.perf_counter()
    body = post_json(
        f"{args.api_base.rstrip('/')}/{route}",
        payload,
        timeout=timeout,
        api_key=api_key,
    )
    raw = item_bytes(image_items(body)[0], timeout)
    validate_image_bytes(raw, label="generated image")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(raw)
    elapsed = time.perf_counter() - started
    print(f"[generate_image] OK in {elapsed:.1f}s -> {output} ({len(raw)} bytes)")
    print("[generate_image] Inspect the page reference; do not rerun it to fix copy.")


if __name__ == "__main__":
    main()
