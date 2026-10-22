# hand-drawn — the pen is thinking (whiteboard, sketch, doodle, boil)

Lines that draw themselves, boiling outlines, doodles and annotations; the whiteboard explainer, the
ChatGPT ending where doodle icons bounce and gather into the logo, the Claude Startups coil that
grows a skyline.

**Says:** *human, approachable, honest, thinking out loud.* In an AI context, the hand is a
differentiator.

**Use when:** education, reasoning step by step, friendly brands, annotation over real UI, small
announcements that want warmth. **Avoid when:** precision and premium polish are the brand.

## Signature

1. Stroke draw-on that follows the pen's speed (accelerate into curves, slow at corners).
2. Boiling lines: the path jitters slightly every 2–3 frames (seeded), so a still drawing stays alive.
3. Paper or riso grain; one or two ink colours.
4. Writing appears as it is said (≈ 0.5 s after the phrase starts).
5. Ends on the whole board / a loop that reverses back to the start.

## Camera · rhythm · easing

Locked or slow pans across a big board; draw speed varies; `OM.spring(0.2)` squash on pops.

## Sound

Marker/pencil foley synced to strokes, a light ukulele/piano bed or none; a "boing" for elastic moves.

## Build

`whiteboard` template; SVG paths with dash offsets; boil = re-seeded `feTurbulence` displacement per
2–3 frames from the frame number.

## Breaks when

Perfectly uniform stroke speed; boil on everything (noise); handwriting fonts pretending to be hands.
