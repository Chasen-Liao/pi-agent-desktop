# system-diagram — parts, connections, flow

Boxes, nodes and devices connected by paths along which packets, particles or tokens travel:
architectures, agent workflows, data pipelines, "how a request goes from prompt to answer" (the
ISO-GLOW seven-step explainer). Isometric or flat.

**Says:** *this is how the pieces connect and what flows between them.*

**Use when:** infra, APIs, agents, B2B platforms, security, networks, any multi-step process.
**Avoid when:** consumer emotion is the goal.

## Signature

1. A fixed layout of components that stays put; motion is the flow, not the furniture.
2. Packets/particles travelling along paths with consistent speed per channel; colour = data type.
3. Components light up / pulse when they receive; counters tick.
4. Isometric 30° projection for "product-y" infra, flat 2D for clarity.
5. A step index (`03 / 07`) and one-line captions.

## Camera · rhythm · easing

Push to the active component, pull out to show the whole system at the end. Packets move linearly
(constant rate means data); components react with `OM.spring(0.1)`.

## Sound

Soft electronic bed; a tick per packet arrival at key nodes; a resolve when the request completes.

## Build

SVG paths for channels; packets as positions along `getPointAtLength` driven by time; huashu-flow
style light paper look works well. Keep the system legible at 1× before any zoom.

## Breaks when

Everything flows at once (no focus); paths cross into spaghetti; decorative particles with no data meaning.
