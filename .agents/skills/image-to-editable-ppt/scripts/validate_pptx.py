#!/usr/bin/env python3
"""Fast structural validation for generated PPTX files using only stdlib."""

from __future__ import annotations

import argparse
import json
import posixpath
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


def _source_for_rels(name: str) -> str:
    if name == "_rels/.rels":
        return ""
    marker = "/_rels/"
    if marker not in name or not name.endswith(".rels"):
        return ""
    before, after = name.split(marker, 1)
    return posixpath.join(before, after[:-5])


def validate(path: str | Path) -> dict:
    pptx = Path(path).expanduser().resolve()
    if not pptx.is_file() or pptx.suffix.lower() != ".pptx":
        raise RuntimeError(f"PPTX does not exist: {pptx}")
    errors: list[str] = []
    required = {"[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml"}
    slide_stats = []

    try:
        with zipfile.ZipFile(pptx) as archive:
            names = set(archive.namelist())
            missing = sorted(required - names)
            if missing:
                errors.append("missing required parts: " + ", ".join(missing))
            bad_crc = archive.testzip()
            if bad_crc:
                errors.append(f"CRC failure: {bad_crc}")

            parsed = {}
            for name in sorted(names):
                if not (name.endswith(".xml") or name.endswith(".rels")):
                    continue
                try:
                    parsed[name] = ET.fromstring(archive.read(name))
                except ET.ParseError as exc:
                    errors.append(f"malformed XML {name}: {exc}")

            for name, root in parsed.items():
                if not name.endswith(".rels"):
                    continue
                source = _source_for_rels(name)
                base = posixpath.dirname(source)
                for rel in root.findall(f"{{{REL_NS}}}Relationship"):
                    if rel.get("TargetMode") == "External":
                        continue
                    target = (rel.get("Target") or "").split("#", 1)[0]
                    resolved = posixpath.normpath(posixpath.join(base, target)).lstrip("/")
                    if resolved and resolved not in names:
                        errors.append(f"broken relationship {name} -> {target}")

            slides = sorted(
                name for name in names
                if name.startswith("ppt/slides/slide") and name.endswith(".xml")
                and "/_rels/" not in name
            )
            if not slides:
                errors.append("no slide XML parts")
            for name in slides:
                root = parsed.get(name)
                if root is None:
                    continue
                text_boxes = 0
                native_shapes = 0
                image_filled_shapes = 0
                for shape in root.findall(f".//{{{P_NS}}}sp"):
                    properties = shape.find(f"{{{P_NS}}}nvSpPr/{{{P_NS}}}cNvSpPr")
                    is_text_box = properties is not None and properties.get("txBox") in {"1", "true"}
                    is_image_fill = shape.find(f"{{{P_NS}}}spPr/{{{A_NS}}}blipFill") is not None
                    if is_image_fill:
                        image_filled_shapes += 1
                    elif not is_text_box:
                        native_shapes += 1
                    if shape.find(f"{{{P_NS}}}txBody") is not None and shape.findall(f".//{{{A_NS}}}t"):
                        text_boxes += 1
                slide_stats.append({
                    "part": name,
                    "text_boxes": text_boxes,
                    "native_shapes": native_shapes,
                    "image_filled_shapes": image_filled_shapes,
                    "pictures": len(root.findall(f".//{{{P_NS}}}pic")),
                    "backgrounds": len(root.findall(f".//{{{P_NS}}}bg")),
                })
    except zipfile.BadZipFile as exc:
        errors.append(f"invalid ZIP package: {exc}")

    return {
        "path": str(pptx),
        "ok": not errors,
        "errors": errors,
        "slides": slide_stats,
        "size_bytes": pptx.stat().st_size,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pptx")
    parser.add_argument("--require-text", type=int, default=0)
    parser.add_argument("--require-shapes", type=int, default=0)
    parser.add_argument("--require-images", type=int, default=0)
    args = parser.parse_args()
    report = validate(args.pptx)
    totals = {
        "text": sum(item["text_boxes"] for item in report["slides"]),
        "shapes": sum(item["native_shapes"] for item in report["slides"]),
        "images": sum(item["pictures"] + item["image_filled_shapes"] for item in report["slides"]),
    }
    if totals["text"] < args.require_text:
        report["errors"].append(f"expected at least {args.require_text} text boxes, got {totals['text']}")
    if totals["shapes"] < args.require_shapes:
        report["errors"].append(f"expected at least {args.require_shapes} native shapes, got {totals['shapes']}")
    if totals["images"] < args.require_images:
        report["errors"].append(f"expected at least {args.require_images} images (pictures or image fills), got {totals['images']}")
    report["ok"] = not report["errors"]
    report["totals"] = totals
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
