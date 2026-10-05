# -*- coding: utf-8 -*-
"""Layer-decomposition API client.

Call chain:
    local image → POST {BASE}/images/edits (multipart, field image=file) →
    each layer's b64_json (or url) → layer_1.png ... layer_N.png

Two differences from the old client:

1. **No built-in prompt expansion** (`use_pe=false`). The caller inspects the
   image and decides the layer count, contents, and occlusion order. See
   `references/iterative-decomposition.md`. A missing prompt is an error;
   this module does not guess a layer count.

2. **Two resolutions**:
   - `probe` (`size=512`): a cheap check of whether a prompt separates layers.
     Do not use its output as slide assets. The image-to-editable-ppt workflow
     does not run a probe loop.
   - `final` (`size=auto`): the asset-producing call. The service keeps the
     source aspect ratio at roughly 2K. Crop and place these layers.

Prompt order: layer_1 is the **frontmost** layer, and the last layer is the
background. Occlusion in the source decides the order. Assets that must move
independently (hero art, icons, cards, text blocks) each get their own layer.
The background absorbs props, surfaces, shadows, gradients, and texture.

Compact front-to-back prompt, for example:
    "4 layers: 1 text part, 2 text card, 3 only burger, 4 background environment"
`prompt_from_plan()` renders a structured plan into the same format.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import tempfile
from urllib.parse import urlsplit

import requests

try:
    from .artifact_store import publish_layers
except ImportError:  # Direct script invocation.
    from artifact_store import publish_layers

# ==================== Config ====================

_SKILL_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_ENV_FILE = os.path.join(_SKILL_DIR, ".env")
_ENV_EXAMPLE = os.path.join(_SKILL_DIR, ".env.example")
_LING_KEYS = ("LING_BASE_URL", "LING_MODEL", "LING_API_KEY")

DECOMPOSE_ENDPOINT = os.environ.get("DECOMPOSE_ENDPOINT", "/images/edits")

DECOMPOSE_OUTPUT_FORMAT = os.environ.get("DECOMPOSE_OUTPUT_FORMAT", "png")
DECOMPOSE_RESPONSE_FORMAT = os.environ.get("DECOMPOSE_RESPONSE_FORMAT", "b64_json")
# The caller writes the prompt, so server-side prompt expansion stays off.
DECOMPOSE_USE_PE = os.environ.get("DECOMPOSE_USE_PE", "false").lower() in ("1", "true", "yes")
DECOMPOSE_USE_SR = os.environ.get("DECOMPOSE_USE_SR", "true").lower() in ("1", "true", "yes")
DECOMPOSE_STREAM = os.environ.get("DECOMPOSE_STREAM", "false").lower() in ("1", "true", "yes")

# Two resolutions: probe checks a prompt, final produces assets.
# `size` is a long-edge budget, not an exact output size. The service
# scales to the source aspect ratio.
STAGE_SIZE = {
    "probe": os.environ.get("DECOMPOSE_SIZE_PROBE", "512x512"),
    "final": os.environ.get("DECOMPOSE_SIZE_FINAL", "auto"),
}
STAGE_TIMEOUT = {
    "probe": int(os.environ.get("DECOMPOSE_TIMEOUT_PROBE_S", "180")),
    "final": int(os.environ.get("DECOMPOSE_TIMEOUT_FINAL_S", "600")),
}
DOWNLOAD_TIMEOUT_S = int(os.environ.get("DECOMPOSE_DOWNLOAD_TIMEOUT_S", "300"))
ATTEMPTS = int(os.environ.get("DECOMPOSE_ATTEMPTS", "3"))
RETRY_BACKOFF_S = [5, 15]          # seconds to wait before each retry

DEFAULT_PLAN_NAME = "decompose_plan.json"
DEFAULT_LOG_NAME = "decompose_log.jsonl"

# Layer order: index 1 = frontmost, last layer = background. Plans and logs use the same words.
LAYER_ORDER_NOTE = "layer_1 = topmost (front); last layer = background/environment"


def _read_dotenv(path: str) -> dict:
    """Read KEY=value lines. Blank lines and # comments are ignored."""
    found = {}
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key:
                found[key] = value.strip().strip("'\"")
    return found


def _valid_base_url(value: str) -> bool:
    """Accept a non-placeholder HTTP(S) base URL with any API path prefix."""
    try:
        parsed = urlsplit(value.strip())
    except ValueError:
        return False
    hostname = (parsed.hostname or "").lower()
    placeholder = hostname == "example.com" or hostname.endswith(".example.com")
    return (
        parsed.scheme in {"http", "https"}
        and bool(hostname)
        and not placeholder
        and not parsed.query
        and not parsed.fragment
    )


def _ling_settings() -> dict:
    """Load LING_BASE_URL, LING_MODEL, and LING_API_KEY from the skill-root .env."""
    path = _ENV_FILE
    if not os.path.isfile(path):
        raise RuntimeError(
            f"Missing required configuration: {path}. "
            f"Copy {_ENV_EXAMPLE} to .env, fill in "
            "LING_BASE_URL, LING_MODEL, and LING_API_KEY, then retry."
        )
    values = _read_dotenv(path)
    missing = [name for name in _LING_KEYS if not values.get(name, "").strip()]
    if missing:
        raise RuntimeError(
            f"Incomplete {path}: missing {', '.join(missing)}. "
            "Fill in these values in .env, then retry. "
            "Do not pass credentials on the command line."
        )
    if not _valid_base_url(values["LING_BASE_URL"]):
        raise RuntimeError(
            f"Invalid LING_BASE_URL in {path}. "
            "Ask the user for the exact OpenAI-compatible API base URL, "
            "usually in the form https://<host>/v1. "
            "Do not use https://example.com/v1 or guess an endpoint."
        )
    return {name: values[name].strip() for name in _LING_KEYS}


# ==================== Layer plan → prompt ====================

def _layer_text(layer) -> str:
    """One plan layer is a string, or a dict with role/desc/name plus note/why."""
    if isinstance(layer, str):
        return layer.strip()
    if isinstance(layer, dict):
        for key in ("role", "desc", "name", "content"):
            if layer.get(key):
                return str(layer[key]).strip()
        raise ValueError(f"plan.layers entry is missing role/desc: {layer}")
    raise ValueError(f"unsupported plan.layers entry type: {type(layer)}")


def _clean_layer_text(desc: str) -> str:
    """Replace ASCII commas inside one layer description with '/'.

    Commas separate layers, so a description must not contain one. This also
    repairs a plan that included them. Fullwidth commas do not split layers
    and are left unchanged.
    """
    return re.sub(r"\s*,\s*(?=\S)", "/", desc).strip().rstrip(",")


def prompt_from_plan(plan) -> str:
    """Render a structured layer plan into the compact API prompt.

    `layers` is front to back; item 1 is frontmost:
        {"layers": [{"role": "text part", "why": "title sits on the hero"}, ...],
         "background": "background environment"}   # optional; default is the last layer
        or {"prompt": "4 layers: 1 ..., 2 ..."}    # already written; use as-is

    Result:
        "4 layers: 1 text part, 2 text card, 3 only burger, 4 background environment"
    """
    if not isinstance(plan, dict):
        raise ValueError("plan must be a dict")
    if plan.get("prompt"):
        return str(plan["prompt"]).strip()

    layers = [_layer_text(x) for x in (plan.get("layers") or [])]
    if not layers:
        raise ValueError("plan has neither prompt nor layers — inspect the image and write a layer plan")
    n = len(layers)
    body = ", ".join(f"{i} {_clean_layer_text(desc)}" for i, desc in enumerate(layers, start=1))
    return f"{n} layers: {body}"


def load_plan(path_or_dir) -> dict:
    """Load a layer plan from a file or a directory containing decompose_plan.json. Missing file returns {}."""
    p = path_or_dir
    if os.path.isdir(p):
        p = os.path.join(p, DEFAULT_PLAN_NAME)
    if not os.path.exists(p):
        return {}
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save_plan(plan: dict, path_or_dir) -> str:
    p = path_or_dir
    if os.path.isdir(p):
        p = os.path.join(p, DEFAULT_PLAN_NAME)
    os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=1)
    return p


def layer_count_of(prompt: str):
    """Parse the layer count from a prompt ("4 layers: ..." / "Number of layers: 4"). Returns None if absent."""
    if not prompt:
        return None
    m = re.search(r"(\d+)\s*layers?", prompt, re.IGNORECASE)
    if m:
        return int(m.group(1))
    m = re.search(r"number of layers[:\s]*(\d+)", prompt, re.IGNORECASE)
    return int(m.group(1)) if m else None


# ==================== Decomposition API ====================

_IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def _endpoint(base_url: str) -> str:
    return base_url.rstrip("/") + "/" + DECOMPOSE_ENDPOINT.lstrip("/")


def _read_image_bytes(source) -> tuple[bytes, str]:
    """Read a local path, bytes, or remote URL into (bytes, mime). A URL is downloaded and inlined; it is not rehosted."""
    if isinstance(source, (bytes, bytearray)):
        return bytes(source), "image/png"
    if not isinstance(source, str) or not source.strip():
        raise ValueError("decompose source must be a local path, image bytes, or a downloadable http(s) URL")
    source = source.strip()
    if source.startswith("data:image"):
        header, _, payload = source.partition(",")
        mime = header.split(";")[0].split(":", 1)[-1] or "image/png"
        return base64.b64decode(payload), mime
    if source.startswith(("http://", "https://")):
        resp = requests.get(source, timeout=DOWNLOAD_TIMEOUT_S)
        if not resp.ok:
            raise RuntimeError(f"failed to download source HTTP {resp.status_code}: {source[:160]}")
        mime = (resp.headers.get("content-type") or "image/png").split(";")[0].strip()
        if mime not in _IMAGE_MIME.values():
            mime = "image/png"
        return resp.content, mime
    if not os.path.isfile(source):
        raise FileNotFoundError(f"source image not found: {source}")
    mime = _IMAGE_MIME.get(os.path.splitext(source)[1].lower(), "image/png")
    with open(source, "rb") as handle:
        return handle.read(), mime


def _source_filename(source, mime: str) -> str:
    if isinstance(source, str) and not source.startswith(("http://", "https://", "data:")):
        name = os.path.basename(source)
        if name:
            return name
    ext = {v: k for k, v in _IMAGE_MIME.items()}.get(mime, ".png")
    return f"image{ext}"


def _form_fields(prompt: str, size, model: str) -> dict[str, str]:
    return {
        "model": model,
        "prompt": prompt,
        "size": str(size),
        "output_format": DECOMPOSE_OUTPUT_FORMAT,
        "response_format": DECOMPOSE_RESPONSE_FORMAT,
        "use_pe": str(DECOMPOSE_USE_PE).lower(),
        "use_sr": str(DECOMPOSE_USE_SR).lower(),
        "stream": str(DECOMPOSE_STREAM).lower(),
    }


def _call_edits_once(source, prompt: str, size, timeout: int) -> list:
    """Call the decomposition API once and return front-to-back layer entries.

    Sends the file as multipart, matching ``client.images.edit(image=[open(...)])``.
    The source is not first turned into a public URL. Entries carry b64_json by
    default; url is only a compatibility channel.
    """
    settings = _ling_settings()
    raw, mime = _read_image_bytes(source)
    resp = requests.post(
        _endpoint(settings["LING_BASE_URL"]),
        headers={
            "Authorization": f"Bearer {settings['LING_API_KEY']}",
            "Accept": "application/json",
        },
        data=_form_fields(prompt, size, settings["LING_MODEL"]),
        files={"image": (_source_filename(source, mime), raw, mime)},
        timeout=timeout,
    )
    try:
        result = resp.json()
    except Exception:
        result = None
    if not resp.ok:
        msg = ""
        if isinstance(result, dict):
            msg = (result.get("error") or {}).get("message") or result.get("message") or ""
        raise RuntimeError(f"decompose HTTP {resp.status_code}: {msg or resp.text[:200]}")

    data = (result or {}).get("data") or []
    items = []
    for i, d in enumerate(data, start=1):
        if not isinstance(d, dict):
            continue
        url = d.get("url") or d.get("image_url")
        if isinstance(url, dict):            # accept {"image_url": {"url": ...}}
            url = url.get("url")
        b64 = d.get("b64_json")
        if url or b64:
            # revised_prompt is structured JSON
            # ({"canvas":[W,H],"regions":[{"category","bbox"}]}): the server's
            # region reading of this image, kept so layer ownership can be checked.
            items.append({"index": i, "url": url, "b64_json": b64,
                          "revised_prompt": d.get("revised_prompt")})
    if not items:
        raise RuntimeError(f"decomposition model returned no layers: {json.dumps(result)[:300]}")
    return items


def decompose_layers(source, prompt: str, size=None, stage: str = "final",
                     attempts: int = None, on_log=print) -> list:
    """Decomposition entry point, with retries. Returns layer entries, not files.

    `source` is a local path, image bytes, or a downloadable http(s) URL
    (downloaded, then uploaded as a file; not rehosted).
    `prompt` is required: layer count, contents, and occlusion come from the
    caller (see prompt_from_plan).
    `size` defaults by stage: probe → 512, final → auto.
    """
    log = on_log or (lambda *_: None)
    if not prompt or not prompt.strip():
        raise ValueError(
            "prompt is required. Inspect the image and write a layer plan "
            "(you choose the count; layer_1 is frontmost). "
            "Use stage=final (size=auto). Do not treat probe output as slide assets.")
    prompt = prompt.strip()
    stage = (stage or "final").lower()
    if stage not in STAGE_SIZE:
        raise ValueError(f"stage must be probe or final, got: {stage}")
    size = STAGE_SIZE[stage] if size is None else str(size)
    attempts = attempts or ATTEMPTS
    timeout = STAGE_TIMEOUT[stage]

    want = layer_count_of(prompt)
    last_error = None
    for attempt in range(1, attempts + 1):
        if attempt > 1:
            time.sleep(RETRY_BACKOFF_S[attempt - 2] if attempt - 2 < len(RETRY_BACKOFF_S) else 15)
        t0 = time.time()
        try:
            items = _call_edits_once(source, prompt, size, timeout)
            got = len(items)
            if want and got != want:
                log(f"[decompose] note: prompt asked for {want} layers, API returned {got}"
                    f" (size={size}, {time.time() - t0:.1f}s)")
            return items
        except Exception as err:
            last_error = err
            log(f"[decompose] attempt {attempt}/{attempts} failed (size={size}): {err}")
    raise last_error


# ==================== Download and save ====================

def _layer_bytes(item) -> bytes:
    """Turn one layer result into bytes: download url first, otherwise decode b64_json."""
    if isinstance(item, str):                # old API: a raw base64 string
        return base64.b64decode(item)
    if isinstance(item, bytes):
        return item
    if isinstance(item, dict):
        url = item.get("url")
        if url:
            resp = requests.get(url, timeout=DOWNLOAD_TIMEOUT_S)
            if not resp.ok:
                raise RuntimeError(f"layer download failed HTTP {resp.status_code}: {url[:160]}")
            return resp.content
        if item.get("b64_json"):
            return base64.b64decode(item["b64_json"])
    raise ValueError(f"unrecognized layer result: {type(item)}")


def _b64_to_image_bytes(b64: str) -> bytes:
    """Decode a base64 string into PNG bytes (kept for older callers)."""
    return base64.b64decode(b64)


def save_layers(items, output_dir: str, prefix: str = "layer") -> list:
    """Write layer results (url / b64 / bytes) to PNG files. Returns absolute paths, front to back.

    Filenames are layer_1.png ... layer_N.png. **1 = frontmost**, matching the prompt numbers.
    """
    os.makedirs(output_dir, exist_ok=True)
    saved = []
    with tempfile.TemporaryDirectory(prefix=".layers-stage-", dir=output_dir) as stage:
        for i, item in enumerate(items, start=1):
            name = f"{prefix}_{i}.png"
            with open(os.path.join(stage, name), "wb") as f:
                f.write(_layer_bytes(item))
            saved.append(os.path.abspath(os.path.join(output_dir, name)))
        publish_layers(stage, output_dir, prefix)
    return saved


def _server_view(items) -> dict:
    """Compress the server's revised_prompt (region JSON) into an inspection summary.

    Observed shape: {"canvas": [3072, 4608], "regions": [{"category": "BackgroundImage",
    "bbox": [2.2, 0.2, 3068.5, 4601.6]}, ...]}. This is the model's reading of the
    source. When it disagrees with the requested count or order, the prompt was
    unclear or the model did not follow it.
    """
    rp = None
    for it in items or []:
        if isinstance(it, dict) and it.get("revised_prompt"):
            rp = it["revised_prompt"]
            break
    if rp is None:
        return {}
    if isinstance(rp, str):
        try:
            rp = json.loads(rp)
        except Exception:
            return {"raw": rp[:400]}
    if not isinstance(rp, dict):
        return {}
    regions = rp.get("regions") or []
    out = {"canvas": rp.get("canvas"), "n_regions": len(regions), "regions": []}
    for r in regions[:12]:
        if not isinstance(r, dict):
            continue
        bbox = []
        for v in (r.get("bbox") or [])[:4]:
            try:
                bbox.append(round(float(v), 1))
            except (TypeError, ValueError):
                bbox.append(None)
        out["regions"].append({"category": r.get("category"), "bbox": bbox})
    return out


def _append_log(output_dir: str, record: dict):
    """Append every call, including failures, to decompose_log.jsonl. Record only; do not summarize."""
    try:
        os.makedirs(output_dir, exist_ok=True)
        with open(os.path.join(output_dir, DEFAULT_LOG_NAME), "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


# ==================== High-level entry: probe / final ====================

def decompose_run(source, output_dir: str, prompt: str, stage: str = "final",
                  size=None, on_log=print, record=True) -> dict:
    """Read a local image, decompose it, save layers, and log the call. Returns the run record."""
    log = on_log or (lambda *_: None)
    stage = (stage or "final").lower()
    size = STAGE_SIZE[stage] if size is None else str(size)
    settings = _ling_settings()
    t0 = time.time()
    result = {
        "ts": int(time.time()), "stage": stage, "size": size,
        "model": settings["LING_MODEL"], "prompt": prompt,
        "prompt_layers": layer_count_of(prompt), "output_dir": os.path.abspath(output_dir),
        "order": LAYER_ORDER_NOTE,
    }
    try:
        items = decompose_layers(source, prompt, size=size, stage=stage, on_log=log)
        paths = save_layers(items, output_dir)
        result.update({
            "ok": True, "n_layers": len(paths), "paths": paths,
            "use_sr": DECOMPOSE_USE_SR,
            "server_view": _server_view(items),
            "elapsed_s": round(time.time() - t0, 1),
        })
        log(f"[decompose] {stage}(size={size}) done: {len(paths)} layers → {output_dir} "
            f"({result['elapsed_s']}s)")
    except Exception as err:
        result.update({"ok": False, "error": f"{type(err).__name__}: {err}",
                       "elapsed_s": round(time.time() - t0, 1)})
        log(f"[decompose] {stage}(size={size}) failed: {err}")
        if record:
            _append_log(output_dir, result)
        raise
    if record:
        _append_log(output_dir, result)
    return result


def probe_layers(source, prompt: str, out_dir: str, round_no: int = None,
                 size=None, on_log=print) -> dict:
    """512 check of whether a prompt separates layers. Do not use the output as slide assets.

    When `round_no` is set, results go to `probe_r<N>/` so rounds can be compared.
    The default size is DECOMPOSE_SIZE_PROBE (512). The image-to-editable-ppt
    workflow does not call this; it starts at size=auto.
    """
    if round_no is not None:
        out_dir = os.path.join(out_dir, f"probe_r{int(round_no)}")
    return decompose_run(source, out_dir, prompt, stage="probe", size=size, on_log=on_log)


def finalize_layers(source, prompt: str, out_dir: str, on_log=print) -> dict:
    """Produce the delivery assets after the prompt is chosen (size=auto)."""
    return decompose_run(source, out_dir, prompt, stage="final", on_log=on_log)


def decompose_image(image_path: str, output_dir: str, prompt: str = None,
                    plan=None, stage: str = "final", size=None,
                    num_layers: int = None, on_log=print) -> list:
    """Read a local image, decompose it, and save PNGs. Returns paths, front to back.

    Provide at least one of prompt or plan:
      prompt="4 layers: 1 ..., 2 ..."        compact prompt
      plan={"layers": [...]}                  structured plan, rendered into a prompt
      neither → try decompose_plan.json beside output_dir or image_path

    `num_layers` exists for older callers. If it is set and prompt/plan are
    missing, this raises instead of defaulting to four layers. The caller
    chooses the count by inspecting the image.
    """
    if not prompt and plan:
        prompt = prompt_from_plan(plan)
    if not prompt:
        for cand in (output_dir, os.path.dirname(os.path.abspath(image_path))):
            p = load_plan(cand)
            if p:
                prompt = prompt_from_plan(p)
                break
    if not prompt:
        raise ValueError(
            "missing layer prompt/plan. Inspect the source and decide the count, "
            "what each layer contains, and which layer is in front "
            "(layer_1 = frontmost). This function no longer defaults to 4 layers."
            + (f" (ignored obsolete num_layers={num_layers})" if num_layers else ""))
    res = decompose_run(image_path, output_dir, prompt, stage=stage, size=size, on_log=on_log)
    return res["paths"]


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(
        description="Layer decomposition. Default stage is final (size=auto), which produces slide assets. probe (size=512) is a check only and is not used by the image-to-editable-ppt workflow.")
    ap.add_argument("input_image", help="local image path")
    ap.add_argument("output_dir", help="layer output directory (layer_1.png = frontmost)")
    ap.add_argument("--prompt", default=None,
                    help='compact layer prompt, e.g. "4 layers: 1 text part, 2 text card, '
                         '3 only burger, 4 background environment"')
    ap.add_argument("--plan", default=None,
                    help="path to decompose_plan.json, or a directory that contains it (layers[] or prompt)")
    ap.add_argument("--stage", default="final", choices=["probe", "final"],
                    help="final=auto assets (default). probe=512 check; do not use those files as slide assets")
    ap.add_argument("--size", default=None, help="override size (default is 512 for probe and auto for final)")
    args = ap.parse_args()

    if not args.prompt and not args.plan:
        ap.error("pass --prompt or --plan. Inspect the image and decide the count, contents, and occlusion. There is no default of 4 layers")

    prompt = args.prompt or prompt_from_plan(load_plan(args.plan))
    r = decompose_run(args.input_image, args.output_dir, prompt,
                      stage=args.stage, size=args.size)
    print(json.dumps(r, ensure_ascii=False, indent=1))
    sys.exit(0 if r.get("ok") else 1)
