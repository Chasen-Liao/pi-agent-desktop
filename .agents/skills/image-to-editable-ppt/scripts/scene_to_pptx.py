#!/usr/bin/env python3
"""Convert ``scene.json`` to one editable PowerPoint slide."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pptx_native import build
from scene_dom import compile_scene, load_scene, validate_scene
from validate_pptx import validate as validate_pptx


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case_dir")
    parser.add_argument("--scene", default="scene.json")
    parser.add_argument("--out", default="output.pptx")
    parser.add_argument("--compiled-spec", default="work/compiled-spec.json")
    parser.add_argument("--strict-review", action="store_true",
                        help="fail while any scene node is marked needs_review")
    args = parser.parse_args()

    case = Path(args.case_dir).expanduser().resolve()
    scene_path = (case / args.scene).resolve()
    output = (case / args.out).resolve()
    compiled_path = (case / args.compiled_spec).resolve()
    scene = load_scene(scene_path)
    warnings = validate_scene(scene, case)
    if warnings:
        print("[scene_to_pptx] warnings:")
        for warning in warnings:
            print(f"  - {warning}")
        if args.strict_review:
            return 2

    spec = compile_scene(scene, case)
    compiled_path.parent.mkdir(parents=True, exist_ok=True)
    with compiled_path.open("w", encoding="utf-8") as handle:
        json.dump(spec, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    output.parent.mkdir(parents=True, exist_ok=True)
    build(str(case), str(compiled_path), str(output))
    package_report = validate_pptx(output)
    if not package_report["ok"]:
        for error in package_report["errors"]:
            print(f"[scene_to_pptx] package error: {error}")
        return 2
    print(f"[scene_to_pptx] scene={scene_path}")
    print(f"[scene_to_pptx] compiled={compiled_path}")
    print(f"[scene_to_pptx] output={output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
