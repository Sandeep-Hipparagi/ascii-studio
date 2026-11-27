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
 * Pre-allocated reusable buffer pool keyed by `(cols, rows, sampleCount)` so
 * 60 FPS real-time style plugins trigger zero per-frame typed-array allocations.
 */
export class RealtimeBufferPool {
  private fieldCap = 0;
  private sampleCap = 0;
  private cellCap = 0;

  private fieldBuf = new Float32Array(0);
  private lumaBuf = new Float32Array(0);
  private gradedRgbBuf = new Uint8ClampedArray(0);
  private cellRgbBuf = new Uint8ClampedArray(0);
  private edgeStrengthBuf = new Float32Array(0);
  private brailleMasksBuf = new Uint8Array(0);
  private glyphsBuf: string[] = [];
  public readonly hist = new Uint32Array(256);

  private cachedRamp = '';
  private cachedRampChars: string[] = [];

  public getRampChars(ramp: string): readonly string[] {
    if (ramp !== this.cachedRamp) {
      this.cachedRamp = ramp;
      this.cachedRampChars = Array.from(ramp);
    }
    return this.cachedRampChars;
  }

  public acquire(cols: number, rows: number, sampleCount = cols * rows): {
    readonly field: Float32Array;
    readonly luma: Float32Array;
    readonly gradedRgb: Uint8ClampedArray;
    readonly cellRgb: Uint8ClampedArray;
    readonly edgeStrength: Float32Array;
    readonly brailleMasks: Uint8Array;
    readonly glyphs: string[];
  } {
    const cellCount = Math.max(1, cols * rows);
    const sCount = Math.max(1, sampleCount);

    if (cellCount > this.cellCap) {
      this.cellCap = cellCount;
      this.cellRgbBuf = new Uint8ClampedArray(cellCount * 4);
      this.edgeStrengthBuf = new Float32Array(cellCount);
      this.brailleMasksBuf = new Uint8Array(cellCount);
    }
    if (cellCount * 4 > this.fieldCap) {
      this.fieldCap = cellCount * 4;
      this.fieldBuf = new Float32Array(this.fieldCap);
    }
    if (sCount > this.sampleCap) {
      this.sampleCap = sCount;
      this.lumaBuf = new Float32Array(sCount);
      this.gradedRgbBuf = new Uint8ClampedArray(sCount * 4);
    }
    if (this.glyphsBuf.length !== cellCount) {
      this.glyphsBuf.length = cellCount;
    }

    return {
      field: this.fieldBuf.subarray(0, cellCount * 4),
      luma: this.lumaBuf.subarray(0, sCount),
      gradedRgb: this.gradedRgbBuf.subarray(0, sCount * 4),
      cellRgb: this.cellRgbBuf.subarray(0, cellCount * 4),
      edgeStrength: this.edgeStrengthBuf.subarray(0, cellCount),
      brailleMasks: this.brailleMasksBuf.subarray(0, cellCount),
      glyphs: this.glyphsBuf,
    };
  }
}

export function extractGradedLuminanceFieldInto(
  rgba: Uint8ClampedArray,
  pixelCount: number,
  options: LinearGradeOptions,
  outLuma: Float32Array,
  scratchHist?: Uint32Array
): Float32Array {
  const contrastFactor = computeContrastFactor(options.contrast);
  const invGamma = 1 / Math.max(0.05, options.gamma);
  const hist = options.autoLevels ? (scratchHist ?? new Uint32Array(256)) : null;
  if (hist) hist.fill(0);

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

    outLuma[i] = y;
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
    let y = outLuma[i] ?? 0;
    if (hist) {
      y = clamp01((y - qLo) * invSpan);
    }
    if (options.invert) {
      y = 1 - y;
    }
    outLuma[i] = y;
  }

  return outLuma;
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
  return extractGradedLuminanceFieldInto(
    rgba,
    pixelCount,
    options,
    new Float32Array(pixelCount)
  );
}

export function gradeSourceRgbaInto(
  rgba: Uint8ClampedArray,
  pixelCount: number,
  brightness: number,
  contrast: number,
  invert: boolean,
  out: Uint8ClampedArray
): Uint8ClampedArray {
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

export function gradeSourceRgba(
  rgba: Uint8ClampedArray,
  pixelCount: number,
  brightness: number,
  contrast: number,
  invert: boolean
): Uint8ClampedArray {
  return gradeSourceRgbaInto(
    rgba,
    pixelCount,
    brightness,
    contrast,
    invert,
    new Uint8ClampedArray(pixelCount * 4)
  );
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
