# Scene schema

Read this when writing or correcting `scene.json`. The scene is a compact, source-pixel DOM compiled deterministically into one PowerPoint slide.

## Root

```json
{
  "version": 1,
  "title": "Reference slide",
  "canvas": {"width": 1920, "height": 1080},
  "background": {"asset": "layers_final/layer_4.png", "color": "#FFFFFF"},
  "nodes": []
}
```

- Use `layers_final/manifest.json.canvas`, not the original upload dimensions, when the decomposition service resized the source.
- Set `background.asset` to the last layer in `layers_final/manifest.json` (`layer_N.png`). The example uses `layer_4.png` because a normal four-layer plan leaves the background there. After refinement, use the last filename the manifest actually lists.
- Asset paths are relative to the case directory and may not escape it.
- `background.asset` takes precedence over `background.color`.
- By default the slide preserves the canvas aspect ratio inside a 13.333-inch maximum width. To force physical dimensions, add `"slide": {"width_in": 13.333, "height_in": 7.5}` without changing the aspect ratio.
- Node `bbox` values are `[x, y, width, height]` in canvas pixels.
- Lower `z` values render first.

## Cropped image

```json
{
  "id": "hero-art",
  "type": "image",
  "asset": "assets/hero/hero.png",
  "bbox": [220, 190, 760, 640],
  "z": 30,
  "rotation_deg": -2.5
}
```

`crop_alpha_assets.py` writes a manifest box as `[left, top, right, bottom]`. Convert it to scene form as `[left, top, right-left, bottom-top]`.

Use the crop's actual box, not the original full canvas. Rotation is clockwise in degrees.

## Image-filled native shape

Use this for a photo clipped by a simple PowerPoint geometry:

```json
{
  "id": "photo-card",
  "type": "image",
  "asset": "assets/photos/photo_1.png",
  "bbox": [1080, 240, 360, 420],
  "shape": "roundRect",
  "rotation_deg": 3,
  "z": 25,
  "style": {"radius_in": 0.08}
}
```

This is emitted as a `p:sp` with a bitmap fill, so the outer container remains a native PowerPoint shape.

## Native shape

```json
{
  "id": "summary-card",
  "type": "shape",
  "shape": "roundRect",
  "bbox": [90, 170, 620, 410],
  "rotation_deg": 0,
  "z": 10,
  "style": {
    "fill": "#FFFFFF",
    "opacity": 0.96,
    "border": "#D9DDE7",
    "border_width_pt": 1,
    "border_opacity": 1,
    "radius_in": 0.12
  }
}
```

Supported preset names include `rect`, `roundRect`, `ellipse`, and `triangle`. Model a straight separator as a very thin `rect` for predictable PowerPoint rendering.

## Editable text

```json
{
  "id": "title",
  "type": "text",
  "text": "Cities to explore.",
  "bbox": [620, 120, 680, 90],
  "z": 100,
  "style": {
    "font_size_px": 54,
    "font_family": "Arial",
    "font_family_ea": "Microsoft YaHei",
    "color": "#A33125",
    "bold": true,
    "align": "center",
    "valign": "middle",
    "line_height_pct": 100,
    "margin_in": 0,
    "fit": "shrink"
  }
}
```

Rules:

- Preserve explicit line breaks with `\n`.
- Use the visually closest installed font. The source text and render are authoritative.
- `font_size_px` is scaled with the canvas. `font_size_pt` is also accepted. Either explicit size is compiled unchanged, rounded to 0.1pt. The compiler estimates a size only when both are omitted. That estimate treats each line as one unwrapped run, so it ignores wrapping and condensed fonts and must not replace a measured size. An explicit 24pt used to become 5.2pt even with `fit: "none"`.
- Accepted alignment values include `left`, `center`, and `right`; vertical alignment accepts `top`, `middle`, and `bottom`.
- `fit: "shrink"` asks PowerPoint to autofit inside the box. It starts from the explicit size when one is set and does not change the compiled point size. The box still needs enough height for that autofit to look right. For a size measured from the source, set `fit: "none"` so PowerPoint does not shrink the glyphs, then confirm the compiled `pt` and the real render.
- Add `rotation_deg` on the node for rotated text.
- Use `needs_review: true` while any transcription is uncertain. `scene_to_pptx.py --strict-review` refuses to compile such a scene.

Mixed-format text uses runs:

```json
{
  "id": "metric",
  "type": "text",
  "bbox": [100, 700, 500, 90],
  "z": 100,
  "runs": [
    {"text": "42", "style": {"font_size_px": 68, "bold": true, "color": "#5B21B6"}},
    {"text": " projects", "style": {"font_size_px": 34, "color": "#242424"}}
  ],
  "style": {"font_family": "Arial", "valign": "middle", "margin_in": 0}
}
```

## Logical group

Groups are optional organizational wrappers. Children keep absolute canvas coordinates and inherit the group's z offset.

```json
{
  "id": "feature-one",
  "type": "group",
  "z": 40,
  "children": [
    {"type": "shape", "shape": "roundRect", "bbox": [100, 300, 420, 240], "z": 0, "style": {"fill": "#FFFFFF"}},
    {"type": "image", "asset": "assets/icon.png", "bbox": [130, 330, 56, 56], "z": 1},
    {"type": "text", "text": "Details", "bbox": [210, 326, 260, 64], "z": 2, "style": {"font_size_px": 30}}
  ]
}
```

## Correction routing

- Wrong wording, font, line break, box, color, rotation, or stacking: edit `scene.json` and rebuild.
- Wrong crop: rerun `crop_alpha_assets.py`; keep the accepted decomposition.
- Missing or contaminated pixels inside a layer: refine that layer.
- Duplicated object across root layers or text still in the background: revise the root decomposition once.

Do not spend another network call on a scene-only defect.
