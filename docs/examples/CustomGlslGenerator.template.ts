/**
 * Copy-Paste Starter Template: GPU Procedural Generative Style (`glsl-fragment`)
 *
 * How to use:
 *   1. Copy this file to: `src/engine/generative/shaders/CustomGlslGenerator.ts`
 *   2. Rename `CustomGlslGenerator` and customize `id`, `uniformSchema`, and `evaluateCell`.
 *   3. Register it in `src/registry/index.ts`:
 *        import { CustomGlslGenerator } from '../engine/generative/shaders/CustomGlslGenerator';
 *        styleRegistry.registerStyle(CustomGlslGenerator);
 *
 * Host Contract:
 *   The engine automatically prepends `GLSL_PRELUDE` (`src/engine/glsl/prelude.glsl.ts`),
 *   giving your shader access to:
 *     - StudioFrame UBO:
 *         vec2  u_gridDims    (cols, rows)
 *         vec2  u_cellSize    (cellWidthPx, cellHeightPx)
 *         vec2  u_resolution  (canvasWidthPx, canvasHeightPx)
 *         float u_time        (seconds)
 *         float u_deltaTime   (seconds)
 *         uint  u_seed        (32-bit PRNG seed)
 *         uint  u_frameIndex  (monotonic frame index)
 *         vec4  u_audioBands  (subBass, bass, mid, treble in [0..1])
 *         vec4  u_pointer     (normX, normY, isDown, speed)
 *     - Helpers:
 *         snoise2(vec2), snoise3(vec3), fbm(vec2), fbm(vec2, int, float, float),
 *         fbm3(vec3, int, float, float), curlNoise2D(vec2, float),
 *         bayer4(ivec2), bayer8(ivec2), cosinePalette(float, vec3, vec3, vec3, vec3),
 *         luminance709(vec3)
 */

import type { GlslFragmentStylePlugin } from '../../../registry/types';

export const CustomGlslGenerator: GlslFragmentStylePlugin = {
  mode: 'generative',
  executionMode: 'glsl-fragment',
  id: 'custom-glsl-template',
  name: 'Custom GLSL Field',
  category: 'noise-field',
  description:
    'Starter template combining 3D Simplex noise, 4-octave fBm, cosine palette cycling, and directional gradient angles.',
  defaultRamp: 'classic',
  // Set true if you want `gradientAngle` (.g) to substitute directional glyphs (|, /, -, \)
  supportsDirectionalGlyphs: false,
  // Set true if your shader uses ping-pong feedback via `uniform sampler2D u_prevField`
  usesPingPong: false,

  // The Studio UI inspector auto-generates controls directly from this array.
  uniformSchema: [
    {
      id: 'scale',
      uniformName: 'u_scale',
      label: 'Pattern Scale',
      kind: 'slider',
      group: 'shape',
      min: 0.5,
      max: 6.0,
      step: 0.1,
      default: 2.0,
    },
    {
      id: 'speed',
      uniformName: 'u_speed',
      label: 'Animation Speed',
      kind: 'slider',
      group: 'motion',
      min: 0,
      max: 2.0,
      step: 0.05,
      default: 0.4,
    },
    {
      id: 'warpAmount',
      uniformName: 'u_warpAmount',
      label: 'Domain Warp',
      kind: 'slider',
      group: 'shape',
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.45,
    },
    {
      id: 'accent',
      uniformName: 'u_accent',
      label: 'Accent Tint',
      kind: 'color',
      group: 'color',
      default: '#38bdf8',
    },
    {
      id: 'quantizeBayer',
      uniformName: 'u_quantizeBayer',
      label: 'Ordered Dither',
      kind: 'toggle',
      group: 'shape',
      default: false,
    },
  ] as const,

  fragmentBody: `
// Declare one GLSL uniform matching each entry's \`uniformName\` above.
uniform float u_scale;
uniform float u_speed;
uniform float u_warpAmount;
uniform vec3  u_accent;
uniform float u_quantizeBayer;

float sampleField(vec2 p, float t) {
  // Combine 4-octave 2D fBm with 3D time-evolving Simplex noise
  float base = fbm(p);
  vec2 warped = p + u_warpAmount * vec2(base, snoise3(vec3(p, t * 0.6)));
  float ridge = 1.0 - abs(snoise3(vec3(warped, t)));
  return clamp(0.5 * base + 0.5 * ridge, 0.0, 1.0);
}

/**
 * Required entrypoint called once per ASCII grid cell.
 * @returns vec4(luminance [0..1], gradientAngle [-pi..pi], paletteIdx [0..1], alpha [0..1])
 */
vec4 evaluateCell(vec2 cellCoord, vec2 gridDims, float time) {
  // Correct aspect ratio using monospace physical cell dimensions
  float aspect = (gridDims.x * u_cellSize.x) / max(gridDims.y * u_cellSize.y, 1.0);
  vec2 uv = (cellCoord + 0.5) / max(gridDims, vec2(1.0));
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * u_scale;

  float t = time * u_speed;
  float val = sampleField(p, t);

  // Finite-difference gradient angle for optional directional glyph mapping
  const float eps = 0.015;
  float gx = sampleField(p + vec2(eps, 0.0), t) - val;
  float gy = sampleField(p + vec2(0.0, eps), t) - val;
  float angle = atan(gy, gx);

  // Optional ordered 8x8 Bayer threshold perturbation
  if (u_quantizeBayer > 0.5) {
    float threshold = bayer8(ivec2(cellCoord));
    val = clamp(val + (threshold - 0.5) * 0.25, 0.0, 1.0);
  }

  // Generate smooth palette index using cosinePalette + Rec. 709 luminance
  vec3 palColor = cosinePalette(
    val + t * 0.05,
    vec3(0.5),
    vec3(0.5),
    vec3(1.0),
    vec3(0.0, 0.33, 0.67)
  );
  vec3 tinted = mix(palColor, u_accent, 0.25);
  float paletteIdx = luminance709(tinted);

  return vec4(val, angle, paletteIdx, 1.0);
}
`,
};
