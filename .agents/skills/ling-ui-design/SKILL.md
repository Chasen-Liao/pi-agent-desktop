---
name: ling-ui-design
description: >-
  Create or reproduce production-quality web interfaces through a visual-first
  workflow: generate or accept a page reference, decompose it into useful layers,
  then implement and screenshot-refine it. Use for text-to-code,
  screenshot-to-code, visual UI replication, responsive page design, or
  screenshot-guided refinement. Do not use when there is no visual interface to
  build or evaluate.
---

# Ling UI Design

Settle a usable visual direction before building a real, maintainable interface. The
brief remains authoritative for copy, behavior, and product constraints; a selected
mockup or supplied screenshot guides appearance and is never the implementation.

## Choose the path

- **Text-to-code:** read [visual direction](references/visual-direction.md) and
  [image generation](references/image-generation.md). Unless the user explicitly
  skips the visual-first path, choose a preset, custom direction, or no preset;
  generate and inspect a high-resolution page reference, then decompose it the
  same way as image-to-code.
- **Image-to-code:** use the supplied screenshots as the visual reference. Do not
  generate a replacement design. Read [layer decomposition](references/layer-decomposition.md)
  and decompose each primary reference once before implementation.

## Workflow

Run task commands from the target application's root, not the skill directory.
Set `LING_UI_DESIGN_SKILL_ROOT` to the installed skill's absolute path. Store generated
references, layers, crops, and previews in the application's `artifacts/`, and final
assets in its `assets/`. Never write task outputs into the installed skill.

1. Inspect the repository, brief, run command, supplied assets, required views, and
   target viewports. Run `python "$LING_UI_DESIGN_SKILL_ROOT/scripts/configure.py" --check`
   to check model configuration without exposing values. Preserve an existing stack; in an empty
   repository choose a suitable minimal stack unless the choice materially requires
   user input.
2. Obtain and inspect the visual reference through the selected path. Do not begin
   page implementation until it is usable or the user explicitly chooses direct code.
3. Separate product UI from browser, operating-system, device, and host-container
   chrome. Recreate only product-owned content unless the user asks for a mock device.
4. Prepare reusable raster assets before writing page code:
   1. Decompose once with the default 4-layer request. Layers are RGBA PNGs with
      unused pixels usually transparent. The manifest records the requested `text`,
      `image`, `container`, and `background` roles. Inspect the original and every
      layer; role labels describe the request, not guaranteed model correctness.
   2. Generate asset candidates with one command:

      `python "$LING_UI_DESIGN_SKILL_ROOT/scripts/crop_elements.py" --layers <decompose-dir> --outdir <crops-dir>`

      Inspect `manifest.json` and every written candidate PNG.
      Candidates are proposals: reject fragments and crops containing unrelated UI;
      split or clean a useful candidate with `scripts/refine_crop.py` or the manual
      mode of `crop_elements.py`. Read [asset placement](references/asset-placement.md)
      before implementation.

   **Asset gate:** Resolve every material raster region as `accepted`, `refined`,
   `generated`, or `omitted`. Omit only a minor nonessential region unless the user
   explicitly accepts a larger fidelity loss. An unresolved material region blocks
   implementation. Never substitute a gradient, solid fill, emoji, or the complete
   reference screenshot for a required raster asset.
5. Follow [pre-implementation analysis](references/pre-implementation-analysis.md) and
   [engineering taste](references/engineering-taste.md). Complete the checklist below
   before writing page code, recording brief conclusions beside the relevant items.

   **Pre-implementation checklist:**
   - [ ] Layout: region order, column proportions, alignment, and major spacing identified.
   - [ ] Visual hierarchy: heading wrapping, type scale, colors, and repeated styles identified.
   - [ ] Every material raster region has one recorded asset-gate outcome.
   - [ ] Every accepted/refined/generated asset visually matches its intended occurrence and
         contains no unrelated text, controls, or neighboring assets.
   - [ ] Selected files are copied to the app `assets/` directory with slot names and
         mapped to their intended page locations.
   - [ ] Every mapped raster has a defined slot size and fit matching the reference.
   - [ ] No complete reference screenshot or improvised placeholder is used as layout.

   Then implement text, controls, layout, and simple icons in code, using the resolved assets.
6. Run the page and follow [visual validation](references/visual-validation.md).
   Capture the requested viewports, inspect the images, fix the largest material
   mismatch, and capture again.
7. Verify interactions, responsive behavior, asset loading, and console errors.

## Visual-model outputs are drafts

Inspect every generated image and decomposed layer. If a generated page
reference is unusable as visual direction (wrong page type, collapsed layout,
or wrong mood), name the defect and retry; stop after three attempts. Do not
regenerate because mockup copy is wrong or a brief section is missing or merged;
restore those in code from the brief.

For decomposition, overlap or imperfect separation alone does not justify a retry. Generate and
review asset candidates first. Rerun decompose at most once, only when a material
raster is missing from every layer or every candidate for it is unusable. Name that exact
defect in the revised prompt; keep the size and seed fixed. If the second decomposition
still cannot recover the asset, report the limitation and ask for a replacement or
permission to generate an alternative.

For a misplaced or noisy crop, reclean it with `scripts/refine_crop.py` in that
image's own coordinates, or pass an explicit `--box` to `crop_elements.py`.
Always inspect the cleaned output before using it.

## Evidence hierarchy

1. Original user brief, supplied screenshots, and supplied assets.
2. The selected generated reference for appearance only, never for authoritative copy.
3. A rendered screenshot of the current implementation.
4. Decomposed layers, which may overlap, omit content, or invent hidden pixels.

Do not let a lower source override a visibly contradictory higher source.

## Service and environment rules

- Use one `LING_UI_DESIGN_API_KEY` for image generation and decomposition.
  Read it from the process environment first, then the gitignored `.env` in this
  skill's real root. Never place the key in prompts, command arguments, logs,
  committed files, or generated debug JSON.
- Keep the skill directory and its `.env` outside static-serving roots and deployment
  bundles. Publish only the application's required files, not the skill directory.
- When configuration checking or a helper reports a missing key, relay its application
  guide and environment/`.env` options; pause that capability until the user configures
  the key locally. Never ask for a key in chat or fill it from conversation text.
- Non-sensitive endpoints, model names, sizes, and timeouts may use the defaults in
  `.env.example`; credentials have no defaults.
- Give image-generation and layer-decomposition requests at least 10 minutes; never
  set either client timeout below 600 seconds.
- If a model-backed stage in the selected path is unavailable, report it and ask the
  user whether to configure it or explicitly skip that stage. Do not silently collapse
  the visual-first workflow into ordinary direct UI coding. A supplied screenshot
  skips reference generation, but decomposition uses the same shared key.
- Installing Playwright, browsers, packages, or system dependencies changes the
  environment. Ask the user before installation. Prefer an existing harness browser;
  if a capture tool must be added, prefer one `npm install` of `@playwright/cli` over
  Python Playwright and a Chromium download.

## Completion

Stop visual iteration when the requested viewports have no material structural,
asset, typography, overflow, or interaction mismatch. A default ceiling of five
render-and-correct cycles prevents low-value polishing loops; report any remaining
observable limitation.
