"""Optional detector metadata returned by the decomposition service."""
from __future__ import annotations

import json
import math
from typing import Any


CATEGORIES = ("Image", "Avatar", "BackgroundImage")


def normalize_assets(value: Any) -> dict[str, Any] | None:
    """Keep usable raster boxes only; absent/invalid metadata means alpha fallback."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, RecursionError):
            return None
    if not isinstance(value, dict):
        return None
    canvas, regions = value.get("canvas"), value.get("regions")
    if (
        not isinstance(canvas, list)
        or len(canvas) != 2
        or any(type(side) is not int or side <= 0 for side in canvas)
        or not isinstance(regions, list)
    ):
        return None
    boxes: dict[tuple[float, ...], dict[str, Any]] = {}
    for region in regions:
        if not isinstance(region, dict) or region.get("category") not in CATEGORIES:
            continue
        box = region.get("bbox")
        if (
            not isinstance(box, list)
            or len(box) != 4
            or any(type(v) not in (int, float) or (isinstance(v, float) and not math.isfinite(v)) for v in box)
        ):
            continue
        left, top, right, bottom = box
        if not (0 <= left < right <= canvas[0] and 0 <= top < bottom <= canvas[1]):
            continue
        key = tuple(box)
        category = region["category"]
        previous = boxes.get(key)
        if previous is None or CATEGORIES.index(category) > CATEGORIES.index(previous["category"]):
            boxes[key] = {"category": category, "bbox": list(box)}
    return {"canvas": list(canvas), "regions": list(boxes.values())} if boxes else None


def response_assets(body: dict[str, Any]) -> dict[str, Any] | None:
    # This response schema carries detector metadata in revised_prompt.
    data = body.get("data")
    if not isinstance(data, list):
        return None
    for item in data:
        if isinstance(item, dict):
            assets = normalize_assets(item.get("revised_prompt"))
            if assets:
                return assets
    return None
