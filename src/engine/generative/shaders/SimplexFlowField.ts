/**
 * Simplex Curl-Noise Flow Field Procedural ASCII Style (#version 300 es).
 * Evaluates 3D Simplex curl noise across octaves to yield both scalar flow
 * density and divergence-free flow orientation angles for directional glyphs.
 */

import type { GlslFragmentStylePlugin } from '../../../registry/types';

export const SimplexFlowField: GlslFragmentStylePlugin = {
  mode: 'generative',
  executionMode: 'glsl-fragment',
  id: 'simplex-flow-field',
  name: 'Simplex Flow Field',
  category: 'vector-flow',
  description:
    'Divergence-free 3D Simplex curl-noise vector field mapping velocity magnitude to density and direction to oriented ASCII strokes.',
  defaultRamp: 'directional',
  supportsDirectionalGlyphs: true,
  uniformSchema: [
    {
      id: 'noiseScale',
      uniformName: 'u_noiseScale',
      label: 'Noise Scale',
      kind: 'slider',
      group: 'shape',
      min: 0.4,
      max: 6.0,
      step: 0.1,
      default: 2.2,
    },
    {
      id: 'flowSpeed',
      uniformName: 'u_flowSpeed',
      label: 'Flow Speed',
      kind: 'slider',
      group: 'motion',
      min: 0,
      max: 2.0,
      step: 0.05,
      default: 0.35,
    },
    {
      id: 'octaves',
      uniformName: 'u_octaves',
      label: 'Octaves',
      kind: 'slider',
      group: 'shape',
      min: 1,
      max: 6,
      step: 1,
      default: 3,
    },
    {
      id: 'curlStrength',
      uniformName: 'u_curlStrength',
      label: 'Curl Strength',
      kind: 'slider',
      group: 'motion',
      min: 0.2,
      max: 3.0,
      step: 0.05,
      default: 1.25,
    },
  ] as const,

  fragmentBody: `
uniform float u_noiseScale;
uniform float u_flowSpeed;
uniform float u_octaves;
uniform float u_curlStrength;

vec4 evaluateCell(vec2 cellCoord, vec2 gridDims, float time) {
  float aspect = (gridDims.x * u_cellSize.x) / max(gridDims.y * u_cellSize.y, 1.0);
  vec2 uv = (cellCoord + 0.5) / max(gridDims, vec2(1.0));
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * u_noiseScale;

  float t = time * u_flowSpeed;
  int oct = clamp(int(u_octaves + 0.5), 1, 6);

  vec2 velocity = vec2(0.0);
  float amp = 1.0;
  float freq = 1.0;
  float normSum = 0.0;

  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    velocity += amp * curlNoise2D(p * freq, t * (0.7 + 0.2 * float(i)));
    normSum += amp;
    freq *= 2.0;
    amp *= 0.5;
  }
  velocity = (velocity / max(normSum, 1e-4)) * u_curlStrength;

  float speedMag = length(velocity);
  float speedNorm = clamp(speedMag * 0.42, 0.0, 1.0);
  float potential = 0.5 + 0.5 * fbm3(vec3(p, t), oct, 2.0, 0.5);
  float luminance = smoothstep(0.28, 0.82, mix(potential, speedNorm, 0.55));

  float angle = atan(velocity.y, velocity.x);
  float paletteIdx = fract(0.5 + 0.5 * (angle / 3.14159265) + potential * 0.25);
  vec3 flowRgb = cosinePalette(
    paletteIdx,
    vec3(0.52, 0.54, 0.58),
    vec3(0.48, 0.45, 0.42),
    vec3(1.0, 1.0, 1.0),
    vec3(0.15, 0.42, 0.72)
  );
  emitCellRgb(flowRgb * (0.45 + 0.55 * luminance));

  return vec4(luminance, angle, paletteIdx, 1.0);
}
`,
};
