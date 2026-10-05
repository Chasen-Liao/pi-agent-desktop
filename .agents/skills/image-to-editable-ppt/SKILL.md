---
name: image-to-editable-ppt
description: Recreate one flat slide image, screenshot, or AI-rendered presentation page as one faithful editable PowerPoint slide. Use for image-to-PPT or screenshot-to-PPT reconstruction where text must be editable, simple containers must be native PowerPoint shapes, and complex visuals should be extracted through iterative layer decomposition. Do not use for text-to-deck authoring, ordinary presentation writing, or image generation.
---

# Image to Editable PPT

Convert one reference image into one editable `.pptx` slide. Fidelity and editability are joint requirements: reproduce ordinary text as text boxes, simple layout containers as native shapes, and existing artwork as independently movable cropped images.

This skill is self-contained. Run every `python3 scripts/...` command from this skill directory, so `scripts/` resolves. Paths such as `/absolute/path/to/case` are the slide workspace.

Use Python 3.9 or newer. If an import is missing, install only the declared dependencies with `python3 -m pip install -r requirements.txt` before starting the timed conversion.

Before the first decomposition call, this skill directory's `.env` must define `LING_BASE_URL`, `LING_MODEL`, and `LING_API_KEY`. Do not print that file or pass the key on the command line. If it is missing, copy `.env.example` to `.env` and fill it in.

## Non-negotiable contract

- Do not call an image-generation model. Reuse the visual material already present in the source.
- Do not place the untouched source image behind editable text; that duplicates the original text and creates a false reconstruction.
- Do not keep foreground artwork as full-slide transparent images. Physically crop it so its PowerPoint selection box is useful.
- Keep ordinary text editable. Never paste the decomposed text layer into the slide.
- Rebuild simple cards, frames, panels, pills, borders, and separators as native PowerPoint shapes when their geometry is recoverable.
- Keep detailed illustrations, photos, decorative textures, complex logos, and stylized art as cropped bitmap objects. “Editable” means each object is independently selectable, movable, resizable, replaceable, and correctly stacked; bitmap pixels are not vector paths.
- Preserve the source aspect ratio. One source image maps to one slide.
- Render and inspect the actual PPTX before delivery.

## Representation choice

| Source content | PowerPoint object |
|---|---|
| Title, body, label, number, caption | Native text box |
| Simple card, frame, bar, circle, line-like separator | Native shape |
| Photo inside a simple frame | Cropped image plus native frame, or an image-filled native shape |
| Illustration, icon cluster, texture, complex decoration | Tight RGBA crop |
| Clean color/gradient/texture field | Slide background image or solid fill |

Use the simplest editable representation that does not visibly reduce fidelity.

## Fast workflow

### 1. Inspect once and plan both tracks

Identify, in one pass:

- all text and exact line breaks;
- the clean background;
- the major visual assets that need independent movement;
- simple containers that should become shapes;
- front-to-back occlusion.

From the same inspection, decide both the decomposition layers and the future PowerPoint objects. Give the text, shapes, and planned visual assets stable IDs and approximate z-order before calling the API. Record the wall-clock start; the target for a normal one-slide conversion is 10 minutes.

### 2. Start decomposition and build the PPT scaffold in parallel

Do not run a 512 probe loop. Start with one useful `auto` result, normally four coarse layers: text, primary visuals, remaining midground/containers, and background. `layer_1` is frontmost; the last layer is the background.

```bash
python3 scripts/decompose_iterative.py /absolute/path/to/case \
  --src /absolute/path/to/source.png \
  --prompt "4 layers: 1 all text only no cards, 2 primary photos and illustrations only no text, 3 foreground decorations and container visuals no text, 4 complete background no text no foreground objects"
```

Start this as a long-running or background session, then immediately continue local authoring. Do not sit idle or poll while the API runs.

While it runs, create `scene.json` from the source image dimensions and build everything that does not depend on returned pixels:

- transcribe all text into final native text nodes;
- add the recoverable native shapes and containers;
- assign stable IDs, approximate boxes, and z values;
- use a plain background-color fallback and leave bitmap image nodes out until their real cropped assets exist.

If useful, compile this native-only scene to `work/scaffold.pptx` and inspect text wrapping and container geometry:

```bash
python3 scripts/scene_to_pptx.py /absolute/path/to/case \
  --scene scene.json --out work/scaffold.pptx
```

This is only an early local preview; never use the source image as its background.

The decomposition service preserves aspect ratio. When the root result arrives, if its canvas differs from the source canvas, change `scene.canvas` to the returned canvas and scale all pixel-based native geometry once. Keep point- and inch-based values unchanged:

```text
sx = returned_width  / source_width
sy = returned_height / source_height
[x, y, w, h] -> [x*sx, y*sy, w*sx, h*sy]
font_size_px  -> font_size_px * min(sx, sy)
```

Then continue from the same scene instead of rebuilding the native objects.

Inspect `case/layers/auto_preview.png`. Mechanical signals in `auto_report.json` are clues; visual inspection decides whether a layer is usable.

### 3. Repair only the failed layer

Use the cheapest correct action:

| Observation | Action |
|---|---|
| Layer is already one usable object or group | Keep it |
| Layer has several clean, spatially separated objects | Crop them directly; do not call the API again |
| Desired object is mixed with a frame, pattern, or local background in the same layer | Refine only that layer |
| Several different layers fail independently | Refine them in one command with per-layer prompts; they run concurrently |
| Object is duplicated or glued across different root layers, or local refinement cannot recover it | Rerun the original image once with a revised root prompt |

Example refinement:

```bash
python3 scripts/decompose_iterative.py /absolute/path/to/case \
  --refine 3 \
  --prompt "3 layers: 1 photo content only, 2 simple white frames only, 3 local pattern behind the frames"
```

For multiple failed layers:

```bash
python3 scripts/decompose_iterative.py /absolute/path/to/case \
  --refine 2 --refine 3 \
  --refine-prompts '{"2":"2 layers: 1 hero art only, 2 its local shadow", "3":"3 layers: 1 icons only, 2 cards only, 3 local decoration"}'
```

Read [references/iterative-decomposition.md](references/iterative-decomposition.md) only when deciding a refinement prompt, handling a stuck layer, or interpreting the refinement tree.

Normally allow one parallel refinement wave. A second child refinement such as `--refine 3.1` is justified only for a high-value object with a clear separation plan. Never keep rerunning an unchanged prompt.

### 4. Assemble and crop useful assets

Assemble the refinement tree after the accepted leaves are clean:

```bash
python3 scripts/decompose_iterative.py /absolute/path/to/case --assemble
```

`case/layers_final/` contains front-to-back full-canvas layers. Refined children are resized and mapped back to their exact root-canvas positions; `manifest.json` records their origins and root boxes.

Crop each foreground bitmap physically:

```bash
python3 scripts/crop_alpha_assets.py \
  --image /absolute/path/to/case/layers_final/layer_2.png \
  --output-dir /absolute/path/to/case/assets/hero \
  --mode bbox --prefix hero
```

Use `--mode x-groups` for a clean horizontal row, or repeat `--box left,top,right,bottom` for visually chosen assets. Keep 2–6 px of source-space margin for antialiasing and shadows. The emitted manifest boxes are the exact scene positions.

Do not crop the background. Do not insert the text layer. Do not insert a container bitmap after replacing that container with a native shape.

### 5. Complete `scene.json` and compile

Read [references/scene-schema.md](references/scene-schema.md) when authoring `scene.json`. Use `layers_final/manifest.json.canvas` as the final `scene.canvas`. Coordinates remain in pixels until compilation.

Continue from the scaffold created while the API was running. Add the returned background asset and cropped image nodes at their manifest boxes, then make only the small position or z-order corrections revealed by the real assets. Do not patch the binary scaffold PPTX or recreate its native objects; update `scene.json` and compile a fresh final PPTX.

The scene must contain:

- the clean last layer as `background.asset`;
- cropped visual assets at their recorded boxes;
- native shapes for recoverable containers;
- visually verified text boxes above the correct objects;
- explicit `z` values matching the source occlusion.

Compile without network calls:

```bash
python3 scripts/scene_to_pptx.py /absolute/path/to/case \
  --scene scene.json --out final/output.pptx
```

Text or layout corrections require only editing `scene.json` and rerunning this command. Do not refetch layers for a local text, shape, position, color, or z-order issue.

An explicit `font_size_px` or `font_size_pt` is compiled as that size. The compiler estimates a size only when both are omitted. For text measured from the source, set `fit: "none"` so PowerPoint autofit does not shrink it, then confirm the compiled point size and the real render.

### 6. Validate and inspect the real render

Set the minimum counts to the objects the source actually requires:

```bash
python3 scripts/validate_pptx.py /absolute/path/to/case/final/output.pptx \
  --require-text 1 --require-shapes 1 --require-images 1

python3 scripts/render_pptx.py /absolute/path/to/case/final/output.pptx \
  --out /absolute/path/to/case/final/render.png
```

Compare the source and render at the same aspect ratio. Fix only the visible defect, rebuild locally, and inspect again.

## Ten-minute operating budget

- **0:00–1:00:** inspect, choose the coarse four-layer plan and PPT object plan, start `auto`.
- **1:00–4:00:** build the native scene and optional scaffold while `auto` runs; inspect the result once; run at most one parallel refinement wave. A root retry is allowed only for cross-layer adhesion.
- **4:00–8:00:** assemble, crop, add real assets to the existing scene, compile.
- **8:00–10:00:** validate, render, and make one focused local correction pass.

Reserve at least two minutes for rendering and QA. If API work reaches four minutes, stop exploratory calls: use the best clean leaves, crop already-separated assets, and finish the editable reconstruction. Do not spend time on SSIM tuning, ad hoc pixel-analysis scripts, prompt tournaments, or repeated full-pipeline runs.

## Acceptance gates

Do not deliver until all are true:

- every source text string has been visually checked and exists as editable text;
- no source text remains visibly baked into the background or retained bitmap layers;
- every simple container that matters to the layout is a native shape;
- foreground bitmap objects are tight crops, not source-sized transparent canvases;
- major visuals are complete and movable, with correct stacking and no duplicated pixels;
- slide ratio, positions, rotations, colors, and line breaks visibly match the reference;
- the PPTX passes structural validation and its real render has been inspected.

If exact font or vector-level editing of artwork is impossible, preserve visual fidelity with the closest installed font or a cropped bitmap and state that limitation. Never silently call a flattened slide “editable.”
