/**
 * Pure Gray-Scott Reaction-Diffusion Simulation Kernel.
 * Uses double-buffered Float32Arrays for U and V chemical concentrations,
 * a 9-point isotropic Laplacian stencil, and toroidal wrap-around boundaries.
 */

import type { UniformValue, WorkerGridSimulation } from '../../../registry/types';

export type GrayScottPresetId = 'mitosis' | 'coral' | 'spirals' | 'maze';

export interface GrayScottRates {
  readonly feed: number;
  readonly kill: number;
}

export const GRAY_SCOTT_PRESETS: Readonly<Record<GrayScottPresetId, GrayScottRates>> = {
  mitosis: { feed: 0.0367, kill: 0.0649 },
  coral: { feed: 0.0545, kill: 0.062 },
  spirals: { feed: 0.014, kill: 0.045 },
  maze: { feed: 0.029, kill: 0.057 },
};

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GrayScottSimulation implements WorkerGridSimulation {
  private cols: number;
  private rows: number;
  private seed: number;

  private uCurr: Float32Array;
  private vCurr: Float32Array;
  private uNext: Float32Array;
  private vNext: Float32Array;

  public constructor(cols: number, rows: number, seed = 1337) {
    this.cols = Math.max(4, Math.floor(cols));
    this.rows = Math.max(4, Math.floor(rows));
    this.seed = seed >>> 0;

    const len = this.cols * this.rows;
    this.uCurr = new Float32Array(len);
    this.vCurr = new Float32Array(len);
    this.uNext = new Float32Array(len);
    this.vNext = new Float32Array(len);

    this.reset(this.seed);
  }

  public getCols(): number {
    return this.cols;
  }

  public getRows(): number {
    return this.rows;
  }

  public resize(cols: number, rows: number): void {
    const nextCols = Math.max(4, Math.floor(cols));
    const nextRows = Math.max(4, Math.floor(rows));
    if (nextCols === this.cols && nextRows === this.rows) return;

    this.cols = nextCols;
    this.rows = nextRows;
    const len = nextCols * nextRows;
    this.uCurr = new Float32Array(len);
    this.vCurr = new Float32Array(len);
    this.uNext = new Float32Array(len);
    this.vNext = new Float32Array(len);

    this.reset(this.seed);
  }

  public reset(seed: number): void {
    this.seed = seed >>> 0;
    this.uCurr.fill(1.0);
    this.vCurr.fill(0.0);

    const rng = mulberry32(this.seed);
    const dropCount = Math.max(3, Math.min(12, Math.floor((this.cols * this.rows) / 250)));

    // Always seed center + deterministic PRNG droplets
    this.injectDrop(this.cols * 0.5, this.rows * 0.5, Math.max(2, Math.min(this.cols, this.rows) * 0.08));
    for (let i = 0; i < dropCount; i += 1) {
      const cx = rng() * this.cols;
      const cy = rng() * this.rows;
      const r = 1.5 + rng() * 2.5;
      this.injectDrop(cx, cy, r);
    }
  }

  /**
   * Seeds a circular chemical V perturbation with toroidal boundary wrap-around.
   */
  public injectDrop(gridX: number, gridY: number, radius = 3): void {
    const rCeil = Math.max(1, Math.ceil(radius));
    const r2 = Math.max(1, radius * radius);
    const cx = Math.round(gridX);
    const cy = Math.round(gridY);

    for (let dy = -rCeil; dy <= rCeil; dy += 1) {
      for (let dx = -rCeil; dx <= rCeil; dx += 1) {
        if (dx * dx + dy * dy > r2) continue;
        const x = ((cx + dx) % this.cols + this.cols) % this.cols;
        const y = ((cy + dy) % this.rows + this.rows) % this.rows;
        const idx = y * this.cols + x;
        this.uCurr[idx] = 0.5;
        this.vCurr[idx] = 0.25;
      }
    }
  }

  public step(_dt: number, params: Readonly<Record<string, UniformValue>>): void {
    const presetRaw = params['preset'];
    const presetKey: GrayScottPresetId =
      typeof presetRaw === 'string' && presetRaw in GRAY_SCOTT_PRESETS
        ? (presetRaw as GrayScottPresetId)
        : 'coral';
    const preset = GRAY_SCOTT_PRESETS[presetKey];

    const feed =
      typeof params['feedRate'] === 'number' && presetRaw === 'custom'
        ? params['feedRate']
        : preset.feed;
    const kill =
      typeof params['killRate'] === 'number' && presetRaw === 'custom'
        ? params['killRate']
        : preset.kill;

    const du =
      typeof params['diffusionU'] === 'number'
        ? Math.max(0.05, Math.min(0.24, params['diffusionU']))
        : 0.2;
    const dv =
      typeof params['diffusionV'] === 'number'
        ? Math.max(0.02, Math.min(0.2, params['diffusionV']))
        : 0.1;
    const stepsPerFrame =
      typeof params['stepsPerFrame'] === 'number'
        ? Math.max(1, Math.min(24, Math.round(params['stepsPerFrame'])))
        : 8;

    const subDt = 1.0;
    const w = this.cols;
    const h = this.rows;

    for (let s = 0; s < stepsPerFrame; s += 1) {
      const uIn = this.uCurr;
      const vIn = this.vCurr;
      const uOut = this.uNext;
      const vOut = this.vNext;

      for (let y = 0; y < h; y += 1) {
        const ym = (y - 1 + h) % h;
        const yp = (y + 1) % h;
        const rowOffset = y * w;
        const rowUp = ym * w;
        const rowDn = yp * w;

        for (let x = 0; x < w; x += 1) {
          const xm = (x - 1 + w) % w;
          const xp = (x + 1) % w;
          const idx = rowOffset + x;

          const u = uIn[idx] ?? 1;
          const v = vIn[idx] ?? 0;

          // 9-point isotropic Laplacian stencil (sum of weights = 0)
          const lapU =
            0.2 * ((uIn[rowOffset + xm] ?? u) + (uIn[rowOffset + xp] ?? u) + (uIn[rowUp + x] ?? u) + (uIn[rowDn + x] ?? u)) +
            0.05 * ((uIn[rowUp + xm] ?? u) + (uIn[rowUp + xp] ?? u) + (uIn[rowDn + xm] ?? u) + (uIn[rowDn + xp] ?? u)) -
            u;

          const lapV =
            0.2 * ((vIn[rowOffset + xm] ?? v) + (vIn[rowOffset + xp] ?? v) + (vIn[rowUp + x] ?? v) + (vIn[rowDn + x] ?? v)) +
            0.05 * ((vIn[rowUp + xm] ?? v) + (vIn[rowUp + xp] ?? v) + (vIn[rowDn + xm] ?? v) + (vIn[rowDn + xp] ?? v)) -
            v;

          const uvv = u * v * v;
          let nextU = u + (du * lapU - uvv + feed * (1 - u)) * subDt;
          let nextV = v + (dv * lapV + uvv - (feed + kill) * v) * subDt;

          if (!Number.isFinite(nextU)) nextU = 1;
          if (!Number.isFinite(nextV)) nextV = 0;

          uOut[idx] = nextU < 0 ? 0 : nextU > 1 ? 1 : nextU;
          vOut[idx] = nextV < 0 ? 0 : nextV > 1 ? 1 : nextV;
        }
      }

      // Swap double buffers
      this.uCurr = uOut;
      this.vCurr = vOut;
      this.uNext = uIn;
      this.vNext = vIn;
    }
  }

  public writeCellField(outRgba32f: Float32Array): void {
    const w = this.cols;
    const h = this.rows;
    const vArr = this.vCurr;
    const uArr = this.uCurr;

    for (let y = 0; y < h; y += 1) {
      const ym = (y - 1 + h) % h;
      const yp = (y + 1) % h;
      for (let x = 0; x < w; x += 1) {
        const xm = (x - 1 + w) % w;
        const xp = (x + 1) % w;
        const idx = y * w + x;

        const v = vArr[idx] ?? 0;
        const u = uArr[idx] ?? 1;
        const dvdx = (vArr[y * w + xp] ?? v) - (vArr[y * w + xm] ?? v);
        const dvdy = (vArr[yp * w + x] ?? v) - (vArr[ym * w + x] ?? v);

        const lum = Math.min(1, Math.max(0, v * 2.4));
        const angle = Math.atan2(dvdy, dvdx);
        const paletteIdx = Math.min(1, Math.max(0, 0.5 + 0.5 * (v - u + 0.5)));

        const base = idx * 4;
        outRgba32f[base] = lum;
        outRgba32f[base + 1] = angle;
        outRgba32f[base + 2] = paletteIdx;
        outRgba32f[base + 3] = 1;
      }
    }
  }
}
