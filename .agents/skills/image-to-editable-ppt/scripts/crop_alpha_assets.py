#!/usr/bin/env python3
"""Physically crop transparent PNG assets and emit their source-coordinate boxes."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Crop one alpha-bounded asset, a horizontal row, or explicit source boxes. "
            "Outputs RGBA PNG files and manifest.json with source-pixel boxes."
        )
    )
    parser.add_argument("--image", required=True, type=Path, help="Source RGBA image")
    parser.add_argument("--output-dir", required=True, type=Path, help="Directory for crops")
    parser.add_argument("--mode", choices=("bbox", "x-groups"), default="bbox")
    parser.add_argument(
        "--box",
        action="append",
        default=[],
        metavar="L,T,R,B",
        help="Explicit crop box in source pixels; repeat for multiple assets. Overrides --mode.",
    )
    parser.add_argument("--prefix", default="asset", help="Output filename prefix")
    parser.add_argument("--threshold", type=int, default=8, help="Visible alpha threshold, 0–254")
    parser.add_argument("--margin", type=int, default=4, help="Padding around each detected box")
    parser.add_argument(
        "--max-column-gap",
        type=int,
        default=8,
        help="In x-groups mode, merge visible column runs separated by at most this many pixels",
    )
    parser.add_argument(
        "--min-alpha-pixels",
        type=int,
        default=20,
        help="Ignore x-groups with fewer visible pixels than this",
    )
    parser.add_argument("--expected-count", type=int, help="Fail unless this many crops are detected")
    return parser.parse_args()


def parse_box(value: str, width: int, height: int) -> tuple[int, int, int, int]:
    try:
        left, top, right, bottom = [int(round(float(part.strip()))) for part in value.split(",")]
    except (TypeError, ValueError):
        raise ValueError(f"Invalid --box {value!r}; expected left,top,right,bottom")
    left, top = max(0, left), max(0, top)
    right, bottom = min(width, right), min(height, bottom)
    if right <= left or bottom <= top:
        raise ValueError(f"Empty --box after clipping: {value!r}")
    return left, top, right, bottom


def padded_box(mask: np.ndarray, margin: int, x_bounds: tuple[int, int] | None = None) -> tuple[int, int, int, int]:
    height, width = mask.shape
    if x_bounds is None:
        x0, x1 = 0, width
    else:
        x0, x1 = x_bounds
    ys, xs = np.where(mask[:, x0:x1])
    if xs.size == 0:
        raise ValueError("No visible pixels found")
    left = max(0, x0 + int(xs.min()) - margin)
    top = max(0, int(ys.min()) - margin)
    right = min(width, x0 + int(xs.max()) + 1 + margin)
    bottom = min(height, int(ys.max()) + 1 + margin)
    return left, top, right, bottom


def column_groups(mask: np.ndarray, max_gap: int, min_pixels: int) -> list[tuple[int, int]]:
    active = np.flatnonzero(mask.any(axis=0))
    if active.size == 0:
        return []

    groups: list[tuple[int, int]] = []
    start = previous = int(active[0])
    for value in active[1:]:
        x = int(value)
        if x - previous - 1 > max_gap:
            groups.append((start, previous + 1))
            start = x
        previous = x
    groups.append((start, previous + 1))

    return [(left, right) for left, right in groups if int(mask[:, left:right].sum()) >= min_pixels]


def main() -> None:
    args = parse_args()
    if not 0 <= args.threshold <= 254:
        raise SystemExit("--threshold must be between 0 and 254")
    if args.margin < 0:
        raise SystemExit("--margin must be non-negative")

    image = Image.open(args.image).convert("RGBA")
    alpha = np.asarray(image.getchannel("A"))
    mask = alpha > args.threshold

    if args.box:
        boxes = [parse_box(value, image.width, image.height) for value in args.box]
        mode = "explicit"
    elif args.mode == "bbox":
        boxes = [padded_box(mask, args.margin)]
        mode = args.mode
    else:
        groups = column_groups(mask, args.max_column_gap, args.min_alpha_pixels)
        boxes = [padded_box(mask, args.margin, group) for group in groups]
        mode = args.mode

    if args.expected_count is not None and len(boxes) != args.expected_count:
        raise SystemExit(f"Expected {args.expected_count} crops, detected {len(boxes)}")
    if not boxes:
        raise SystemExit("No assets detected")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    assets = []
    for index, box in enumerate(boxes, start=1):
        suffix = "" if len(boxes) == 1 else f"_{index}"
        output = args.output_dir / f"{args.prefix}{suffix}.png"
        image.crop(box).save(output)
        assets.append(
            {
                "name": f"{args.prefix}{suffix}",
                "path": str(output.resolve()),
                "box": list(box),
                "size": [box[2] - box[0], box[3] - box[1]],
            }
        )

    manifest = {
        "source": str(args.image.resolve()),
        "source_size": [image.width, image.height],
        "threshold": args.threshold,
        "margin": args.margin,
        "mode": mode,
        "assets": assets,
    }
    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
