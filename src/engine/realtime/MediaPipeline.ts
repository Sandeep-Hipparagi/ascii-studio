/**
 * Real-Time Media Ingestion & Signal-Processing Pipeline.
 * Handles Image, Video (via `requestVideoFrameCallback`), and Webcam `MediaStream`
 * inputs, downsamples directly to monospace-corrected grid dimensions (Nx, Ny),
 * and extracts linearized Rec. 709 luminance, graded RGB, Sobel edges, ordered
 * Bayer dithering, and 2x4 Unicode Braille bitmasks.
 */

import type {
  CellFieldOutput,
  DitherMode,
  GlyphAtlasMetrics,
  MediaFitMode,
  MediaGradingParams,
  MediaInput,
} from '../core/types';

// --- Precomputed Lookup Tables (Zero Per-Pixel Allocations) ---

const SRGB_TO_LINEAR_LUT = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
  const u = i / 255;
  SRGB_TO_LINEAR_LUT[i] =
    u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
}

/** Recursive Bayer matrix generator (size = 2^order). */
function buildBayerMatrix(order: number): Float32Array {
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

const BAYER_4X4 = buildBayerMatrix(2);
const BAYER_8X8 = buildBayerMatrix(3);

// Unicode Braille (U+2800..U+28FF) dot bits indexed by [col * 4 + row]
const BRAILLE_DOT_BITS = new Uint8Array([
  0x01, 0x02, 0x04, 0x40, // Left column (rows 0..3)
  0x08, 0x10, 0x20, 0x80, // Right column (rows 0..3)
]);

const DIRECTIONAL_GLYPHS = ['|', '/', '-', '\\'] as const;

export function quantizeAngleToGlyph(angleRad: number): string {
  // Gradient normal is perpendicular to edge tangent; map into 4 angular bins.
  const wrapped = ((angleRad % Math.PI) + Math.PI) % Math.PI;
  const bin = Math.floor(wrapped / (Math.PI / 4) + 0.5) % 4;
  return DIRECTIONAL_GLYPHS[bin] ?? '|';
}

// --- Optional WebGL2 Preprocessing Shader Source (#version 300 es) ---

export const MEDIA_PREPROCESS_VERT = `#version 300 es
layout(location = 0) in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner;
  gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const MEDIA_PREPROCESS_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_mediaTex;
uniform vec2  u_gridDims;
uniform float u_brightness;
uniform float u_contrastFactor;
uniform float u_gamma;
uniform float u_invert;
uniform vec2  u_autoLevelsRange; // (lowQuantile, highQuantile)
uniform float u_edgeEmphasis;
uniform float u_ditherMode;      // 0 = none, 1 = bayer4, 2 = bayer8
uniform float u_ditherStrength;

in vec2 v_uv;
out vec4 outField; // (luminance, gradientAngle, edgeMagnitude, alpha)

float srgbToLinear(float u) {
  return (u <= 0.04045) ? (u / 12.92) : pow((u + 0.055) / 1.055, 2.4);
}

float linearLuma709(vec3 srgb) {
  vec3 lin = vec3(srgbToLinear(srgb.r), srgbToLinear(srgb.g), srgbToLinear(srgb.b));
  return dot(lin, vec3(0.2126, 0.7152, 0.0722));
}

float gradeLuma(vec2 uv) {
  vec3 c = texture(u_mediaTex, clamp(uv, 0.0, 1.0)).rgb;
  float y = linearLuma709(c);
  y = clamp((y - 0.5) * u_contrastFactor + 0.5 + u_brightness, 0.0, 1.0);
  y = pow(y, 1.0 / max(u_gamma, 0.05));
  float span = max(u_autoLevelsRange.y - u_autoLevelsRange.x, 1e-4);
  y = clamp((y - u_autoLevelsRange.x) / span, 0.0, 1.0);
  if (u_invert > 0.5) y = 1.0 - y;
  return y;
}

float bayerThreshold(ivec2 p, int size) {
  int x = p.x & (size - 1);
  int y = p.y & (size - 1);
  int v = 0;
  int bit = (size == 8) ? 4 : 2;
  for (int i = 0; i < 3; i++) {
    if (bit == 0) break;
    int rx = (x & bit) != 0 ? 1 : 0;
    int ry = (y & bit) != 0 ? 1 : 0;
    v = (v << 2) | ((rx ^ ry) << 1) | ry;
    bit >>= 1;
  }
  return (float(v) + 0.5) / float(size * size);
}

void main() {
  vec2 texel = 1.0 / max(u_gridDims, vec2(1.0));
  float yC = gradeLuma(v_uv);

  float edgeMag = 0.0;
  float angle = 0.0;
  if (u_edgeEmphasis > 0.001) {
    float tl = gradeLuma(v_uv + vec2(-texel.x, -texel.y));
    float tc = gradeLuma(v_uv + vec2(     0.0, -texel.y));
    float tr = gradeLuma(v_uv + vec2( texel.x, -texel.y));
    float ml = gradeLuma(v_uv + vec2(-texel.x,      0.0));
    float mr = gradeLuma(v_uv + vec2( texel.x,      0.0));
    float bl = gradeLuma(v_uv + vec2(-texel.x,  texel.y));
    float bc = gradeLuma(v_uv + vec2(     0.0,  texel.y));
    float br = gradeLuma(v_uv + vec2( texel.x,  texel.y));

    float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
    edgeMag = clamp(sqrt(gx * gx + gy * gy) * 0.5, 0.0, 1.0);
    angle = atan(gy, gx);
    yC = clamp(yC + pow(edgeMag, 0.35) * u_edgeEmphasis * 0.65, 0.0, 1.0);
  }

  if (u_ditherMode > 0.5) {
    ivec2 cell = ivec2(floor(v_uv * u_gridDims));
    float t = (u_ditherMode > 1.5) ? bayerThreshold(cell, 8) : bayerThreshold(cell, 4);
    yC = clamp(yC + (t - 0.5) * u_ditherStrength * 0.35, 0.0, 1.0);
  }

  outField = vec4(yC, angle, edgeMag, 1.0);
}
`;

export const DEFAULT_MEDIA_GRADING: MediaGradingParams = {
  brightness: 0,
  contrast: 0,
  gamma: 1.0,
  autoLevels: false,
  autoLevelsLowPct: 0.02,
  autoLevelsHighPct: 0.98,
  invert: false,
  edgeEmphasis: 0,
  edgeThreshold: 0.22,
  ditherMode: 'none',
  ditherStrength: 1.0,
  brailleMode: false,
  fitMode: 'contain',
};

type StagingCanvas = HTMLCanvasElement | OffscreenCanvas;
type StagingCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createStagingSurface(width: number, height: number): {
  canvas: StagingCanvas;
  ctx: StagingCtx;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Failed to create OffscreenCanvas 2D staging context.');
    return { canvas, ctx };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Failed to create HTMLCanvasElement 2D staging context.');
  return { canvas, ctx };
}

export class MediaPipeline {
  private source: MediaInput | null = null;
  private ownedStream: MediaStream | null = null;
  private ownedVideoEl: HTMLVideoElement | null = null;
  private activeVideoEl: HTMLVideoElement | null = null;

  private rvfcHandle: number | null = null;
  private videoFrameCounter = 0;
  private lastProcessedVideoFrame = -1;
  private lastVideoTime = -1;
  private staticDirty = false;

  private readonly staging: { canvas: StagingCanvas; ctx: StagingCtx };
  private readonly backdropStaging: { canvas: StagingCanvas; ctx: StagingCtx };
  private fieldBuffer = new Float32Array(0);
  private lumaGridBuffer = new Float32Array(0);
  private edgeMagBuffer = new Float32Array(0);
  private rgbBuffer = new Uint8ClampedArray(0);
  private brailleBuffer = new Uint8Array(0);
  private readonly histogram = new Uint32Array(256);

  public constructor() {
    this.staging = createStagingSurface(64, 64);
    this.backdropStaging = createStagingSurface(96, 72);
  }

  public setInput(input: MediaInput | null): void {
    this.cleanupOwnedStream();
    this.detachVideoCallback();
    this.source = input;
    this.activeVideoEl = null;
    this.videoFrameCounter = 0;
    this.lastProcessedVideoFrame = -1;
    this.lastVideoTime = -1;
    this.staticDirty = input !== null;

    if (!input) return;

    if (typeof MediaStream !== 'undefined' && input instanceof MediaStream) {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.srcObject = input;
      void video.play().catch(() => {});
      this.ownedStream = input;
      this.ownedVideoEl = video;
      this.activeVideoEl = video;
      this.attachVideoCallback(video);
    } else if (typeof HTMLVideoElement !== 'undefined' && input instanceof HTMLVideoElement) {
      this.activeVideoEl = input;
      this.attachVideoCallback(input);
    }
  }

  public isContinuousMedia(): boolean {
    if (this.ownedStream !== null) return true;
    const v = this.activeVideoEl;
    return v !== null && !v.paused && !v.ended;
  }

  public isWebcamActive(): boolean {
    return this.ownedStream !== null;
  }

  public isVideoOrWebcam(): boolean {
    return this.ownedStream !== null || this.activeVideoEl !== null;
  }

  public hasInput(): boolean {
    return this.source !== null;
  }

  public getVideoElement(): HTMLVideoElement | null {
    return this.activeVideoEl;
  }

  /**
   * Downsamples the active media source to `(cols * subX) x (rows * subY)` and
   * returns its raw RGBA8 pixel buffer without executing built-in grading kernels.
   */
  public sampleDownsampledRgba(
    viewportW: number,
    viewportH: number,
    metrics: GlyphAtlasMetrics,
    fitMode: MediaFitMode,
    subX = 1,
    subY = 1,
    force = false
  ): { cols: number; rows: number; sampleW: number; sampleH: number; rgba: Uint8ClampedArray } | null {
    if (!this.source) return null;

    const v = this.activeVideoEl;
    if (v) {
      if (v.readyState < 2) return null;
      if (!force && !this.hasNewFrame()) return null;
      this.lastProcessedVideoFrame = this.videoFrameCounter;
      this.lastVideoTime = v.currentTime;
    } else if (!force && !this.staticDirty) {
      return null;
    }

    this.staticDirty = false;

    const cols = Math.max(1, Math.floor(viewportW / Math.max(1, metrics.cellWidthPx)));
    const rows = Math.max(1, Math.floor(viewportH / Math.max(1, metrics.cellHeightPx)));
    const sampleW = cols * Math.max(1, subX);
    const sampleH = rows * Math.max(1, subY);

    const drawable = this.resolveDrawable();
    if (!drawable) return null;

    const { srcW, srcH } = this.getDrawableDimensions(drawable);
    if (srcW <= 0 || srcH <= 0) return null;

    if (this.staging.canvas.width !== sampleW || this.staging.canvas.height !== sampleH) {
      this.staging.canvas.width = sampleW;
      this.staging.canvas.height = sampleH;
    }

    const ctx = this.staging.ctx;
    ctx.clearRect(0, 0, sampleW, sampleH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    this.drawFittedSource(ctx, drawable, srcW, srcH, viewportW, viewportH, sampleW, sampleH, fitMode);

    return {
      cols,
      rows,
      sampleW,
      sampleH,
      rgba: ctx.getImageData(0, 0, sampleW, sampleH).data,
    };
  }

  public markDirty(): void {
    this.staticDirty = true;
  }

  /**
   * Renders the fitted active media source into a low-resolution (96x72) offscreen
   * canvas whose GPU `LINEAR` texture sampling yields a blurred ambient backdrop.
   */
  public getBlurredBackdropSurface(
    viewportW: number,
    viewportH: number,
    fitMode: MediaFitMode
  ): StagingCanvas | null {
    if (!this.source) return null;
    const v = this.activeVideoEl;
    if (v && v.readyState < 2) return null;

    const drawable = this.resolveDrawable();
    if (!drawable) return null;

    const { srcW, srcH } = this.getDrawableDimensions(drawable);
    if (srcW <= 0 || srcH <= 0) return null;

    const bw = 96;
    const bh = 72;
    const ctx = this.backdropStaging.ctx;
    ctx.clearRect(0, 0, bw, bh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    this.drawFittedSource(ctx, drawable, srcW, srcH, viewportW, viewportH, bw, bh, fitMode);
    return this.backdropStaging.canvas;
  }

  /**
   * Renders the un-stylized active media source directly into an arbitrary target
   * canvas using identical aspect-fit geometry (`contain` / `cover`) for Before/After
   * split-wipe comparison.
   */
  public drawRawFittedToCanvas(
    targetCanvas: HTMLCanvasElement,
    viewportW: number,
    viewportH: number,
    dpr: number,
    fitMode: MediaFitMode
  ): boolean {
    if (!this.source) return false;
    const v = this.activeVideoEl;
    if (v && v.readyState < 2) return false;

    const drawable = this.resolveDrawable();
    if (!drawable) return false;

    const { srcW, srcH } = this.getDrawableDimensions(drawable);
    if (srcW <= 0 || srcH <= 0) return false;

    const targetW = Math.max(1, Math.round(viewportW * dpr));
    const targetH = Math.max(1, Math.round(viewportH * dpr));
    if (targetCanvas.width !== targetW || targetCanvas.height !== targetH) {
      targetCanvas.width = targetW;
      targetCanvas.height = targetH;
    }

    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return false;

    ctx.clearRect(0, 0, targetW, targetH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    this.drawFittedSource(
      ctx,
      drawable,
      srcW,
      srcH,
      viewportW,
      viewportH,
      targetW,
      targetH,
      fitMode
    );
    return true;
  }

  /**
   * Checks whether a newly presented video frame or updated static source is ready
   * for ingestion, preventing redundant processing of unchanged video frames.
   */
  public hasNewFrame(): boolean {
    if (!this.source) return false;

    const v = this.activeVideoEl;
    if (!v) {
      return this.staticDirty;
    }

    if (v.readyState < 2) return false;

    if (typeof v.requestVideoFrameCallback === 'function') {
      return this.staticDirty || this.videoFrameCounter !== this.lastProcessedVideoFrame;
    }

    return this.staticDirty || Math.abs(v.currentTime - this.lastVideoTime) > 1e-4;
  }

  /**
   * Downsamples the active media input directly to the monospace-corrected target
   * grid (cols x rows, or 2*cols x 4*rows for Braille) and executes luminance,
   * grading, Sobel edge, Bayer dithering, and Braille extraction.
   */
  public processFrame(
    viewportW: number,
    viewportH: number,
    metrics: GlyphAtlasMetrics,
    params: MediaGradingParams,
    force = false
  ): CellFieldOutput | null {
    if (!this.source) return null;

    const v = this.activeVideoEl;
    if (v) {
      if (v.readyState < 2) return null;
      if (!force && !this.hasNewFrame()) return null;
      this.lastProcessedVideoFrame = this.videoFrameCounter;
      this.lastVideoTime = v.currentTime;
    } else if (!force && !this.staticDirty) {
      return null;
    }

    this.staticDirty = false;

    const cols = Math.max(1, Math.floor(viewportW / Math.max(1, metrics.cellWidthPx)));
    const rows = Math.max(1, Math.floor(viewportH / Math.max(1, metrics.cellHeightPx)));

    const subX = params.brailleMode ? 2 : 1;
    const subY = params.brailleMode ? 4 : 1;
    const sampleW = cols * subX;
    const sampleH = rows * subY;

    const drawable = this.resolveDrawable();
    if (!drawable) return null;

    const { srcW, srcH } = this.getDrawableDimensions(drawable);
    if (srcW <= 0 || srcH <= 0) return null;

    if (this.staging.canvas.width !== sampleW || this.staging.canvas.height !== sampleH) {
      this.staging.canvas.width = sampleW;
      this.staging.canvas.height = sampleH;
    }

    const ctx = this.staging.ctx;
    ctx.clearRect(0, 0, sampleW, sampleH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';

    // Aspect-ratio correction: fit the source image into the target viewport's
    // monospace-corrected physical aspect ratio before sampling into (sampleW, sampleH).
    this.drawFittedSource(ctx, drawable, srcW, srcH, viewportW, viewportH, sampleW, sampleH, params.fitMode);

    const pixels = ctx.getImageData(0, 0, sampleW, sampleH).data;
    return this.runTypedArrayKernels(pixels, cols, rows, sampleW, sampleH, params);
  }

  public dispose(): void {
    this.detachVideoCallback();
    this.cleanupOwnedStream();
    this.source = null;
    this.activeVideoEl = null;
  }

  private runTypedArrayKernels(
    pixels: Uint8ClampedArray,
    cols: number,
    rows: number,
    sampleW: number,
    sampleH: number,
    params: MediaGradingParams
  ): CellFieldOutput {
    const sampleCount = sampleW * sampleH;
    const cellCount = cols * rows;

    if (this.lumaGridBuffer.length < sampleCount) {
      this.lumaGridBuffer = new Float32Array(sampleCount);
    }
    if (this.fieldBuffer.length < cellCount * 4) {
      this.fieldBuffer = new Float32Array(cellCount * 4);
    }
    if (this.edgeMagBuffer.length < cellCount) {
      this.edgeMagBuffer = new Float32Array(cellCount);
    }
    if (this.rgbBuffer.length < cellCount * 4) {
      this.rgbBuffer = new Uint8ClampedArray(cellCount * 4);
    }
    if (params.brailleMode && this.brailleBuffer.length < cellCount) {
      this.brailleBuffer = new Uint8Array(cellCount);
    }

    const contrastClamped = Math.max(-0.99, Math.min(1, params.contrast)) * 255;
    const contrastFactor =
      (259 * (contrastClamped + 255)) / (255 * (259 - contrastClamped));
    const invGamma = 1 / Math.max(0.05, params.gamma);

    if (params.autoLevels) {
      this.histogram.fill(0);
    }

    // Pass 1: Linearized Rec. 709 luminance + contrast/brightness/gamma grading
    for (let i = 0; i < sampleCount; i += 1) {
      const p4 = i * 4;
      const rLin = SRGB_TO_LINEAR_LUT[pixels[p4] ?? 0] ?? 0;
      const gLin = SRGB_TO_LINEAR_LUT[pixels[p4 + 1] ?? 0] ?? 0;
      const bLin = SRGB_TO_LINEAR_LUT[pixels[p4 + 2] ?? 0] ?? 0;

      let y = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
      y = (y - 0.5) * contrastFactor + 0.5 + params.brightness;
      y = y < 0 ? 0 : y > 1 ? 1 : y;
      if (invGamma !== 1) {
        y = Math.pow(y, invGamma);
      }

      this.lumaGridBuffer[i] = y;
      if (params.autoLevels) {
        const bin = Math.min(255, Math.max(0, (y * 255) | 0));
        this.histogram[bin] = (this.histogram[bin] ?? 0) + 1;
      }
    }

    // Pass 1b: Optional percentile auto-levels stretch + inversion
    let qLo = 0;
    let qHi = 1;
    if (params.autoLevels && sampleCount > 0) {
      qLo = this.findPercentile(sampleCount, params.autoLevelsLowPct) / 255;
      qHi = this.findPercentile(sampleCount, params.autoLevelsHighPct) / 255;
      if (qHi - qLo < 1e-3) {
        qLo = 0;
        qHi = 1;
      }
    }
    const invSpan = 1 / Math.max(1e-4, qHi - qLo);

    for (let i = 0; i < sampleCount; i += 1) {
      let y = this.lumaGridBuffer[i] ?? 0;
      if (params.autoLevels) {
        y = (y - qLo) * invSpan;
        y = y < 0 ? 0 : y > 1 ? 1 : y;
      }
      if (params.invert) {
        y = 1 - y;
      }
      this.lumaGridBuffer[i] = y;
    }

    // Pass 2: Assemble cell field, graded RGB, 3x3 Sobel edges, Bayer dither & Braille
    const lumaAt = (sx: number, sy: number): number => {
      const cx = sx < 0 ? 0 : sx >= sampleW ? sampleW - 1 : sx;
      const cy = sy < 0 ? 0 : sy >= sampleH ? sampleH - 1 : sy;
      return this.lumaGridBuffer[cy * sampleW + cx] ?? 0;
    };

    const ditherMatrix =
      params.ditherMode === 'bayer8'
        ? BAYER_8X8
        : params.ditherMode === 'bayer4'
          ? BAYER_4X4
          : null;
    const ditherDim = params.ditherMode === 'bayer8' ? 8 : 4;
    const ditherMask = ditherDim - 1;

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const cellIdx = r * cols + c;
        const fieldBase = cellIdx * 4;

        if (params.brailleMode) {
          const sx0 = c * 2;
          const sy0 = r * 4;
          let mask = 0;
          let ySum = 0;
          let rSum = 0;
          let gSum = 0;
          let bSum = 0;

          for (let du = 0; du < 2; du += 1) {
            for (let dv = 0; dv < 4; dv += 1) {
              const sx = sx0 + du;
              const sy = sy0 + dv;
              const ySub = lumaAt(sx, sy);
              ySum += ySub;

              const p4 = (sy * sampleW + sx) * 4;
              rSum += pixels[p4] ?? 0;
              gSum += pixels[p4 + 1] ?? 0;
              bSum += pixels[p4 + 2] ?? 0;

              const thresh = ditherMatrix
                ? (ditherMatrix[(sy & ditherMask) * ditherDim + (sx & ditherMask)] ?? 0.5)
                : 0.5;

              if (ySub > thresh) {
                mask |= BRAILLE_DOT_BITS[du * 4 + dv] ?? 0;
              }
            }
          }

          this.brailleBuffer[cellIdx] = mask;
          this.fieldBuffer[fieldBase] = ySum / 8;
          this.fieldBuffer[fieldBase + 1] = 0;
          this.fieldBuffer[fieldBase + 2] = 0;
          this.fieldBuffer[fieldBase + 3] = 1;
          this.edgeMagBuffer[cellIdx] = 0;

          this.writeGradedRgb(
            fieldBase,
            rSum / 8,
            gSum / 8,
            bSum / 8,
            contrastFactor,
            params
          );
          continue;
        }

        // Standard 1:1 cell sample
        const p4 = cellIdx * 4;
        let y = this.lumaGridBuffer[cellIdx] ?? 0;
        let angle = 0;
        let edgeMag = 0;

        if (params.edgeEmphasis > 0.001) {
          const tl = lumaAt(c - 1, r - 1);
          const tc = lumaAt(c, r - 1);
          const tr = lumaAt(c + 1, r - 1);
          const ml = lumaAt(c - 1, r);
          const mr = lumaAt(c + 1, r);
          const bl = lumaAt(c - 1, r + 1);
          const bc = lumaAt(c, r + 1);
          const br = lumaAt(c + 1, r + 1);

          const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
          const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
          edgeMag = Math.min(1, Math.hypot(gx, gy) * 0.5);
          angle = Math.atan2(gy, gx);

          y = Math.min(
            1,
            y + Math.pow(edgeMag, 0.35) * params.edgeEmphasis * 0.65
          );
        }

        if (ditherMatrix) {
          const threshold =
            ditherMatrix[(r & ditherMask) * ditherDim + (c & ditherMask)] ?? 0.5;
          y = Math.max(0, Math.min(1, y + (threshold - 0.5) * params.ditherStrength * 0.35));
        }

        this.fieldBuffer[fieldBase] = y;
        this.fieldBuffer[fieldBase + 1] = angle;
        this.fieldBuffer[fieldBase + 2] = edgeMag;
        this.fieldBuffer[fieldBase + 3] = (pixels[p4 + 3] ?? 255) / 255;
        this.edgeMagBuffer[cellIdx] = edgeMag;

        this.writeGradedRgb(
          fieldBase,
          pixels[p4] ?? 0,
          pixels[p4 + 1] ?? 0,
          pixels[p4 + 2] ?? 0,
          contrastFactor,
          params
        );
      }
    }

    return {
      cols,
      rows,
      field: this.fieldBuffer.subarray(0, cellCount * 4),
      rgb: this.rgbBuffer.subarray(0, cellCount * 4),
      edgeStrength: this.edgeMagBuffer.subarray(0, cellCount),
      brailleMasks: params.brailleMode
        ? this.brailleBuffer.subarray(0, cellCount)
        : undefined,
    };
  }

  private writeGradedRgb(
    base: number,
    rIn: number,
    gIn: number,
    bIn: number,
    contrastFactor: number,
    params: MediaGradingParams
  ): void {
    const bOffset = params.brightness * 255;
    let r = contrastFactor * (rIn - 128) + 128 + bOffset;
    let g = contrastFactor * (gIn - 128) + 128 + bOffset;
    let b = contrastFactor * (bIn - 128) + 128 + bOffset;

    if (params.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    this.rgbBuffer[base] = r < 0 ? 0 : r > 255 ? 255 : r | 0;
    this.rgbBuffer[base + 1] = g < 0 ? 0 : g > 255 ? 255 : g | 0;
    this.rgbBuffer[base + 2] = b < 0 ? 0 : b > 255 ? 255 : b | 0;
    this.rgbBuffer[base + 3] = 255;
  }

  private findPercentile(total: number, pct: number): number {
    const target = total * Math.max(0, Math.min(1, pct));
    let running = 0;
    for (let i = 0; i < 256; i += 1) {
      running += this.histogram[i] ?? 0;
      if (running >= target) return i;
    }
    return 255;
  }

  private resolveDrawable(): CanvasImageSource | null {
    if (this.activeVideoEl) return this.activeVideoEl;
    if (this.source && !(this.source instanceof MediaStream)) {
      return this.source;
    }
    return null;
  }

  private getDrawableDimensions(drawable: CanvasImageSource): {
    srcW: number;
    srcH: number;
  } {
    if (typeof HTMLVideoElement !== 'undefined' && drawable instanceof HTMLVideoElement) {
      return { srcW: drawable.videoWidth, srcH: drawable.videoHeight };
    }
    if (typeof HTMLImageElement !== 'undefined' && drawable instanceof HTMLImageElement) {
      return {
        srcW: drawable.naturalWidth || drawable.width,
        srcH: drawable.naturalHeight || drawable.height,
      };
    }
    if (typeof ImageBitmap !== 'undefined' && drawable instanceof ImageBitmap) {
      return { srcW: drawable.width, srcH: drawable.height };
    }
    if (typeof HTMLCanvasElement !== 'undefined' && drawable instanceof HTMLCanvasElement) {
      return { srcW: drawable.width, srcH: drawable.height };
    }
    if (typeof OffscreenCanvas !== 'undefined' && drawable instanceof OffscreenCanvas) {
      return { srcW: drawable.width, srcH: drawable.height };
    }
    return { srcW: 0, srcH: 0 };
  }

  private drawFittedSource(
    ctx: StagingCtx,
    drawable: CanvasImageSource,
    srcW: number,
    srcH: number,
    viewportW: number,
    viewportH: number,
    sampleW: number,
    sampleH: number,
    fitMode: MediaFitMode
  ): void {
    const scale =
      fitMode === 'cover'
        ? Math.max(viewportW / srcW, viewportH / srcH)
        : Math.min(viewportW / srcW, viewportH / srcH);

    const drawnW = srcW * scale;
    const drawnH = srcH * scale;
    const offsetX = (viewportW - drawnW) * 0.5;
    const offsetY = (viewportH - drawnH) * 0.5;

    const toSampleX = sampleW / Math.max(1, viewportW);
    const toSampleY = sampleH / Math.max(1, viewportH);

    ctx.drawImage(
      drawable,
      offsetX * toSampleX,
      offsetY * toSampleY,
      drawnW * toSampleX,
      drawnH * toSampleY
    );
  }

  private attachVideoCallback(video: HTMLVideoElement): void {
    if (typeof video.requestVideoFrameCallback !== 'function') return;

    const onFrame = (): void => {
      if (this.activeVideoEl !== video) return;
      this.videoFrameCounter += 1;
      this.rvfcHandle = video.requestVideoFrameCallback(onFrame);
    };

    this.rvfcHandle = video.requestVideoFrameCallback(onFrame);
  }

  private detachVideoCallback(): void {
    if (
      this.activeVideoEl &&
      this.rvfcHandle !== null &&
      typeof this.activeVideoEl.cancelVideoFrameCallback === 'function'
    ) {
      this.activeVideoEl.cancelVideoFrameCallback(this.rvfcHandle);
    }
    this.rvfcHandle = null;
  }

  private cleanupOwnedStream(): void {
    if (this.ownedStream) {
      for (const track of this.ownedStream.getTracks()) {
        track.stop();
      }
      this.ownedStream = null;
    }
    if (this.ownedVideoEl) {
      this.ownedVideoEl.pause();
      this.ownedVideoEl.srcObject = null;
      this.ownedVideoEl = null;
    }
  }
}
