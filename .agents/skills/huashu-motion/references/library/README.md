# The motion library

Four layers, chosen in this order. Keeping them separate is what lets one product get a film that
fits it instead of the house style everyone else's agent produces.

| Layer | Question | File |
|---|---|---|
| **Format** | What kind of film? (length, frame, structure, ending) | [formats.md](formats.md) |
| **Language** | How do things move, and what does that say? | [languages/](languages/) — table below |
| **Techniques** | Which moves, each with a meaning and a recipe | [techniques.md](techniques.md) |
| **Look & sound** | Palette, type, material, music, hits | each language file + [../sound.md](../sound.md); art styles via huashu-art-motion |

The [director](../director.md) picks them; [product-fit.md](product-fit.md) shows what real products
used, with evidence.

## Languages

| id | Says | Best for | Template to start from |
|---|---|---|---|
| [cursor-demo](languages/cursor-demo.md) | It works; here's how | features, workflows, SaaS, AI apps | `blank` (+ product-demo-continuity) |
| [continuous-morph](languages/continuous-morph.md) | One crafted system | consumer apps, UI features, stings, loops | `blank` |
| [card-montage](languages/card-montage.md) | Step by step, finished and real | small-team product promos, consumer apps | `blank` |
| [kinetic-type](languages/kinetic-type.md) | A claim with conviction | slogans, lists, hooks, endings | `kinetic-type` |
| [modular-grid](languages/modular-grid.md) | Precise, engineered | dev tools, infra, fintech, specs | `blank` |
| [data-story](languages/data-story.md) | Here's the evidence | metrics, reports, milestones | `finance-chart` |
| [mechanism](languages/mechanism.md) | Why it works | AI/ML, algorithms, science | `math-3b1b` |
| [system-diagram](languages/system-diagram.md) | How parts connect | infra, agents, pipelines | `blank` |
| [flat-world](languages/flat-world.md) | Wonder, scale | science, health, education | `kurzgesagt` |
| [editorial-collage](languages/editorial-collage.md) | It's real; look at this line | news, commentary, case studies | `vox-collage` |
| [hand-drawn](languages/hand-drawn.md) | Human, thinking aloud | teaching, friendly brands, annotations | `whiteboard` |
| [character](languages/character.md) | Emotion, personality | stories, consumer, agents as actors | `storytime` |
| [3d-object](languages/3d-object.md) | Tangible, premium | hardware, logos, maps → cities | `blank` + Three.js |
| [generative-field](languages/generative-field.md) | Intelligence, mood | model launches, music, loops | `blank` |
| [liquid-glass](languages/liquid-glass.md) | Premium consumer | iOS apps, photo/media | `blank` |
| [photo-led](languages/photo-led.md) | The real world | travel, food, fashion, ads | `blank` |
| [showreel](languages/showreel.md) | Range and mastery | capability showcases, "made with X" | `blank` |
| [retro-digital](languages/retro-digital.md) | Culture, edge | dev culture, games, CLI tools; mostly a seasoning on kinetic-type or showreel | `blank` |
| [art-styles](languages/art-styles.md) | Culture, delight | showcases, the unexpected direction | huashu-art-motion |
| [talking-head](languages/talking-head.md) | A real person behind it | founders, creators | `talking-head` |

## Choosing: message shape × personality

Rows are the message's shape (director §2), columns the dominant personality. Each cell lists the
**Fit** language first, then good **Amplify / Unexpected** options.

| | Precise / technical | Calm / premium | Playful / energetic | Human / warm |
|---|---|---|---|---|
| **Claim** | kinetic-type · modular-grid · system-diagram ident (wireframe → mark) | 3d-object · generative-field · photo-led | kinetic-type (slams) · showreel · retro-digital | hand-drawn · kinetic-type · character |
| **Workflow** | cursor-demo · system-diagram · continuous-morph | cursor-demo · continuous-morph · card-montage | continuous-morph · cursor-demo · card-montage | cursor-demo · talking-head · hand-drawn annotations |
| **Mechanism** | mechanism · system-diagram · modular-grid | mechanism · 3d-object · flat-world | flat-world · character · art-styles | hand-drawn · flat-world · character |
| **Evidence** | data-story · modular-grid · kinetic-type | data-story · editorial-collage · 3d-object (map → city) | data-story (bold) · kinetic-type | data-story · editorial-collage · talking-head |
| **List** | modular-grid · kinetic-type · continuous-morph | card-montage · continuous-morph · kinetic-type | continuous-morph · card-montage · 3d-object | card-montage · hand-drawn · character |
| **Transformation** | continuous-morph · data-story | continuous-morph · photo-led | continuous-morph · character | photo-led · hand-drawn |
| **Story** | system-diagram (agent as packet) · talking-head · character | photo-led · talking-head · flat-world | character · art-styles · photo-led | talking-head · photo-led · character |
| **Showcase** | one deep artifact (mechanism / 3d-object) · showreel · generative-field | one deep artifact · 3d-object · showreel (restrained) | showreel · art-styles · retro-digital | art-styles · character · the product demoing itself |

Then set the parameters from the personality sentence: tempo, easing family, palette energy, type
contrast, amount on screen (director §3).

Notes from the evidence (Oct 2026 launches, product-fit.md): every launch "story" was told by real
people, none by animated characters; "showcase" launches were one deeply made artifact (a working
simulation, an epicycle drawing), not reels; a calm premium claim moved an object or a field, not
the words.

## The house style

Many top AI-made films of Sep–Oct 2026 look alike: warm off-white or near-black ground, an
orange-red or lime accent, a giant grotesk (Geist, Inter) with mono labels, one-second modules,
a dot that opens the film. The library's examples come from those films. The pattern is the problem,
not the names in it: a dark ground with one warm accent and bone type in a serif is the same house
look with the font swapped ([colour.md](../colour.md) §4). After choosing a language, say in one line
how this film's look differs from that pattern, or that the brand really looks like that. The look
comes from the product; the library supplies motion.

## Mixing languages

A film may switch language when the switch means something: the launch film opens in character
(the problem, emotionally), moves to cursor-demo (the product), closes in kinetic-type (the claim).
Carry a spine across the switch (palette, a shape, the cursor). Three languages in 30 s is the most
that still reads as one film.
