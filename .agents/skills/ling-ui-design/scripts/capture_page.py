#!/usr/bin/env python3
# pyright: reportMissingImports=false
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from _common import artifact_path


DEFAULT_VIEWPORTS = (("desktop", 1280, 832), ("mobile", 390, 844))


def parse_viewport(value: str) -> tuple[str, int, int]:
    try:
        name, dimensions = value.split("=", 1)
        width_text, height_text = dimensions.lower().split("x", 1)
        width, height = int(width_text), int(height_text)
    except (TypeError, ValueError) as exc:
        raise argparse.ArgumentTypeError("viewport must be NAME=WIDTHxHEIGHT") from exc
    if not name.strip() or width <= 0 or height <= 0:
        raise argparse.ArgumentTypeError("viewport name and dimensions must be positive")
    return name.strip(), width, height


def normalize_url(value: str) -> str:
    if "://" in value:
        return value
    path = Path(value)
    if path.exists():
        return path.resolve().as_uri()
    return value


def launch_browser(playwright: object, channel: str):
    chromium = getattr(playwright, "chromium")
    candidates: list[str | None]
    if channel == "auto":
        candidates = [None, "chrome", "msedge"]
    elif channel == "bundled":
        candidates = [None]
    else:
        candidates = [channel]
    errors: list[str] = []
    for candidate in candidates:
        try:
            if candidate:
                browser = chromium.launch(headless=True, channel=candidate)
            else:
                browser = chromium.launch(headless=True)
            return browser, candidate or "bundled"
        except Exception as exc:  # browser availability differs by host
            errors.append(f"{candidate or 'bundled'}: {type(exc).__name__}")
    raise SystemExit(
        "error: no usable Playwright browser (" + ", ".join(errors) + "). "
        "Read references/visual-validation.md before installing one."
    )


def prepare_full_page(page: Any) -> list[str]:
    return page.evaluate(
        """async () => {
          const height = document.documentElement.scrollHeight;
          const step = Math.max(1, Math.floor(window.innerHeight * 0.8));
          for (let y = 0; y < height; y += step) {
            window.scrollTo(0, y);
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          window.scrollTo(0, 0);
          const images = Array.from(document.images);
          await Promise.race([
            Promise.all(images.filter(img => !img.complete).map(img =>
              new Promise(resolve => {
                img.addEventListener('load', resolve, {once: true});
                img.addEventListener('error', resolve, {once: true});
              })
            )),
            new Promise(resolve => setTimeout(resolve, 5000))
          ]);
          return images
            .filter(img => !img.complete || img.naturalWidth === 0)
            .map(img => img.currentSrc || img.src || '<unknown>');
        }"""
    )


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Capture stable desktop/mobile previews.")
    result.add_argument("--url", required=True, help="URL or local HTML path")
    result.add_argument("--outdir", required=True)
    result.add_argument("--viewport", action="append", type=parse_viewport)
    result.add_argument(
        "--channel", choices=("auto", "bundled", "chrome", "msedge"), default="auto"
    )
    result.add_argument("--timeout", type=float, default=300.0)
    result.add_argument("--full-page", action=argparse.BooleanOptionalAction, default=True)
    result.add_argument("--allow-motion", action="store_true")
    return result


def main() -> None:
    args = parser().parse_args()
    output_dir = artifact_path(args.outdir)
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise SystemExit(
            "error: Python Playwright is unavailable. Prefer a harness browser or "
            "playwright-cli; read references/visual-validation.md before installing."
        ) from exc

    output_dir.mkdir(parents=True, exist_ok=True)
    viewports = args.viewport or list(DEFAULT_VIEWPORTS)
    target = normalize_url(args.url)
    with sync_playwright() as playwright:
        browser, browser_name = launch_browser(playwright, args.channel)
        try:
            for name, width, height in viewports:
                page = browser.new_page(viewport={"width": width, "height": height})
                try:
                    page.goto(
                        target,
                        wait_until="domcontentloaded",
                        timeout=int(args.timeout * 1000),
                    )
                    try:
                        page.wait_for_load_state("networkidle", timeout=5000)
                    except PlaywrightTimeoutError:
                        pass
                    try:
                        page.evaluate("document.fonts && document.fonts.ready")
                    except Exception:
                        pass
                    if not args.allow_motion:
                        page.add_style_tag(
                            content="""*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}"""
                        )
                    if args.full_page:
                        failed_images = prepare_full_page(page)
                        if failed_images:
                            print(
                                f"[capture_page] WARNING: {len(failed_images)} unloaded images; "
                                "inspect the page without logging credential-bearing URLs."
                            )
                    page.wait_for_timeout(250)
                    output = artifact_path(output_dir / f"{name}.png")
                    page.screenshot(path=str(output), full_page=args.full_page, type="png")
                    print(f"[capture_page] {name} {width}x{height} -> {output}")
                finally:
                    page.close()
        finally:
            browser.close()
    print(f"[capture_page] browser={browser_name}; inspect previews before editing again")


if __name__ == "__main__":
    main()
