/**
 * Audio-FFT Spectral Generative ASCII Style (#version 300 es).
 * Reads `u_audioBands` (subBass, lowMid, highMid, treble) from the StudioFrame UBO
 * to drive reactive vertical equalizer bars, radial sub-bass shockwave rings,
 * and high-frequency harmonic shimmer with multi-hue cosine palette coloring.
 */

import type { GlslFragmentStylePlugin } from '../../../registry/types';

export const AudioSpectralStyle: GlslFragmentStylePlugin = {
  mode: 'generative',
  executionMode: 'glsl-fragment',
  id: 'audio-spectral',
  name: 'Audio Spectral FFT',
  category: 'audio-spectral',
  description:
    '4-band Web Audio FFT spectrum combining reactive equalizer columns, sub-bass radial shockwaves, and treble shimmer.',
  defaultRamp: 'classic',
  supportsDirectionalGlyphs: false,
  uniformSchema: [
    {
      id: 'sensitivity',
      uniformName: 'u_sensitivity',
      label: 'FFT Gain',
      kind: 'slider',
      group: 'motion',
      min: 0.4,
      max: 3.0,
      step: 0.05,
      default: 1.4,
    },
    {
      id: 'barCount',
      uniformName: 'u_barCount',
      label: 'Spectral Bands',
      kind: 'slider',
      group: 'shape',
      min: 12,
      max: 64,
      step: 4,
      default: 32,
    },
    {
      id: 'ringStrength',
      uniformName: 'u_ringStrength',
      label: 'Sub-Bass Shockwave',
      kind: 'slider',
      group: 'shape',
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.85,
    },
    {
      id: 'shimmer',
      uniformName: 'u_shimmer',
      label: 'Treble Shimmer',
      kind: 'slider',
      group: 'color',
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.75,
    },
    {
      id: 'idleCarrier',
      uniformName: 'u_idleCarrier',
      label: 'Idle Demo Synth',
      kind: 'toggle',
      group: 'motion',
      default: true,
    },
  ] as const,

  fragmentBody: `
uniform float u_sensitivity;
uniform float u_barCount;
uniform float u_ringStrength;
uniform float u_shimmer;
uniform float u_idleCarrier;

float sampleBandCurve(float x, vec4 bands) {
  float k = clamp(x, 0.0, 1.0) * 3.0;
  if (k < 1.0) return mix(bands.x, bands.y, k);
  if (k < 2.0) return mix(bands.y, bands.z, k - 1.0);
  return mix(bands.z, bands.w, k - 2.0);
}

vec4 evaluateCell(vec2 cellCoord, vec2 gridDims, float time) {
  vec2 uv = (cellCoord + 0.5) / max(gridDims, vec2(1.0));
  float aspect = (gridDims.x * u_cellSize.x) / max(gridDims.y * u_cellSize.y, 1.0);
  vec2 centered = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  float livePeak = max(max(u_audioBands.x, u_audioBands.y), max(u_audioBands.z, u_audioBands.w));
  vec4 synthBands = vec4(
    0.42 + 0.36 * sin(time * 2.4) * sin(time * 1.1),
    0.34 + 0.28 * cos(time * 3.1 - 0.7),
    0.28 + 0.24 * sin(time * 4.3 + 1.2),
    0.22 + 0.22 * cos(time * 5.7)
  );
  vec4 bands = (livePeak > 0.01 || u_idleCarrier < 0.5)
    ? clamp(u_audioBands * u_sensitivity, 0.0, 1.0)
    : clamp(synthBands * (0.65 * u_sensitivity), 0.0, 1.0);

  // Discrete frequency columns mirrored symmetrically from center-bottom
  float bars = max(8.0, floor(u_barCount + 0.5));
  float symX = abs(uv.x * 2.0 - 1.0);
  float binCoord = floor(symX * (bars * 0.5)) / max(1.0, bars * 0.5);
  float bandLevel = sampleBandCurve(binCoord, bands);
  float harmonicRipple = 0.08 * sin(binCoord * 18.0 - time * 6.0) * (bands.z + 0.2);
  float barHeight = clamp(bandLevel + harmonicRipple, 0.04, 0.96);

  float distFromBottom = 1.0 - uv.y;
  float colSub = fract(symX * (bars * 0.5));
  float barGap = smoothstep(0.05, 0.2, colSub) * (1.0 - smoothstep(0.8, 0.95, colSub));
  float barFill = smoothstep(barHeight + 0.03, barHeight - 0.05, distFromBottom) * barGap;
  float barCap = exp(-abs(distFromBottom - barHeight) * 26.0) * barGap;

  // Radial sub-bass shockwave rings
  float rad = length(centered);
  float pulsePhase = rad * (14.0 - 4.0 * bands.x) - time * (3.5 + 3.0 * bands.x);
  float ringWave = pow(max(0.0, sin(pulsePhase)), 3.0) * exp(-rad * 1.35);
  float shockwave = ringWave * (0.25 + bands.x * 1.15) * u_ringStrength;

  // Treble harmonic shimmer over high-frequency field
  float trebleWave = 0.5 + 0.5 * snoise3(vec3(centered * 7.5, time * (1.5 + 2.5 * bands.w)));
  float shimmerEnergy = trebleWave * bands.w * u_shimmer * 0.55;

  float luminance = clamp(barFill * 0.8 + barCap * 0.95 + shockwave * 0.8 + shimmerEnergy, 0.0, 1.0);
  luminance = smoothstep(0.08, 0.95, luminance);

  float palT = fract(symX * 0.55 + bands.x * 0.25 + time * 0.08 + ringWave * 0.2);
  vec3 col = cosinePalette(
    palT,
    vec3(0.50, 0.52, 0.56),
    vec3(0.50, 0.48, 0.44),
    vec3(1.0, 1.0, 1.0),
    vec3(0.05, 0.35, 0.72)
  );
  emitCellRgb(col * (0.4 + 0.65 * luminance));

  return vec4(luminance, 0.0, palT, 1.0);
}
`,
};
