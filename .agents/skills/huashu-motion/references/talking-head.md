# Talking-head packaging (口播包装)

The job: someone hands you a recording of themselves talking to camera. They want it to look like a produced show — a name plate when they introduce themselves, the number popping up as they say it, the key phrase in bold 花字, a card at the turn — and they may want only the package layer, transparent, to drop onto the talk in 剪映 / Premiere / Final Cut.

Start from the `talking-head` template. It already does the hard parts: words from the recording, anchoring to them, keeping off the speaker, 16:9 and 9:16 from one file, and a transparent export.

## 1. Set up

```sh
om new talk --template talking-head
cp <recording>.mp4 talk/assets/talk.mp4
om set talk=assets/talk.mp4 talk
om fork talk talk-9x16 --size 1080x1920     # if the recording or the delivery is vertical (see 6)
```

Without a video the frame shows a placeholder that says what to do; nothing errors.

**Check for HDR first.** Phone footage is often HDR (`ffprobe` shows `color_transfer=arib-std-b67` (HLG) or `smpte2084` (PQ)). `om render` and `om check` stop on HDR footage, because its colours would come out wrong in an SDR film. Convert the talk to SDR before you start: with an ffmpeg that has `zscale`, tone-map (`-vf "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"`); for HLG without `zscale`, re-tagging as BT.709 is an acceptable quick path because HLG is designed to look right on SDR (`-vf "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,format=yuv420p" -color_primaries bt709 -color_trc bt709 -colorspace bt709`).

The picture is muted on purpose. The sound comes from `<audio id="om-voice">`, which the next step extracts from the same file, so picture and sound cannot drift apart. Until you run `om voice`, the film is silent and lasts `length` seconds.

## 2. Get the words

```sh
om voice talk --audio talk/assets/talk.mp4 --text script.txt
```

`--audio` takes a video file directly (ffmpeg pulls the sound track). It writes the cues into `index.html`, the words with times to `assets/voice.words.json`, captions to `out/*.srt`, and sets the film length to the recording.

- Give `--text` whenever you can: a transcript written the way it is *spoken* ("二十几款", not "20+ 款"). Whisper alone mishears names and jargon ("女娲skill" came back as "女arcegeal", "星标" as "新标"); with the script, whisper only places the words and the words are right. Without a script, run once without `--text`, read `voice.words.json`, fix the transcript, and run again.
- Check the `note` line: around 90% of the script matched is normal; under 50% means wrong script or wrong file.

## 3. Pick 3–6 moments

Read the transcript like an editor and choose what the viewer should *see* as well as hear. Usually:

| Moment | Element | Example |
| --- | --- | --- |
| who is talking (first ~5 s) | name plate: `name`, `role`, `nameTag` | 花叔 · 经济学出身，不会写代码的独立开发者 |
| a number that matters | number card in `stats` (counts up and lands on the spoken number) | 20+ 款产品 |
| the claim people should remember | 花字 in `keywords` (4–8 characters) | 付费榜第一 |
| a turn: 但是 / 其实 / 我学的是… | chapter card: `chapter`, `chapterNo` | 学的不是编程，是做产品 |
| the show, the series, the brand | corner badge: `corner` | Claude Code 橙皮书 |

Restraint is the craft: one package element every 4 s or so is plenty, and most sentences get nothing. Never package what is already on screen (the speaker holding up the book), and don't put the same fact in a card and a 花字.

## 4. Anchor to the words

Every element has a cue (the spoken phrase) and a seconds fallback:

```sh
om set nameCue=不会 'stats=[{"value":20,"suffix":"+","label":"款产品，全靠 AI 编程","cue":"二十"}]' \
  'keywords=[{"text":"付费榜第一","cue":"付费榜"}]' chapterCue=我学的是 talk
```

- The cue is text as it appears in `voice.words.json` — spoken form, Chinese numerals as said ("两万", "七万"). It may span the word splitter's cuts ("付|费|榜" still matches "付费榜") and may start mid-word. Add `"nth":2` for the second occurrence.
- Lookup order: `OM.cue` (one word containing the term) → the same phrase across words → the `at` / `nameAt` / `chapterAt` seconds. A cue that is not found logs a console warning and uses the seconds; `window.__omAnchors` lists what each element resolved to and from where.
- `lead` (default 0.25 s) starts the entrance early so it *settles* as the word is spoken. Number cards count until 0.35 s after the cue.
- Elements in the same slot never overlap: when the next one arrives, the previous one leaves. Lengths come from `nameHold`, `chapterHold`, per-item `hold`, or the default `hold`.
- A new take only needs `om voice` again; everything follows the words.

Quick check that every cue exists before rendering:

```sh
node -e 'const w=require("./talk/assets/voice.words.json").words.map(x=>x.word).join("");for(const c of process.argv.slice(1))console.log(w.includes(c)?"ok     ":"MISSING",c)' 不会 二十 付费榜 我学的是
```

## 5. Keep off the speaker

The layout reads five variables (fractions of the frame) and the frame size:

- `subjectX`, `subjectW`: where the person is horizontally. In 16:9, cards go to the side with more room (`side` forces left/right) and the 花字 to the other side if it has at least 22% of the width free, both off the person.
- `subjectTop`, `subjectBottom`: top of the head, bottom of the face. In 9:16, the 花字 goes above the head when there is room under the status bar, otherwise just below the face.
- `cardBottom`: the bottom edge of the card stack (0 = automatic: 0.84 in 16:9, 0.74 in 9:16, leaving the caption zone free). Raise it if the cards would cover something the speaker is showing.
- For 16:9 footage of a 3:4 or 9:16 recording, `videoFit=contain` keeps the whole picture and the cards sit in the side bars; `cover` with `focusX`/`focusY` crops instead.

Estimate the face from frames, don't guess: `om look talk --at 3` (and a few more times), or on macOS use Vision on extracted frames:

```swift
// swift face.swift frame*.jpg  → face boxes [x, y, w, h] as fractions, origin top-left
import Vision; import AppKit
for p in CommandLine.arguments.dropFirst() {
  guard let i = NSImage(contentsOfFile: p)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
  let r = VNDetectFaceRectanglesRequest(); try? VNImageRequestHandler(cgImage: i).perform([r])
  print(p, (r.results ?? []).map { b in [b.boundingBox.minX, 1 - b.boundingBox.maxY, b.boundingBox.width, b.boundingBox.height] })
}
```

Take the union over the clip (people move), put the hat or hair inside `subjectTop`, then look at the frames where each element is up.

## 6. Vertical (9:16)

Vertical is a re-layout, not a crop. `om fork <dir> <newdir> --size 1080x1920` copies the project (without `out/` and `.om/`), changes the root size and leaves a comment in the new project's inbox describing the re-layout; `om inbox <newdir> --wait` hands it to you like any user comment. For this template most of the re-layout is automatic (type scales up for phones, cards stack on the left above the caption zone, the right 14% stays free for the app's buttons); your part is setting the subject variables for the vertical framing and checking frames. `om done` it when it reads well.

## 7. Export

```sh
om render talk                    # the finished film: talk + package + sound → out/talk-vN.mp4
om render talk --transparent      # the package alone → out/talk-vN.mov
```

`--transparent` renders ProRes 4444 with alpha, sets the composition's boolean variable `transparent` to true for that render (in this template: the talk video and the placeholder are not drawn and the background is cleared), drops the sound (the edit underneath already has it), and checks the result: it fails if the file has no alpha pixel format and warns if a middle frame is opaque everywhere. `--format webm --transparent` gives VP9 with alpha instead (smaller, less widely supported in editors).

What was verified (om render, 2026-10-18; test/render.test.js):

- `--format mov` is ProRes 4444 `yuva444p12le` with a real alpha channel: where nothing is drawn alpha is 0, a drawn shape is opaque. `--format webm --transparent` carries VP9 alpha.
- The template removes the footage when building the overlay (`if (V.transparent) $('#talk').remove()`); with the HyperFrames renderer, hiding it with CSS was not enough (an earlier overlay came out fully opaque).
- Alpha is only there if nothing paints the background: `html`, `body` and the root must be `background: transparent` (the default for an element; the usual mistake is a page color on `body` or the root). Any composition can opt into `om render --transparent` by declaring a boolean `transparent` variable and clearing its background and footage when it is true.
- The overlay laid on the original video with ffmpeg matches the full render frame for frame (see the check below).

Check before handing over — the overlay on its own always looks fine; on the picture it may not:

```sh
ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0 out/talk-v2.mov   # yuva444p12le
ffmpeg -ss 9 -i out/talk-v2.mov -vf alphaextract -frames:v 1 alpha.png                        # white = package, black = clear
ffmpeg -i assets/talk.mp4 -i out/talk-v2.mov -filter_complex "[0][1]overlay=0:0:format=auto" -t 3 -ss 8 check.mp4
```

The overlay is the size of the composition. If the recording has another size or aspect, either make the composition the recording's size (`om fork --size`) or scale the recording to the composition in the editor, so the package lines up with the face it avoided.

In the editor: put the `.mov` on the track above the talk, starting at 00:00, same frame rate. The package has its own exits, so no fades are needed in the edit.

## What to report

The two output paths, which moments you packaged and the word each lands on (from `window.__omAnchors` or your cue check), anything that fell back to seconds, and frames you looked at where an element sits near the face.
