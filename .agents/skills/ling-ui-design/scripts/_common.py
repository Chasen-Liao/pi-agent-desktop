from __future__ import annotations

import base64
import io
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Sequence


SKILL_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = SKILL_ROOT / ".env"
ENV_EXAMPLE = SKILL_ROOT / ".env.example"
DEFAULT_API_BASE = "https://api.novita.ai/openai/v1/"
KEY_SETUP_URL = "https://novita.ai/"
_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def artifact_path(path: str | Path) -> Path:
    """Keep task outputs outside the installed skill, including symlink aliases."""
    output = Path(path).expanduser().resolve()
    if output.is_relative_to(SKILL_ROOT.resolve()):
        raise SystemExit(
            "error: task outputs must be outside the skill directory. "
            "Run from the target application root and use its artifacts/ or assets/ directory."
        )
    return output


def read_dotenv(path: Path | None = None) -> dict[str, str]:
    path = path or ENV_FILE
    if not path.exists():
        return {}
    if not path.is_file():
        raise SystemExit(f"error: expected a dotenv file at {path}")
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise SystemExit(f"error: cannot read dotenv file: {path}") from exc
    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise SystemExit(f"error: invalid dotenv entry at {path}:{line_number}")
        name, raw_value = line.split("=", 1)
        name = name.strip()
        value = raw_value.strip()
        if not _ENV_NAME.fullmatch(name):
            raise SystemExit(f"error: invalid dotenv name at {path}:{line_number}")
        if value[:1] in {"'", '"'}:
            if len(value) < 2 or value[-1] != value[0]:
                raise SystemExit(f"error: unmatched dotenv quote at {path}:{line_number}")
            value = value[1:-1]
        if not value and values.get(name):
            continue
        values[name] = value
    return values


def configured_value(name: str) -> str:
    process_value = os.environ.get(name, "").strip()
    if process_value:
        return process_value
    return read_dotenv().get(name, "").strip()


def initialize_env_file() -> tuple[Path, bool]:
    if ENV_FILE.exists():
        if not ENV_FILE.is_file():
            raise SystemExit(f"error: expected a dotenv file at {ENV_FILE}")
        try:
            os.chmod(ENV_FILE, 0o600)
        except OSError:
            pass
        return ENV_FILE, False
    try:
        template = ENV_EXAMPLE.read_text(encoding="utf-8")
        descriptor = os.open(ENV_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(template)
        try:
            os.chmod(ENV_FILE, 0o600)
        except OSError:
            pass  # Best effort on platforms without POSIX permission semantics.
    except FileExistsError:
        return ENV_FILE, False
    except OSError as exc:
        raise SystemExit(f"error: cannot create dotenv file: {ENV_FILE}") from exc
    return ENV_FILE, True


def env(name: str, default: str) -> str:
    return configured_value(name) or default


def require_env(name: str) -> str:
    value = configured_value(name)
    if not value:
        path, _ = initialize_env_file()
        raise SystemExit(
            f"""error: {name} is not configured.
Create a personal API key: {KEY_SETUP_URL}
In the shell that launches the agent: export {name}='<your-api-key>'
Or set {name} in {path}. Retry after configuration.
Do not paste or echo the key in chat."""
        )
    return value


def parse_size(value: str) -> tuple[int, int]:
    try:
        width_text, height_text = value.lower().split("x", 1)
        width, height = int(width_text), int(height_text)
    except (TypeError, ValueError) as exc:
        raise ValueError("size must be WIDTHxHEIGHT") from exc
    if width <= 0 or height <= 0:
        raise ValueError("size dimensions must be positive")
    return width, height


def parse_box(value: str) -> tuple[int, int, int, int]:
    try:
        box = tuple(int(part.strip()) for part in value.split(","))
    except ValueError as exc:
        raise ValueError("box must be left,top,right,bottom") from exc
    if len(box) != 4 or box[2] <= box[0] or box[3] <= box[1]:
        raise ValueError("box must have positive width and height")
    return box


def scale_box(
    box: Sequence[float],
    src_size: Sequence[int],
    dst_size: Sequence[int],
) -> tuple[int, int, int, int]:
    src_w, src_h = src_size
    dst_w, dst_h = dst_size
    if src_w <= 0 or src_h <= 0:
        raise ValueError("source size must be positive")
    if dst_w <= 0 or dst_h <= 0:
        raise ValueError("destination size must be positive")
    sx = dst_w / src_w
    sy = dst_h / src_h
    left, top, right, bottom = (float(part) for part in box)
    mapped = (
        int(round(left * sx)),
        int(round(top * sy)),
        int(round(right * sx)),
        int(round(bottom * sy)),
    )
    left_i = max(0, min(mapped[0], dst_w - 1))
    top_i = max(0, min(mapped[1], dst_h - 1))
    right_i = max(left_i + 1, min(mapped[2], dst_w))
    bottom_i = max(top_i + 1, min(mapped[3], dst_h))
    return left_i, top_i, right_i, bottom_i


def source_size_from_manifest(path: str | Path) -> tuple[int, int]:
    manifest_path = Path(path)
    if not manifest_path.is_file():
        raise SystemExit(f"error: manifest not found: {manifest_path}")
    try:
        import json

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise SystemExit(f"error: invalid layer manifest: {manifest_path}") from exc
    raw = manifest.get("source_size") if isinstance(manifest, dict) else None
    if not isinstance(raw, str):
        raise SystemExit(f"error: layer manifest is missing source_size: {manifest_path}")
    try:
        return parse_size(raw)
    except ValueError as exc:
        raise SystemExit(f"error: invalid source_size in {manifest_path}") from exc


def resolve_source_size(
    *,
    from_image: str | None = None,
    from_size: str | None = None,
    from_manifest: str | None = None,
    required: bool = False,
) -> tuple[int, int] | None:
    specified = [name for name, value in (
        ("--from-image", from_image),
        ("--from-size", from_size),
        ("--from-manifest", from_manifest),
    ) if value]
    if len(specified) > 1:
        raise SystemExit("error: use only one of --from-image, --from-size, or --from-manifest")
    if from_image:
        return image_pixel_size(from_image)
    if from_size:
        try:
            return parse_size(from_size)
        except ValueError as exc:
            raise SystemExit(f"error: {exc}") from exc
    if from_manifest:
        return source_size_from_manifest(from_manifest)
    if required:
        raise SystemExit("error: provide --from-image, --from-size, or --from-manifest")
    return None


def format_size(width: int, height: int) -> str:
    return f"{width}x{height}"


def image_pixel_size(path: str | Path) -> tuple[int, int]:
    try:
        from PIL import Image
    except ImportError as exc:
        raise SystemExit("error: Pillow is unavailable; install the optional helpers") from exc
    source = Path(path)
    if not source.is_file():
        raise SystemExit(f"error: image not found: {source}")
    try:
        with Image.open(source) as image:
            return image.size
    except OSError as exc:
        raise SystemExit(f"error: cannot read image size: {source}") from exc


def image_data_url(path: str, resize: int | None = None) -> str:
    try:
        from PIL import Image
    except ImportError as exc:
        raise SystemExit("error: Pillow is unavailable; install the optional helpers") from exc
    source = Path(path)
    if not source.is_file():
        raise SystemExit(f"error: image not found: {source}")
    # Reject non-image files before any bytes can enter an API payload.
    try:
        with Image.open(source) as checked:
            mime_type = Image.MIME.get(checked.format or "", "image/png")
            checked.verify()
    except (OSError, ValueError) as exc:
        raise SystemExit("error: input must be a valid image file") from exc
    if resize:
        with Image.open(source) as image:
            if max(image.size) > resize:
                image.thumbnail((resize, resize), Image.Resampling.LANCZOS)
                buffer = io.BytesIO()
                image.convert("RGB").save(buffer, "JPEG", quality=92)
                encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
                return f"data:image/jpeg;base64,{encoded}"
    encoded = base64.b64encode(source.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def post_json(
    url: str,
    payload: dict[str, Any],
    *,
    timeout: float,
    api_key: str | None = None,
    attempts: int = 3,
    multipart: bool = False,
) -> dict[str, Any]:
    try:
        import requests
    except ImportError as exc:
        raise SystemExit("error: Requests is unavailable; install the optional helpers") from exc
    headers = {
        "Content-Type": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request_body: dict[str, Any] = {"json": payload}
    if multipart:
        files = []
        for index, item in enumerate(payload["images"]):
            prefix, encoded = item["image_url"].split(",", 1)
            mime = prefix.removeprefix("data:").removesuffix(";base64")
            extension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(mime, "bin")
            files.append(("image", (f"image_{index}.{extension}", base64.b64decode(encoded, validate=True), mime)))
        request_body = {
            "data": {
                name: json.dumps(value) if isinstance(value, (bool, dict, list)) else str(value)
                for name, value in payload.items() if name != "images"
            },
            "files": files,
        }
        # Requests supplies the multipart boundary. Bytes remain reusable on retries.
        headers.pop("Content-Type")
    last_error = "request failed"
    for attempt in range(max(1, attempts)):
        try:
            response = requests.post(url, headers=headers, timeout=timeout, **request_body)
        except requests.RequestException as exc:
            last_error = type(exc).__name__
            if attempt + 1 < attempts:
                time.sleep(min(0.4 * (2**attempt), 2.0))
                continue
            break
        if response.status_code >= 500 and attempt + 1 < attempts:
            last_error = f"HTTP {response.status_code}"
            time.sleep(min(0.4 * (2**attempt), 2.0))
            continue
        if response.status_code >= 400:
            raise SystemExit(f"error: service returned HTTP {response.status_code}")
        try:
            result = response.json()
        except ValueError as exc:
            raise SystemExit("error: service returned invalid JSON") from exc
        if not isinstance(result, dict):
            raise SystemExit("error: service returned a non-object JSON response")
        return result
    raise SystemExit(f"error: request failed after {attempts} attempts ({last_error})")


def image_items(body: dict[str, Any]) -> list[dict[str, Any]]:
    data = body.get("data")
    if not isinstance(data, list):
        raise SystemExit("error: response carried no image list")
    items = [item for item in data if isinstance(item, dict)]
    if not items:
        raise SystemExit("error: response carried no image data")
    return items


def item_bytes(item: dict[str, Any], timeout: float) -> bytes:
    encoded = item.get("b64_json")
    if isinstance(encoded, str) and encoded:
        try:
            return base64.b64decode(encoded, validate=True)
        except ValueError as exc:
            raise SystemExit("error: service returned invalid base64 image data") from exc
    url = item.get("url")
    if isinstance(url, str) and url:
        try:
            import requests
        except ImportError as exc:
            raise SystemExit("error: Requests is unavailable; install the optional helpers") from exc
        try:
            response = requests.get(url, timeout=timeout)
            response.raise_for_status()
        except requests.RequestException as exc:
            raise SystemExit("error: failed to download generated image") from exc
        return response.content
    raise SystemExit("error: image item carried neither b64_json nor url")


def validate_image_bytes(data: bytes, *, label: str = "image") -> None:
    try:
        from PIL import Image
    except ImportError as exc:
        raise SystemExit("error: Pillow is unavailable; install the optional helpers") from exc
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
    except (OSError, ValueError) as exc:
        raise SystemExit(f"error: service returned invalid {label} data") from exc
