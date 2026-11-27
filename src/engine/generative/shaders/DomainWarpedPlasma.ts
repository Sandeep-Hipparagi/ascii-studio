/**
 * Domain-Warped Plasma Procedural ASCII Style (#version 300 es).
 * Applies two-stage recursive fBm domain warping (q = fbm(p), r = fbm(p + 4q + t))
 * to synthesize organic fluid currents and smooth cosine-palette cycling.
 */

import type { GlslFragmentStylePlugin } from '../../../registry/types';

export const DomainWarpedPlasma: GlslFragmentStylePlugin = {
  mode: 'generative',
  executionMode: 'glsl-fragment',
  id: 'domain-warped-plasma',
  name: 'Domain-Warped Plasma',
  category: 'noise-field',
  description:
    'Two-stage recursive fBm domain warping generating fluid ASCII currents with cosine-palette cycling.',
  defaultRamp: 'dense',
  supportsDirectionalGlyphs: false,
  uniformSchema: [
    {
      id: 'scale',
      uniformName: 'u_scale',
      label: 'Field Scale',
      kind: 'slider',
      group: 'shape',
      min: 0.4,
      max: 5.0,
      step: 0.1,
      default: 1.6,
    },
    {
      id: 'warpStrength',
      uniformName: 'u_warpStrength',
      label: 'Warp Intensity',
      kind: 'slider',
      group: 'shape',
      min: 0,
      max: 2.0,
      step: 0.05,
      default: 1.0,
    },
    {
      id: 'flowSpeed',
      uniformName: 'u_flowSpeed',
      label: 'Current Speed',
      kind: 'slider',
      group: 'motion',
      min: 0,
      max: 1.5,
      step: 0.02,
      default: 0.22,
    },
    {
      id: 'paletteSpeed',
      uniformName: 'u_paletteSpeed',
      label: 'Palette Cycle',
      kind: 'slider',
      group: 'color',
      min: 0,
      max: 1.0,
      step: 0.02,
      default: 0.15,
    },
  ] as const,

  fragmentBody: `
uniform float u_scale;
uniform float u_warpStrength;
uniform float u_flowSpeed;
uniform float u_paletteSpeed;

float evalWarp(vec2 p, float t, out vec2 qOut, out vec2 rOut) {
  qOut = vec2(
    fbm(p + vec2(0.0, t * 0.4)),
    fbm(p + vec2(5.2, 1.3 - t * 0.3))
  );
  rOut = vec2(
    fbm(p + 4.0 * u_warpStrength * qOut + vec2(1.7 + t * 0.55, 9.2)),
    fbm(p + 4.0 * u_warpStrength * qOut + vec2(8.3, 2.8 + t * 0.45))
  );
  return fbm(p + 4.0 * u_warpStrength * rOut + vec2(t * 0.2, -t * 0.15));
}

vec4 evaluateCell(vec2 cellCoord, vec2 gridDims, float time) {
  float aspect = (gridDims.x * u_cellSize.x) / max(gridDims.y * u_cellSize.y, 1.0);
  vec2 uv = (cellCoord + 0.5) / max(gridDims, vec2(1.0));
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * u_scale;

  float t = time * u_flowSpeed;
  vec2 q;
  vec2 r;
  float f = evalWarp(p, t, q, r);

  float luminance = clamp(0.5 + 0.5 * f, 0.0, 1.0);
  // Open shadows into clean negative space and enhance fluid ridges
  luminance = smoothstep(0.18, 0.88, luminance);

  float angle = atan(r.y, r.x);
  float palScalar = fract(luminance * 0.65 + length(q) * 0.35 + time * u_paletteSpeed);
  vec3 palCol = cosinePalette(
    palScalar,
    vec3(0.5, 0.5, 0.5),
    vec3(0.5, 0.5, 0.5),
    vec3(1.0, 1.0, 1.0),
    vec3(0.26, 0.42, 0.56)
  );
  emitCellRgb(palCol * (0.4 + 0.6 * luminance));

  return vec4(luminance, angle, palScalar, 1.0);
}
`,
};
