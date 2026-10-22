# Experience

Shipped experience: general findings from past films, for everyone who uses the skill. `om learn <topics>` prints the entries that match, together with this machine's local experience and the user's preferences. Each entry records what was seen, what was done and how sure we are. When new evidence contradicts an entry, fix the entry and note why. Do not add an opposite rule next to it. An entry that a reference has absorbed (rhythm.md, sound.md, director.md…) is deleted here; this file holds what is not yet method.

Entry format: `## date | situation`, then: finding, what to do, evidence, confidence.

Older project-specific notes (3D city film, web-product promo) are kept by the maintainer and not shipped.

## 2026-10-17 | Three traps met while rebuilding a launch film

- `OM.beat()` needs the bpm, so `OM.music({ bpm, end: B(54) })` throws: the argument is evaluated before the call. Set the bpm in one call and anything computed from beats in a second `OM.music({ end })`.
- Masked letters hidden with `yPercent: 110` peek out when the mask has descender padding (`padding-bottom: .26em`): the tops of the glyphs showed as fragments for the whole film. Hide at `yPercent: 140` (more than line + padding).
- An initial `transform: translateY(110%)` in CSS on an element GSAP later moves with `yPercent` does not combine cleanly; exits left captions stacked on screen. Set the hidden state with `gsap.set` instead of CSS.
- Evidence: snapshots of the same project; each fixed and re-checked by frame.
- Confidence: reproduced.

## 2026-10-17 | Chinese type and captions over a moving camera

- Finding: the user called some text "ugly" and pointed at a caption sitting on the UI card. The Chinese was a Noto Sans SC subset in 500/700 (CSS 600 snapped to 700): heavy and blunt next to Figtree. The overlap came from a slow push-in (zoom 1.12) that carried the card's bottom edge into the caption band.
- Do: when the brand's site renders Chinese in the system font, use PingFang SC (Light for big taglines, Regular for captions, Medium/Semibold for UI titles), keep the Latin face for Latin, and only request weights the font has. For every caption, compute the UI's on-screen bottom under the camera at that moment (`540 + zoom × (bottom − focusY)`) and keep it above the caption band, or move the caption. Break long CJK lines by meaning (`<br>` + `nowrap`) instead of letting one or two characters wrap alone.
- Evidence: outputs/today-launch-20261017, v5 → v6 frames at 11.2 s and 14.7 s; the user's screenshot of v5 at 0:10.
- Confidence: verified by frames. PingFang is a local macOS system font, not redistributable; a render on another OS needs a licensed substitute.

## 2026-10-17 | Gathering a product's history (old launches, archived sites)

- Finding: an "evolution" film needed the product's first launch video, archived pages and every release since. What blocked the researchers, and what got through: YouTube "Sign in to confirm you're not a bot" → `yt-dlp --cookies-from-browser chrome`; X "Requested format is not available" → `yt-dlp -F` and pick the hls video + audio pair by hand; a 1080p download stalling → `--http-chunk-size 5M -f "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]"`; the Wayback availability API returns nothing for early dates → query the CDX API and screenshot each capture headless; Homebrew's ffmpeg has no `drawtext` → build contact sheets in Python (PIL). An X post's video is reachable without login through `cdn.syndication.twimg.com/tweet-result?id=…`.
- Do: give each researcher a fixed brief (date, new capability, the visible UI change, the original wording, the URL) and ask for a contact sheet per video with "which second shows which screen". Check the user's remembered dates against the official post before building on them (the "February" launch was 5 March).
- Evidence: Manus → Cue film research, 2026-10-17 (timeline with 8 dated nodes, each with URL and quote).
- Confidence: observed in one project; the tool workarounds were each reproduced at least twice within it.

## 2026-10-17 | Narration timing from `om voice --audio` on halting speech

- Finding: on a recorded demo with long pauses, word times stretched across the silences ("双击" placed at 6.22–8.22 s, two seconds including silence) while the note still reported a 93 % character match, which looked fine. The film's burned-in subtitles changed at the true moments and became the timing authority.
- Do: when a word span is longer than ~1.2 s, or the speech has long pauses, check the cues against the waveform or the footage's own subtitles before anchoring motion to them.
- Evidence: Sofatap launch test, 2026-10-17.
- Confidence: observed once.

## 2026-10-17 | Launch film built around someone else's real footage

- Finding: for a film whose first frame had to be a person's vertical phone demo, cropping it into a 16:9 band and rebuilding the room around a segmented person (stabilization, Vision person masks, a matte + premultiplied-person pair blended with multiply / plus-lighter) worked technically but was the wrong call: the user wanted the original untouched, as a tall card in a landscape frame, with the explanation built beside it. That was faster and kept the footage honest (its own captions and screen-recording inset stayed in).
- Do: offer "original as a card + code beside it" first for real footage; reach for cropping or compositing only when the user asks. Label code-built UI next to real footage as illustrative, and credit the footage on the card.
- Finding: the footage's burned-in captions were the best clock for her words. Detecting caption changes frame by frame gave clause edges that matched the waveform; `om voice` with whisper small (88-93 % match) stretched the last clause by about 1.5 s into the trailing silence.
- Do: when a recording ships with captions, time motion to them; use `om voice` for the cues and ducking, not as the authority on clause edges.
- Finding: a phone recording had clauses 20 dB apart, and the product's key sentences were the quietest. Leveling clause by clause (each to about −23 dB RMS, gaps untouched, 80 ms ramps), then a global gain, took LRA from 13.6 to 5.7 LU without raising the room tone.
- Finding: pushing the camera in on a group (phone + TV) made it collide with the captions and the footage card. A soft-edged viewport (an intersecting mask-image on the camera's parent) keeps close-ups inside their zone. `check` cannot see masks; mark the parent `data-layout-allow-overlap`.
- Finding: `OM.clock(tl, draw, 30)` with a fixed duration made the film as long as that number; pass `tl.duration()` after building. State the canvas needs (drop, gather, stage on) was computed from `t` directly, since seeks may skip `onUpdate`.
- Evidence: repository project `outputs/sofatap-launch-20261017`, film-v4.mp4 (23.4 s, 0 hard cuts, −16.0 LUFS, 28 hits, scenes on a 120 BPM grid with 0 ms bend); cold review by a separate agent on v3, applied in v4. Processing pipeline archived under that project's `_archive/footage-processing`.
- Confidence: one film; the user has not yet watched v4 or listened to it.

## 2026-10-10 | Cross-device product demo, rendered from the reference method

- Finding: a 40.8s ChatGPT film used real web conversation/search, an official desktop document case, real CLI output and a separate official mobile case. The initial phone segment only reframed a task list while promising "view and guide"; independent review flagged the missing action.
- Do: match an operation headline to visible evidence. This film changed the headline to "view progress" and added the same official demo's opened task, activity and completion state. When mixing cases, keep provenance readable instead of implying one task moved between unrelated screens. A reading hold is valid; camera motion alone does not demonstrate a new operation.
- Finding: the first runtime check had no lint/JS errors but a sampled web shot was blank. The final build removed overlapping zero-time initial sets and forced the initial timeline state to render; do not generalise that fix without a minimal reproduction. Real-frame checks remain necessary.
- Evidence: repository project `outputs/chatgpt-across-devices-20261010`, v2 MP4, source manifests and `research/final-qa/review_v2.md`; final check had 0 errors/warnings in lint, runtime, layout and contrast. 1080p/30fps, 1224 frames, locally synthesized music with 15 declared SFX hits. Review tied to video SHA256 `5a47144b87f3f545e0727a6c0c5b15c6ee4c0191d23952420c80bfa2179e6d1e`.
- Confidence: rendered film and independently reviewed samples; no human normal-speed or listening sign-off. This is one multi-feature trial within the same product, not proof of transfer to unfamiliar brands or genres.

## 2026-10-10 | Product demo: ChatGPT dot reference

- Finding: the reference moves from phone overview to input close-up, back to overview, then desktop/phone composition, task detail and a final notification. Short reframing alternates with stable typing, task reveals and reading; focus is passed through recognisable UI elements.
- Do: on product demos, read [product-demo-continuity.md](product-demo-continuity.md) before shot planning. Separate content/scroll, shell and framing; keep a primary reading area and plan where the previous focus goes in the next shot. Retiming depends on the new content, not the reference's seconds.
- Evidence: [ChatGPT source](https://x.com/ChatGPT/status/2108636748217770180), 1080p/30fps source, full-film overview samples, 0.1s transition sequences and full-resolution keyframes examined on 2026-10-10. Private source/hash/frames remain in the project's research directory.
- Confidence: visual observations checked from frames; exact easing, normal-speed rhythm and audio not reviewed. The implementation guidance has not yet been tested on a new film. The user selected this reference as a best practice; this does not make its palette or pacing universal.

## 2026-10-10 | Sound by default: silent films read as drafts

- Finding: the user rejected silent output outright ("motion必须配音效配乐，不然太干涩"). Sound is part of the deliverable, not an export option.
- Do: mark hits with `OM.sfx` while animating, put cuts on `OM.beat`, run `om sound` before handing over the studio; `om render` rebuilds it. Offer narration once at the start (none / system voice / own recording).
- Finding: two films scored end to end in ~1.5 s each (a site intro: 33 hits, 100 BPM on-grid; a skill promo: 15 hits, cuts laid out in seconds were up to 81 ms off any grid). The latter is why each scene now restarts the beat at its own cut instead of snapping to one global grid.
- Finding: first mix was bass-heavy (kick, bass and the impact tail dominated below 150 Hz). Band means from 120 Hz–2 kHz within ~6 dB are a usable check when you can't listen.
- Evidence: two of our own films (spectrograms, ebur128: −16 LUFS master, −16.7 LUFS after AAC).
- Confidence: sync, levels and balance measured; whether it sounds good is not yet confirmed by a listener.

## 2026-10-10 | fromTo on an element that another tween moves first

- Finding: a small `fromTo('#card', { y: 0 }, …)` shake placed later in the film rendered its start immediately and pinned the card at y = 0, so the card was already in place before its drop. Same family as the `immediateRender` trap below; `check` does not catch it.
- Do: for nudges on something already animated, use `.to(el, { y: '+=6', yoyo: true, repeat: 1 })`; snapshot the second after each scene cut.
- Confidence: reproduced and fixed in the site-intro film.

## 2026-10-09 | Data explainer, made cold from the skill alone

- Finding: an agent that had only read SKILL.md built a 21 s compound-interest film in about 15 min (dark, glowing curves, one hero object carried across scenes) and handled three frame comments end to end: 2 min, 2 min and 37 s. It used `om set` for the text change and pointed out the precise figure on its own (14.2万 vs 14万).
- Do: put every number a user might question into variables and recompute everything visible from them, so an edit can never leave a stale label. Use a real typeface with weight contrast; start the first pass with the axis labels at phone-readable size (≥ 32 px at 1080p), since "the chart is too small" was the first comment.
- Do: when a comment's spot shows nothing obvious, run `om look <id>`, state the reading you chose in the note and ask the user to click again if it was the other thing. Users accept this; a guess without saying so does not work.
- Evidence: blind trial, scratchpad project `compound`; studio inbox log with timings.
- Confidence: one trial, one topic. Repeat on other genres before generalising.

## 2026-10-09 | Same loop, different agent (Codex)

- Finding: Codex (codex-cli 0.162, `exec`, workspace-write sandbox) built a 20 s browser-cache explainer from SKILL.md alone and closed three comments: 47 s, 20 s, and a "not quite" reopen it fixed from the user's follow-up line. On a timing request it delayed one beat and rippled the rest (20 → 21 s) and exposed the hold as a variable without being asked.
- Finding: in that sandbox, anything that listens on 127.0.0.1 is blocked, so `check`, `snapshot` and `om look` failed and it shipped without looking at frames.
- Do: in sandboxed agents, ask the user to approve the visual checks instead of skipping them.
- Evidence: scratchpad project `codex-trial`, its inbox log and final report.
- Confidence: one trial per agent; Gemini CLI and Kimi not yet tried.

## 2026-10-09 | GSAP timing traps that shift a whole film

- Finding: one tween placed before 0 (e.g. a caption fading in at -0.12 s) makes GSAP shift the **entire** timeline later, so every narration-anchored motion lands 0.12 s late. `fromTo` also renders its start state immediately, so an element meant to appear at 8 s is already visible at 0 s.
- Do: clamp every position to ≥ 0 (`Math.max(0, OM.cue('词') - 0.3)`); for things that must not exist before their moment, use `set` at that time or `immediateRender: false`. Check one anchored action by snapshot at its cue time.
- Evidence: voice-demo, caught by frame-checking anchored actions against word times.
- Confidence: reproduced; GSAP behaviour.

## 2026-10-09 | Rules with exceptions

- Finding: "everything must keep moving" and "always add sound effects" both have good counter-examples (a reading hold, a silent loop). Turn absolute rules into conditions on the task: what is being explained, what is being delivered, what the user chose.
- Evidence: huashu-art-motion #07 "stillness is not a freeze"; differing audio defaults in huashu-design and the video pipeline.
- Confidence: cross-checked in documents; not yet shown to improve films on new topics.

## 2026-10-09 | Smooth is not the same as interesting

- Finding: the user rejected technically clean films (deterministic camera, exact frame re-renders, readable text) as "boring". Their two reasons were weak visual craft and uniform slow camera movement, and separately, nothing new to look at.
- Do: fix craft at the shot size the camera actually uses; give the camera reasons (push in to extract evidence, pull out to reveal the system, cut to change the question); vary speed and shot size with the content. On product promos, lift a real sentence or number out of the screenshot as its own layer and let it change, instead of panning across a static page.
- Do: when the user has said a transition feels abrupt, repair continuity first (where the eye was, where it goes) instead of adding more cuts.
- Evidence: user feedback on the city and web-promo samples (maintainer's notes, not shipped).
- Confidence: clear on those films; the remedies are partly verified.

## 2026-10-09 | Studio state vs. source

- Finding: a value typed into an editor field, a preview override and the source default are three different states. Exporting after only typing can render the old value.
- Do: in huashu-motion every edit is written into `index.html` immediately (variables) and the preview reloads from the file, so preview and export always match. Do not keep values in browser-only state.
- Confidence: verified in the studio end-to-end tests.

## 2026-10-17 | Motion blur ghosts on fast moves

- Finding: averaging 4 subframes per output frame leaves discrete ghost copies on anything that crosses more than about a tenth of the frame in one frame. 8 subframes at 30 fps hides most of them.
- Do: `om render --blur` (it picks up to 8 subframes, limited by 240 fps of capture). If ghosts still show, slow the move or treat it as a stylised smear.
- Evidence: frame-checked renders of camera whips during the motion-tools work.
- Confidence: reproduced on our renders.

## 2026-10-17 | Camera poses must be planned, not read from live state

- Finding: building camera moves from the camera's current live state at build time makes a move depend on which frame was rendered first, so seeks and re-renders differ.
- Do: `OM.camera` keeps a separate plan pose and every move is a `fromTo` with `immediateRender: false`; build all moves in timeline order once.
- Evidence: seek-order tests during the camera work.
- Confidence: verified by tests.

## 2026-10-17 | What top films of Sep–Oct 2026 actually did

- Finding: about 145 high-engagement films (X launches, community films, the top prompt gallery) measured and watched by an audio-video model. Few hard cuts; a beat under the events; reliable results from one continuous language (continuous-morph) and wild variance from showreels; launch "stories" told by real people; short UI films often silent; a shared house look (cream or black, orange or lime, Geist) that makes films interchangeable.
- Do: the director now records material, people and sound mode, offers directions that differ in material, and states how the look differs from the house style. Category examples are in library/product-fit.md.
- Evidence: research set of 2026-10-17 (private); numbers are quoted where used in the library.
- Confidence: descriptive, one month, likes depend on the account; not causal.

## 2026-10-17 | A transformed wrapper with no height hides its layers

- Finding: a plain `<div>` wrapping absolutely positioned full-frame layers has zero height. The moment a tween gives it a transform, it becomes their containing block and every `inset: 0` layer collapses to nothing. The photo disappeared for the whole film while every check passed.
- Do: give any wrapper you will scale or move `position: absolute; inset: 0` (or an explicit size) before animating it.
- Evidence: the Nano Banana case film, first renders.
- Confidence: reproduced and fixed.

## 2026-10-17 | Footage inside a film

- Finding: a `<video>` with `data-start` but no `id` renders frozen. Clips play a window with `data-start`, `data-duration` and `data-media-start`; animate a wrapper, not the video (the renderer forces the clip's opacity).
- Do: `<div class="tile"><video id="v0" data-start="20.3" data-duration="5.2" data-media-start="5.8" data-track-index="1" muted playsinline src="…"></video></div>`, and tween `.tile`.
- Evidence: the huashu-motion promo film, three of our own films playing as tiles.
- Confidence: verified in the render.

## 2026-10-17 | The soundtrack sets the film's length

- Finding: `om sound` rounds the soundtrack up to a whole bar, and the render runs as long as the soundtrack. A long idle loop on the end card (a repeat that outlasts the end hold) pushed a 29 s film to 32 s.
- Do: keep idle loops inside the end hold; rerun `om sound` after changing the length.
- Evidence: the promo film went from 32.0 s to 29.6 s after trimming one repeat.
- Confidence: verified.

## 2026-10-17 | Swapping a scaled-about-the-corner element

- Finding: a camera-style move that scales an element about `0 0` and then exits with `scale` about the centre jumps on the first frame of the exit (`om qa` reports it as a hard cut).
- Do: keep the same origin for the exit and compute x/y so it shrinks toward the point you want.
- Evidence: the promo film's studio exit, fixed in one pass.
- Confidence: verified.

## 2026-10-17 | Launch films cut more than the X median, and not faster in tempo

- Finding: 21 launch films measured (first 60 s): 15 cut ten or more times a minute; the music-driven ones cut every 1.8–3.5 s on average with a median shot of 1.2–2.2 s; nine in twelve had one burst of 5–8 cuts inside five seconds, usually at 30–60 % of the length; reliable BPMs ran 77–130 (median 105). A silence slammed back on a cut appeared in 3 films; cutting strictly on the beat throughout in 2 of 11.
- Do: absorbed into rhythm.md §1–3, §5–6 and director.md §3: 100–125 BPM, a hook within 3 s, a burst, the stop as an option. The earlier "about 118 BPM, no hard cuts" for developer launches came from short UI films on X and does not hold for launch films.
- Evidence: the maintainer's launch-film rhythm study (cut detection checked by eye on 112 sampled cuts, 3.6 % false).
- Confidence: verified (measured).

## 2026-10-17 | Without a colour method, agents converge on one look

- Finding: three agents, three products, README-only material, nine key frames: six near-black with one warm accent and bone-white type, all three directions of one product in that pattern; each card claimed to differ from the house style because the house style was described by names (Geist, lime). The user disliked all of them.
- Do: colour.md (find colours before choosing, a system with roles and shares, three colour strategies, the house look as patterns) and `om swatch`, which warns when every ground is dark or every accent warm.
- Evidence: validation run 2026-10-17 (nuwa, darwin, huashu-design direction cards); the user's words are in the local experience.
- Confidence: verified (nine frames from three independent agents).

## 2026-10-17 | A pull-back through nested UI still read as a slideshow

- Finding: one continuous pull-back (a task card inside an email, a browser, a desktop, a phone) with a line of copy added per layer was judged "still a slideshow" by a cold reviewer: after the first second the picture was always the same small window shrinking a step, and the UI text in it was 8–10 px. The fix that worked was out-and-in: pull out to reveal the whole layer, then push in to the one thing that layer added (the address chip, the timer, the toggle, the Dock icon, the clock racing at night), then pull out again. Between moves a slow drift (scale 1.03 → 1) keeps the camera from parking.
- Do: drive the camera from one list of `[time, worldRect, duration]` and fit each rect into the view; give every layer a wide and a detail rect. To rotate the whole world (a phone standing up), rotate an inner rig about the object's own centre and let the outer camera only scale and translate; tweening rotation and x/y on one element swings the object on an arc (≈110 px here).
- Evidence: Manus → Cue film, v4 (cold review: "no shot-size contrast 2–16.5 s") → v5 frames; `om qa` still-spans 9 → 4.
- Confidence: verified by frames and a second review.

## 2026-10-17 | Accents and official material

- Finding: a mascot-like accent (a butterfly) flying through every scene was rejected as too heavy and meaningless; flash cuts of the brand's official release covers were rejected as boring, like slides. Accepted: the accent only at the open and on the end card, and the brand's history rebuilt as live UI instead of covers.
- Do: an accent appears at most twice and lands on something (the input box, "by <brand>"); official covers are reference for what to rebuild, not footage.
- Evidence: the user's words on v3 of the Manus → Cue film, recorded in the case folder.
- Confidence: one user, stated plainly.

## 2026-10-17 | A real engraved plate beats a drawn creature

- Finding: a code-drawn vector butterfly was called ugly; a public-domain 1779 hand-coloured plate cut into left wing, body and right wing (paper-distance threshold, largest component, holes filled) and flapped by scaleX of each wing about the body axis, darkened as it foreshortens, with a blurred silhouette as a contact shadow, was chosen over a paper-cut and an ink version.
- Do: for an organic accent, look for a public-domain plate first (Wikimedia Commons, Biodiversity Heritage Library) and animate its parts; keep flapping fast in flight (≈4 Hz) and nearly still when perched.
- Evidence: Manus → Cue film, three-direction sheet and the user's choice.
- Confidence: one project.

## 2026-10-17 | HyperFrames tooling traps on a long single-file film (history: HyperFrames was removed on 2026-10-18)

- The first and third points below were HyperFrames bugs; `om check` skips non-JavaScript scripts, and `om still` / `om look` use the render's own seek. The rest still holds.

- `hyperframes check` parses the `<script type="text/vnd.abc">` score as JavaScript ("invalid_inline_script_syntax 3:8") and then skips the browser checks. Run the check on a copy with the score block removed; `node --check` the main script separately.
- A full-frame transparent `<canvas>` counts as covering every text under it. Set its `visibility` to hidden on the frames where it draws nothing.
- `hyperframes snapshot` rendered some layers missing (whole windows, the left column) that a sequential seek and the actual render showed correctly. Judge frames from the rendered mp4 (`ffmpeg … tile`) when snapshots and the page disagree.
- Scaling an element 9× while it carries a large blurred `box-shadow` stalled rasterising (a screenshot never returned). Drop the shadow before the zoom and stop at about 5×.
- `om render --blur` at 60 fps allows at most 4 subframes (the renderer tops out at 240 fps); fast 0.5 s pulls across small text still ghost.
- `om qa` reports slow scale drift on light UI as "still"; measure a frame difference instead (mean abs diff 1.4 over 1.1 s here was a visible drift).
- Evidence: Manus → Cue film, 2026-10-17. The score-as-JS check failure and the missing snapshot layers (an end-card mark, a Computer window at 8.05 s, both present in the render) recurred in the Grok Bot film the same day.
- Confidence: each reproduced at least twice; the first two across two films.

## 2026-10-17 | Art from real material, when generated images are ruled out

- Finding: asked for portraits of real people with no AI images and no hand-drawn faces, a height map computed from an openly licensed photo and lit as clay in a WebGL shader read as each person (glasses, collars, hair) and as a made object. Rubbings and woodblocks work the same way with the ink as the raised surface. Kneading one lump from person to person (flatten, swap, form again) reads as making; a cross-fade between two height maps shows a double face.
- Do: silhouette (GrabCut, shoulders filled in below the chin), volume from its distance field, detail from the photo with its broad lighting removed and flattened into planes; never let dark mean low on its own (dark suits and hair vanish). Drive the canvas with `OM.clock`, keep it a pure function of time, register the timeline synchronously and redraw once the textures arrive.
- Evidence: `outputs/nuwa-launch-20261017` (tools/relief.py, tools/silhouette.py, assets/clay.js), stills at every section and the v2 render.
- Confidence: observed (one film).
