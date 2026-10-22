# data-story — numbers that move

Charts draw, bars grow, counters roll, a dashboard turns into a story: the Claude Motion launch's
"dashboard → animated explainer", earnings explainers, milestone posts ("1 million visitors").

**Says:** *here is the evidence; it changed; this is the turning point.*

**Use when:** the message is a number, a trend, a comparison, a result. **Avoid when:** the numbers
are invented for decoration (never fake data in a real company's film), or there is one number and
nothing to compare it with (use kinetic-type for a single figure).

## Signature

1. The question first, the chart second ("Why does the Fernhill dock run empty by 8:15?").
2. Draw the line, then land the point that matters with a label and a hit.
3. Count-ups that land on the exact number on the beat; tabular figures.
4. Chart morphs that keep each datum's identity (bars → dots → map pins).
5. Highlight by dimming the rest to 20–30 % rather than adding arrows everywhere.
6. Source line on screen; fictional data carries a 示意/illustrative badge.

## Camera · rhythm · easing

Push into the turning point; pull back for context. Draw at a steady rate (`power1.inOut`), land
points on `OM.spring(0.1)`. Give each chart ≥ 2 s of readable hold after it completes.

## Look

The brand's chart palette, or a neutral base + one accent for the hero series; gridlines at 10–15 %
contrast; axis labels ≥ 32 px at 1080p (phone-readable).

## Sound

Ticks for counting (`count` sfx with duration), a soft draw sound for lines, a chime on the key
number. Calm music; the data is the drama.

## Build

- Data in a composition variable (JSON string), every label computed from it — edits never leave a
  stale number.
- The `finance-chart` template covers revenue/growth/share films; build custom charts in SVG.
- Map → 3D (Claude Motion's city): same station ids feed the flat map and the 3D scene.

## Breaks when

Bars not from zero; axes that change scale mid-film; numbers on screen < 1 s; a takeaway sentence the
chart does not support.
