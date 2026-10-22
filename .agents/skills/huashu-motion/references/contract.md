# The huashu-motion project contract

A project is a folder whose `index.html` is a composition: a root element with `data-composition-id`, `data-width` and `data-height`, and a paused GSAP timeline registered in `window.__timelines[<id>]`. The renderer drives it in the user's own Chrome. That file is the only source: write GSAP, Canvas, Three.js or SVG freely. Everything below is a few extra HTML attributes — no new format. A composition that ignores them still renders; it just can't be pointed at or edited in the studio.

```
my-film/
  index.html      the source
  vendor/         gsap.min.js, om.js (runtime helpers) and other local libraries
  assets/         fonts, images, audio
  out/            renders from `om render`; never overwritten
  .om/            history, comment inbox, render log — maintained by the tools, safe to delete
```

## 1. Editable values are composition variables

Declare them on `<html data-composition-variables='[…]'>`. Types: `string`, `number` (`min`, `max`, `step`), `color`, `boolean`, `enum` (`options`). Optional `group` sorts them in the studio.

- `data-var-text="title"` replaces an element's text.
- `var(--accent)` in CSS — every scalar variable is also a CSS custom property on the root.
- `OM.vars()` once while building the timeline, for data, timing and logic (`window.__hyperframes.getVariables()` in older films still works).
- `data-om-var="title"` on a container whose text a script builds (per-letter animation), so the studio can edit it in place on a double-click.

The studio and `om set key=value` change only each variable's `default` value — every other byte stays as written. Good candidates: titles, numbers, colors, hold durations, data arrays (a string holding JSON). If a user might want to change it without you, make it a variable.

## 2. `data-om-id` names what people can point at

```html
<h1 data-om-id="title" data-var-text="title">…</h1>
```

Clicks and comments resolve to the smallest clearly visible element carrying an id, and comments arrive with that id and its source line. Keep ids stable when text changes. For things drawn on a canvas, register a region: `OM.region('cat', (t) => [x, y, w, h] /* composition px, or null when absent */, '猫')`.

## 3. Timeline labels `scene:<id>` are the scenes

```js
tl.addLabel('scene:intro', 0).addLabel('scene:chart', 3.2);
```

The studio draws them as the scene strip, and comments carry the scene they were made in.

## Timing

One paused timeline at `window.__timelines[<composition-id>]`. Without `data-duration` on the root, the film is as long as the timeline, so hold variables can change the length — end with the closing hold, e.g. `tl.to({}, { duration: V.endHold })`. Keep every position ≥ 0 (a negative position shifts the whole timeline), and remember `fromTo` renders its start state immediately (`immediateRender: false` or `set` at the moment when something must not exist earlier).

## Runtime helpers — `vendor/om.js`

- `OM.clock(tl, t => draw(t), duration)` — drive a frame-by-frame canvas/WebGL engine from the timeline.
- `OM.region(id, box(t), label)` — pickable canvas regions.
- `OM.cue('word', nth?, 'start'|'end')` — when a narration word is spoken (from `om voice`); motion anchored to words follows a new recording automatically.
- `OM.vars()` — the variables.
- `OM.sfx(name, at, opts)` — a sound effect at `at` (returns `at`); `OM.music({ product, drop, ending, marks, bpm })` — a built-in direction, or `<script type="text/vnd.abc" id="om-score">` — your own score, its `!mark:name!`s landing on `scene:name`; `OM.beat(n)` — n beats in seconds. `om sound` synthesizes them into `assets/sound.wav` + `<audio id="om-sound">` ([sound.md](sound.md)).

## The comment loop

1. The user presses C in the studio and clicks the frame. The comment records time, position, the object under the pointer, the scene and the current variables in `.om/inbox.jsonl`.
2. `om inbox <dir> --wait` blocks until there is one, claims it and prints the context with source lines.
3. You edit `index.html` (or `om set`). The studio reloads at the same moment.
4. `om done <id> --note "…"` — the user sees your note. They can answer "not quite" with more detail; the comment comes back to your inbox with the whole thread.
5. Every version lands in `.om/history/`, whoever wrote it. `om undo` steps back.
