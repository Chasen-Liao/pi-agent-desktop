"""Stage a set of output files, then publish with rollback on replacement errors."""

import os
import tempfile
from pathlib import Path

from PIL import Image


def publish_layers(stage, output_dir, prefix="layer", include_manifest=False):
    """Validate all PNGs before touching old files. Preserve unrelated files.

    Callers must serialize publication to the same output directory. This handles
    ordinary exceptions, not process termination or concurrent readers.
    """
    stage, output = Path(stage), Path(output_dir)
    def selected(name):
        return (name.startswith(prefix + "_") and name.endswith(".png")) or (
            include_manifest and name == "manifest.json")

    new = sorted(p for p in stage.iterdir() if selected(p.name))
    if not any(p.suffix == ".png" for p in new):
        raise ValueError("No layer images to publish")
    for path in new:
        if path.suffix == ".png":
            with Image.open(path) as image:
                if image.format != "PNG":
                    raise ValueError(f"Layer is not PNG: {path.name}")
                image.verify()
            with Image.open(path) as image:
                image.load()
    output.mkdir(parents=True, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix=".layers-backup-", dir=output.parent))
    moved, installed = [], []
    try:
        for old in sorted(output.iterdir()):
            if selected(old.name):
                os.replace(old, backup / old.name)
                moved.append(old.name)
        for path in new:
            os.replace(path, output / path.name)
            installed.append(path.name)
    except BaseException:
        # If rollback itself fails, keep the backup directory for recovery.
        for name in installed:
            (output / name).unlink()
        for name in moved:
            os.replace(backup / name, output / name)
        backup.rmdir()
        raise
    else:
        for name in moved:
            (backup / name).unlink()
        backup.rmdir()
