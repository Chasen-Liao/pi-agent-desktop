// Specialized from AI球源码.md for its fixed style-12 uniform seed.
// The executed formulas are unchanged; unreachable editor presets are omitted so
// Chromium does not compile the full 55 KB shader for a 46 px status indicator.
export const LIQUID_ORB_SHADER = /* wgsl */ `
struct Uniforms {
  size: vec2<f32>,
  time: f32,
  speed: f32,
  radius: f32,
  zoom: f32,
  warp: f32,
  ridgeAmt: f32,
  sharp: f32,
  shade: f32,
  sheen: f32,
  gloss: f32,
  shellMidAlpha: f32,
  shellEdgeAlpha: f32,
  exposure: f32,
  style: f32,
  edgeSoftness: f32,
  edgeGlow: f32,
  paletteCount: f32,
  glassEnabled: f32,
  glassOpacity: f32,
  contourDeform: f32,
  bandDensity: f32,
  chromaticShift: f32,
  metalScale: f32,
  metalStretch: f32,
  metalAngle: f32,
  metalOffset: f32,
  metalPhase: f32,
  metalEvolution: f32,
  metalRoughness: f32,
  metalDepth: f32,
  colorA: vec4<f32>,
  colorB: vec4<f32>,
  colorC: vec4<f32>,
  colorD: vec4<f32>,
  highlightColor: vec4<f32>,
  shellInner: vec4<f32>,
  shellMid: vec4<f32>,
  shellEdge: vec4<f32>,
  sheenColor: vec4<f32>,
  specColor: vec4<f32>,
  canvasColor: vec4<f32>,
  glowColor: vec4<f32>,
  paletteStop0: vec4<f32>,
  paletteStop1: vec4<f32>,
  paletteStop2: vec4<f32>,
  paletteStop3: vec4<f32>,
  paletteStop4: vec4<f32>,
  paletteStop5: vec4<f32>,
  paletteStop6: vec4<f32>,
  paletteStop7: vec4<f32>,
  paletteStop8: vec4<f32>,
  paletteStop9: vec4<f32>,
  paletteStop10: vec4<f32>,
  paletteStop11: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn mfEdgeD(soft: f32) -> f32 {
  return soft - 0.005;
}

fn mfEdgeGlow(col: vec3<f32>, uv: vec2<f32>, ctr: vec2<f32>, rad: f32,
              soft: f32, glow: f32, glowRGB: vec3<f32>) -> vec3<f32> {
  if (glow <= 0.0) { return col; }
  let r = length(uv - ctr);
  let outside = smoothstep(rad - max(soft, 0.0005), rad + max(soft, 0.0005), r);
  return col + glowRGB * (glow * exp(-max(r - rad, 0.0) * 11.0) * outside);
}

fn lqRamp(v: f32, cA: vec3<f32>, cB: vec3<f32>, cC: vec3<f32>, cD: vec3<f32>) -> vec3<f32> {
  var c = mix(cA, cB, smoothstep(0.0, 0.45, v));
  c = mix(c, cC, smoothstep(0.38, 0.72, v));
  c = mix(c, cD, smoothstep(0.68, 1.0, v));
  return c;
}

fn glsFinishPresetFluid(colorIn: vec3<f32>, p: vec2<f32>) -> vec3<f32> {
  var color = colorIn;
  color = mix(color, u.highlightColor.rgb,
              u.shade * 0.22 * smoothstep(0.15, 1.15, dot(p, vec2<f32>(-0.32, 0.78))));
  color = color * (1.0 - u.shade * 0.34
                  * smoothstep(-0.1, 1.2, dot(p, vec2<f32>(0.45, -0.62))));
  color = color * (1.0 - u.shade * 0.22 * smoothstep(0.72, 1.08, length(p)));
  return clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn glsChromeFluid(p: vec2<f32>, t: f32) -> vec3<f32> {
  var q = p * (1.0 + u.zoom * 0.35);
  let amplitude = 0.028 * u.warp;
  for (var i: i32 = 1; i <= 9; i = i + 1) {
    let fi = f32(i);
    q.x = q.x + amplitude / fi * cos(fi * 2.7 * q.y + t * 0.46);
    q.y = q.y + amplitude / fi * cos(fi * 3.1 * q.x - t * 0.4);
  }
  let denominator = max(abs(sin(t * 0.24 - q.y - q.x)), 0.045);
  let flare = clamp(1.0 / denominator, 0.0, 18.0);
  let metal = smoothstep(1.15, 7.5, flare);
  let fold = 0.5 + 0.5 * cos((q.x - q.y) * (3.2 + u.sharp * 0.28) + t * 0.32);
  let value = clamp(metal * 0.74 + fold * 0.36, 0.0, 1.0);
  var color = lqRamp(value, u.colorD.rgb, u.colorC.rgb, u.colorB.rgb, u.colorA.rgb);
  color = mix(color, u.colorA.rgb, pow(metal, 5.0) * 0.62);
  return glsFinishPresetFluid(color, p);
}

fn glsOver(dst: vec3<f32>, src: vec3<f32>, a: f32) -> vec3<f32> {
  let k = clamp(a, 0.0, 1.0);
  return src * k + dst * (1.0 - k);
}

fn glsRefractionProfile(t: f32) -> f32 {
  let depth = clamp(t, 0.0, 1.0);
  let circular = sqrt(max(1.0 - (1.0 - depth) * (1.0 - depth), 0.0));
  return 1.0 - circular;
}

fn glsHighlightLobe(normal: vec2<f32>, direction: vec2<f32>, cut: f32,
                     power: f32) -> f32 {
  let angular = clamp((dot(normal, direction) - cut) / max(1.0 - cut, 0.001),
                      0.0, 1.0);
  return pow(angular, power);
}

fn glsRadialNormal(uv: vec2<f32>) -> vec2<f32> {
  let distance = length(uv);
  if (distance <= 0.0001) { return vec2<f32>(0.0); }
  let radial = uv / distance;
  return normalize(radial);
}

fn orbGlassLiquidAnim(uv01: vec2<f32>) -> vec4<f32> {
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);
  let rad = max(u.radius, 0.05);
  let t = u.time * u.speed;
  let contourRad = rad;

  if (length(uv) > contourRad * (1.01 + mfEdgeD(u.edgeSoftness))) {
    return vec4<f32>(clamp(mfEdgeGlow(vec3<f32>(0.0), uv, vec2<f32>(0.0), contourRad,
                                      u.edgeSoftness, u.edgeGlow, u.glowColor.rgb),
                           vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  }

  let p = uv / contourRad;
  let pd = length(p);
  let clearFa = 1.0 - smoothstep(0.995, 1.04, pd);
  let normal = glsRadialNormal(uv);
  let edgeDepth = max(1.0 - pd, 0.0);
  let refractionWidth = 0.015 + 0.95 * clamp(u.shellMidAlpha, 0.0, 1.0);
  let refractionT = edgeDepth / max(refractionWidth, 0.001);
  let refractionProfile = pow(glsRefractionProfile(refractionT), 0.68);
  let refractionAmount = 1.6 * clamp(u.glassOpacity, 0.0, 1.0) * refractionProfile;
  let refractedP = p - normal * refractionAmount;
  var fcol = vec3<f32>(0.0);
  if (clearFa > 0.0) {
    let channelSplit = 0.14 * clamp(u.gloss, 0.0, 2.0)
                       * clamp(u.glassOpacity, 0.0, 1.0) * refractionProfile;
    let redSample = glsChromeFluid(refractedP - normal * channelSplit, t);
    let greenSample = glsChromeFluid(refractedP, t);
    let blueSample = glsChromeFluid(refractedP + normal * channelSplit, t);
    fcol = vec3<f32>(redSample.r, greenSample.g, blueSample.b);
  }

  let lum = dot(fcol, vec3<f32>(0.213, 0.715, 0.072));
  let clearSat = clamp(vec3<f32>(lum) + (fcol - vec3<f32>(lum)) * 1.22,
                       vec3<f32>(0.0), vec3<f32>(1.0));
  var col = glsOver(u.canvasColor.rgb, clearSat, 0.99 * clearFa);

  let surfaceWidth = 0.026 + 0.055 * clamp(u.shellEdgeAlpha, 0.0, 1.0);
  let surfaceBand = (1.0 - smoothstep(0.0, surfaceWidth, edgeDepth)) * clearFa;
  let opticalRim = pow(surfaceBand, 1.8);
  col = glsOver(col, u.shellInner.rgb, opticalRim * u.glassOpacity * 0.45);

  let coolDirection = normalize(vec2<f32>(0.84, 0.54));
  let warmDirection = normalize(vec2<f32>(-0.62, -0.78));
  let coolSplit = glsHighlightLobe(normal, coolDirection, -0.32, 1.8);
  let warmSplit = glsHighlightLobe(normal, warmDirection, -0.28, 2.0);
  let dispersion = opticalRim * clamp(u.gloss, 0.0, 2.0) * (0.8 + 0.8 * u.shellEdgeAlpha);
  col = glsOver(col, u.shellMid.rgb, dispersion * coolSplit);
  col = glsOver(col, u.shellEdge.rgb, dispersion * warmSplit);

  let edgeShadow = opticalRim * (0.015 + 0.15 * u.shellEdgeAlpha)
                   * (0.15 + 0.85 * max(dot(normal, vec2<f32>(0.45, -0.89)), 0.0));
  col = col * (1.0 - edgeShadow);

  let keyDirection = normalize(vec2<f32>(-0.68, 0.73));
  let fillDirection = normalize(vec2<f32>(0.74, -0.67));
  let key = opticalRim * glsHighlightLobe(normal, keyDirection, 0.2, 2.8)
            * clamp(u.sheen, 0.0, 2.0) * 1.4;
  let fill = opticalRim * glsHighlightLobe(normal, fillDirection, 0.4, 3.6)
             * clamp(u.sheen, 0.0, 2.0) * 1.0;
  col = glsOver(col, u.sheenColor.rgb, key);
  col = glsOver(col, u.specColor.rgb, fill);

  let ballA = 1.0 - smoothstep(0.99 - mfEdgeD(u.edgeSoftness),
                               1.01 + mfEdgeD(u.edgeSoftness), pd);
  col = clamp(col * max(u.exposure, 0.0), vec3<f32>(0.0), vec3<f32>(1.0)) * ballA;
  let edged = mfEdgeGlow(col, uv, vec2<f32>(0.0), contourRad,
                         u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(edged, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  var out: VOut;
  out.pos = vec4<f32>(p[i], 0.0, 1.0);
  let uv01 = (p[i] + vec2<f32>(1.0)) * 0.5;
  out.uv = vec2<f32>(uv01.x, 1.0 - uv01.y);
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let c = orbGlassLiquidAnim(in.uv);
  let fc = vec2<f32>(in.uv.x, 1.0 - in.uv.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);
  let rad = max(u.radius, 0.05);
  let contourRad = rad;
  let pd = length(uv) / contourRad;
  let ballA = 1.0 - smoothstep(
    0.99 - mfEdgeD(u.edgeSoftness),
    1.01 + mfEdgeD(u.edgeSoftness),
    pd,
  );
  let lum = max(c.r, max(c.g, c.b));
  let q = (2.0 * fc - u.size) / u.size;
  let fitEnd = 1.0;
  let fitFeather = 2.0 / max(min(u.size.x, u.size.y), 1.0);
  let fitStart = min(mix(contourRad, fitEnd, 0.5), fitEnd - fitFeather);
  let fit = 1.0 - smoothstep(fitStart, fitEnd, max(abs(q.x), abs(q.y)));
  let alpha = select(ballA, max(ballA, lum), u.edgeGlow > 0.0);
  return vec4<f32>(c.rgb * fit, clamp(alpha, 0.0, 1.0) * fit);
}
`;

export const LIQUID_ORB_UNIFORM_SEED = new Float32Array([
  1, 1, 0, 3, 0.7200000286102295, 0.36000001430511475, 3.799999952316284,
  0.4399999976158142, 5.199999809265137, 0.5799999833106995,
  0.36000001430511475, 0.2800000011920929, 0.20000000298023224,
  0.2199999988079071, 1.0800000429153442, 12, 0.004999999888241291, 0, 0, 1,
  0.41999998688697815, 0, 2, 0.41999998688697815, 0.7699999809265137,
  0.23000000417232513, 65, 0, 0, 1, 0.2199999988079071, 0.25,
  1, 1, 1, 1, 0.7254902124404907, 0.7529411911964417, 0.7921568751335144, 1,
  0.20392157137393951, 0.22745098173618317, 0.26274511218070984, 1,
  0.0117647061124444, 0.01568627543747425, 0.019607843831181526, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 0.7254902124404907, 0.7529411911964417,
  0.7921568751335144, 1, 1, 1, 1, 1, 0.9176470637321472, 0.95686274766922,
  1, 1, 0.8627451062202454, 0.9176470637321472, 1, 1,
  0.019607843831181526, 0.0235294122248888, 0.0313725508749485, 1,
  1, 1, 1, 1, 0.9686274528503418, 0.9843137264251709, 1, 1,
  0.9372549057006836, 0.9647058844566345, 0.9921568632125854, 1,
  0.8784313797950745, 0.9333333373069763, 0.9764705896377563, 1,
  0.8313725590705872, 0.9019607901573181, 0.9686274528503418, 1,
  0.7333333492279053, 0.8352941274642944, 0.9529411792755127, 1,
  0.6509804129600525, 0.7803921699523926, 0.9411764740943909, 1,
  0.529411792755127, 0.6901960968971252, 0.9215686321258545, 1,
  0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1,
  0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1,
  0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1,
  0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1,
  0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1,
]);
