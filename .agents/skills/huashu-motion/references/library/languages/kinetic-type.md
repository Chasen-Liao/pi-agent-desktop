# kinetic-type — the words are the actors

Typography carries the film: words slam, squeeze, stack, rotate, ride paths and change weight on the
beat. The hype cut, the manifesto, the launch line ("The open-source alternative to Claude Motion",
"Not just Opus 5.5.", "Any model."), the chapter card.

**Says:** *a claim with conviction; energy; a rhythm you can feel.* It is the fastest way to make a
statement memorable and the easiest to read muted in a feed.

**Use when:** the message is a claim, a list, a slogan or one number; social hooks; endings of other
films; products whose brand is its voice. **Avoid when:** the viewer must understand how something
works (words describing a mechanism are weaker than showing it).

## Signature

1. One idea per beat or two; never a paragraph.
2. Scale contrast: a 300–400 px headline word against 28–40 px labels.
3. A heavy grotesk or condensed display face (or the brand's) + an italic serif or mono for contrast.
4. Variable-font axes animated (weight 300→900, width 75→125) on the beat.
5. Pill highlight behind the key phrase; a word swapped inside a sentence ("Not just ___").
6. Text as container: images or video inside the letterforms; text on spirals and paths.
7. Colour fields switch on the cut (orange → blue → cream → black), the type inverts.
8. Black type with one accent word in an italic serif; punctuation as a character (the full stop
   becomes the brand's shape); one word per screen. Full stops on every line, or none at all, are
   both valid house rules: pick one and keep it.
9. Hype variant: many hard cuts, white flashes, a little glitch, the badge or mark returning as a
   refrain (phonk / trap at 130+ BPM). An all-caps instruction word with an italic-serif result word
   ("TYPE *anything*"). Easing names and spec callouts as content for a technical audience.

## Camera · rhythm · easing

- Mostly a locked frame; when the camera moves it is a push-through into a letter's counter or a
  whip to the next word.
- 110–140 BPM; 1–2 beats per word in the build, then a break (a beat of silence or a single word),
  then the payoff with the most space.
- `expo.out` for slams, mask reveals for editorial lines, `OM.spring(0.15–0.3)` for playful brands.

## Look

Two typefaces at most; the brand colour as field; HUD chrome (timecode, section numbers) optional.
Every frame must work as a poster.

## Sound

Percussive track; a hit per word in the build (vary pitch or pan so it is not a machine gun), a riser
into the payoff, an impact on the slam, silence before the last line.

## Skeleton (12 s, 128 BPM)

`word · word · word (1 beat each) → phrase builds with pill highlight (4 beats) → break (1 beat, near
silence) → payoff line slams (2 beats) → squeeze into the wordmark (accordion into its period) → hold`

## Build

- Split text into spans per word/letter (`data-om-var` on the container so the studio can edit it).
- Fonts with real axes from `om fonts`; animate `font-variation-settings` via a CSS variable.
- Keep every word readable at 1×: at least 0.4 s on screen per short word, more for long ones.

## Breaks when

- Too many words per second to read; text that only "looks" kinetic (random rotations, jitter).
- System default fonts; centred everything; the same entrance for every word.
- Typos or brand names set in the wrong case.
- Used for a calm, premium claim with nothing else moving: in Oct 2026 launches of that kind, the
  words stayed still or only faded and an object or field carried the motion (3d-object,
  generative-field). Slow serif type alone reads as a slide.
