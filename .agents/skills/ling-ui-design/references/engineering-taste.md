# Engineering taste

Read this before implementation. It is a quality floor, not permission to redesign
the reference.

## Preserve the evidence

Apply evidence in this order: explicit product requirements; the selected reference
at its target viewport and state; existing product components and conventions; then
the defaults below only where evidence is missing. Match intentional density and
unusual choices. The brief owns behavior and copy; the reference owns appearance.
Do not invent features, claims, routes, or hidden content.

## Build a coherent system

- Infer shared alignment edges, container behavior, grid, and a small set of type,
  spacing, color, radius, and elevation roles. Prefer reusable rules over unrelated
  one-off coordinates.
- Preserve hierarchy and grouping. Related elements sit closer than unrelated ones;
  use alignment and whitespace before adding containers or dividers.
- Reuse existing components, tokens, icon families, and supplied assets. Never replace
  distinctive imagery with emoji, text glyphs, generic gradients, or improvised CSS.
  Before implementation, resolve each material raster through the asset gate. Place
  the selected asset with crop, fit, and alignment behavior that matches the reference;
  no single image-fit rule is correct for every photo, logo, or illustration.
- Let structure encode real meaning. Cards, pills, numbered markers, statistics, and
  decoration need a content or interaction role; do not add them as filler.
- Keep one coherent visual idea grounded in the product. Spend emphasis deliberately
  and keep supporting elements quiet and consistent.
- Unless the evidence calls for them, avoid common generated defaults: purple-blue
  gradients, glow everywhere, generic oversized heroes, uniform card grids, excessive
  pills or rounded containers, nested cards, random serif accents, and decorative data.

## Make the visible experience real

- State the primary journey in one sentence and make it finish. Implement every visible
  core control; use links for navigation, buttons for actions, labels for inputs, and
  native semantics before ARIA or clickable containers.
- Treat states not shown by the reference as evidence gaps. Add only relevant hover,
  focus-visible, loading, empty, error, success, disabled, and reduced-motion behavior,
  following existing product conventions when present.
- Keep actions discoverable and acknowledged. Preserve action names across controls and
  feedback, prevent duplicate submission, place recoverable errors near their cause,
  and confirm destructive actions or provide undo.
- Make the apparent control the hit target, keep keyboard order logical, label icon-only
  controls, preserve browser zoom, and avoid interaction that depends only on hover,
  gesture, or color.
- Do not fake authentication, persistence, payment, integration, or backend success.
  Use local behavior or clearly simulated states unless production behavior is in scope.

## Verify in the right order

First match the reference viewport and state. Then verify the primary journey, keyboard
operation, realistic content, asset loading, console errors, responsive relationships,
and unintended clipping or horizontal scroll. Follow
[visual validation](visual-validation.md) for screenshot comparison and correction.
