# Iterative layer decomposition

Read this only when a root layer needs refinement, when a layer is stuck to another, or when the tree output is unclear.

## The model's role

The API is an asset separator, not a slide author. It returns full-canvas transparent PNG layers in front-to-back order. Use it to recover existing visual pixels cleanly; use PowerPoint objects for text and simple structure.

The normal path calls `size=auto` immediately. A low-resolution prompt tournament costs time without producing usable assets, so this skill does not use it.

## Root prompt

Use a short numbered prompt:

```text
4 layers: 1 all text only no cards, 2 primary photos and illustrations only no text, 3 foreground decorations and container visuals no text, 4 complete background no text no foreground objects
```

Rules:

- numbering is front to back;
- the last root layer is the full-slide background;
- each layer description says what belongs and what does not;
- avoid commas inside one layer description because commas separate layers;
- group coherent artwork instead of naming every internal object;
- add a layer to separate ownership, not to maximize layer count.

The usual root is four layers, but use three when the slide is genuinely simple and five when one extra independently movable class is obvious. Do not start with a nine-layer inventory.

## Visual verdict

Inspect `layers/auto_preview.png` and answer:

1. Is every required object present?
2. Does each accepted layer contain one useful object or coherent group?
3. Is the front-to-back order correct?
4. Is the last layer free of source text and foreground objects?
5. Does the rebuild resemble the source without doubled objects?

`auto_report.json` reports alpha area, components, overlap, coverage, and color difference. These numbers point to locations to inspect; they are not acceptance gates.

## Keep, crop, refine, or restart

### Keep

Keep a coherent illustration, photo group, decoration group, or background. Internal editability is not worth seams or hallucinated pixels.

### Crop without another API call

If one transparent layer already contains several spatially separated objects with clean alpha, crop each object from that layer. This is faster and preserves the first output exactly.

### Refine a layer

Refine when the desired asset is inseparable by rectangular cropping because it shares one layer with a local background, frame, or another overlapping object.

The refinement source is the tight alpha box of that one parent layer. The child prompt describes only this crop; its final item does not need to be the full-slide background.

Example matching the intended strategy:

1. A root call produces separate decoration, tape, and text layers, plus one mixed layer containing three photos, white frames, and a pattern.
2. Keep the good root layers unchanged.
3. Refine only the mixed layer into `photo content`, `white frames`, and `local pattern`.
4. Rebuild the white frames as native PowerPoint shapes when their geometry is simple; keep the photos as cropped images.
5. Assemble the tree. The script maps the child layers back to full root-canvas coordinates.

### Restart the root

Local refinement cannot repair an ownership error across root layers. Restart the original image once when:

- the same object is painted into two different root layers;
- part of the desired object lives in another root layer;
- the root background still contains text or a foreground object that is also present above it;
- refining the isolated parent cannot recover pixels already lost at the root.

Change the root prompt concretely. Do not rerun the same prompt.

## Parallel refinement

Independent failed layers should be passed in one command with `--refine-prompts`; the script runs them concurrently. A failed worker is not attached to the tree, while successful siblings remain reusable.

Node paths describe the tree:

- `3` means root layer 3;
- `3.1` means child layer 1 inside refined root layer 3;
- `3.1.2` means one more nested child.

One refinement wave is the default. Two waves are the practical maximum for a ten-minute slide unless API calls are unusually fast.

## Assembly invariant

Each refined API result has its own local canvas, often at a different resolution from its crop. `--assemble` uses every stored crop transform and node canvas to resize each leaf and place it on a transparent root-sized canvas. All files in `layers_final/` therefore share one canvas and remain correctly aligned.

Do not bypass `--assemble` by copying a file from `refine/` directly into the slide; its coordinates are local to the crop.

## API configuration

The client reads `LING_BASE_URL`, `LING_MODEL`, and `LING_API_KEY` from this skill directory's `.env`. Copy `.env.example` to `.env` and fill it in before the first call. Do not pass the API key on the command line.

`DECOMPOSE_TIMEOUT_FINAL_S` can still override the request timeout.

Required Python packages are `requests`, `Pillow`, and `numpy`. Network/API failures are retried by the wrapper. After its bounded retries fail, report the service failure; do not hide it by using the flattened source as the background.
