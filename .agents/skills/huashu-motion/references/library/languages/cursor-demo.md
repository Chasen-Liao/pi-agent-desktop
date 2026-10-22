# cursor-demo — the product, used for real

A rebuilt product interface, driven by a cursor (or a finger) doing real clicks, drags and typing,
with a camera that zooms to wherever the work is happening. The launch-video default of 2026: the
Claude Motion announcement, ChatGPT feature posts, most "made with Opus" product promos.

**Says:** *it exists, it works, this is exactly how you use it.* Credibility comes from the real UI
and the visible cause → effect.

**Use when:** the message is a workflow or a feature; the audience will use the product; there is a
UI worth seeing. **Avoid when:** the product has no interface (a model, an API — use mechanism or
system-diagram), or the UI is generic CRUD that tells no story by itself (lift one number or sentence
out of it instead, see data-story / kinetic-type).

## Signature

1. Rebuilt UI in HTML/CSS, crisp at 3× zoom; real copy, real labels, real numbers.
2. A cursor with intent (it can be the film's recurring motif): eased glides that decelerate into targets, hover growth (×1.3–1.55),
   press shrink (−15 %), a ripple on click; the click and the state change share a frame.
3. Screen-studio camera: push to the work area for each step, out to re-establish, one eased move
   per step. The cursor scales with the camera.
4. Typing with human rhythm on fixed lines, caret on.
5. Action → response → result, with a readable hold on the result.
6. Interface state changes are springs on exactly the property that changed.

Variants seen in Oct 2026: two cursors, *you* and the *agent*, working in the same UI; the product's
mascot as the cursor; opening on a prompt being typed and sent, after which the film is the result;
a nested reveal (start on the result, pull back into the product).

## Camera · rhythm · easing

- Camera: `OM.camera('#world')`; steps at 1.6–3× (`fit` the panel with 80–160 px pad). Never zoom in
  and out back to back; never reverse a move mid-step.
- Rhythm: short moves (0.3–0.8 s), long reads (1–2.5 s). The film speeds up between steps, not
  during reading.
- Easing: camera `expo.inOut`/`power3.inOut`; UI `OM.spring(0.05–0.12)`; cursor glides `power3.out`
  into the target.

## Look

Neutral canvas (the product's own background, or one shade off it), the product's type and colours,
one accent for the thing being demonstrated. Device frames only when the platform matters (phone,
Mac). Soft shadows to lift panels off the canvas; no glow on UI text.

## Sound

Light music (95–125 BPM); UI foley: clicks, keys, soft pops on state changes, a whoosh only on
real camera travel; a success tone on the result. Duck music −6 to −10 dB under narration.

## Skeleton (feature demo, 20 s, 110 BPM)

| Beats | Event | Camera |
|---|---|---|
| 0–2 | Product window on canvas, already settling in | wide → slight push |
| 2–4 | Cursor enters, glides to the input | push to composer, 2.2× |
| 4–10 | Types the request (fixed lines) | hold, 1 % drift |
| 10 | Press send — ripple, message flies into the thread | pull to 1.4× |
| 12–20 | Response streams; the result renders | push to result, 1.8× |
| 20–26 | Read hold; key phrase highlighted | still |
| 26–32 | Pull back → product name + mark | out to 1×, mark |

## Build

- Lay out the whole product in `#world` at 1× (sidebar, thread, panels). Each step is a camera pose.
- Cursor: one absolutely positioned SVG arrow in the world; its path as a list of `{ at, x, y, press }`
  waypoints; tween between them with `power3.out`; `OM.sfx('click', at)` on each press.
- Typing: `const shown = text.slice(0, typedAt(t))` from a fixed per-character time table.
- Streaming responses: reveal by word with a short mask per line, 25–40 ms per word.
- Read [product-demo-continuity.md](../../product-demo-continuity.md) for focus hand-offs.

## Breaks when

- A screenshot is panned around instead of a UI being used. (A real screen recording of the real
  product is fine: several Oct 2026 launches were plain recordings and were saved thousands of times.)
- Every step has the same zoom and the same speed (`om qa` contrast < 0.35).
- The result appears at the same instant as the click (implies fake speed) or the wait is shown in
  full (dead time). Compress the wait with a visible "working" state.
- Text is unreadable at the zoom the camera stops at.
- Invented features or fake numbers in a real product's UI.

## Pairs well with

kinetic-type for the claim at the end; data-story when the result is a number; continuous-morph for
transitions between product areas; talking-head when a founder narrates.
