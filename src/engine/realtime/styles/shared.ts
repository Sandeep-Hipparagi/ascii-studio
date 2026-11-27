/**
 * Shared pure signal-processing utilities for real-time ASCII style plugins.
 * Zero DOM or framework dependencies; executes identically in main thread,
 * Web Workers, and Node test environments.
 */

export const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
  const u = i / 255;
  SRGB_TO_LINEAR[i] =
    u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
}

export const REALTIME_RAMP_PRESETS = {
  standard: ' .:-=+*#%@',
  dense: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  minimal: ' .:+*#@',
  blocks: ' ░▒▓█',
} as const;

export type RealtimeRampKey = keyof typeof REALTIME_RAMP_PRESETS;

export function buildOrderedBayerMatrix(order: number): Float32Array {
  const size = 1 << order;
  const n2 = size * size;
  const out = new Float32Array(n2);

  const recur = (x: number, y: number, dim: number, value: number, step: number): void => {
    if (dim === 1) {
      out[y * size + x] = (value + 0.5) / n2;
      return;
    }
    const half = dim >> 1;
    recur(x, y, half, value, step * 4);
    recur(x + half, y, half, value + 2 * step, step * 4);
    recur(x, y + half, half, value + 3 * step, step * 4);
    recur(x + half, y + half, half, value + step, step * 4);
  };

  recur(0, 0, size, 0, 1);
  return out;
}

export const BAYER_MATRIX_4 = buildOrderedBayerMatrix(2);
export const BAYER_MATRIX_8 = buildOrderedBayerMatrix(3);

const DIRECTIONAL_EDGE_GLYPHS = ['|', '/', '-', '\\'] as const;

/**
 * Quantizes gradient normal angle (in radians) to the perpendicular edge stroke
 * glyph (`|`, `/`, `-`, `\`) in screen coordinates (+x right, +y down).
 */
export function quantizeGradientToEdgeGlyph(angleRad: number): string {
  const wrapped = ((angleRad % Math.PI) + Math.PI) % Math.PI;
  const bin = Math.floor(wrapped / (Math.PI / 4) + 0.5) % 4;
  return DIRECTIONAL_EDGE_GLYPHS[bin] ?? '|';
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function computeContrastFactor(contrastNormalized: number): number {
  const c = Math.max(-0.99, Math.min(1, contrastNormalized)) * 255;
  return (259 * (c + 255)) / (255 * (259 - c));
}

export interface LinearGradeOptions {
  readonly brightness: number;
  readonly contrast: number;
  readonly gamma: number;
  readonly invert: boolean;
  readonly autoLevels?: boolean;
  readonly lowPct?: number;
  readonly highPct?: number;
}

/**
 * Computes linearized Rec. 709 luminance over an RGBA8 pixel buffer with
 * contrast/brightness/gamma grading and optional percentile auto-levels.
 */
export function extractGradedLuminanceField(
  rgba: Uint8ClampedArray,
  pixelCount: number,
  options: LinearGradeOptions
): Float32Array {
  const luma = new Float32Array(pixelCount);
  const contrastFactor = computeContrastFactor(options.contrast);
  const invGamma = 1 / Math.max(0.05, options.gamma);
  const hist = options.autoLevels ? new Uint32Array(256) : null;

  for (let i = 0; i < pixelCount; i += 1) {
    const p4 = i * 4;
    const rLin = SRGB_TO_LINEAR[rgba[p4] ?? 0] ?? 0;
    const gLin = SRGB_TO_LINEAR[rgba[p4 + 1] ?? 0] ?? 0;
    const bLin = SRGB_TO_LINEAR[rgba[p4 + 2] ?? 0] ?? 0;

    let y = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
    y = clamp01((y - 0.5) * contrastFactor + 0.5 + options.brightness);
    if (invGamma !== 1) {
      y = Math.pow(y, invGamma);
    }

    luma[i] = y;
    if (hist) {
      const bin = Math.min(255, Math.max(0, (y * 255) | 0));
      hist[bin] = (hist[bin] ?? 0) + 1;
    }
  }

  let qLo = 0;
  let qHi = 1;
  if (hist && pixelCount > 0) {
    qLo = percentileBin(hist, pixelCount, options.lowPct ?? 0.02) / 255;
    qHi = percentileBin(hist, pixelCount, options.highPct ?? 0.98) / 255;
    if (qHi - qLo < 1e-3) {
      qLo = 0;
      qHi = 1;
    }
  }

  const invSpan = 1 / Math.max(1e-4, qHi - qLo);
  for (let i = 0; i < pixelCount; i += 1) {
    let y = luma[i] ?? 0;
    if (hist) {
      y = clamp01((y - qLo) * invSpan);
    }
    if (options.invert) {
      y = 1 - y;
    }
    luma[i] = y;
  }

  return luma;
}

export function gradeSourceRgba(
  rgba: Uint8ClampedArray,
  pixelCount: number,
  brightness: number,
  contrast: number,
  invert: boolean
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixelCount * 4);
  const contrastFactor = computeContrastFactor(contrast);
  const bOff = brightness * 255;

  for (let i = 0; i < pixelCount; i += 1) {
    const p4 = i * 4;
    let r = contrastFactor * ((rgba[p4] ?? 0) - 128) + 128 + bOff;
    let g = contrastFactor * ((rgba[p4 + 1] ?? 0) - 128) + 128 + bOff;
    let b = contrastFactor * ((rgba[p4 + 2] ?? 0) - 128) + 128 + bOff;
    if (invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    out[p4] = r < 0 ? 0 : r > 255 ? 255 : r | 0;
    out[p4 + 1] = g < 0 ? 0 : g > 255 ? 255 : g | 0;
    out[p4 + 2] = b < 0 ? 0 : b > 255 ? 255 : b | 0;
    out[p4 + 3] = rgba[p4 + 3] ?? 255;
  }

  return out;
}

function percentileBin(hist: Uint32Array, total: number, pct: number): number {
  const target = total * clamp01(pct);
  let sum = 0;
  for (let i = 0; i < 256; i += 1) {
    sum += hist[i] ?? 0;
    if (sum >= target) return i;
  }
  return 255;
}

export function readNumberParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number
): number {
  const val = params[key];
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

export function readBooleanParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
  fallback: boolean
): boolean {
  const val = params[key];
  return typeof val === 'boolean' ? val : fallback;
}

export function readStringParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
  fallback: string
): string {
  const val = params[key];
  return typeof val === 'string' ? val : fallback;
}
