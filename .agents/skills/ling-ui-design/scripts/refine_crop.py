#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image

from _common import parse_box as _parse_box
from _common import artifact_path, resolve_source_size, scale_box


def parse_box(value: str) -> tuple[int, int, int, int]:
    try:
        return _parse_box(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def largest_alpha_component(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    if alpha.getextrema() == (255, 255):
        raise SystemExit("error: largest-alpha cleanup requires a transparent layer")
    width, height = rgba.size
    values = alpha.tobytes()
    seen = bytearray(width * height)
    best: list[int] = []
    for start, value in enumerate(values):
        if value == 0 or seen[start]:
            continue
        seen[start] = 1
        queue = deque([start])
        component: list[int] = []
        while queue:
            index = queue.popleft()
            component.append(index)
            x, y = index % width, index // width
            for neighbor in (
                index - 1 if x else -1,
                index + 1 if x + 1 < width else -1,
                index - width if y else -1,
                index + width if y + 1 < height else -1,
            ):
                if neighbor >= 0 and values[neighbor] and not seen[neighbor]:
                    seen[neighbor] = 1
                    queue.append(neighbor)
        if len(component) > len(best):
            best = component
    if not best:
        raise SystemExit("error: image has no visible alpha component")
    cleaned = bytearray(width * height)
    for index in best:
        cleaned[index] = values[index]
    rgba.putalpha(Image.frombytes("L", (width, height), bytes(cleaned)))
    bbox = rgba.getbbox()
    return rgba.crop(bbox) if bbox else rgba


def alpha_components(
    image: Image.Image,
    *,
    threshold: int = 8,
    min_area: int = 64,
) -> list[tuple[tuple[int, int, int, int], Image.Image]]:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    values = rgba.getchannel("A").tobytes()
    seen = bytearray(width * height)
    found: list[tuple[int, list[int]]] = []
    for start, value in enumerate(values):
        if value < threshold or seen[start]:
            continue
        seen[start] = 1
        queue = deque([start])
        component: list[int] = []
        while queue:
            index = queue.popleft()
            component.append(index)
            x, y = index % width, index // width
            for neighbor in (
                index - 1 if x else -1,
                index + 1 if x + 1 < width else -1,
                index - width if y else -1,
                index + width if y + 1 < height else -1,
            ):
                if neighbor >= 0 and values[neighbor] >= threshold and not seen[neighbor]:
                    seen[neighbor] = 1
                    queue.append(neighbor)
        if len(component) >= min_area:
            found.append((len(component), component))
    found.sort(key=lambda item: (-item[0], item[1][0]))
    pixels = rgba.tobytes()
    results: list[tuple[tuple[int, int, int, int], Image.Image]] = []
    for _, component in found:
        isolated = bytearray(len(pixels))
        xs: list[int] = []
        ys: list[int] = []
        for index in component:
            offset = index * 4
            isolated[offset : offset + 4] = pixels[offset : offset + 4]
            xs.append(index % width)
            ys.append(index // width)
        box = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
        cut = Image.frombytes("RGBA", (width, height), bytes(isolated)).crop(box)
        results.append((box, cut))
    return results


def trim_alpha(image: Image.Image) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    return image.crop(bbox) if bbox else image


def resolve_box(
    box: tuple[int, int, int, int],
    image_size: tuple[int, int],
    source_size: tuple[int, int] | None,
) -> tuple[int, int, int, int]:
    if source_size is None or source_size == image_size:
        left, top, right, bottom = box
        width, height = image_size
        if left < 0 or top < 0 or right > width or bottom > height:
            raise SystemExit("error: crop box lies outside this image")
        return box
    return scale_box(box, source_size, image_size)


def crop_asset(
    image: Image.Image,
    *,
    box: tuple[int, int, int, int] | None = None,
    source_size: tuple[int, int] | None = None,
    trim: bool = False,
    keep_largest_alpha: bool = False,
) -> tuple[Image.Image, tuple[int, int, int, int] | None]:
    mapped = None
    if box:
        mapped = resolve_box(box, image.size, source_size)
        image = image.crop(mapped)
    if keep_largest_alpha:
        image = largest_alpha_component(image)
    elif trim:
        image = trim_alpha(image)
    return image, mapped


def add_source_size_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--from-image", help="measure --box on this original or reference")
    parser.add_argument("--from-size", help="WIDTHxHEIGHT of the canvas --box was measured on")
    parser.add_argument(
        "--from-manifest",
        help="decompose manifest.json; uses its source_size as the --box canvas",
    )


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Recrop or clean one extracted asset. "
        "Pass --from-image when --box was measured on the original, not this file."
    )
    result.add_argument("--image", required=True)
    result.add_argument("--out", required=True)
    result.add_argument("--box", type=parse_box, help="left,top,right,bottom")
    add_source_size_flags(result)
    result.add_argument("--trim-alpha", action="store_true")
    result.add_argument("--keep-largest-alpha", action="store_true")
    return result


def load_rgba(path: str | Path) -> Image.Image:
    source = Path(path)
    if not source.is_file():
        raise SystemExit(f"error: image not found: {source}")
    with Image.open(source) as opened:
        return opened.convert("RGBA")


def write_png(image: Image.Image, path: str | Path) -> Path:
    output = artifact_path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, "PNG")
    return output


def report_crop(
    label: str,
    output: Path,
    image: Image.Image,
    *,
    box: tuple[int, int, int, int] | None = None,
    mapped: tuple[int, int, int, int] | None = None,
    source_size: tuple[int, int] | None = None,
    layer_size: tuple[int, int] | None = None,
) -> None:
    print(f"[{label}] OK -> {output} ({image.width}x{image.height})")
    if box and mapped and source_size and layer_size and source_size != layer_size:
        print(
            f"[{label}] mapped {','.join(map(str, box))} on "
            f"{source_size[0]}x{source_size[1]} -> {','.join(map(str, mapped))} on "
            f"{layer_size[0]}x{layer_size[1]}"
        )
    print(f"[{label}] Inspect the cropped image before integrating it.")


def main() -> None:
    args = parser().parse_args()
    if not (args.box or args.trim_alpha or args.keep_largest_alpha):
        raise SystemExit("error: request --box, --trim-alpha, or --keep-largest-alpha")
    source_size = resolve_source_size(
        from_image=args.from_image,
        from_size=args.from_size,
        from_manifest=args.from_manifest,
    )
    if source_size and not args.box:
        raise SystemExit("error: --from-image/--from-size/--from-manifest require --box")
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
        "refine_crop",
        output,
        image,
        box=args.box,
        mapped=mapped,
        source_size=source_size,
        layer_size=layer_size,
    )


if __name__ == "__main__":
    main()
