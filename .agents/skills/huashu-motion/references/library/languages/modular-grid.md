# modular-grid — Swiss precision, systems in motion

A strict grid of modules — squares, circles, bars, tiles, Truchet patterns, numbered cells — that
rearranges, flips, fills and counts in exact rhythm. The language of developer platforms, infra,
fintech, design systems and timetables.

**Says:** *precise, engineered, rational, scales.* Order is the message.

**Use when:** precise/technical brands (Vercel, Linear, Stripe, Supabase register); lists and
specifications; abstract product ideas (sync, deploy, scale); loops for landing heroes.
**Avoid when:** warmth or human stories carry the message.

## Signature

1. An 8/12-column grid that stays visible or implied; everything snaps to it.
2. Modules that flip, rotate in 90° steps, fill, invert, stagger across the grid in waves.
3. Monospace labels, indices (`01 — DEPLOY`), coordinates, tabular numbers.
4. Two or three colours, flat; one accent travels through the grid like a signal.
5. Patterns that propagate (a wave from a corner, a cell that infects neighbours).

## Camera · rhythm · easing

Locked frame or exact 2× zoom steps. 115–130 BPM, events on 8ths. Easing is decisive:
`power4.inOut`, `expo.out`, even linear for conveyor motion; no bounce.

## Look

Black on off-white or white on near-black; the brand accent; Inter/Geist/a mono; hairline rules.

## Sound

Minimal techno / clicky electronics; ticks per module, a low hit when a pattern completes.

## Build

CSS grid or absolute positioning from a computed layout; stagger by `distance from origin / speed`;
all patterns from `OM.random(seed)` so they are identical in preview and render.

## Breaks when

Off-grid placement, mixed corner radii, decorative gradients, wobbly easing.
