# Techniques — the vocabulary

Every motion means something. Pick a technique for what it says, not because it looks advanced.
Each entry: **what it says** · when · how (GSAP + `vendor/om.js`) · what breaks it.

All snippets assume one paused timeline `tl`, `const V = OM.vars()`, and that everything is a function
of time (no CSS transitions, no timers, no `Math.random`).

## Timing and easing

**Ease-out (expo / power3).** Says: *arrived with intent*. The default for anything entering.
`ease: 'expo.out'`, 0.5–0.9 s. Most of the travel happens in the first third, so the hit goes on the
frame it visually lands (≈30–40 % of the duration), not at the end.

**Spring (closed form).** Says: *responsive, physical, alive*. UI that reacts to a click, things that
land. `ease: OM.spring(0.08)` (tiny overshoot) for UI, `OM.spring(0.25)` for playful brands, `OM.spring(0)`
for a damped settle. The tween's duration is the settle time (0.4–0.7 s for UI). For canvas engines,
`OM.springValue(from, [{at, to}, …], t, { bounce, settle })` sums one spring per target change.
Breaks when: everything bounces (it reads as a template), or a precise brand gets overshoot.

**Ease-in-out (power2–3).** Says: *a deliberate move from A to B*. Camera moves and repositioning,
never entrances.

**Linear.** Says: *mechanical, constant, time passing*. Tickers, conveyor belts, rotating rings,
scrolling backgrounds, counters that represent a rate. Not for entrances.

**Anticipation.** Says: *something is about to happen — get ready*. A 2–6 % move against the
direction 0.1–0.15 s before the action. `tl.to(el, { x: -8, duration: .12, ease: 'power2.in' }, t - .12).to(el, { x: 600, duration: .5, ease: 'expo.out' }, t)`.

**Stagger.** Says: *these are many, and they are a set*. Lists, grids, letters. 30–60 ms between
items for UI, 15–25 ms for letters. Stagger from the point of cause (`from: 'center'`, or from the
click). Breaks when: a 12-item stagger takes longer than the beat it belongs to.

**Hold.** Says: *this matters; read it*. A hold is a decision: something just landed, or text must
be read (≈ 0.25 s per short word + 0.5 s). A still frame with nothing to read is dead time
(`om qa` reports it).

**Start from a dot.** Says: *something is about to happen, and it will pay off*. The first frame is
one dot breathing on an empty ground; it becomes the subject, then comes back at the end as the
full stop, the logo's dot or the anchor of a match cut. A hook that is also a motif. Twelve of the
54 top prompt-gallery films open this way, so it is close to a cliché there: use the product's own
mark (a cursor, a pixel, a seed) rather than a generic dot.

**On the beat.** Says: *this was composed, not generated*. `OM.music({ bpm })`, place events at
`OM.beat(n)`. Fast sections = fewer beats per event, not a faster tempo.

## Entrances and exits

**Mask reveal (rise from a line).** Says: *precise, editorial, confident*. Text rises out of an
invisible line. Wrap each line in `overflow:hidden`; tween the inner from `yPercent: 110` to `0`,
`expo.out`, staggered by line. The premium default for headlines.

**Scale from zero on a spring.** Says: *popped into existence, friendly*. Icons, chips, dots.
`fromTo(el, { scale: 0 }, { scale: 1, duration: .5, ease: OM.spring(.15), immediateRender: false }, t)`.
Set `transform-origin` at the cause (the click, the parent).

**Draw on.** Says: *being made / traced / connected*. SVG strokes with `stroke-dasharray` =
length, tween `stroke-dashoffset` to 0. Lines, routes, underlines, chart lines, signatures.

**Type on.** Says: *someone is typing this, live*. Characters by time, not by interval:
`const n = Math.floor((t - t0) * cps)` with an irregular rhythm table (holds every 2–3 chars).
Keep the text on fixed lines so the camera never chases a wrapping cursor. Caret always on.

**Wipe / clip-path.** Says: *replace, reveal underneath*. `clip-path: inset(0 100% 0 0)` → `inset(0)`.
Direction follows reading or the cause.

**Blur-in.** Says: *dreamy, coming into focus*. Overused and generic in AI-made motion as a default
entrance; two of the seven structured top prompts ban it. It earns its place when the meaning is
focus: a brand name resolving out of fog, a model teaser where the answer sharpens.

**Exit faster than entrance.** Entrances 0.5–0.9 s, exits 0.25–0.4 s with `power2.in`. The eye has
already moved on.

## Continuity devices (instead of cuts)

These are why the best 2026 films feel like one take. Plan one per transition (see the director's
continuity chain).

**Shared element.** Says: *it's the same thing, now in a new context*. The button becomes the page;
the card flies into its slot; the bubble carries its words. Build both states, then interpolate one
element's box (x, y, w, h, radius) between them while its contents swap with their own short
mask/blur. Text inside a morphing container needs its own enter/exit timing or it overlaps.

**Morph.** Says: *transformation, one idea becoming the next*. A shape changes size, radius and colour
into the next UI state (pill → loader → check → island). For paths, interpolate equal-point
polygons, or use `MorphSVGPlugin` if vendored. For UI, animate the box and radius, not the path.

**Flood and contract.** Says: *a state change; commitment; a new chapter*. A colour or shape grows
from an object to fill the frame (≈ 0.3–0.35 s; overscale past the farthest corner or half the
screen changes in one frame), holds a beat, then contracts into the next scene's object. Carry a copy
of the source's text inside the flood if it continues.

**Nested reveal.** Says: *what you just watched was made by this*. Open on the finished result
playing, then pull back to show it sitting inside the product's player, editor or chat. The Claude
Motion launch film (Oct 2026) opens this way. One per film, at the start or as the turn.

**Path-follow.** Says: *a journey from here to there*. An object travels along a dashed path as it
draws on; the path connects two ideas or two places.

**Mascot through-line.** Says: *one friend guides you through*. The same character carries every
transition or replaces the cursor. Only with a real mascot of the product.

**White flash cut.** Says: *a beat of light; next chapter*. 2–3 frames of white (or the accent) at a
cut. Common in hype edits; twice a film at most.

**Iris.** Says: *focus, a window opening onto something*. Circular `clip-path: circle(r at x y)` or
6 blades around a hexagonal aperture. Opens onto photos and reveals.

**Push-through (zoom into an object).** Says: *go deeper, enter this*. The camera pushes into a
screen, a letter's counter, a dot, until it becomes the next world. Use `OM.camera` with a large
zoom on a small target; the next scene is laid out inside it.

**Match cut.** Says: *these two are alike*. Cut between two shots where the shape, position or motion
matches (circle → sun → button). A cut that rhymes is continuity.

**Whip.** Says: *fast, energetic, next!* A 0.15–0.25 s camera move with directional blur that
carries into the next shot already moving. Use `--blur` at render for real smear.

**Hard cut on the beat.** Says: *a new question, a punch*. Legitimate when it lands exactly on a beat
and the new frame is instantly readable. Never cut on a still frame: enter the next shot already moving.

**Smash cut / J-cut / L-cut.** A smash cut jumps from loud to quiet (or the reverse) for comedy or
shock. In a J-cut the next scene's sound starts before its picture; in an L-cut the old sound runs
over the new picture — both make cuts feel continuous. Place the sound hits accordingly.

**Crossfade.** Says: *time passing / dream*. Almost always the weakest transition between scenes;
four of the seven structured top prompts ban it. A short white flash-dissolve inside one shot is a
different thing and still common.

**Colour-field flip.** Says: *new chapter, hard and clean*. The whole frame flips black ↔ white (or to
the brand colour) for one beat, then the next scene draws on the new ground. Costs nothing, reads as
a section break and a cut at once. Twelve of the 54 top prompt-gallery films use it. Overused when
every section flips.

**Collapse into the mark.** Says: *all of this is one thing — us*. The parts of the diagram, product
or scene fold, slide or merge into the logo's geometry, then the mark holds alone. The engineering
ident: Vercel's frontend and backend prisms collapse into the triangle (Oct 2026). Needs a logo
whose shape the content can honestly become.

## Camera

Use one world and one camera: `const cam = OM.camera('#world')`. Lay every shot out somewhere in
the world, move the camera between them. Zoom interpolates in log space; the focus point travels on
its own curve.

**Push in.** Says: *look closer; this is the evidence*. `cam.to(tl, t, { fit: '#detail', pad: 120, duration: .8, ease: 'expo.inOut' })`.
Needs a target that rewards the push (the text you can now read, the number).

**Pull back (reveal).** Says: *this is part of something bigger*. Out to show the system; there must
be new information in the wider frame.

**Screen-studio zoom.** Says: *follow the action*. Auto-zoom to the cursor's work area for each step,
1.6–3×, then out. One eased move per step; never zoom in and out back to back.

**Drift.** Says: *alive, premium*. A 1–3 % slow push during a hold keeps it breathing. Linear, the
whole hold.

**Parallax.** Says: *depth*. Layers move at different rates (foreground 1.3×, background 0.6×).

**3D orbit / dolly.** Says: *it's a real object*. Three.js camera on an arc around the product.

**Card wall / carousel.** Says: *scale — there are many of these*. A wall of sites, videos or icons in
perspective, flying past or turning as a carousel; the camera then pushes into one card. Lay the
cards on a 3D plane (CSS `perspective` + `rotateY`) and move the camera, not the cards.

**Camera shake / impact.** Says: *weight, a slam*. 2–6 px decaying over 0.2 s on the impact frame
(`OM.random(seed)` for the offsets). Once or twice a film.

**Rack focus.** Says: *attention moves from here to there*. Blur the old subject, sharpen the new
(CSS `filter: blur()` on layers, 0.4–0.6 s). Cheap depth for UI over photos.

**Dolly zoom (vertigo).** Says: *realisation, unease*. Zoom in while pulling the background layer's
scale the other way. Once, if at all.

**Speed ramp.** Says: *this moment matters*. A move that runs fast, slows to near-stop at the key
frame, then accelerates out. Ease the timeline's time itself with `tl.timeScale` tweens or a custom
ease on the move.

**Freeze frame.** Says: *stop — look at this / that's me*. Everything halts on a hit, a label slams
in, then motion resumes. Pair with a record-scratch or a hard silence.

Camera moves must not reverse direction mid-scene, and the reading moments sit still or drift.

## Typography in motion

**Weight / width axis animation.** Says: *the word itself is alive*. Variable fonts (`font-variation-settings`)
from 300 to 900 or wdth 75→125 on the beat.

**Scale slam.** Says: *THIS*. A word enters at 140–200 % and lands at 100 % on `expo.out` or a spring,
with an impact hit and maybe a 2 px shake.

**Word-by-word / beat-by-beat.** Says: *a rhythm you can feel; a manifesto*. One word per beat,
replacing or stacking.

**Kerning squeeze / accordion.** Says: *compression, the brand gathering into a mark*. Letters move
toward a point with their width (wdth axis) following.

**Pill highlight.** Says: *the key phrase*. A rounded rect grows behind 1–3 words (left to right,
0.3 s) in the accent colour. The 2026 launch-film staple; once or twice per film.

**Text reel.** Says: *many, continuous, at scale*. Words, currencies or stack names scroll vertically
or horizontally with motion blur behind one fixed word ("works with ___"). Land the reel on the
word that matters with a spring.

**Strike-through and replace.** Says: *the old way is over*. A line is drawn through the old claim or
price, then the new one pops in beside it. One reversal per film.

**Punctuation as a character.** Says: *crafted, with a voice*. The full stop, question mark or comma
becomes the brand's shape, moves on its own, or carries the transition. Small, memorable; one
device per film.

**Text on a path / spiral.** Says: *journey, motion, hypnotic*. SVG `textPath` with animated
`startOffset`.

**Type as container.** Says: *the word holds the world*. Video or images masked inside letterforms.

## Shape and material

**Squash and stretch.** Says: *mass, elasticity, cartoon life*. Scale x/y inversely on impact
(1.2 × 0.8), recover on a spring. Characters, balls, playful UI.

**Overlap and follow-through.** Says: *it's physical*. Parts arrive at different times: the label
settles 60 ms after its card; a tab indicator's leading edge runs ahead of its trailing edge (two
springs on two edges).

**Goo / metaball.** Says: *liquid, merging, organic*. Blur + alpha threshold (SVG `feGaussianBlur` +
`feColorMatrix`), then composite the sharp source on top.

**Liquid glass.** Says: *premium, modern consumer*. Each glass element holds its own clone of what's
behind it, displaced with SVG `feDisplacementMap` (a rounded-rect distance field) at three slightly
different scales for chromatic edges, plus a rim highlight. `backdrop-filter: url()` misreads
displacement maps in Chromium; clone the scene instead.

**Grain / noise.** Says: *film, warmth, analog*. A seeded noise canvas at 3–6 % opacity, re-seeded
per frame from the frame number (deterministic).

**Light sweep.** Says: *polish, premium, "new"*. A narrow bright gradient band crosses a logo or
card once (`background-position` or a masked gradient, 0.6–0.9 s, `power2.inOut`). Once per film.

**Motion trail.** Says: *speed, path*. Fading copies or a stroke behind a fast object. Prefer real
motion blur; use trails when the path itself matters.

**Impact rings and burst lines.** Says: *the accent, drawn*. Concentric rings or speed lines at a hit.
Divisive: four of the seven structured top prompts ban shockwaves and particle bursts, while the
showreel family uses them constantly. Use them only on the one or two biggest hits, in the accent.

**Text ↔ particles.** Says: *emergence; form from noise*. Letters dissolve into particles or particles
gather into a word. Sample points from the text (canvas `getImageData`), give each particle a seeded
start, and tween to the target. Model launches and generative pieces; never on body copy.

**Particle burst / gather / orbit.** Says: *energy released; things coming together*. Seeded particles
burst from a hit, gather into a shape or orbit a centre. The most common effect in the Claude Motion
wave (in about half of the 40 films): that is also why it reads as generic. Give the particles a
meaning (letters, pixels of the product, the product's icons) or skip it.

**Idle life.** Says: *alive, waiting for you*. A held subject keeps a tiny loop going: a blink, a
float, a breathing glow. Keeps holds from going dead without moving the camera.

**Glitch.** Says: *digital, broken, edgy*. 2–4 frames of seeded slice offsets and RGB split on a beat.
More than twice a film becomes noise.

**Glow.** Says: *energy, AI, magic*. Six of the seven structured top prompts ban glow on UI and on
text. Still used on the final wordmark, on rim light, on particles, and on dark grounds where the
light source is the content (a terminal, a neon sign).

## Data

**Count up.** Says: *it grew to this*. Counter tween with `snap`, landing on the final number with a
hit; tabular figures (`font-variant-numeric: tabular-nums`) so digits don't jitter.

**Bars grow from zero.** Says: *comparison*. Always from a zero baseline, staggered, the hero bar
last and in the accent.

**Price anchor flip.** Says: *the difference is absurd*. The big old number holds on black, then the
new one slams in next to it (or a dual counter runs both ways). For pricing and speed claims.

**Line draws, then the point lands.** Says: *trend, and this moment on it*. Draw the line, then pop
the latest point with a label.

**Chart morph.** Says: *same data, new view*. Bars → dots → line by interpolating each datum's
mark. Keep identity per datum.

## Product UI

**Cursor choreography.** Says: *a real person is using this, and it works*. A macOS arrow that
glides on eased curves, decelerates into targets, grows on hover, shrinks 10–15 % on press, and
leaves a press ripple. Clicks trigger state changes on the same frame. The cursor scales with the
camera.

Concrete values from a top structured prompt: hover ×1.55, press −15 %.

**Prompt receipt.** Says: *you can make this too*. The prompt or code that made the film stays on screen
beside it, typed in or pinned as a card. Films that showed their prompt were among the most saved of
Oct 2026.

**Chat-bubble stack.** Says: *a conversation, live*. Bubbles spring in from the bottom and push the
older ones up; the newest gets the accent. iMessage, Slack or a chat UI used as the frame of the hook.

**Completion receipt.** Says: *the promise is kept*. A progress run 1/6 → 6/6, a ring to 100 %, a
timeline ticking off each step, a check that pops. The emotional peak of a UI film; nine of the 54
top prompt-gallery films use one.

**Direct manipulation.** Says: *you control it*. While the cursor holds, the value follows the cursor
position; on release it springs back from wherever it was.

**UI state springs.** Toggles, tabs, sliders, sheets: every state change is a spring on the
specific property that changed, nothing else moves.

**Rebuild, don't screenshot.** Rebuilt UI (HTML/CSS) stays sharp at any zoom and can morph. Use
screenshots only as textures for context. A real screen recording is fine when the real product is
the point (several Oct 2026 launches were plain recordings and did well); what fails is a still
screenshot panned around.

**Split compare.** Says: *before and after; this vs that*. Two states side by side or wiped across
one frame with a draggable divider, the same content in both. Keep everything identical except the
one thing being compared.

## Finishing

**Motion blur.** Says nothing — it removes the strobing that marks animation as cheap. Render with
`om render --blur` (up to 8 subframes averaged per frame). Very fast moves still show discrete
ghost copies: slow the move down, or accept them as a stylised smear.

**The editor on screen.** Says: *this was made, and it is adjustable*. Keyframes, easing curves,
selection boxes, bezier handles, a playhead and live readouts (`ROT 258.8°`) become the content,
not just the frame. Makes code-made motion credible. Ten of the 54 top prompt-gallery films do this.

**Leader-line callout.** Says: *this exact part*. A thin line from a point to a small caps label;
draw the line, then type the label. Engineering idents, hardware, diagrams.

**Stamp.** Says: *approved, signed, final*. A seal rotates and scales down onto the frame with a small
shake. Once per film, on the confirmation.

**Spec card ending.** Says: *made by someone who knows what they did*. The film ends by stating its
own specs (palette, type, frame count, BPM) or a signature line. A showreel convention; in a product
film the brand mark replaces it.

**HUD chrome.** Says: *a professional piece, a system*. Corner brackets, timecode, section labels
(`01 — EASING`), BPM. Small monospace caps at the frame edges. Showreels and technical films.

**60 fps.** Fast UI motion and showreels look better at 60 (`data-fps="60"`); story and documentary
at 24–30.

**Seamless loop.** Says: *an object, not an ad*. The last frame equals the first, including cursor
position and velocity. `om qa --loop` checks the seam. Three ways back to the start: reset with state
kept (the scene tidies itself up), a varied repeat (the same move with a new value), rewind.

**Chapter counter.** Says: *this is a set and you know where you are*. `01/08`, `13 OF 20` in a fixed
corner, ticking on each cut. Lists, tutorials, game trailers.
