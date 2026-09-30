#!/usr/bin/env node
/**
 * Generate the landing page's liquid-orb payload from the real product shader.
 *
 * `docs/index.html` is a no-build GitHub Pages file and cannot import from
 * `components/`, so this script copies the WGSL and its uniform seed out of the
 * single source of truth (`components/liquid-orb-source.ts`, consumed by
 * `components/LiquidOrbCanvas.tsx`) into `docs/assets/liquid-orb.wgsl.js`.
 * The landing page therefore renders the *actual* production orb, not a mock.
 *
 * Colour handling
 * ---------------
 * The product's own accent is `#ff8f40` (orange, hue 25deg) — see
 * `--accent` in `app/globals.css`, which is also the landing page's brand.
 * The shipped seed's colour stops are cool blue (~213deg), the one cold spot
 * inside an otherwise warm product. The seed is a designer-tunable block
 * (`radius`, `style`, `metalScale`, ... are all knobs), so this script
 * hue-rotates only the 12 `paletteStop*` ramps and the tinted `*Color` slots
 * onto the brand hue. Lightness, the saturation ladder, and all 30+ material
 * parameters (warp, ridgeAmt, gloss, sheen, glass, chromaticShift, ...) are
 * copied byte-for-byte, so the material read — chrome liquid metal — is
 * unchanged; only its temperature follows the brand.
 *
 * Usage
 *   node scripts/sync-landing-orb.mjs              # write docs/assets/liquid-orb.wgsl.js
 *   node scripts/sync-landing-orb.mjs --check      # verify in sync, write nothing
 *   node scripts/sync-landing-orb.mjs --hue 200    # keep the product's cool palette
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "components", "liquid-orb-source.ts");
const OUT = join(ROOT, "docs", "assets", "liquid-orb.wgsl.js");

/** Brand hue: #ff8f40 -> 24.8deg. Matches --accent in app/globals.css. */
const DEFAULT_HUE = 25;
/** Below this saturation a colour is read as neutral and is left untinted. */
const NEUTRAL_SAT = 0.06;

/**
 * Hue rotation alone lands on champagne/bronze, not brand orange, and raising
 * saturation alone lands on copper. `#ff8f40` reads as orange because it is
 * both bright (L 0.63) and saturated (S 1.0); the shipped seed's mid tones are
 * dim and desaturated (L 0.78 / S 0.14), so tinting them can only ever give
 * beige or bronze.
 *
 * So each slot is anchored to a role instead: the brand hue at a chosen
 * lightness/saturation, laid out along the value ramp the chrome read needs
 * (specular white -> brand orange -> deep orange -> near-black). Pure whites
 * (highlight, glow, shell rims) stay neutral; tinting them reads as stained
 * plastic. `u.paletteCount` is 0 and the twelve `paletteStop*` entries are never
 * read by the shader, so those are rotated for consistency only.
 *
 * `hue` is still honoured so the product's own cool orb can be reproduced.
 */
const SLOT_TARGET = {
  colorB: { l: 0.62, s: 0.85 },
  colorC: { l: 0.28, s: 0.7 },
  colorD: { l: 0.06, s: 0.5 },
  shellMid: { l: 0.62, s: 0.85 },
  sheenColor: { l: 0.95, s: 0.35 },
  specColor: { l: 0.9, s: 0.45 },
  canvasColor: { l: 0.05, s: 0.3 },
};

const SHADER_RE = /export const LIQUID_ORB_SHADER = \/\* wgsl \*\/ `([\s\S]*?)`;/;
const SEED_RE = /export const LIQUID_ORB_UNIFORM_SEED = new Float32Array\(\[([\s\S]*?)\]\);/;

/**
 * Uniform layout mirrors `struct Uniforms` in the WGSL: `size: vec2<f32>`
 * then scalars, then 16 `vec4<f32>` colour blocks (colourA at float 32) and
 * 12 `paletteStop` ramps (float 80). Verified against the 512-byte buffer.
 */
const COLOR_VEC4_STARTS = [32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76];
const PALETTE_STOPS = 12;
const COLOR_NAMES = [
  "colorA", "colorB", "colorC", "colorD",
  "highlightColor", "shellInner", "shellMid", "shellEdge",
  "sheenColor", "specColor", "canvasColor", "glowColor",
];

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [((h * 60) + 360) % 360, s, l];
}

function hueToRgb(p, q, t) {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  // Hue 0/1/3 -> red, 1/3 -> green, 2/3 -> blue, so the channels are offset
  // from the base hue, not from it in order.
  const t = (((h % 360) + 360) % 360) / 360;
  return [hueToRgb(p, q, t + 1 / 3), hueToRgb(p, q, t), hueToRgb(p, q, t - 1 / 3)];
}

const hex = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");

function remap(floats, targetHue) {
  const out = floats.slice();
  const touched = [];

  const rotate = (i, label) => {
    const [r, g, b] = [out[i], out[i + 1], out[i + 2]];
    const before = `#${hex(r)}${hex(g)}${hex(b)}`;
    const [h, s, l] = rgbToHsl(r, g, b);
    const target = SLOT_TARGET[label];
    if (s < NEUTRAL_SAT || !target) {
      // Genuine neutral (white highlight, pure glow): leave it alone.
      touched.push(`${label} ${before} -> ${before} (neutral kept)`);
      return;
    }
    const [nr, ng, nb] = hslToRgb(targetHue, target.s, target.l);
    out[i] = nr;
    out[i + 1] = ng;
    out[i + 2] = nb;
    touched.push(`${label} ${before} -> #${hex(nr)}${hex(ng)}${hex(nb)} (L ${l.toFixed(2)}->${target.l} S ${s.toFixed(2)}->${target.s})`);
  };

  COLOR_VEC4_STARTS.forEach((start, i) => rotate(start, COLOR_NAMES[i]));
  for (let k = 0; k < PALETTE_STOPS; k += 1) rotate(80 + k * 4, `paletteStop${k}`);

  return { floats: out, touched };
}

function build(source, targetHue) {
  const shaderMatch = source.match(SHADER_RE);
  const seedMatch = source.match(SEED_RE);
  if (!shaderMatch) throw new Error("LIQUID_ORB_SHADER not found in components/liquid-orb-source.ts");
  if (!seedMatch) throw new Error("LIQUID_ORB_UNIFORM_SEED not found in components/liquid-orb-source.ts");

  const wgsl = shaderMatch[1].replace(/\s+$/, "");
  if (wgsl.includes("`") || wgsl.includes("${")) {
    throw new Error("WGSL contains a backtick or ${ sequence; cannot inline verbatim");
  }
  for (const entry of ["vs_main", "fs_main"]) {
    if (!new RegExp(`fn ${entry}\\b`).test(wgsl)) throw new Error(`WGSL is missing entry point ${entry}`);
  }

  const floats = seedMatch[1].split(",").map((p) => parseFloat(p.trim())).filter((n) => Number.isFinite(n));
  if (floats.length !== 128) {
    throw new Error(`expected 128 uniform floats (512-byte buffer), found ${floats.length}`);
  }

  const { floats: remapped, touched } = remap(floats, targetHue);

  const lines = [];
  for (let i = 0; i < remapped.length; i += 4) {
    const row = remapped.slice(i, i + 4).map((n) => (Number.isInteger(n) ? String(n) : n.toFixed(7).replace(/0+$/, "").replace(/\.$/, ".0")));
    lines.push(`  ${row.join(", ")},`);
  }

  return {
    body: `/* GENERATED by scripts/sync-landing-orb.mjs — do not edit by hand.
 * Source of truth: components/liquid-orb-source.ts (WGSL + uniform seed).
 * Colour slots are hue-rotated to the product accent (#ff8f40, hue ${targetHue}deg);
 * every material parameter is copied verbatim. Re-run the script after editing
 * the shader.
 */
window.PI_LIQUID_ORB = {
  wgsl: String.raw\`${wgsl}\`,
  seed: new Float32Array([
${lines.join("\n")}
  ])
};
`,
    touched,
    remapped,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const hueArg = argv.indexOf("--hue");
  const targetHue = hueArg !== -1 ? Number(argv[hueArg + 1]) : DEFAULT_HUE;
  if (!Number.isFinite(targetHue)) throw new Error("--hue requires a number");

  const { body, touched, remapped } = build(readFileSync(SOURCE, "utf8"), targetHue);

  if (check) {
    const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (current === body) {
      console.log("docs/assets/liquid-orb.wgsl.js is in sync");
      return;
    }
    console.error("docs/assets/liquid-orb.wgsl.js is OUT OF SYNC — run: node scripts/sync-landing-orb.mjs");
    process.exitCode = 1;
    return;
  }

  writeFileSync(OUT, body, "utf8");
  console.log(`wrote docs/assets/liquid-orb.wgsl.js (${(body.length / 1024).toFixed(1)} KB)`);
  if (targetHue === DEFAULT_HUE) {
    console.log(`hue-rotated ${touched.length} colour slots -> hue ${targetHue}deg:`);
    for (const line of touched) console.log(`  ${line}`);
    const first = remapped[80 + 4 * 11];
    const hexOf = (i) => `#${hex(remapped[i])}${hex(remapped[i + 1])}${hex(remapped[i + 2])}`;
    console.log(`  palette ramp now ${hexOf(80)} -> ${hexOf(80 + 4 * 11)}`);
  } else {
    console.log(`kept product palette (hue ${targetHue}deg override)`);
  }
}

main();
