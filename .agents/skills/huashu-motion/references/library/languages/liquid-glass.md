# liquid-glass — material UI with depth

Refractive glass toolbars, orbs and lock screens over photos; droplets that stretch into controls;
goo merges. The iOS-26-flavoured consumer language (the photo-print launch film).

**Says:** *premium, modern, delightful consumer product.*

**Use when:** consumer apps on Apple platforms, photo/media apps, lifestyle products.
**Avoid when:** developer tools; anything that needs flat clarity.

## Signature

1. Glass elements refracting what's behind them, chromatic edges, rim light.
2. Liquid morphs: a word melts into a droplet that stretches into a toolbar; the Dynamic Island pinches off.
3. Real photography behind the glass.
4. Springs with slight overshoot; everything feels touchable.

## Build

Per-element clone of the background + SVG `feDisplacementMap` (rounded-rect distance field) at three
scales for chromatic edges; goo = blur + alpha threshold, sharp source composited atop. Heavy filters
render slowly: keep the number of glass elements small.

## Breaks when

Glass over flat colour (nothing to refract); blur used as a fake glass; too many glass layers.
