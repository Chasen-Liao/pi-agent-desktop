# photo-led — real images, designed motion

Real photography or footage is the substance; motion design frames it: irises open onto photos,
images scale small → big → several at once, graphics are painted on top, photos sit inside type and
shapes, footage plays inside a phone or on a wall.

**Says:** *the real world; the lifestyle this product lives in.*

**Use when:** travel, food, fashion, photo apps, ads with UGC, anything whose value is visual.
**Avoid when:** there are no rights-cleared images (don't fake with AI images of real places/people
for a real brand without saying so).

## Signature

1. Strong, consistent photography (grade them alike).
2. Image transitions that are shapes: iris, mask from a line, rect morph, tile reflow.
3. Graphics painted over images (strokes, labels, circles) in one accent.
4. Fast pacing for ads (0.5–1.5 s per image), with a long hold on the hero image.

## Build

Images as `<img>` in shapes with `object-fit: cover`; footage re-encoded all-intra (`ffmpeg -g 1`)
and drawn after `seeked` for frame accuracy; HDR footage converted to SDR first.

## Breaks when

Mismatched grading; Ken Burns on everything; text over busy areas without a scrim.
