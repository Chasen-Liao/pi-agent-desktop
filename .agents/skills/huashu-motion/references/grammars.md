# Grammar templates

Eight explainer "grammars" from huashu-art-motion, each a template: `om templates` lists them, `om new <dir> --template <id>` starts one. Each is a whole film drawn on one canvas from a JSON spec, so you change it by editing variables and cues rather than writing animation code. Use one when the narration fits the grammar; build from `blank` when it doesn't.

| id | Good for | Not for |
|---|---|---|
| `math-3b1b` | A mechanism that turns into the next step: formulas, curves, ML and algorithms. One sentence = one animation. | Launches, stories, quick cuts |
| `keynote-ui` | Product and feature launches, specs, a tutorial screenshot, a single headline number. | Mechanisms (use 3b1b), bad news |
| `finance-chart` | Revenue, growth, share, a trend with one turning point. Numbers people will check. | One lone number (use keynote-ui or kinetic-type) |
| `kurzgesagt` | "What is inside X": systems, parts, scale, calm science narration. | Real people and events, step-by-step reasoning |
| `vox-collage` | Arguments built on real screenshots, documents, clippings: "look at this line". | Pure concepts with no real material (it turns into fake evidence) |
| `whiteboard` | Step-by-step reasoning, chains of cause, "why". Writes as it is said, ends on the whole board. | Precise data |
| `storytime` | First-person stories and fails, a joke that needs a pause. | Dense tutorials, news without an "I" |
| `kinetic-type` | Lists and stages, chapter cards, a one-line takeaway, a number. | Long explanations (more than ~5 items) |

The demo specs are 2.5–3× denser than real pacing. With narration, anchor the cues to words; without it, set `pace` to 2–3 before judging the rhythm.

For a continuous UI workflow (device → action close-up → cross-device composition → detail → result), read [product-demo-continuity.md](product-demo-continuity.md). `keynote-ui` is a starting point for launch cards and screenshot highlights, not an implementation of those focus handoffs; build unsupported shots in `blank`.

## How a template is built

`index.html` holds three things: the variables on `<html>`, the spec in `<script type="application/json" id="clip-spec">`, and a short `CLIP.mount({ id, tl, apply })`. The engine is `vendor/clip/` (grammar files in `vendor/clip/grammars/`), the fonts are in `assets/fonts/`.

- **Variables fill the spec.** `"{{title}}"` becomes the variable's value (numbers stay numbers), `"{{series|json}}"` parses a JSON string variable (empty → the field is left out; broken → the declared default plus a red note on the frame), `"收盘 {{price}} 元"` interpolates. A cue whose text placeholders all come out empty is dropped, so clearing a text variable removes that beat. `apply(spec, V)` handles the few rules placeholders can't (switching chart type, dropping a highlight with no target).
- **Structure and timing live in the cues.** Add, remove or reorder cues to change the film. `at` = the second the thing first appears (a `number` cue's `at` is when it lands; it starts counting 0.7–0.9 s earlier). The full field list per grammar is in the comment at the top of each `vendor/clip/grammars/<grammar>.js`.
- **Sound.** Every cue gets an effect by kind (point → pop, number → count, highlight → draw, title → riser, image → paper…) when you run `om sound`. `"sfx": "stamp"` on a cue picks another, `"sfx": false` mutes it. See [sound.md](sound.md).
- **`duration`** is the minimum length; with narration the film runs to the end of the voice + 0.5 s. **`pace`** multiplies every cue time that is not anchored to a word (and `duration`); animation speeds stay the same, so holds get longer.
- **Scenes** are one label per beat (`title`, `point-1`, `chart-1`, …, numbered from 1). **Regions** (pickable things on the canvas) use the spec's 0-based indexes: `bar-4` is `data.series[4]`, `point-0` is the first point cue, `card-2` the third card cue. The comment at the top of each `index.html` lists both.
- Real screenshots go in `assets/`; images are fitted (contain), never cropped. Fictional data keeps a 示意数据 badge or label in every frame; real data gets a real source and no badge.
- Vertical film: set `data-width="1080" data-height="1920"` on the root. Every grammar has a portrait layout; for burned-in subtitles add `"safe": {"bottom": 520}` to the spec.

## Anchoring cues to narration

Give a cue a `word` and it follows the voice:

```json
{ "at": 1.9, "kind": "point", "text": "补全", "word": "补全" }
{ "at": 4.6, "kind": "react", "word": "3000", "edge": "end", "offset": 0.6 }
{ "at": 8.0, "kind": "point", "text": "注意力", "word": "注意力", "nth": 2, "offset": -0.2 }
```

- After `om voice <dir> --text script.txt`, `at` = when that word is spoken (`OM.cue`), plus `offset`; `nth` picks a repeat, `edge: "end"` anchors to the end of the word. y4's slam uses `data.hitWord` the same way.
- Without `om-cues` (no narration yet) the cue keeps its own `at`, so a template plays the same before and after you write the script.
- A word that `om voice`'s tokenizer split (缓存命中 → 缓|存命|中) is still found: the narration text is searched with the words joined.
- A word missing from the narration keeps its own `at` and the frame shows a red note naming it. Fix the word or the script; don't ship with the note.
- Anchor every beat or none: cues without `word` keep their scaled `at` and won't move with the voice.
- Where the motion should land: 3b1b and kinetic type on the word (or a frame early); whiteboard writing about 0.5 s after the phrase starts (`"offset": 0.5`); keynote titles 0.2–0.3 s before the name; a number cue lands on the number; storytime reactions sit in the silence after the punch word.

## Common mistakes

- **Writing a cue kind the grammar doesn't know.** It is ignored silently. Check the kinds in the grammar file's header comment.
- **Highlight rects guessed by eye.** `highlightRect` / `data.rect` are fractions of the image and are often 20–30 % off. Snapshot the frame (`om look --at`) and adjust.
- **Too many cues in a short film.** 2–5 cues per 3–8 s. Packed cues make writing speed up and the camera arrive late.
- **`highlight` indexes.** They count only that kind (points, satellites in the current layer) from 0. A value out of range drops the highlight and says so on the frame.
- **Numbers.** Bars always start at 0. "涨到 7.8 倍" is not "涨了 7.8 倍". A ratio in the title should be computable from the chart.
- **Characters outside the font subsets.** Rare characters fall back to a system font (a console warning lists them). Common GB2312 characters are all there.
- **Editing `vendor/clip/` for one film.** Change the spec instead; the grammar files are shared code. If a grammar truly can't do something, build that shot in `blank` and cut between the two.
