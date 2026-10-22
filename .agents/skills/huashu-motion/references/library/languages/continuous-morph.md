# continuous-morph — one take, every scene grown from the last

A single element (a pill, a dot, a card) never leaves the screen. It morphs through UI states and
scenes — button → loader → check → island → player → slider → tabs → chart → ⌘K → toast → button —
driven by a cursor and the beat. Nothing fades or blurs; at most a few hard cuts on the drop. The
most reliable style among the Opus-made films of Sep–Oct 2026: all four in the top prompt gallery
cleared 270 likes (median about 1,400), while showreels peaked higher but four of eleven took 97 % of
the likes. (The "shape morphing through UI states" piece, the photo-print and food-craving films.)
In the wider Claude Motion wave on X it was rare as the main language (0 of 40); it is a craft piece,
not the default.

**Says:** *one coherent, crafted system; everything flows from one idea.* It reads as Dribbble /
Apple-keynote craft and is extremely rewatchable.

**Use when:** a consumer or design-led product; many small features that should feel unified; a
launch sting or loop; UI components themselves are the subject. **Avoid when:** the audience needs
to read dense real UI (use cursor-demo), or the story has real-world settings that need cuts.

## Signature

1. One hero shape whose box (x, y, w, h, radius, colour) interpolates between states; its content
   swaps inside with its own short mask.
2. Shared-element hand-offs between scenes: the send button grows into the next object; a flood of
   colour contracts into the next scene's shape.
3. A cursor causes every change with real clicks, drags and long-presses.
4. Something happens on every beat (120–130 BPM is typical), the hero moment on the drop.
5. Springs everywhere, small overshoot at most; edges of stretchy things on separate springs (the
   leading edge of a tab indicator runs ahead of its trailing edge).
6. Last frame = first frame. It loops.

## Camera · rhythm · easing

- Camera zooms so each state fills the frame (`OM.camera` with `fit`); one eased move per scene.
- Rhythm: 7–8 bars for a 15 s sting; holds ≤ 1 s; density is constant but energy builds to the drop.
- Easing: `OM.spring(0.05–0.1)` for UI morphs, `expo.out` for floods, `power3.inOut` for camera.

## Look

The product's own canvas, components, accent and UI font. The famous examples share a warm
off-white canvas, black/white components, Geist and one lime or orange accent; that is now a house
style, so copy their motion, not their look, unless the brand really looks like that. Real photos may appear inside shapes (iris into a photo).
**Banned:** bouncy easing, particle bursts, glows, gradients on UI chrome, crossfades, blur-ins, 3D
flips, holds > 1 s, anything that looks like a template.

## Sound

A clean track with a drop; a UI sound on every contact (click, pop, tick, slide), placed on the
measured landing frame; one bigger hit on the drop.

## Skeleton (15 s loop, 120 BPM, 30 beats)

`button (0) → loader (2) → check (4) → island (6) → player (8, play/pause morph) → scrub (10) →
volume slider stretches past max (12) → toggle (14) → liquid tab indicator (16, drop) → tabs open into a
chart that draws itself (18–22) → collapses into ⌘K (24) → type (25) → toast (27) → button (30 = 0)`

Replace the states with the product's real components and features, in the order of its story.

## Build

- Write a state table: `[{ at, w, h, r, fill, content }]`. The hero's box at `t` is the spring sum
  over all changes (`OM.springValue` per property) — one pure function of time.
- Contents: each state's inner content is its own element with enter/exit masks timed to the morph.
- Floods: a circle from the source's centre to a radius past the farthest corner in ≈0.35 s; z-index
  above everything it covers.
- Render at 60 fps with `--blur` (4 subframes at 60 fps; slow the fastest moves if ghosts show).
- Variant: one ball (or one cursor) travels through the whole product world and each place it
  touches turns into the next scene.

## Breaks when

- The shape teleports (a state change without a visible path).
- Text overlaps during a morph (contents not masked separately).
- Each state is a "slide" with the same timing — it becomes a template.
- The loop stutters (cursor position or velocity differs at the seam: `om qa --loop`).

## Pairs well with

kinetic-type for the final line; liquid-glass for iOS-flavoured consumer products; photo-led when
the product is about images.
