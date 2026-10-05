# Layer decomposition

Read this reference before implementing from a supplied or generated page reference.
Run one decomposition for each primary reference even when no asset is immediately
obvious; the original plus all layers provide visual context and possible reusable
photographs, illustrations, textures, logos, or partially occluded assets.

## Default request

| Setting | Default |
|---|---|
| API base | `https://api.novita.ai/openai/v1/` |
| Model | `ming-image-0.1-design-layer` |
| Output | RGBA PNG (`output_format=png`) |
| Target resolution | `auto` (`512`, `1k`, and `2k` are available) |
| Inference steps | `14` |
| Seed | `42` |
| Server prompt enhancement | enabled |

Every returned `layer_*.png` is an RGBA PNG. Unused pixels are usually
transparent. Keep that alpha when cropping and when using the crop. Do not
convert layers to JPEG. Do not flatten them onto a solid background. A
checkerboard in a viewer is transparency, not a pattern to copy.

`LING_UI_DESIGN_API_KEY` is shared with image generation. Configure it
in the skill-root `.env` or process environment. `LING_UI_DESIGN_API_BASE` sets the
shared endpoint; `LING_UI_DESIGN_DECOMPOSE_*` settings override decomposition defaults.

Send the original image at its original resolution. `size` is the target resolution:
use `auto` to let the service choose from the reference, or pass `512`, `1k`, or `2k`
explicitly. The service preserves the reference aspect ratio.

`manifest.json` records `source_size`, `requested_size`, and the actual pixel size of
each written layer. `size` is the shared actual layer size when every file matches.
Crop in each layer file's own coordinates.

If the returned count differs, valid layers are kept without another request and
roles are inferred front-to-back: text, image layer(s), container, background.
For 1–3 layers, use image; image/background; text/image/background respectively.
A warning and `roles_inferred` flag require crop inspection; empty or invalid images still fail.

## Preset prompt

```text
Decompose this image into 4 layers with the following specifications:

Number of layers: 4
Preserve the source composition and geometry exactly. Keep reusable photographs and illustrations high-detail with clean boundaries; do not resize, reposition, blur, or simplify them.
Layer 1 (text): All designed overlay text.
Layer 2 (image): All photographs and illustrations, complete and text-free, including pictures that appear inside cards.
Layer 3 (container): Empty UI chrome: navigation bars, buttons, badges, ribbons, colored section banners, and empty card or panel frames. Keep their colors and shapes. Do not include photographs.
Layer 4 (background): Remaining empty page canvas only. No photographs. No overlay text.
```

The default request sends this prompt with `use_pe=true`, matching the upstream
server-side PE path. If another model has already rewritten a complete decomposition
prompt, pass `--no-pe` so the upstream does not rewrite it again.

## Run

```bash
LING_UI_DESIGN_SKILL_ROOT=/absolute/path/to/ling-ui-design
cd /absolute/path/to/target-app
python "$LING_UI_DESIGN_SKILL_ROOT/scripts/decompose_layers.py" \
  --image reference.png \
  --outdir artifacts/reference-layers
```

Inspect every returned layer. `manifest.json` records the requested roles `text`,
`image`, `container`, and `background`; the labels do not prove that the model obeyed
them. Layers may overlap or contain misplaced content.

Decomposition produces full-canvas layers, not accepted page assets.
Run the default candidate pass on the **image** and **background** layers; the
helper uses available service boxes and connected alpha regions to locate crops,
preserving original layer pixels inside each box:

```bash
python "$LING_UI_DESIGN_SKILL_ROOT/scripts/crop_elements.py" \
  --layers artifacts/reference-layers \
  --outdir artifacts/reference-crops
```

Read `artifacts/reference-crops/manifest.json` and inspect every written candidate PNG.
Service boxes are optional hints; missing or invalid metadata keeps the alpha-only path.
Nearly identical same-layer candidates retain the alpha-component crop only when it
covers its effective alpha content (alpha ≥ 8); near-transparent outer fringes may
be omitted, but pixels inside the retained crop are unchanged. Distinct candidates remain available.
Layer selection uses alpha overlap with reference appearance as a secondary signal;
outputs always come from layers, never reference crops. A matched IR background
replaces generic background-layer candidates; it still requires visual inspection.
The helper may recover a detector-located raster misplaced on a non-text layer.
The default alpha pass skips text and container layers;
if a material raster was misplaced there, manually crop that inspected layer rather
than silently omitting it. Treat `review: true` as a warning, not a verdict. Then read
[asset placement](asset-placement.md).

## Decomposition recovery

Overlap or imperfect separation alone does not justify a retry. Run
`scripts/crop_elements.py --layers … --outdir …` and inspect its candidates first.

Rerun decompose only when a material raster asset is missing from every
layer, or every crop of it is unusable. Then run **once** more:

1. Write a full prompt that names the missing object and which layer should own it.
2. Use `--prompt-file` and `--no-pe`. Keep `--size` and `--seed` the same.

Stop after that second call. Keep the better of the two. Do not regenerate the page
because of an overlay. If neither attempt recovers the required asset, report the limitation
and ask for a replacement or permission to generate an alternative.
