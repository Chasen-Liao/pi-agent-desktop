#!/usr/bin/env python3
"""Install this skill at an explicit project or user scope."""

from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path
from typing import Sequence


SKILL_NAME = "ling-ui-design"
SKILL_ROOT = Path(__file__).resolve().parents[1]
IGNORED = {
    ".git",
    ".venv",
    ".pytest_cache",
    ".playwright-cli",
    "__pycache__",
    "artifacts",
    "node_modules",
    "outputs",
}


def _absolute(path: Path) -> Path:
    return Path(os.path.abspath(path.expanduser()))


def destination_for(
    harness: str,
    scope: str,
    *,
    project_root: Path | None = None,
    destination: Path | None = None,
    home: Path | None = None,
) -> Path:
    if destination is not None:
        return _absolute(destination)
    if scope == "project":
        if project_root is None:
            raise ValueError("--project-root is required for project scope")
        root = project_root.expanduser().resolve(strict=False)
    else:
        root = (home or Path.home()).expanduser().resolve(strict=False)
    skill_dir = ".claude/skills" if harness == "claude" else ".agents/skills"
    return root / skill_dir / SKILL_NAME


def _copy_ignore(_directory: str, names: list[str]) -> set[str]:
    return {
        name
        for name in names
        if name in IGNORED
        or name.endswith(".pyc")
        or (name.startswith(".env") and name != ".env.example")
    }


def ensure_env(root: Path) -> Path:
    env_file = root / ".env"
    if env_file.exists() or env_file.is_symlink():
        if not env_file.is_file():
            raise ValueError(f"expected a dotenv file at {env_file}")
        try:
            os.chmod(env_file, 0o600)
        except OSError:
            pass
        return env_file

    template = root / ".env.example"
    if not template.is_file():
        raise ValueError(f"missing credential template: {template}")
    content = template.read_text(encoding="utf-8")
    descriptor = os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(content)
    return env_file


def install(source: Path, destination: Path, mode: str) -> tuple[Path, bool]:
    source = source.expanduser().resolve(strict=True)
    destination = _absolute(destination)
    if not (source / "SKILL.md").is_file():
        raise ValueError(f"source is not a skill root: {source}")

    if destination.exists() or destination.is_symlink():
        if (
            mode == "link"
            and destination.is_symlink()
            and destination.resolve(strict=True) == source
        ):
            return ensure_env(source), False
        raise ValueError(f"destination already exists: {destination}")
    resolved_destination = destination.resolve(strict=False)
    if resolved_destination == source or source in resolved_destination.parents:
        raise ValueError("destination must not be inside the skill source")

    destination.parent.mkdir(parents=True, exist_ok=True)
    if mode == "copy":
        shutil.copytree(source, destination, ignore=_copy_ignore)
        config_root = destination
    else:
        try:
            destination.symlink_to(source, target_is_directory=True)
        except OSError as exc:
            raise ValueError("could not create link; retry with --mode copy") from exc
        config_root = source
    return ensure_env(config_root), True


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", choices=("project", "user"), required=True)
    parser.add_argument(
        "--harness", choices=("universal", "claude"), default="universal"
    )
    parser.add_argument("--project-root", type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--mode", choices=("link", "copy"), default="link")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        destination = destination_for(
            args.harness,
            args.scope,
            project_root=args.project_root,
            destination=args.destination,
        )
        config_path, created = install(SKILL_ROOT, destination, args.mode)
    except (OSError, ValueError) as exc:
        parser.exit(2, f"error: {exc}\n")

    status = "Installed" if created else "Already installed"
    print(f"{status}: {destination}")
    print(f"Credentials: {config_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
