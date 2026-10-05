# Asset selection and placement

Read this after `crop_elements.py` and before implementation. Automatic crops are
candidates, not semantic truth. The reference remains authoritative for what each
asset contains, where it appears, and how it fits its slot.

Candidates use neutral names (`asset_00.png`, etc.). `source_role` describes the
requested source layer, not the asset's intended use; `method` records `ir` or `alpha`.

## Review candidates

Open the original reference, every decomposed layer, `crops/manifest.json`, and every
written candidate PNG. For each material raster region, record one outcome:

- `accepted`: one clean candidate matches the occurrence;
- `refined`: a useful candidate was split or cleaned;
- `generated`: a replacement was generated and visually verified after decomposition
  could not recover the required pixels;
- `omitted`: the region is minor and nonessential, or the user accepts the loss.

Reject or refine a candidate when it contains unrelated text, controls, neighboring
assets, missing subject pixels, or detached noise. `review: true` is a warning only;
all candidates still require visual inspection. If a material region remains
unresolved, do not start page implementation.

## Map assets to slots

Use `bbox`, `canvas`, and the reference to locate an occurrence; fractions are
geometric evidence, not layout instructions. A wide crop may be a full-bleed visual
or several touching assets. Map each selected file to one intended page slot, and
reuse it only when the reference repeats the same source asset.

Copy selected files into the app's `assets/` directory with slot-oriented names such
as `hero.png` or `event-speaker.png`. Do not reference temporary crop paths from page
code.

## Match the reference fit

Choose image behavior from visible evidence:

- `cover` for a photograph visibly clipped by a fixed frame;
- `contain` for a complete logo, product, poster, or illustration;
- intrinsic dimensions for small inline decoration;
- a background image only when the reference actually uses a full-bleed visual.

When a frame has a stable reference proportion, size the frame and let its image fill
that box. Otherwise preserve the asset's natural ratio. Adjust focal alignment only
when the reference places the subject off-center.

## Repair a candidate

- Multiple assets joined together: recrop the owning layer with an explicit box.
- Detached transparent noise: use `refine_crop.py --keep-largest-alpha` when the
  wanted asset is the largest component.
- Tight crop: widen the box on the owning layer without importing neighboring UI.
- Missing material asset: use the single targeted decomposition retry described in
  [layer decomposition](layer-decomposition.md), then generate or report the asset
  only if recovery still fails.

Inspect every repaired output before accepting it.
