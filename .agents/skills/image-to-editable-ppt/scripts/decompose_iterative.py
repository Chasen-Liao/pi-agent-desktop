#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""decompose_iterative.py — one auto pass, inspect each layer, refine failed layers in parallel, then assemble.

Unlike the old flow (several 512 probe rounds, then auto): **there is no low-resolution search**.
One auto call (about 2K, roughly 50–90s) is the first pass. Inspection is per layer:
crop the content bbox of a dirty layer and send that PNG back to auto. Keep clean
layers as they are. Independent failed layers refine concurrently. A child can be
refined again. For the image-to-PPT time budget, do one parallel wave; a second
wave is only for a high-value object with a clear split.

Usage:
    # 1. First auto pass (--src is a local path; the prompt may also come from decompose_plan.json)
    python scripts/decompose_iterative.py <img_dir> --src src.png \
        --prompt "4 layers: 1 text, 2 hero art, 3 containers and accents, 4 background"

    # 2. Inspect layers/auto_preview.png (original | L1..LN | rebuild) and layers/auto_report.json
    python scripts/decompose_iterative.py <img_dir> --inspect     # reread the report; no API call

    # 3. Refine a failed layer: crop its content bbox and split that crop (several may run at once)
    python scripts/decompose_iterative.py <img_dir> --refine 4 \
        --prompt "3 layers: 1 photo content, 2 white frame, 3 background pattern"
    python scripts/decompose_iterative.py <img_dir> --refine 2 --refine 5 --prompt "..."   # shared prompt
    python scripts/decompose_iterative.py <img_dir> --refine 2 --refine 5 \
        --refine-prompts '{"2": "2 layers: ...", "5": "3 layers: ..."}'               # per-layer prompts
    #    a child still fails → --refine 4.1 (dotted path = subtree index, any depth)

    # 4. When every accepted leaf is clean, flatten the tree into final layers
    python scripts/decompose_iterative.py <img_dir> --assemble

Directory layout (all under <img_dir>/):
    layers/layer_1.png ... layer_N.png      first auto layers (layer_1 = frontmost)
    layers/auto_preview.png                 first-pass inspection panel
    layers/auto_report.json                 first-pass mechanical readings
    refine/L4/                              one refinement of L4 (same files; 4.1 nests as refine/L4/refine/L1)
    layers_final/layer_1.png ...            --assemble output, remapped onto the root canvas
    decompose_log.json                      ledger of nodes (root / L4 / L4.1 ...)

Readings are instruments. **The judge is the image**: compare the preview with the source
and decide, layer by layer, whether it is clean, ordered correctly, and reconstructs
the source. Signals are clues (for example "L4 largest component is only 12%"), not verdicts.
"""
import argparse
import json
import os
import re
import sys
import threading
import time
import tempfile
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

import numpy as np                                   # noqa: E402
from PIL import Image, ImageDraw, ImageFont          # noqa: E402

from api_services.image_decomposer import (          # noqa: E402
    STAGE_SIZE, decompose_run, layer_count_of,
    load_plan, prompt_from_plan, save_plan,
)
from api_services.artifact_store import publish_layers

LOG_NAME = "decompose_log.json"
REPORT_NAME = "auto_report.json"
PREVIEW_NAME = "auto_preview.png"
REFINE_DIR = "refine"
FINAL_DIR = "layers_final"
LAYER_CMP_SIDE = int(os.environ.get("PROBE_LAYER_CMP_SIDE", "256"))   # downsample long edge before readings
# Two numeric hint lines, calibrated on the old probe script.
OVERLAP_T = float(os.environ.get("PROBE_OVERLAP_T", "0.15"))     # asset-layer overlap above this means the same object was painted twice
EDGE_PURE_MAX = float(os.environ.get("PROBE_EDGE_PURE_MAX", "3.0"))  # last-layer visual-check hint, not a failure threshold
EMPTY_LAYER_ALPHA = float(os.environ.get("PROBE_EMPTY_ALPHA", "0.003"))  # alpha ceiling for a nearly empty layer
COVERED_T = 0.15          # visible/own area below this means an upper layer mostly covers it (order may be reversed)
BBOX_PAD = 2              # pixels added around a child crop (auto resolution is high; 2px is enough)


# ==================== Node paths (root / L4 / L4.1 = refinement tree ledger) ====================

def node_dir(img_dir, path):
    """Node directory: root → <img_dir>/layers, L4 → refine/L4, L4.1 → refine/L4/refine/L1."""
    if path in ("root", "", None):
        return os.path.join(img_dir, "layers")
    d = img_dir
    for s in path.split("."):
        d = os.path.join(d, REFINE_DIR, f"L{s}")
    return d


def _node_label(path):
    return "root" if path in ("root", "", None) else f"L{path.replace('.', '_')}"


_LOG_LOCK = threading.Lock()      # parallel refine workers all write the ledger


def _read_log_unlocked(img_dir) -> dict:
    p = os.path.join(img_dir, LOG_NAME)
    if not os.path.exists(p):
        return {}
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _write_log_unlocked(img_dir, log):
    p = os.path.join(img_dir, LOG_NAME)
    pending = p + ".pending"
    with open(pending, "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, indent=1)
    os.replace(pending, p)


def read_log(img_dir) -> dict:
    with _LOG_LOCK:
        return _read_log_unlocked(img_dir)


def update_log(img_dir, update_fn):
    """Atomically apply a read-modify-write update during parallel refinement."""
    with _LOG_LOCK:
        log = _read_log_unlocked(img_dir)
        update_fn(log)
        _write_log_unlocked(img_dir, log)
        return log


def node_entry(img_dir, path):
    log = read_log(img_dir)
    return (log.get("nodes") or {}).get(_node_label(path)) or {}


def invalidate_descendants(log, label):
    """Detach old descendants after a node has successfully been regenerated."""
    nodes = log.setdefault("nodes", {})
    # Remove stale ledger entries too, so a direct --refine 2.1 cannot reuse them.
    for key in list(nodes):
        if key != label and (label == "root" or key.startswith(label + "_")):
            del nodes[key]
    if label in nodes:
        nodes[label]["children"] = {}
    log.pop("assembled_at", None)
    log.pop("final_layers", None)


# ==================== Prompt parsing (comma = layer separator) ====================

def layer_roles(prompt: str) -> list:
    """Extract each layer's role from a compact prompt, front to back.

    "4 layers: 1 text part, 2 text card, 3 only burger, 4 background environment"
      → ["text part", "text card", "only burger", "background environment"]
    Split only at a comma or semicolon followed by a number. If parsing fails,
    return [] and still label readings L1..LN.
    """
    if not prompt:
        return []
    tail = prompt.split(":", 1)[1] if ":" in prompt else prompt
    roles = []
    for chunk in re.split(r"[,;]\s*(?=\d+\s*[:.)\-]?\s+)", tail.strip()):
        c = chunk.strip().strip(".").strip()
        if not c:
            continue
        c = re.sub(r"^\d+\s*[:.)\-]?\s*", "", c).strip()
        if c:
            roles.append(c)
    return roles


# ==================== Pixel readings (same instruments as the old probe script) ====================

def _load_rgba(path, size=None):
    img = Image.open(path).convert("RGBA")
    if size and img.size != size:
        img = img.resize(size, Image.LANCZOS)
    return img


def _count_components(mask, cap_side=LAYER_CMP_SIDE):
    """4-connected components of a binary mask (downsampled first) → (count, largest-component ratio)."""
    m = mask
    if m is None or not m.any():
        return 0, 0.0
    h, w = m.shape
    if max(h, w) > cap_side:
        step = max(1, max(h, w) // cap_side)
        m = m[::step, ::step]
        h, w = m.shape
    seen = np.zeros_like(m, dtype=bool)
    comps, biggest = 0, 0
    ys, xs = np.nonzero(m)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        comps += 1
        size = 0
        q = deque([(int(y0), int(x0))])
        seen[y0, x0] = True
        while q:
            y, x = q.popleft()
            size += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        biggest = max(biggest, size)
    denom = int(m.sum())
    return comps, (biggest / denom if denom else 0.0)


def _edge_energy(rgb, mask):
    """Mean absolute RGB difference of neighboring pixels inside the visible area. High means the layer contains objects, not a flat fill."""
    if mask is None or int(mask.sum()) < 16:
        return 0.0
    gy = np.abs(np.diff(rgb, axis=0)).sum(2)
    gx = np.abs(np.diff(rgb, axis=1)).sum(2)
    e = np.zeros(rgb.shape[:2], dtype=np.float32)
    e[:-1, :] += gy
    e[:, :-1] += gx
    m = mask[: e.shape[0], : e.shape[1]]
    return round(float(e[m].mean()), 2) if m.any() else 0.0


def layer_readings(layer_paths, size, roles):
    """Per-layer readings: alpha ratio, bbox, visible alpha, component count. layer_1 is frontmost; visibility is what remains after upper layers cover it."""
    rows = []
    transmit = np.ones(size[::-1], dtype=np.float32)
    masks = []
    for idx, p in enumerate(layer_paths):
        arr = np.asarray(_load_rgba(p, size), dtype=np.float32)
        alpha = arr[..., 3] / 255.0
        vis = alpha * transmit
        transmit = transmit * (1.0 - alpha)
        m = alpha > 0.08
        masks.append(m)
        ys, xs = np.nonzero(m)
        bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None
        comps, biggest_ratio = _count_components(m)
        rows.append({
            "index": idx + 1,
            "role": roles[idx] if idx < len(roles) else None,
            "path": os.path.basename(p),
            "alpha_ratio": round(float(m.mean()), 4),
            "visible_alpha_ratio": round(float((vis > 0.08).mean()), 4),
            "bbox": bbox,
            "components": comps,
            "largest_component_ratio": round(biggest_ratio, 3) if comps else 0.0,
            "edge_energy": _edge_energy(arr[..., :3], alpha > 0.5),
        })
    return rows, masks


def pairwise_overlap(masks, rows, top=8):
    """Pairwise overlap of asset layers = intersection / smaller area. Skip container/text/bg; those overlaps are normal occlusion.

    Also skip a full-canvas underlay (alpha≈1, such as a base split out of a refine
    subtree). Its intersection with any layer equals that layer's area, so 100% is
    noise from complementary stacking, not the same object painted twice.
    """
    kinds = [role_kind(r["role"]) for r in rows]
    idxs = [i for i, k in enumerate(kinds)
            if k in ("single", "multi")
            and 0.002 < rows[i]["alpha_ratio"] < 0.995]
    out = []
    for a in range(len(idxs)):
        for b in range(a + 1, len(idxs)):
            i, j = idxs[a], idxs[b]
            ma, mb = masks[i], masks[j]
            inter = int((ma & mb).sum())
            small = min(int(ma.sum()), int(mb.sum()))
            if small <= 0 or inter == 0:
                continue
            out.append({
                "layers": [rows[i]["index"], rows[j]["index"], ],
                "roles": [rows[i]["role"], rows[j]["role"]],
                "overlap": round(inter / small, 3),
                "inter_px": inter,
            })
    out.sort(key=lambda x: -x["overlap"])
    return out[:top]


def overlay_top_down(layer_paths, size):
    """Composite layers with layer_1 frontmost (alpha-over from back to front) for reconstruction checks."""
    out = Image.new("RGBA", size, (255, 255, 255, 0))
    for p in reversed(list(layer_paths)):
        out = Image.alpha_composite(out, _load_rgba(p, size))
    return out


def reconstruction_diff(composite, src_path, size):
    """Rough composite-vs-source check: mean absolute color difference and how much of the source is covered."""
    if not src_path or not os.path.exists(src_path):
        return {"skipped": "no src"}
    src = _load_rgba(src_path, size).convert("RGB")
    comp = composite.convert("RGB")
    a_src = np.asarray(src, dtype=np.float32)
    a_cmp = np.asarray(comp, dtype=np.float32)
    cover = np.asarray(composite)[..., 3] > 16
    mae = float(np.abs(a_src - a_cmp).mean())
    mae_covered = float(np.abs(a_src[cover] - a_cmp[cover]).mean()) if cover.any() else None
    return {
        "cmp_size": list(size),
        "coverage_ratio": round(float(cover.mean()), 4),
        "mae_rgb_all": round(mae, 2),
        "mae_rgb_covered": round(mae_covered, 2) if mae_covered is not None else None,
    }


def _src_size(path_or_dir):
    cands = []
    if path_or_dir:
        if os.path.isdir(path_or_dir):
            cands = [os.path.join(path_or_dir, c) for c in ("src.png", "src.jpg", "src.jpeg")]
        else:
            cands = [path_or_dir]
    for p in cands:
        if os.path.exists(p):
            try:
                with Image.open(p) as im:
                    return im.size
            except Exception:
                return None
    return None


def text_ownership(img_dir, rows, masks, size, src_path=None):
    """If ui_elements.json exists, report which layer actually sits on top of each text element."""
    p = os.path.join(img_dir, "ui_elements.json")
    if not os.path.exists(p):
        return None
    try:
        els = json.load(open(p, encoding="utf-8"))
    except Exception:
        return None
    if not rows:
        return None
    W, H = size
    iw, ih = _src_size(src_path) or (W, H)
    kx, ky = W / float(iw), H / float(ih)
    out = []
    for el in els:
        cat = str(el.get("category", "")).lower()
        if "text" not in cat or not el.get("box"):
            continue
        try:
            x1, y1, x2, y2 = [float(v) for v in (el.get("box") or [])[:4]]
        except (TypeError, ValueError):
            continue
        bx1, by1 = max(0, int(x1 * kx)), max(0, int(y1 * ky))
        bx2, by2 = min(W, int(x2 * kx)), min(H, int(y2 * ky))
        if bx2 <= bx1 or by2 <= by1:
            continue
        scores = [(r["index"], float(m[by1:by2, bx1:bx2].mean())) for r, m in zip(rows, masks)]
        owner = max(scores, key=lambda t: t[1])[0] if scores else None
        out.append({
            "element_index": el.get("index"),
            "owner_layer": owner,
            "per_layer_alpha": {f"L{i}": round(v, 3) for i, v in scores},
        })
    return out


# Role classes: "many components" means different things for text, icons, and a single illustration.
TEXT_ROLE_WORDS = ("text", "文字", "字样", "标题", "正文", "headline", "title",
                   "caption", "copy", "typography", "words", "letters", "typo")
MULTI_ROLE_WORDS = ("icon", "图标", "badge", "徽章", "logo", "bullet",
                    "项目符号", "glyph", "marker", "decoration", "装饰",
                    # Texture and pattern layers are naturally thousands of small pieces
                    # (a measured grid had 6676 components). Class them as multi, or the
                    # largest-component signal raises a false alarm.
                    "pattern", "texture", "grid", "lines", "纹理", "图案", "网格", "格纹")
CONTAINER_ROLE_WORDS = ("card", "panel", "box", "frame", "holder",
                        "banner", "tile", "container", "卡片", "容器", "面板")
# Strip these first. Otherwise "no background" classifies an asset layer as background.
NEGATION_PHRASES = ("no background", "without background", "exclude background",
                    "not background", "no card", "without card", "no panel",
                    "no other object", "no objects", "no object", "no plate",
                    "no shadow", "no text", "去除背景", "无背景", "不含背景", "无卡片")


def _strip_negations(r: str) -> str:
    for neg in NEGATION_PHRASES:
        r = r.replace(neg, " ")
    return r


def _hit(words, r):
    for w in words:
        if w.isascii():
            if re.search(rf"(?<![a-z]){re.escape(w)}(?:s|es)?(?![a-z])", r):
                return True
        elif w in r:
            return True
    return False


def is_bg(role):
    r = _strip_negations((role or "").lower())
    return any(w in r for w in ("background", "环境", "背景", "environment", "backdrop"))


def role_kind(role):
    """bg / container / text / multi / single. This order avoids the known mislabels."""
    r = (role or "").lower()
    if is_bg(r):
        return "bg"
    r = _strip_negations(r)
    if _hit(CONTAINER_ROLE_WORDS, r):
        return "container"
    if _hit(TEXT_ROLE_WORDS, r):
        return "text"
    if _hit(MULTI_ROLE_WORDS, r):
        return "multi"
    return "single"


def build_signals(rows, roles, recon, ownership, prompt_layers, overlaps=None, sub=False):
    """Mechanical hints, not verdicts. List obvious suspicions for the person inspecting the preview.

    sub=True means a refine subtree whose input is one layer's crop. "The last layer
    should be the background" and "last-layer edge energy" apply only to the full
    image. A crop's last layer is that crop's local base, not the slide background.
    """
    sig = []
    if prompt_layers and len(rows) != prompt_layers:
        sig.append(f"prompt asked for {prompt_layers} layers, got {len(rows)} — the model did not follow the plan; "
                   f"make each layer say what it contains and what it excludes, or use fewer layers")
    for r in rows:
        kind = role_kind(r["role"])
        if r["alpha_ratio"] <= EMPTY_LAYER_ALPHA:
            sig.append(f"L{r['index']}({r['role']}) is nearly empty (alpha={r['alpha_ratio']}) — "
                       f"its asset was not separated and was likely absorbed by a neighbor; add an exclusion to that neighbor, or drop this layer")
        elif r["visible_alpha_ratio"] < COVERED_T * r["alpha_ratio"]:
            covered = 1 - r["visible_alpha_ratio"] / max(r["alpha_ratio"], 1e-9)
            sig.append(f"L{r['index']}({r['role']}) is {covered:.0%} covered by upper layers — the order may be reversed "
                       f"(whatever occludes in the source belongs in front), or it holds the same objects as the layer above")
        if kind == "single" and r["components"] > 1 and 0 < r["largest_component_ratio"] < 0.2:
            sig.append(f"L{r['index']}({r['role']}) largest piece is only {r['largest_component_ratio']:.0%}"
                       f" ({r['components']} pieces) — one asset was broken apart, "
                       f"or other content was mixed in: --refine {r['index']} to split this layer alone")
    if not sub and not sig and roles and roles[-1] and not is_bg(roles[-1]):
        sig.append(f"the last layer is described as '{roles[-1]}' — the last layer should be the background; check the plan")
    if recon and not recon.get("skipped"):
        if recon["coverage_ratio"] < 0.9:
            sig.append(f"rebuild coverage is only {recon['coverage_ratio']:.0%} — some content was not placed on any layer")
        elif recon.get("mae_rgb_covered") is not None and recon["mae_rgb_covered"] > 24:
            sig.append(f"mean color difference in the covered area is {recon['mae_rgb_covered']} — inspect the preview for duplicated objects; "
                       f"do not tune to this number")
    if ownership:
        owners = [o["owner_layer"] for o in ownership if o["owner_layer"]]
        if owners and owners.count(1) < len(owners) * 0.5 and roles and role_kind(roles[0]) == "text":
            sig.append("the prompt calls L1 the text layer, but most text pixels are owned by another layer — "
                       "text was merged downward, or the order should flip (art that covers text belongs in front)")
    if not sub and rows and is_bg(rows[-1]["role"]) and (rows[-1].get("edge_energy") or 0) > EDGE_PURE_MAX:
        sig.append(f"last layer L{rows[-1]['index']} edge energy {rows[-1]['edge_energy']} > {EDGE_PURE_MAX} — "
                   f"the background may contain a pattern or an object. Check it once visually: objects that must move independently belong on a front layer; "
                   f"content that should stay put and is hard to separate can be recorded as locked_background_content. Do not loop on this reading")
    for o in overlaps or []:
        if o["overlap"] > OVERLAP_T:
            sig.append(f"L{o['layers'][0]} overlaps L{o['layers'][1]} by {o['overlap']:.0%} (threshold {OVERLAP_T:.0%}) — "
                       f"the same object was redrawn on two layers: merge them, or --refine one of them")
    return sig


# ==================== Inspection panel ====================

def _checkerboard(size, cell=16):
    """Checkerboard behind transparency so each layer's shape is visible."""
    w, h = size
    img = Image.new("RGB", size, (236, 236, 236))
    d = ImageDraw.Draw(img)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if ((x // cell) + (y // cell)) % 2 == 0:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(207, 207, 207))
    return img.convert("RGBA")


def build_preview(src_path, layer_rows, layer_dir, composite, out_path, size, cap_h=64):
    """Source | L1 | L2 | ... | LN | rebuild. One panel; judge by eye, not by the numbers."""
    cw, ch = size
    cells = []
    if src_path and os.path.exists(str(src_path)):
        cells.append(("SRC original", _load_rgba(src_path, size)))
    for r in layer_rows:
        p = os.path.join(layer_dir, r["path"])
        lab = f"L{r['index']} {r['role'] or ''}".strip()
        cells.append((lab[:34], Image.alpha_composite(_checkerboard(size), _load_rgba(p, size))))
    cells.append(("REBUILD (bottom to top)", Image.alpha_composite(_checkerboard(size), composite)))

    n = max(1, len(cells))
    panel_w, panel_h = cw * n, ch + cap_h
    panel = Image.new("RGB", (panel_w, panel_h), (255, 255, 255))
    d = ImageDraw.Draw(panel)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", max(13, cap_h // 3))
    except Exception:
        font = ImageFont.load_default()

    for i, (label, im) in enumerate(cells):
        panel.paste(im.convert("RGB"), (i * cw, 0))
        d.line([(i * cw, 0), (i * cw, panel_h)], fill=(150, 150, 150), width=1)
        d.text((i * cw + 8, ch + 8), label, fill=(20, 20, 20), font=font)
    panel.save(out_path)
    return out_path


# ==================== Source image ====================

def find_src(img_dir, src=None):
    if src:
        return src if os.path.isabs(src) else os.path.join(img_dir, src)
    for cand in ("src.png", "src.jpg", "src.jpeg"):
        p = os.path.join(img_dir, cand)
        if os.path.exists(p):
            return p
    raise SystemExit(f"source image not found: pass --src or place src.png in {img_dir}")


def reuse_source(img_dir, args):
    """Reuse the local source path remembered from the first pass when --src is omitted."""
    if getattr(args, "src", None):
        return find_src(img_dir, args.src)
    plan = load_plan(img_dir) or {}
    for key in ("src", "source"):
        p = plan.get(key)
        if p and os.path.exists(p):
            return p
    for cand in ("src.png", "src.jpg", "src.jpeg"):
        p = os.path.join(img_dir, cand)
        if os.path.exists(p):
            return p
    raise SystemExit("source image not found: pass --src, or run the first auto pass")


def materialize_src(img_src, out_dir):
    """Make sure reconstruction and the preview can read local source pixels."""
    if os.path.exists(str(img_src)):
        return img_src
    return None


def resolve_prompt(img_dir, args):
    if args.prompt:
        return args.prompt.strip(), "cli"
    plan = load_plan(args.plan or img_dir)
    if plan:
        try:
            return prompt_from_plan(plan), ("--plan" if args.plan else "decompose_plan.json")
        except ValueError as e:
            raise SystemExit(f"could not read a prompt from the layer plan: {e}\n"
                             f"  → pass --prompt \"N layers: 1 ..., 2 ..., N background\"")
    raise SystemExit("missing layer prompt: pass --prompt, or write <img_dir>/decompose_plan.json "
                     "(you choose the count and contents by inspecting the image; layer_1 = frontmost)")


# ==================== Run one node (auto + readings + preview + ledger) ====================

def run_node(img_dir, path, source, prompt, local_src):
    """Run one auto decomposition for a node (root or a layer subtree) and write readings, a preview, and the ledger."""
    out_dir = node_dir(img_dir, path)
    label = _node_label(path)
    print(f"==> auto decompose [{label}] (size={STAGE_SIZE['final']})")
    print(f"    prompt: {prompt}")
    res = decompose_run(source, out_dir, prompt, stage="final")

    with Image.open(res["paths"][0]) as _im:
        size = _im.size
    roles = layer_roles(prompt)
    rows, masks = layer_readings(res["paths"], size, roles)
    composite = overlay_top_down(res["paths"], size)
    composite.save(os.path.join(out_dir, "rebuild.png"))
    recon = reconstruction_diff(composite, local_src, size) if path in ("root", "", None) \
        else {"skipped": "sublayer crop (inspect only this layer bbox; see the preview)"}
    ownership = text_ownership(img_dir, rows, masks, size, src_path=local_src or img_dir) \
        if path in ("root", "", None) else None
    is_root = path in ("root", "", None)
    overlaps = pairwise_overlap(masks, rows)
    signals = build_signals(rows, roles, recon, ownership, res.get("prompt_layers"),
                            overlaps, sub=not is_root)
    preview = build_preview(local_src if path in ("root", "", None) else None,
                            rows, out_dir, composite,
                            os.path.join(out_dir, PREVIEW_NAME), size)

    report = {
        "node": label, "path": path or "root",
        "stage": "auto", "size": res.get("size"), "model": res.get("model"),
        "prompt": prompt, "prompt_layers": res.get("prompt_layers"),
        "returned_layers": res.get("n_layers"), "layer_roles": roles,
        "layer_order": res.get("order"), "layer_px": list(size),
        "server_view": res.get("server_view") or {},
        "layers": rows, "reconstruction": recon, "text_ownership": ownership,
        "layer_overlap": overlaps, "signals": signals,
        "preview": os.path.basename(preview),
        "elapsed_s": res.get("elapsed_s"), "ts": res.get("ts"),
    }
    with open(os.path.join(out_dir, REPORT_NAME), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)

    def _record(log):
        invalidate_descendants(log, label)
        nodes = log.setdefault("nodes", {})
        entry = nodes.setdefault(label, {
            "path": path or "root",
            "src": os.path.abspath(str(source)) if os.path.exists(str(source)) else str(source),
            "children": {},
        })
        entry.update({
            "prompt": prompt,
            "n_layers": res.get("n_layers"),
            "size": res.get("size"),
            "canvas": list(size),
            "ts": res.get("ts"),
            "report": os.path.relpath(os.path.join(out_dir, REPORT_NAME), img_dir),
            "preview": os.path.relpath(preview, img_dir),
        })

    update_log(img_dir, _record)

    # ---- human-readable summary ----
    print(f"\n--- [{label}] readings (instruments, not a verdict; inspect the preview layer by layer)---")
    print(f"  layer pixels: {size[0]}x{size[1]} (size={res.get('size')} scaled to the source aspect ratio)")
    sv = res.get("server_view") or {}
    if sv.get("canvas"):
        cats = ",".join(str(x.get("category")) for x in (sv.get("regions") or []))
        print(f"  server region reading: canvas={sv['canvas']} regions={sv.get('n_regions')} [{cats}]")
    for r in rows:
        print(f"  L{r['index']} [{r['role'] or '-'}] alpha={r['alpha_ratio']:.3f} "
              f"visible={r['visible_alpha_ratio']:.3f} components={r['components']} "
              f"edge={r.get('edge_energy')} bbox={r['bbox']}")
    if not recon.get("skipped"):
        print(f"  rebuild: coverage={recon['coverage_ratio']:.2f} mean color diff={recon['mae_rgb_all']} "
              f"(covered {recon.get('mae_rgb_covered')})")
    if ownership:
        print("  text ownership: " + ", ".join(
            f"element#{o.get('element_index')}→L{o['owner_layer']}" for o in ownership[:8]))
    if overlaps:
        print("  asset-layer overlap: " + ", ".join(
            f"L{o['layers'][0]}∩L{o['layers'][1]}={o['overlap']:.0%}" for o in overlaps[:4])
              + f" (>{OVERLAP_T:.0%} means the same object was painted on two layers)")
    if signals:
        print("\n--- mechanical hints ---")
        for s in signals:
            print(f"  ! {s}")
    else:
        print("\n--- mechanical hints --- (none)")
    print(f"\ninspect layers: {preview}")
    print(f"report: {os.path.join(out_dir, REPORT_NAME)}")
    print(f"\nnext (judge each layer visually; keep clean layers and refine failed ones):")
    print(f"  · dirty layer → refine it alone: --refine <index> --prompt \"child-layer plan\""
          f" (several failed layers can run in one command: --refine 2 --refine 4)")
    print(f"  · all clean   → --assemble writes the final layers")
    return 0


# ==================== refine: crop a failed layer bbox and split it with auto, concurrently ====================

def _parse_refine_specs(refines):
    out = []
    for r in refines or []:
        r = str(r).strip().lstrip("Ll").strip()
        if not re.fullmatch(r"\d+(\.\d+)*", r):
            raise SystemExit(f"--refine id must look like 4 or 4.1 (subtree path), got: {r}")
        out.append(r)
    if len(set(out)) != len(out):
        raise SystemExit(f"duplicate --refine id: {refines}")
    if any(a != b and b.startswith(a + ".") for a in out for b in out):
        raise SystemExit("cannot refine a parent and its descendant in the same wave; rerun the parent first")
    return out


def _crop_layer_png(layer_png, out_png, pad=BBOX_PAD):
    """Crop this layer's content bbox to a PNG, the input of the child decomposition.

    Same threshold as the readings (alpha>0.08). Faint edge noise is common, and alpha>0 would expand the bbox
    to the full canvas, wasting resolution and pulling in unrelated pixels.
    """
    im = Image.open(layer_png).convert("RGBA")
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > 0.08 * 255)
    if not len(xs):
        raise SystemExit(f"{layer_png} is an empty layer (alpha is all 0); nothing to refine")
    x1, y1 = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    x2, y2 = min(im.width, int(xs.max()) + 1 + pad), min(im.height, int(ys.max()) + 1 + pad)
    im.crop((x1, y1, x2, y2)).save(out_png)
    return [x1, y1, x2, y2]


def do_refine(img_dir, args):
    specs = _parse_refine_specs(args.refine)
    prompts = {}
    if args.refine_prompts:
        try:
            raw = json.loads(args.refine_prompts)
        except Exception as e:
            raise SystemExit(f"--refine-prompts is not valid JSON: {e}")
        prompts = {str(k).strip().lstrip("Ll"): str(v) for k, v in raw.items()}
    if args.prompt:
        for s in specs:
            prompts.setdefault(s, args.prompt.strip())
    missing = [s for s in specs if not prompts.get(s)]
    if missing:
        raise SystemExit(f"these refine targets have no prompt: {missing}\n"
                         f"  → --prompt \"...\" (shared) or --refine-prompts '{{\"4\": \"...\"}}' (each)")

    jobs = []
    for s in specs:
        parent = s.rsplit(".", 1)[0] if "." in s else "root"
        idx = int(s.split(".")[-1])
        pentry = node_entry(img_dir, parent)
        if not pentry.get("n_layers"):
            raise SystemExit(f"parent {parent} has not been decomposed (the ledger has no layer count) — run auto or refine first")
        if idx < 1 or idx > pentry["n_layers"]:
            raise SystemExit(f"{parent} has only {pentry['n_layers']} layers; refine index {idx} is out of range")
        layer_png = os.path.join(node_dir(img_dir, parent), f"layer_{idx}.png")
        if not os.path.exists(layer_png):
            raise SystemExit(f"layer file not found: {layer_png}")
        crop_png = os.path.join(node_dir(img_dir, s), "crop.png")
        os.makedirs(os.path.dirname(crop_png), exist_ok=True)
        bbox = _crop_layer_png(layer_png, crop_png)
        jobs.append({"spec": s, "parent": parent, "idx": idx,
                     "layer_png": layer_png, "crop_png": crop_png, "bbox": bbox,
                     "prompt": prompts[s]})

    for j in jobs:
        print(f"  · L{j['spec']} crop written: {j['crop_png']} bbox={j['bbox']}")

    # Refine failed layers concurrently. Each worker only reads its own crop.png.
    def _run(j):
        return j["spec"], run_node(img_dir, j["spec"], j["crop_png"], j["prompt"], None)

    succeeded = []
    failed = []
    if len(jobs) > 1:
        print(f"==> parallel refine of {len(jobs)} failed layers: {[j['spec'] for j in jobs]}")
        with ThreadPoolExecutor(max_workers=min(len(jobs), 8)) as ex:
            futs = {ex.submit(_run, j): j for j in jobs}
            for fut in as_completed(futs):
                j = futs[fut]
                try:
                    fut.result()
                    succeeded.append(j)
                except Exception as e:
                    failed.append(j)
                    print(f"\n  ! refine L{j['spec']} failed: {type(e).__name__}: {e}"
                          f" (rerun that id; other layers are unchanged)")
    else:
        _run(jobs[0])
        succeeded.append(jobs[0])

    # Record parent links and bboxes in the ledger; --assemble needs them.
    def _record_links(log):
        nodes = log.setdefault("nodes", {})
        for j in succeeded:
            pentry = nodes.setdefault(_node_label(j["parent"]), {"children": {}})
            kids = pentry.setdefault("children", {})
            kids[str(j["idx"])] = {
                "node": _node_label(j["spec"]), "path": j["spec"],
                "crop_bbox": j["bbox"], "prompt": j["prompt"],
            }
            centry = nodes.setdefault(_node_label(j["spec"]), {"path": j["spec"], "children": {}})
            centry.setdefault("children", {})
            centry["parent"] = _node_label(j["parent"])
            centry["parent_layer"] = j["idx"]
            centry["crop_bbox"] = j["bbox"]

    update_log(img_dir, _record_links)
    if not succeeded:
        raise SystemExit("every refine task failed; the tree was not changed, rerun the failed ids")
    print(f"\nInspect child layers the same way (preview is in each refine directory). If a child is still dirty, continue with "
          f"--refine {succeeded[0]['spec']}.1  to split further. When every leaf is clean, run --assemble.")
    return 1 if failed else 0


# ==================== inspect: reread readings, no API call ====================

def do_inspect(img_dir, args):
    path = (args.node or "root").strip().lstrip("Ll") or "root"
    if path != "root" and not re.fullmatch(r"\d+(\.\d+)*", path):
        raise SystemExit(f"--node must look like root / 4 / 4.1, got: {args.node}")
    label = _node_label(path)
    rp = os.path.join(node_dir(img_dir, path), REPORT_NAME)
    if not os.path.exists(rp):
        raise SystemExit(f"{label} has not been decomposed ({rp} does not exist)")
    report = json.load(open(rp, encoding="utf-8"))
    print(f"==> [{label}] (reread only, no API call) prompt: {report.get('prompt')}")
    for r in report.get("layers", []):
        print(f"  L{r['index']} [{r.get('role') or '-'}] alpha={r.get('alpha_ratio')} "
              f"visible={r.get('visible_alpha_ratio')} components={r.get('components')} "
              f"edge={r.get('edge_energy')} bbox={r.get('bbox')}")
    for o in report.get("layer_overlap") or []:
        print(f"  L{o['layers'][0]}∩L{o['layers'][1]} overlap={o['overlap']:.0%}"
              + (" (same object on two layers)" if o["overlap"] > OVERLAP_T else ""))
    recon = report.get("reconstruction") or {}
    if not recon.get("skipped"):
        print(f"  rebuild: coverage={recon.get('coverage_ratio')} mean color diff={recon.get('mae_rgb_all')} "
              f"(covered {recon.get('mae_rgb_covered')})")
    for s in report.get("signals") or []:
        print(f"  ! {s}")
    print(f"\ninspect visually: {os.path.join(node_dir(img_dir, path), PREVIEW_NAME)}")
    return 0


# ==================== assemble: flatten the tree into final layers ====================

def _flatten(node_label_, nodes):
    """DFS flatten: replace a parent layer in place with its subtree, front to back (child bboxes stay inside the parent bbox,
    and the subtree keeps the crop's occlusion order, so global order is preserved). Returns [(node, layer_idx)]."""
    entry = nodes.get(node_label_) or {}
    kids = entry.get("children") or {}
    out = []
    for i in range(1, (entry.get("n_layers") or 0) + 1):
        child = kids.get(str(i))
        if child and (nodes.get(child["node"]) or {}).get("n_layers"):
            out.extend(_flatten(child["node"], nodes))
        else:
            out.append((node_label_, i))
    return out


def _node_root_box(node_label_, nodes, memo=None):
    """Map a node's entire local canvas to a rectangle on the root canvas."""
    memo = memo if memo is not None else {}
    if node_label_ in memo:
        return memo[node_label_]
    root_canvas = (nodes.get("root") or {}).get("canvas")
    if not root_canvas or len(root_canvas) != 2:
        raise SystemExit("ledger is missing root.canvas; rerun root auto with this script")
    if node_label_ == "root":
        box = [0.0, 0.0, float(root_canvas[0]), float(root_canvas[1])]
        memo[node_label_] = box
        return box

    entry = nodes.get(node_label_) or {}
    parent_label = entry.get("parent")
    crop = entry.get("crop_bbox")
    if not parent_label or not crop or len(crop) != 4:
        raise SystemExit(f"{node_label_} is missing parent/crop_bbox, so it cannot be mapped onto the root canvas")
    parent = nodes.get(parent_label) or {}
    parent_canvas = parent.get("canvas")
    if not parent_canvas or len(parent_canvas) != 2:
        raise SystemExit(f"{parent_label} is missing canvas, so this child cannot be mapped: {node_label_}")
    pw, ph = float(parent_canvas[0]), float(parent_canvas[1])
    if pw <= 0 or ph <= 0:
        raise SystemExit(f"{parent_label}.canvas is invalid: {parent_canvas}")
    px, py, proot_w, proot_h = _node_root_box(parent_label, nodes, memo)
    x1, y1, x2, y2 = [float(v) for v in crop]
    box = [
        px + x1 / pw * proot_w,
        py + y1 / ph * proot_h,
        max(0.0, (x2 - x1) / pw * proot_w),
        max(0.0, (y2 - y1) / ph * proot_h),
    ]
    memo[node_label_] = box
    return box


def _embed_on_root(srcp, dst, root_canvas, root_box):
    """Resize one node-local layer and place it back on a transparent root canvas."""
    root_w, root_h = [int(v) for v in root_canvas]
    x, y, w, h = root_box
    left = max(0, min(root_w, int(round(x))))
    top = max(0, min(root_h, int(round(y))))
    right = max(left, min(root_w, int(round(x + w))))
    bottom = max(top, min(root_h, int(round(y + h))))
    if right <= left or bottom <= top:
        raise SystemExit(f"mapped layer region is empty: {root_box}")
    with Image.open(srcp) as source:
        layer = source.convert("RGBA")
    if layer.size != (right - left, bottom - top):
        resampling = getattr(Image, "Resampling", Image)
        layer = layer.resize((right - left, bottom - top), resampling.LANCZOS)
    canvas = Image.new("RGBA", (root_w, root_h), (0, 0, 0, 0))
    canvas.alpha_composite(layer, (left, top))
    canvas.save(dst)
    return [left, top, right, bottom]


def _assemble_layers(img_dir, nodes, out_dir):
    """Build a complete assembly in a staging directory."""
    if not (nodes.get("root") or {}).get("n_layers"):
        raise SystemExit("root has no auto pass yet — run once with --prompt")
    seq = _flatten("root", nodes)
    if not seq:
        raise SystemExit("flatten produced nothing; the ledger may be corrupt")
    root_canvas = nodes["root"].get("canvas")
    if not root_canvas or len(root_canvas) != 2:
        raise SystemExit("root ledger is missing the output canvas; rerun root auto with this script")
    manifest = []
    memo = {}
    for n, (label, idx) in enumerate(seq, start=1):
        path = "root" if label == "root" else label[1:].replace("_", ".")
        srcp = os.path.join(node_dir(img_dir, path), f"layer_{idx}.png")
        if not os.path.exists(srcp):
            raise SystemExit(f"ledger points at a missing layer: {srcp} — that node may not have finished; rerun its refine")
        dst = os.path.join(out_dir, f"layer_{n}.png")
        root_box = _node_root_box(label, nodes, memo)
        placed_box = _embed_on_root(srcp, dst, root_canvas, root_box)
        roles = layer_roles((nodes.get(label) or {}).get("prompt") or "")
        role = roles[idx - 1] if idx - 1 < len(roles) else None
        manifest.append({
            "final_index": n,
            "source": f"{label}/layer_{idx}.png",
            "role": role,
            "root_bbox": placed_box,
            "canvas": [int(root_canvas[0]), int(root_canvas[1])],
        })
        print(f"  layer_{n}.png  ←  {label}/layer_{idx}.png  root_bbox={placed_box}"
              + (f"  [{role}]" if role else ""))

    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"order": "layer_1 = topmost (front); last layer = background",
                   "canvas": [int(root_canvas[0]), int(root_canvas[1])],
                   "layers": manifest, "ts": int(time.time())}, f, ensure_ascii=False, indent=1)

    return len(seq)


def do_assemble(img_dir, args):
    nodes = (read_log(img_dir).get("nodes") or {})
    out_dir = os.path.join(img_dir, FINAL_DIR)
    with tempfile.TemporaryDirectory(prefix=".assembly-stage-", dir=img_dir) as stage:
        count = _assemble_layers(img_dir, nodes, stage)
        publish_layers(stage, out_dir, include_manifest=True)

    def _record_assembly(current):
        current["assembled_at"] = int(time.time())
        current["final_layers"] = count

    update_log(img_dir, _record_assembly)
    print(f"\n==> final {count} layers → {out_dir}/layer_1.png ... layer_{count}.png"
          f" (1 = frontmost; manifest.json records which node each layer came from)")
    return 0


# ==================== Entry point ====================

def main():
    ap = argparse.ArgumentParser(
        description="one auto pass, inspect each layer, refine failed layers in parallel, then assemble",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("img_dir", help="single-image case directory (should contain src.png)")
    ap.add_argument("--src", default=None, help="local source image (default <img_dir>/src.png)")
    ap.add_argument("--prompt", default=None,
                    help='compact layer prompt, for example "4 layers: 1 text part, 2 text card, 3 only burger, '
                         '4 background environment"')
    ap.add_argument("--plan", default=None, help="path to decompose_plan.json, or a directory that contains it")
    ap.add_argument("--refine", action="append", default=None, metavar="LAYER",
                    help="failed layer id (4 or subtree path 4.1); repeat to refine several layers at once")
    ap.add_argument("--refine-prompts", default=None,
                    help='per-target refine prompt JSON, for example \'{"4": "3 layers: ..."}\'')
    ap.add_argument("--assemble", action="store_true",
                    help="flatten every refine subtree and write final layers, front to back, into layers_final/")
    ap.add_argument("--inspect", action="store_true", help="reread one node's readings and preview; no API call")
    ap.add_argument("--node", default=None, help="which node --inspect reads (root / 4 / 4.1)")
    args = ap.parse_args()

    img_dir = os.path.abspath(args.img_dir)
    if not os.path.isdir(img_dir):
        raise SystemExit(f"directory does not exist: {img_dir}")

    if args.assemble:
        return do_assemble(img_dir, args)
    if args.inspect:
        return do_inspect(img_dir, args)
    if args.refine:
        return do_refine(img_dir, args)

    # first auto pass
    prompt, prompt_src = resolve_prompt(img_dir, args)
    img_src = reuse_source(img_dir, args)
    local_src = materialize_src(img_src, img_dir)
    rc = run_node(img_dir, "root", img_src, prompt, local_src)

    plan = load_plan(img_dir) or {}
    plan["prompt"] = prompt
    plan["prompt_source"] = prompt_src
    plan.setdefault("image", os.path.basename(local_src or str(img_src)))
    if os.path.exists(str(img_src)):
        plan["src"] = os.path.abspath(str(img_src))
    rp = os.path.join(node_dir(img_dir, "root"), REPORT_NAME)
    if os.path.exists(rp):
        rep = json.load(open(rp, encoding="utf-8"))
        plan["n_layers"] = rep.get("returned_layers")
    save_plan(plan, img_dir)
    return rc


if __name__ == "__main__":
    sys.exit(main())
