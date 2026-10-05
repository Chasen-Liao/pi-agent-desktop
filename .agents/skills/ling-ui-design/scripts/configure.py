#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os

from _common import ENV_FILE, initialize_env_file, require_env


SECRET_NAME = "LING_UI_DESIGN_API_KEY"


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Initialize or inspect the skill-local dotenv file without printing secrets."
    )
    group = result.add_mutually_exclusive_group()
    group.add_argument("--init", action="store_true", help="create .env if missing")
    group.add_argument("--check", action="store_true", help="check shared API key presence; exit nonzero if missing")
    group.add_argument("--path", action="store_true", help="print the dotenv path")
    return result


def main() -> None:
    args = parser().parse_args()
    if args.path:
        print(ENV_FILE)
        return
    if args.check:
        require_env(SECRET_NAME)
        if os.environ.get(SECRET_NAME, "").strip():
            status = "configured (process environment)"
        else:
            status = "configured (.env)"
        print(f"{SECRET_NAME}: {status}")
        return
    path, created = initialize_env_file()
    verb = "Created" if created else "Using existing"
    print(f"{verb} {path}")
    print(f"Set {SECRET_NAME} locally. Do not paste or echo its value in chat.")
    print("Process environment variables override values in this file.")


if __name__ == "__main__":
    main()
