# Product fit: what real launches used

Evidence base: 48 high-engagement launch videos on X, Oct 2026 (about 40 independent campaigns;
GPT-6 "Intelligent UI" is one campaign with six films). Shapes and personality are estimates, not
measurements. Categories with N<5 are marked weak. Absence of a language here means "not a launch
format", not "bad". References are "@account date what".

How to use: find the product's category, take A/B/C as starting points for the director's three
directions (director §4), then let the message shape (director §2) override when they disagree.
These are what worked in one month of launches, not rules: a category's default is the fastest way
to look like everyone else in that category, so the B and C directions matter.

## Cross-cutting findings
- Hard cuts: median 0; 34 of 48 have at most 3. One object or one UI carries the film.
- Sound is not universal: 65% have an audible track. Under 13 s only 2 of 9; 61 s and over, all 13.
  Design muted-first for short UI films, sound-led for anything over 30 s or with live action.
  Audible loudness: median -17 LUFS, middle half -22 to -14.
- Faces track length: 80% of films over 60 s have a person; 1 of 20 films under 20 s does.
- Live action is rare (9 of 48 over half real footage) but over-indexes on likes (two hits carry it).
- Top films often have no CTA or URL: they end on the mark.
- A film for a product that generates media (video, voice, UI) is best when the film is itself the demo.

## AI model / lab (N=9, strong enough for defaults)
Models have no UI, so show capability through one deeply made artifact.
- Default: mechanism or generative-field + 3d-object; 10-60 s, zero hard cuts, tempo around 100 or no beat,
  ambient sound or silence; deep navy/black plus one glowing accent, paper-and-HUD type (LaTeX serif, mono).
- A Fit: mechanism with a live readout (counter, error, loss) and one convergence arc.
  @Google 2026-10-14 epicycle pelican: 3 to 2049 circles, then 3D wireframe.
  @claudeai 2026-10-02 gristmill: interactive cutaway, sliders drive readouts.
- B Amplify: climb a dimension. @Google 2026-10-14 pelican goes from 2D linework to a 3D orbit.
- C Unexpected: a single frosted object as a teaser: a number or name, no explanation, 10 s, silent-safe.
  @Google 2026-10-13 and 2026-10-15 Gemini 4 teasers.
- Evidence-first variant for startups: founders opening, then charts with warm-vs-cold colour coding.
  @MLCatttt 2026-10-05 Kardashev-0.7.

## AI app feature (N=10, but one campaign)
- Default: continuous-morph or cursor-demo, 16 s sting at about 2 s per beat, 110-140 BPM, character
  instrumentals (jazz, lo-fi, chiptune, piano), white UI plus one saturated "world" colour.
- A Fit: a concrete everyday world (mahjong, GameBoy, night sky) that unfolds into the flat UI, then the
  mark. @OpenAI 2026-10-07 mahjong; @OpenAI 2026-10-07 Pong; @OpenAI 2026-10-07 North Star.
- B Amplify: put it in a real place with a real hand or room, UI cards grow out of text.
  @ChatGPT 2026-10-07 handheld phone pulse; @OpenAI 2026-10-07 apartment film (70 s).
- C Unexpected: the film is the demo of the feature (a call that turns out to be the product; a backstage
  roll call of voices). @tavus 2026-10-01 Griffin; @OpenAI 2026-10-15 ChatGPT Voice.
- Plain workflow when the feature is a browser or app action: cursor-demo with typing and one saved
  result. @ChatGPT 2026-10-15 Chrome tabs.

## Developer tool / infrastructure (N=12)
- Default: cursor-demo for features (terminal or editor, typing, cursor), 15-30 s, zero cuts;
  near-black or pure white, one brand accent, grotesk + mono; ticks and clicks, or silence.
- A Fit: real command or prompt typed in the first second, result held. @supabase 2026-10-02 schema CLI;
  @OpenAIDevs 2026-10-09 Codex composer (ghost-text prediction on white).
- B Amplify: hype-cut kinetic type over real hardware, 17 s, 19 cuts, hard stop before the line.
  @OpenAIDevs 2026-10-15 "you can just build things". For lists: chapter system and diagrams. @supabase 2026-10-15 five CLI updates
  (01/05 chapter cards, founder intercut); @cognition 2026-10-05 Devin memory (cards that index, dedupe, link).
- C Unexpected: brand ident in engineering-drawing language, 12-22 s, no sound needed.
  @vercel 2026-10-15 frontend/backend wireframes; @vercel 2026-10-15 spinning drive.
- Credibility variant, 60-150 s: engineer on camera, short screen demos. @OpenAIDevs 2026-10-06 Decisions API
  (show latency as a badge; no animation on the UI to prove speed).

## Design / creative tool (N=3, weak)
- Default: cursor-demo + continuous-morph at 115-130 BPM funk; warm neutral canvas, accent colours that
  rotate (theme colours, collaborator cursors); every click on a beat.
- A Fit: one capability chain in 30 s. @figma 2026-10-15 capture-to-design.
- B Amplify: black chapter cards as a metronome between demos. @figma 2026-10-15 manifesto.
- C Unexpected: token-driven re-skin as the hook (three themes in the first second). @joshpuckett 2026-10-05.

## Productivity / notes (N=4, weak)
- Default: cursor-demo on the product's own light UI, no world colour, 6-20 s, often no audio track.
- A Fit: one automation in three clicks, hold on the AI stream. @NotionHQ 2026-10-15 button.
- B Amplify: cinematic live-action opening before the UI. @Nlacombe_ 2026-10-04 Promethee (about 105 s).
- C Unexpected: long founder walkthrough that treats the product as a new object. @DanFessler 2026-10-13 Trellis
  (about 3 min, voice-over, fractal zoom as the peak).

## Fintech / payments (N=1, very weak)
- Default: cursor-demo, white plus one indigo, wordless, a single success moment with a chime.
  @stripe 2026-10-15 data pipeline. No other evidence; inherit from developer tools and say so.

## Consumer app (no sample)
- No independent evidence in this set. Start from AI app feature or design tool and mark as unverified.

## Hardware (N=2, weak)
- Default: 3d-object with beat-matched cuts (about 1.5 s), loud trap/electronic, dot-matrix or mono labels;
  dense hard cuts are rare in this set (the other cases: a film trailer and one hype cut). @cmfbynothing 2026-10-12 speaker (10 cuts in 32 s, -9 LUFS).
- C Unexpected: no motion design at all; the raw test is the film. @Google 2026-10-07 vibration table.

## B2B / ecosystem / events (N=2, weak)
- A Fit: a calm hand-drawn loop whose last frame feeds the first. @claudeai 2026-10-06 startups (12 s, silent).
- C Unexpected: a face and a monochrome frame, no graphics. @vercel 2026-10-15 event invite.

## Games / entertainment (N=2, weak)
- Default: kinetic-type locked to the beat, retro or poster texture, high energy (the teaser runs 123 BPM; the trailer 76).
  @PardosShop 2026-10-08 hololive teaser (type rides on rotating tape).
  Film trailers use word-synced captions with 0.5-1 s shots. @TheHungerGames 2026-10-09 trailer (79 cuts).

## Rules of thumb for the three directions
- Make at least one direction differ in material (live action, code, CG, AI footage), not only language.
- If the product produces media, offer the self-referential demo as C.
- Muted-first for under 20 s; sound-led above 30 s or with people.
- A film that ends on the mark with no CTA is normal at the top of this set.
