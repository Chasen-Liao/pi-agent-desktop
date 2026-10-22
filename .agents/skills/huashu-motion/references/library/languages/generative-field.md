# generative-field — particles, fields, light (the model's mind)

Particles, flow fields, point clouds (the torus of dots), fluid, noise, shaders, glowing gradients:
abstract images of intelligence, scale and energy.

**Says:** *intelligence, emergence, scale, mood.* Feeling over facts.

**Use when:** AI model launches, music, brand mood pieces, backgrounds and loops, logo formations
from particles. **Avoid when:** it would replace showing the product; it is the AI-launch cliché if
used without a specific idea (blue particles forming a brain).

## Signature

1. One rule that generates the image (a field, a formation, an attractor) and evolves with time.
2. Particles that form meaningful shapes (the logo, a number, a word) and dissolve.
3. Restrained palette: one hue family + white; additive blending only where light is the point.
4. Determinism: seeded, a pure function of time.

## Camera · rhythm · easing

Slow drifts and dollies through the field; formations on the beat with `expo.inOut`.

## Sound

Ambient/electronic; granular textures; a swell when the formation resolves.

## Build

Canvas 2D for ≤ 20k particles, WebGL/Three.js points beyond; positions = f(seed, t), never accumulated
state. `OM.clock` to drive the draw.

## Breaks when

Random noise with no form; the cliché brain/galaxy; frame-rate dependent simulation (renders differ from preview).
