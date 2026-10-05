#!/usr/bin/env python3
"""Scene DOM validation and compilation for the img2ppt fast path.

The reasoning boundary is ``scene.json`` in source-image pixel coordinates.
This module turns that DOM into the compact inch-based spec consumed by
``pptx_native.py``.  It deliberately has no model or network dependency.
"""

from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path
from typing import Any, Iterable


SUPPORTED_NODE_TYPES = {"group", "image", "shape", "text"}
HEX_RE = re.compile(r"^[0-9A-Fa-f]{6}$")


class SceneError(ValueError):
    pass


def load_scene(path: str | os.PathLike) -> dict[str, Any]:
    with open(path, encoding="utf-8") as handle:
        scene = json.load(handle)
    if not isinstance(scene, dict):
        raise SceneError("scene root must be an object")
    return scene


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SceneError(f"{label} must be a number")
    value = float(value)
    if not math.isfinite(value):
        raise SceneError(f"{label} must be finite")
    return value


def _canvas(scene: dict[str, Any]) -> tuple[float, float]:
    canvas = scene.get("canvas") or {}
    width = _number(canvas.get("width"), "canvas.width")
    height = _number(canvas.get("height"), "canvas.height")
    if width <= 0 or height <= 0:
        raise SceneError("canvas dimensions must be positive")
    return width, height


def normalize_hex(value: Any, default: str = "000000") -> str:
    if value is None:
        return default
    if isinstance(value, (list, tuple)) and len(value) >= 3:
        try:
            return "".join(f"{max(0, min(255, int(round(float(x))))):02X}" for x in value[:3])
        except (TypeError, ValueError):
            return default
    text = str(value).strip().lstrip("#")
    if len(text) == 8:
        text = text[:6]
    if len(text) == 3 and all(ch in "0123456789abcdefABCDEF" for ch in text):
        text = "".join(ch * 2 for ch in text)
    return text.upper() if HEX_RE.match(text) else default


def _safe_asset(case_dir: Path, relpath: str, label: str) -> str:
    if not relpath or not isinstance(relpath, str):
        raise SceneError(f"{label} must be a relative asset path")
    candidate = (case_dir / relpath).resolve()
    try:
        candidate.relative_to(case_dir.resolve())
    except ValueError as exc:
        raise SceneError(f"{label} escapes the case directory: {relpath}") from exc
    if not candidate.is_file():
        raise SceneError(f"{label} does not exist: {relpath}")
    return candidate.relative_to(case_dir.resolve()).as_posix()


def _bbox(value: Any, label: str, canvas: tuple[float, float]) -> list[float]:
    if not isinstance(value, list) or len(value) != 4:
        raise SceneError(f"{label} must be [x, y, width, height]")
    x, y, width, height = [_number(v, f"{label}[{i}]") for i, v in enumerate(value)]
    if width <= 0 or height <= 0:
        raise SceneError(f"{label} width and height must be positive")
    canvas_w, canvas_h = canvas
    tolerance = 1.0
    if x < -tolerance or y < -tolerance or x + width > canvas_w + tolerance or y + height > canvas_h + tolerance:
        raise SceneError(f"{label} lies outside the canvas: {value}")
    return [max(0.0, x), max(0.0, y), min(width, canvas_w - max(0.0, x)), min(height, canvas_h - max(0.0, y))]


def _flatten(nodes: Iterable[dict[str, Any]], parent_z: float = 0.0) -> list[dict[str, Any]]:
    flat: list[dict[str, Any]] = []
    for order, node in enumerate(nodes):
        if not isinstance(node, dict):
            raise SceneError("every node must be an object")
        if node.get("visible", True) is False:
            continue
        node_type = node.get("type")
        if node_type not in SUPPORTED_NODE_TYPES:
            raise SceneError(f"unsupported node type: {node_type!r}")
        z = parent_z + float(node.get("z", order))
        if node_type == "group":
            flat.extend(_flatten(node.get("children") or [], z))
        else:
            copied = dict(node)
            copied["_z"] = z
            copied["_order"] = len(flat)
            flat.append(copied)
    return flat


def validate_scene(scene: dict[str, Any], case_dir: str | os.PathLike) -> list[str]:
    """Return non-blocking warnings; raise SceneError on invalid input."""
    canvas = _canvas(scene)
    root = Path(case_dir).resolve()
    warnings: list[str] = []
    version = scene.get("version", 1)
    if version != 1:
        raise SceneError(f"unsupported scene version: {version}")

    background = scene.get("background") or {}
    if background.get("asset"):
        _safe_asset(root, background["asset"], "background.asset")
    elif not background.get("color"):
        warnings.append("background has no asset or color; white will be used")

    ids: set[str] = set()
    for index, node in enumerate(_flatten(scene.get("nodes") or [])):
        node_id = str(node.get("id") or f"node-{index + 1}")
        if node_id in ids:
            raise SceneError(f"duplicate node id: {node_id}")
        ids.add(node_id)
        _bbox(node.get("bbox"), f"nodes[{index}].bbox", canvas)
        node_type = node["type"]
        if node_type == "image":
            _safe_asset(root, node.get("asset"), f"node {node_id}.asset")
        elif node_type == "text":
            has_text = isinstance(node.get("text"), str)
            has_runs = isinstance(node.get("runs"), list) and bool(node.get("runs"))
            if not has_text and not has_runs:
                raise SceneError(f"text node {node_id} needs text or runs")
            if node.get("needs_review"):
                warnings.append(f"text node {node_id} still needs visual review")
    return warnings


def _slide_size(scene: dict[str, Any], canvas: tuple[float, float]) -> tuple[float, float]:
    slide = scene.get("slide") or {}
    if slide.get("width_in") and slide.get("height_in"):
        return float(slide["width_in"]), float(slide["height_in"])
    aspect = canvas[0] / canvas[1]
    width, height = 13.333, 7.5
    if aspect < width / height:
        width = height * aspect
    else:
        height = width / aspect
    return round(width, 4), round(height, 4)


def _box_in(box_px: list[float], canvas: tuple[float, float], slide: tuple[float, float]) -> list[float]:
    x, y, width, height = box_px
    sx, sy = slide[0] / canvas[0], slide[1] / canvas[1]
    return [round(x * sx, 5), round(y * sy, 5), round(width * sx, 5), round(height * sy, 5)]


def _text_units(text: str) -> float:
    units = 0.0
    for char in text:
        code = ord(char)
        if char.isspace():
            units += 0.33
        elif 0x2E80 <= code <= 0x9FFF or 0xAC00 <= code <= 0xD7AF:
            units += 1.0
        elif char.isupper():
            units += 0.66
        elif char.islower() or char.isdigit():
            units += 0.56
        else:
            units += 0.48
    return max(units, 0.5)


def _estimate_pt(text: str, box_in: list[float], minimum: float = 5.0) -> float:
    """Fallback size when the scene names neither font_size_pt nor font_size_px.

    The width term treats each explicit line as one unwrapped run, so it is not
    a substitute for an author-measured size.
    """
    lines = str(text).split("\n") or [""]
    width_pt = box_in[2] * 72.0
    height_pt = box_in[3] * 72.0
    by_height = height_pt * 0.72 / max(1, len(lines))
    by_width = min(width_pt * 0.94 / _text_units(line) for line in lines)
    return round(max(minimum, min(by_height, by_width)), 1)


def _fit_pt(text: str, box_in: list[float], requested_pt: float | None, minimum: float = 5.0) -> float:
    """Keep an explicit size. Estimate only when the scene omitted one."""
    if requested_pt and requested_pt > 0:
        return round(float(requested_pt), 1)
    return _estimate_pt(text, box_in, minimum)


def _font_pt(style: dict[str, Any], box_in: list[float], canvas: tuple[float, float], slide: tuple[float, float]) -> float | None:
    if style.get("font_size_pt"):
        return float(style["font_size_pt"])
    if style.get("font_size_px"):
        return float(style["font_size_px"]) * (slide[1] / canvas[1]) * 72.0
    return None


def compile_scene(scene: dict[str, Any], case_dir: str | os.PathLike) -> dict[str, Any]:
    """Compile scene DOM to the native writer's spec dictionary."""
    root = Path(case_dir).resolve()
    canvas = _canvas(scene)
    validate_scene(scene, root)
    slide = _slide_size(scene, canvas)
    background = scene.get("background") or {}
    spec: dict[str, Any] = {
        "title": scene.get("title") or "Image to PowerPoint",
        "slide": {"w": slide[0], "h": slide[1]},
        "img_px": [int(round(canvas[0])), int(round(canvas[1]))],
        "bg_color": normalize_hex(background.get("color"), "FFFFFF"),
        "bg_images": [],
        "items": [],
    }
    if background.get("asset"):
        spec["bg_images"] = [_safe_asset(root, background["asset"], "background.asset")]

    nodes = sorted(_flatten(scene.get("nodes") or []), key=lambda n: (n["_z"], n["_order"]))
    for index, node in enumerate(nodes):
        node_id = str(node.get("id") or f"node-{index + 1}")
        node_type = node["type"]
        box_px = _bbox(node["bbox"], f"node {node_id}.bbox", canvas)
        box_in = _box_in(box_px, canvas, slide)
        style = node.get("style") or {}
        if node_type == "image":
            item = {
                "type": "image",
                "role": node_id,
                "path": _safe_asset(root, node["asset"], f"node {node_id}.asset"),
                "box": box_in,
                "rotation_deg": float(node.get("rotation_deg", style.get("rotation_deg", 0))),
            }
            if node.get("shape"):
                item["shape"] = node["shape"]
                item["rect_radius"] = float(style.get("radius_in", 0.10))
            spec["items"].append(item)
        elif node_type == "shape":
            spec["items"].append({
                "type": "shape",
                "role": node_id,
                "box": box_in,
                "shape": node.get("shape") or "rect",
                "fill": normalize_hex(style.get("fill"), "FFFFFF") if style.get("fill") else None,
                "border": normalize_hex(style.get("border")) if style.get("border") else None,
                "border_w": float(style.get("border_width_pt", 0.0)),
                "opacity": float(style.get("opacity", 1.0)),
                "border_opacity": float(style.get("border_opacity", 1.0)),
                "rect_radius": float(style.get("radius_in", 0.10)),
                "rotation_deg": float(node.get("rotation_deg", style.get("rotation_deg", 0))),
            })
        elif node_type == "text":
            text = node.get("text") if isinstance(node.get("text"), str) else "".join(
                str(run.get("text", "")) for run in node.get("runs") or []
            )
            requested = _font_pt(style, box_in, canvas, slide)
            base_pt = _fit_pt(text, box_in, requested)
            item: dict[str, Any] = {
                "type": "text",
                "role": node_id,
                "box": box_in,
                "text": text,
                "pt": base_pt,
                "color": normalize_hex(style.get("color"), "18181B"),
                "bold": bool(style.get("bold", False)),
                "italic": bool(style.get("italic", False)),
                "align": style.get("align", "l"),
                "valign": style.get("valign", "t"),
                "line_pct": float(style.get("line_height_pct", 100)),
                "fit": style.get("fit", "shrink"),
                "font_face": style.get("font_family") or "Arial",
                "font_face_ea": style.get("font_family_ea") or style.get("font_family") or "Microsoft YaHei",
                "margin": style.get("margin_in", 0),
                "rotation_deg": float(node.get("rotation_deg", style.get("rotation_deg", 0))),
            }
            if node.get("runs"):
                item["runs"] = []
                for run in node["runs"]:
                    run_style = {**style, **(run.get("style") or {})}
                    run_requested = _font_pt(run_style, box_in, canvas, slide)
                    item["runs"].append({
                        "text": str(run.get("text", "")),
                        "pt": round(run_requested or base_pt, 1),
                        "color": normalize_hex(run_style.get("color"), item["color"]),
                        "bold": bool(run_style.get("bold", item["bold"])),
                        "italic": bool(run_style.get("italic", item["italic"])),
                        "font_face": run_style.get("font_family") or item["font_face"],
                        "font_face_ea": run_style.get("font_family_ea") or item["font_face_ea"],
                    })
            spec["items"].append(item)
    return spec
