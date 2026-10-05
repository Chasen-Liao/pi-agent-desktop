# Visual direction

Use this reference for text-to-code work before page implementation. Existing
screenshots or concrete page-design references already satisfy this stage.

## Choose one direction

Honor a style supplied by the user. Otherwise ask one compact style question with
these choices plus **Custom** and **No preset**. “No preset” still generates a visual
reference from the brief; it does not mean direct coding. If the user delegates the
choice, select the direction that best fits the product.

- **Clean:** Light canvas, generous whitespace, cool gray surfaces, one quiet blue or
  neutral accent, geometric sans, hairline dividers, and soft rounded cards.
- **Warm:** Cream or stone surfaces, serif or humanist headlines with sans body,
  softer contrast, and a restrained terracotta or olive accent.
- **Dark:** Near-black canvas, high-contrast type, one luminous accent, tighter
  spacing, and restrained hairline or glass details.
- **Bold:** Oversized type, saturated accent blocks, fewer gray tones, and graphic
  shapes or large image crops already implied by the brief.

Presets change only palette, typography, spacing density, materials, and mood. Keep
the page type, information architecture, and requested sections unchanged. Generate
one direction by default; generate up to four only when the user asks to compare.

## Generate before code

Compose the image prompt from the brief, target viewport, and selected direction:

```text
Create a production-quality full-page web UI mockup for this brief:
<brief>

Keep the same page type and sections. Do not introduce a dashboard, campaign splash,
or magazine layout unless requested. Apply this visual direction:
<preset, custom direction, or no extra style direction>

Render a scrollable <desktop or mobile> page with <target aspect ratio>; no browser,
device, or operating-system chrome. Keep the above-fold UI at a natural scale and let
later sections continue below it instead of shrinking the complete page to fit. Use
text as a layout cue; the brief remains authoritative for readable copy.
```

Describe the intended canvas in the prompt; the service determines actual output dimensions.
Inspect the result before writing page code. Regenerating is only for an unusable
visual direction: wrong page type, collapsed layout, or wrong mood. Missing or merged
sections and garbled mockup text are not reasons to regenerate; the brief still owns
information architecture and copy. Stop after three attempts. Once the mockup is usable as appearance, treat it
as the image-to-code reference and read
[layer decomposition](layer-decomposition.md).
