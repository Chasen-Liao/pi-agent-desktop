#!/usr/bin/env python
"""Bounded, artifact-first rendering for a single-slide image2ppt deck.

The renderer process is not the source of truth: a render is complete once a
stable, valid PNG exists.  This matters on macOS because ``qlmanage`` can leave
the calling process alive after it has already written the thumbnail.

Usage:
    python scripts/render_pptx.py /abs/path/input.pptx \
        --out /abs/path/render.png

All paths are resolved before a renderer starts.  ``auto`` tries qlmanage first
and falls back to LibreOffice + pdftoppm when available.  The timeout is a total
budget, not a polling interval.
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PDF_MAGIC = b"%PDF-"
DEFAULT_TIMEOUT_S = 45.0
QLMANAGE_SOFT_BUDGET_S = 12.0
STABLE_FOR_S = 0.4
POLL_S = 0.2


def _has_magic(path: Path, magic: bytes) -> bool:
    try:
        if path.stat().st_size <= len(magic):
            return False
        with path.open("rb") as handle:
            return handle.read(len(magic)) == magic
    except OSError:
        return False


def _stop_process(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(proc.pid, signal.SIGTERM)
        else:
            proc.terminate()
        proc.wait(timeout=2)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        try:
            if os.name == "posix":
                os.killpg(proc.pid, signal.SIGKILL)
            else:
                proc.kill()
            proc.wait(timeout=2)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            pass


def _tail(path: Path, limit: int = 1200) -> str:
    try:
        data = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return data[-limit:].strip()


def _run_until_artifact(
    command: list[str],
    artifact: Path,
    magic: bytes,
    timeout_s: float,
    log_path: Path,
) -> tuple[bool, float, bool, str]:
    """Run a command until its artifact is stable, even if the process hangs."""
    started = time.monotonic()
    deadline = started + max(0.1, timeout_s)
    last_signature: tuple[int, int] | None = None
    stable_since: float | None = None
    exit_seen: float | None = None

    with log_path.open("w", encoding="utf-8") as log:
        proc = subprocess.Popen(
            command,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=(os.name == "posix"),
        )

        while True:
            now = time.monotonic()
            if _has_magic(artifact, magic):
                stat = artifact.stat()
                signature = (stat.st_size, stat.st_mtime_ns)
                if signature == last_signature:
                    if stable_since is not None and now - stable_since >= STABLE_FOR_S:
                        was_running = proc.poll() is None
                        _stop_process(proc)
                        return True, now - started, was_running, _tail(log_path)
                else:
                    last_signature = signature
                    stable_since = now

            returncode = proc.poll()
            if returncode is not None and exit_seen is None:
                exit_seen = now
            if exit_seen is not None and now - exit_seen >= 1.0:
                break
            if now >= deadline:
                break
            time.sleep(POLL_S)

        _stop_process(proc)
        return False, time.monotonic() - started, False, _tail(log_path)


def _atomic_copy(source: Path, target: Path) -> None:
    pending = target.with_name(f".{target.name}.pending")
    shutil.copy2(source, pending)
    os.replace(pending, target)


def _find_soffice() -> str | None:
    found = shutil.which("soffice") or shutil.which("libreoffice")
    if found:
        return found
    for candidate in (
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/usr/bin/soffice",
        "/usr/bin/libreoffice",
        "/opt/homebrew/bin/soffice",
    ):
        if Path(candidate).exists():
            return candidate
    return None


def _render_with_qlmanage(
    pptx: Path, stage: Path, size: int, budget_s: float
) -> tuple[Path | None, float, bool, str]:
    qlmanage = shutil.which("qlmanage")
    if not qlmanage:
        return None, 0.0, False, "qlmanage not found"
    candidate = stage / f"{pptx.name}.png"
    ok, elapsed, stopped, log = _run_until_artifact(
        [qlmanage, "-t", "-s", str(size), "-o", str(stage), str(pptx)],
        candidate,
        PNG_MAGIC,
        budget_s,
        stage / "qlmanage.log",
    )
    return (candidate if ok else None), elapsed, stopped, log


def _render_with_libreoffice(
    pptx: Path, stage: Path, size: int, budget_s: float
) -> tuple[Path | None, float, bool, str]:
    soffice = _find_soffice()
    pdftoppm = shutil.which("pdftoppm")
    if not soffice or not pdftoppm:
        return None, 0.0, False, "LibreOffice or pdftoppm not found"

    started = time.monotonic()
    profile = stage / "lo-profile"
    profile.mkdir()
    pdf = stage / f"{pptx.stem}.pdf"
    ok, elapsed_pdf, stopped_pdf, log_pdf = _run_until_artifact(
        [
            soffice,
            f"-env:UserInstallation={profile.as_uri()}",
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            str(stage),
            str(pptx),
        ],
        pdf,
        PDF_MAGIC,
        budget_s,
        stage / "soffice.log",
    )
    if not ok:
        return None, elapsed_pdf, stopped_pdf, log_pdf

    remaining = budget_s - (time.monotonic() - started)
    if remaining <= 0:
        return None, time.monotonic() - started, stopped_pdf, "LibreOffice used the render budget"

    dpi = max(72, int(round(size / 13.4375)))
    prefix = stage / "slide"
    candidate = stage / "slide-1.png"
    ok, _, stopped_png, log_png = _run_until_artifact(
        [
            pdftoppm,
            "-png",
            "-r",
            str(dpi),
            "-f",
            "1",
            "-l",
            "1",
            str(pdf),
            str(prefix),
        ],
        candidate,
        PNG_MAGIC,
        remaining,
        stage / "pdftoppm.log",
    )
    log = "\n".join(part for part in (log_pdf, log_png) if part)
    return (
        candidate if ok else None,
        time.monotonic() - started,
        stopped_pdf or stopped_png,
        log,
    )


def render_first_slide(
    pptx_path: str | os.PathLike,
    output_path: str | os.PathLike,
    *,
    size: int = 2000,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    renderer: str = "auto",
) -> dict:
    """Render the first slide and return evidence about the real renderer used."""
    pptx = Path(pptx_path).expanduser().resolve()
    output = Path(output_path).expanduser().resolve()
    if not pptx.is_file() or pptx.suffix.lower() != ".pptx":
        raise RuntimeError(f"input PPTX does not exist: {pptx}")
    if pptx.stat().st_size == 0:
        raise RuntimeError(f"input PPTX is empty: {pptx}")
    if timeout_s <= 0:
        raise RuntimeError("timeout must be positive")

    output.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    attempts: list[str] = []

    with tempfile.TemporaryDirectory(prefix="ppt-render-", dir=str(output.parent)) as tmp:
        stage = Path(tmp)

        if renderer in {"auto", "qlmanage"}:
            remaining = timeout_s - (time.monotonic() - started)
            budget = remaining if renderer == "qlmanage" else min(QLMANAGE_SOFT_BUDGET_S, remaining)
            candidate, elapsed, stopped, log = _render_with_qlmanage(pptx, stage, size, budget)
            attempts.append(f"qlmanage {elapsed:.1f}s: {log or 'no diagnostic output'}")
            if candidate:
                _atomic_copy(candidate, output)
                return {
                    "renderer": "qlmanage",
                    "output": str(output),
                    "elapsed_s": round(time.monotonic() - started, 2),
                    "renderer_stopped_after_artifact": stopped,
                }

        if renderer in {"auto", "libreoffice"}:
            remaining = timeout_s - (time.monotonic() - started)
            if remaining > 0:
                candidate, elapsed, stopped, log = _render_with_libreoffice(
                    pptx, stage, size, remaining
                )
                attempts.append(f"libreoffice {elapsed:.1f}s: {log or 'no diagnostic output'}")
                if candidate:
                    _atomic_copy(candidate, output)
                    return {
                        "renderer": "libreoffice",
                        "output": str(output),
                        "elapsed_s": round(time.monotonic() - started, 2),
                        "renderer_stopped_after_artifact": stopped,
                    }

    raise RuntimeError(
        f"no real render produced within {timeout_s:.0f}s; " + " | ".join(attempts)
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Render the first slide; finish when a valid PNG is ready, not when the renderer exits."
    )
    parser.add_argument("pptx", help="input .pptx; resolved to an absolute path")
    parser.add_argument("--out", required=True, help="output PNG path")
    parser.add_argument("--size", type=int, default=2000, help="target width for qlmanage")
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_S,
        help=f"total render budget in seconds (default: {DEFAULT_TIMEOUT_S:g})",
    )
    parser.add_argument(
        "--renderer",
        choices=("auto", "qlmanage", "libreoffice"),
        default="auto",
    )
    args = parser.parse_args()

    try:
        result = render_first_slide(
            args.pptx,
            args.out,
            size=args.size,
            timeout_s=args.timeout,
            renderer=args.renderer,
        )
    except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
        print(f"render failed: {exc}", file=sys.stderr)
        return 2

    stopped = "yes" if result["renderer_stopped_after_artifact"] else "no"
    print(
        f"render ready: {result['output']} "
        f"renderer={result['renderer']} elapsed={result['elapsed_s']:.2f}s "
        f"stopped_after_artifact={stopped}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
