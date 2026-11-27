/**
 * Harmonic Wave Interference Procedural ASCII Style (#version 300 es).
 * Superimposes radial wave emitters and planar sinusoidal oscillators with
 * Lissajous/Moiré phase distortion into concentric ASCII contours.
 */

import type { GlslFragmentStylePlugin } from '../../../registry/types';

export const HarmonicInterference: GlslFragmentStylePlugin = {
  mode: 'generative',
  executionMode: 'glsl-fragment',
  id: 'harmonic-interference',
  name: 'Harmonic Interference',
  category: 'wave-interference',
  description:
    'Multi-source radial and planar sinusoidal interference generating Lissajous Moiré patterns and concentric ASCII rings.',
  defaultRamp: 'classic',
  supportsDirectionalGlyphs: false,
  uniformSchema: [
    {
      id: 'waveCount',
      uniformName: 'u_waveCount',
      label: 'Wave Emitters',
      kind: 'slider',
      group: 'shape',
      min: 2,
      max: 8,
      step: 1,
      default: 4,
    },
    {
      id: 'frequency',
      uniformName: 'u_frequency',
      label: 'Wave Frequency',
      kind: 'slider',
      group: 'shape',
      min: 2.0,
      max: 36.0,
      step: 0.5,
      default: 14.0,
    },
    {
      id: 'phaseSpeed',
      uniformName: 'u_phaseSpeed',
      label: 'Phase Speed',
      kind: 'slider',
      group: 'motion',
      min: 0,
      max: 4.0,
      step: 0.05,
      default: 1.2,
    },
    {
      id: 'distortion',
      uniformName: 'u_distortion',
      label: 'Phase Distortion',
      kind: 'slider',
      group: 'shape',
      min: 0,
      max: 2.0,
      step: 0.05,
      default: 0.45,
    },
  ] as const,

  fragmentBody: `
uniform float u_waveCount;
uniform float u_frequency;
uniform float u_phaseSpeed;
uniform float u_distortion;

float evalWaveSum(vec2 p, float t, int count) {
  float sum = 0.0;
  float weightSum = 0.0;

  // Planar carrier wave for Moire beat patterns
  vec2 dirP = vec2(cos(t * 0.25), sin(t * 0.25));
  sum += 0.45 * sin(dot(p, dirP) * u_frequency * 0.75 - t * 1.4);
  weightSum += 0.45;

  for (int i = 0; i < 8; i++) {
    if (i >= count) break;
    float fi = float(i);
    // Lissajous emitter orbit
    vec2 src = 0.45 * vec2(
      sin(t * 0.37 * (1.0 + 0.13 * fi) + fi * 1.5707),
      cos(t * 0.43 * (1.0 + 0.11 * fi) + fi * 2.0944)
    );
    float dist = length(p - src);
    float modPhase = u_distortion * sin(p.x * 3.1 + p.y * 2.7 + t * 0.5 + fi);
    float w = exp(-dist * 0.65);
    sum += w * sin(dist * u_frequency - t * 2.2 + modPhase + fi * 1.1);
    weightSum += w;
  }

  return sum / max(weightSum, 1e-4);
}

vec4 evaluateCell(vec2 cellCoord, vec2 gridDims, float time) {
  float aspect = (gridDims.x * u_cellSize.x) / max(gridDims.y * u_cellSize.y, 1.0);
  vec2 uv = (cellCoord + 0.5) / max(gridDims, vec2(1.0));
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  float t = time * u_phaseSpeed;
  int count = clamp(int(u_waveCount + 0.5), 2, 8);

  float field = evalWaveSum(p, t, count);
  float eps = 0.01;
  float dx = evalWaveSum(p + vec2(eps, 0.0), t, count) - field;
  float dy = evalWaveSum(p + vec2(0.0, eps), t, count) - field;

  float luminance = clamp(0.5 + 0.5 * field, 0.0, 1.0);
  float angle = atan(dy, dx);
  float palT = fract(luminance * 0.85 + t * 0.05);
  vec3 pal = cosinePalette(
    palT,
    vec3(0.5),
    vec3(0.5),
    vec3(1.0),
    vec3(0.0, 0.33, 0.67)
  );
  emitCellRgb(pal * (0.45 + 0.55 * luminance));

  return vec4(luminance, angle, palT, 1.0);
}
`,
};
