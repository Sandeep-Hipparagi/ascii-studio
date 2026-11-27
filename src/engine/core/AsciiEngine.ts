/**
 * Unified Orchestrator for ASCII Studio.
 * Coordinates GlyphAtlas, WebGLInstancedRenderer, MediaPipeline, and
 * GenerativeStylePlugin sources while decoupling the 60 FPS rAF loop from
 * React via a `useSyncExternalStore`-compatible external store.
 */

import type {
  GenerativeStylePlugin,
  RealtimeStyleOutput,
  RealtimeStylePlugin,
  StylePlugin,
  UniformValue,
  WorkerGridSimulation,
} from '../../registry/types';
import { ReactionDiffusionWorkerBridge } from '../generative/ReactionDiffusionStyle';
import { GLSL_PRELUDE } from '../glsl/prelude.glsl';
import { MediaPipeline, DEFAULT_MEDIA_GRADING, quantizeAngleToGlyph } from '../realtime/MediaPipeline';
import { GlyphAtlas } from './GlyphAtlas';
import { WebGLInstancedRenderer } from './WebGLInstancedRenderer';
import {
  CELL_FLAG_EDGE_EMPHASIS,
  CELL_FLAG_INVERT_GLYPH,
  type AsciiEngineSnapshot,
  type AtlasFilterMode,
  type CellBuffer,
  type CellFieldOutput,
  type EngineSourceKind,
  type ExportRenderOptions,
  type GlyphAtlasMetrics,
  type MediaGradingParams,
  type MediaInput,
  type PaletteConfig,
  type PostFxUniforms,
} from './types';

export interface AsciiEngineOptions {
  readonly fontFamily?: string;
  readonly fontSizeCssPx?: number;
  readonly dpr?: number;
  readonly defaultRamp?: string;
}

const DEFAULT_RAMP = ' .:-=+*#%@';

const BUILTIN_RAMPS: Readonly<Record<string, string>> = {
  classic: ' .:-=+*#%@',
  dense: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  minimal: ' .:+*#@',
  blocks: ' ░▒▓█',
  'box-drawing': ' ·─│┌┐└┘├┤┬┴┼╬',
  directional: ' .-|/\\+*',
  binary: ' 01',
};

function resolveRampChars(rampOrId: string): string {
  return BUILTIN_RAMPS[rampOrId] ?? (rampOrId.length > 0 ? rampOrId : DEFAULT_RAMP);
}

const DIRECTIONAL_MIN_LUMINANCE = 0.14;

const GENERATIVE_VERT_GLSL = `#version 300 es
layout(location = 0) in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner;
  gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

interface GlslPluginRunner {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ubo: WebGLBuffer;
  fboA: WebGLFramebuffer;
  texA: WebGLTexture;
  texColorA: WebGLTexture;
  fboB: WebGLFramebuffer;
  texB: WebGLTexture;
  texColorB: WebGLTexture;
  pingIndex: 0 | 1;
  hasRenderedPass: boolean;
  cols: number;
  rows: number;
  readbackBuf: Uint8Array;
  colorReadbackBuf: Uint8Array;
  colorOutBuf: Uint8ClampedArray;
  uboData: ArrayBuffer;
  uboF32: Float32Array;
  uboU32: Uint32Array;
}

export class AsciiEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly atlas: GlyphAtlas;
  private readonly renderer: WebGLInstancedRenderer;
  private readonly media: MediaPipeline;

  private viewportCssW = 640;
  private viewportCssH = 360;
  private dpr: number;

  private sourceKind: EngineSourceKind = 'media';
  private activeRealtimePlugin: RealtimeStylePlugin | null = null;
  private activePlugin: GenerativeStylePlugin | null = null;
  private workerSim: WorkerGridSimulation | null = null;
  private rdWorkerBridge: ReactionDiffusionWorkerBridge | null = null;
  private workerFieldBuf = new Float32Array(0);
  private gradedWorkerFieldBuf = new Float32Array(0);
  private gradedRgbaScratch = new Uint8ClampedArray(0);
  private glslRunner: GlslPluginRunner | null = null;
  private lastCellOutput: (CellFieldOutput & Partial<RealtimeStyleOutput>) | null = null;

  private realtimeParams: Record<string, UniformValue> = {};
  private generativeParams: Record<string, UniformValue> = {};
  private simSeed = 1337;
  private simAccumulatorSec = 0;
  private elapsedGenSec = 0;
  private frameCounter = 0;
  private audioBands: readonly [number, number, number, number] = [0, 0, 0, 0];
  private pointerState: readonly [number, number, number, number] = [0.5, 0.5, 0, 0];

  private rampChars: string[];
  private rampString: string;
  private sortedDenseRamp: string;
  private activeRampIsDensePreset = false;
  private filterMode: AtlasFilterMode = 'linear';
  private grading: MediaGradingParams = { ...DEFAULT_MEDIA_GRADING };
  private palette: PaletteConfig = {
    colorMode: 'source',
    fgRgba: [240, 245, 240, 255],
    bgRgba: [10, 12, 14, 255],
  };
  private postFx: PostFxUniforms = {
    crtScanlineIntensity: 0,
    crtScanlineDensity: 1.5,
    bloomIntensity: 0,
    bloomThreshold: 0.55,
    backdropOpacity: 0,
  };

  // Scheduling & Loop Decoupling
  private isPlaying = true;
  private dirty = true;
  private exportHold = false;
  private disposed = false;
  private loopGeneration = 0;
  private continuousRafId: number | null = null;
  private dirtyRafId: number | null = null;
  private lastTickMs = 0;
  private fpsWindowStartMs = 0;
  private fpsFrameCount = 0;
  private currentFps = 0;
  private lastCols = 0;
  private lastRows = 0;

  // External Store Subscription (React useSyncExternalStore)
  private readonly listeners = new Set<() => void>();
  private uiNotifyRafId: number | null = null;
  private snapshot: AsciiEngineSnapshot;

  public constructor(canvas: HTMLCanvasElement, options: AsciiEngineOptions = {}) {
    this.canvas = canvas;
    this.dpr = Math.max(
      1,
      options.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
    );

    this.rampString = resolveRampChars(options.defaultRamp ?? DEFAULT_RAMP);
    this.rampChars = Array.from(this.rampString);

    this.atlas = new GlyphAtlas({
      fontFamily: options.fontFamily,
      fontSizeCssPx: options.fontSizeCssPx ?? 12,
      dpr: this.dpr,
      filterMode: this.filterMode,
    });
    this.atlas.ensureGlyphs(this.rampString + '-|/\\');
    this.sortedDenseRamp = this.atlas.sortRampByVisualDensity(resolveRampChars('dense'));
    const initialRampInput = options.defaultRamp ?? DEFAULT_RAMP;
    if (initialRampInput === 'dense' || initialRampInput === resolveRampChars('dense')) {
      this.activeRampIsDensePreset = true;
      this.rampString = this.sortedDenseRamp;
      this.rampChars = Array.from(this.sortedDenseRamp);
      this.atlas.ensureGlyphs(this.sortedDenseRamp);
    }

    this.renderer = new WebGLInstancedRenderer(canvas, {
      onContextLost: () => {
        this.disposeGlslRunner();
        this.scheduleUiNotify();
      },
      onContextRestored: () => {
        if (this.activePlugin?.executionMode === 'glsl-fragment') {
          this.rebuildGlslRunner(this.activePlugin);
        }
        this.markDirty();
        this.scheduleUiNotify();
      },
    });

    this.media = new MediaPipeline();
    this.snapshot = this.buildSnapshot();
    this.resize(canvas.clientWidth || 640, canvas.clientHeight || 360, this.dpr);
  }

  // --- React 18/19 `useSyncExternalStore` API ---

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public readonly getSnapshot = (): AsciiEngineSnapshot => this.snapshot;

  // --- Configuration & Input Control ---

  public resize(cssWidth: number, cssHeight: number, dpr: number = this.dpr): void {
    const nextW = Math.max(1, Math.round(cssWidth));
    const nextH = Math.max(1, Math.round(cssHeight));
    const nextDpr = Math.max(1, dpr);

    const dprChanged = nextDpr !== this.dpr;
    this.viewportCssW = nextW;
    this.viewportCssH = nextH;
    this.dpr = nextDpr;

    if (dprChanged) {
      this.atlas.updateTypography(this.atlas.getMetrics().fontSizeCssPx, nextDpr);
    }

    this.renderer.resize(nextW * nextDpr, nextH * nextDpr);
    this.media.markDirty();
    this.markDirty();
    this.scheduleUiNotify();
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public getAtlasMetrics(): GlyphAtlasMetrics {
    return this.atlas.getMetrics();
  }

  /**
   * Renders the fitted un-stylized active source media onto an overlay/underlay
   * canvas for Before/After split-wipe comparison.
   */
  public renderCompareSource(targetCanvas: HTMLCanvasElement): boolean {
    if (this.sourceKind !== 'media') return false;
    return this.media.drawRawFittedToCanvas(
      targetCanvas,
      this.viewportCssW,
      this.viewportCssH,
      this.dpr,
      this.grading.fitMode
    );
  }

  /**
   * Restores the currently active plugin's uniform schema parameters and
   * default character ramp to factory defaults.
   */
  public resetActiveStyle(): void {
    if (this.sourceKind === 'media' && this.activeRealtimePlugin) {
      const defaults: Record<string, UniformValue> = {};
      for (const control of this.activeRealtimePlugin.uniformSchema) {
        defaults[control.id] = control.default;
      }
      this.realtimeParams = defaults;
      this.setRamp(this.activeRealtimePlugin.defaultRamp, false);
      this.media.markDirty();
      this.markDirty();
      this.scheduleUiNotify();
      return;
    }

    if (this.sourceKind === 'generative' && this.activePlugin) {
      const defaults: Record<string, UniformValue> = {};
      for (const control of this.activePlugin.uniformSchema) {
        defaults[control.id] = control.default;
      }
      this.generativeParams = defaults;
      this.setRamp(this.activePlugin.defaultRamp, false);
      this.workerSim?.reset(this.simSeed);
      this.rdWorkerBridge?.reset(this.simSeed);
      this.markDirty();
      this.scheduleUiNotify();
    }
  }

  public setMediaInput(input: MediaInput | null): void {
    this.sourceKind = 'media';
    this.activePlugin = null;
    this.disposeGlslRunner();
    this.rdWorkerBridge?.dispose();
    this.rdWorkerBridge = null;
    this.workerSim = null;

    this.media.setInput(input);
    this.isPlaying = this.media.isContinuousMedia();
    this.markDirty();
    this.syncScheduler();
    this.scheduleUiNotify();
  }

  public setStylePlugin(
    plugin: StylePlugin,
    initialParams?: Readonly<Record<string, UniformValue>>
  ): void {
    if (plugin.mode === 'realtime') {
      this.setRealtimeStyle(plugin, initialParams);
    } else {
      this.setGenerativePlugin(plugin, initialParams);
    }
  }

  public setRealtimeStyle(
    plugin: RealtimeStylePlugin,
    initialParams?: Readonly<Record<string, UniformValue>>
  ): void {
    this.sourceKind = 'media';
    this.activePlugin = null;
    this.activeRealtimePlugin = plugin;
    this.disposeGlslRunner();
    this.rdWorkerBridge?.dispose();
    this.rdWorkerBridge = null;
    this.workerSim = null;

    const defaults: Record<string, UniformValue> = {};
    for (const control of plugin.uniformSchema) {
      defaults[control.id] = initialParams?.[control.id] ?? control.default;
    }
    this.realtimeParams = defaults;
    this.setRamp(plugin.defaultRamp, false);

    if (plugin.subSampleFactor?.[0] === 2 && plugin.subSampleFactor?.[1] === 4) {
      this.atlas.ensureBrailleRange();
    }

    this.isPlaying = this.media.isContinuousMedia();
    this.media.markDirty();
    this.markDirty();
    this.syncScheduler();
    this.scheduleUiNotify();
  }

  public setGenerativePlugin(
    plugin: GenerativeStylePlugin,
    initialParams?: Readonly<Record<string, UniformValue>>
  ): void {
    this.sourceKind = 'generative';
    this.activeRealtimePlugin = null;
    this.activePlugin = plugin;
    this.disposeGlslRunner();
    this.rdWorkerBridge?.dispose();
    this.rdWorkerBridge = null;
    this.workerSim = null;
    this.simAccumulatorSec = 0;
    this.elapsedGenSec = 0;
    this.frameCounter = 0;

    const defaults: Record<string, UniformValue> = {};
    for (const control of plugin.uniformSchema) {
      defaults[control.id] = initialParams?.[control.id] ?? control.default;
    }
    this.generativeParams = defaults;
    this.setRamp(plugin.defaultRamp, false);

    if (plugin.executionMode === 'glsl-fragment') {
      this.rebuildGlslRunner(plugin);
    } else {
      const { cols, rows } = this.computeGridDims();
      this.workerSim = plugin.createSimulation(cols, rows, this.simSeed);
      if (plugin.id === 'reaction-diffusion' && typeof Worker !== 'undefined') {
        this.rdWorkerBridge = new ReactionDiffusionWorkerBridge(cols, rows, this.simSeed);
      }
    }

    this.isPlaying = true;
    this.markDirty();
    this.syncScheduler();
    this.scheduleUiNotify();
  }

  public updateUniform(id: string, value: UniformValue): void {
    if (this.sourceKind === 'media' && this.activeRealtimePlugin) {
      this.realtimeParams = { ...this.realtimeParams, [id]: value };
      this.media.markDirty();
      this.markDirty();
      this.scheduleUiNotify();
      return;
    }
    this.setGenerativeParam(id, value);
  }

  public setGenerativeParam(id: string, value: UniformValue): void {
    this.generativeParams = { ...this.generativeParams, [id]: value };
    this.markDirty();
    this.scheduleUiNotify();
  }

  public setGridResolution(targetCols: number): void {
    const clampedCols = Math.max(16, Math.min(320, Math.round(targetCols)));
    const ratio = this.atlas.getMetrics().aspectRatio;
    const nextFontCssPx = Math.max(
      6,
      Math.min(32, this.viewportCssW / (clampedCols * Math.max(0.35, ratio)))
    );
    this.setFontSize(Math.round(nextFontCssPx * 10) / 10);
  }

  public sortActiveRampByVisualDensity(): string {
    const sorted = this.atlas.sortRampByVisualDensity(this.rampString);
    this.setRamp(sorted, false);
    return sorted;
  }

  public injectPointerDrop(gridX: number, gridY: number, radius = 3): void {
    this.workerSim?.injectDrop?.(gridX, gridY, radius);
    this.rdWorkerBridge?.injectDrop(gridX, gridY, radius);
    this.markDirty();
  }

  /**
   * Captures the active frame's resolved grid glyphs and RGBA8 colors into a
   * portable CellBuffer for plain-text, ANSI, and SVG exporters.
   */
  public captureCellBuffer(): CellBuffer {
    const metrics = this.atlas.getMetrics();
    const { cols: fallbackCols, rows: fallbackRows } = this.computeGridDims();
    const output =
      this.sourceKind === 'generative' &&
      this.activePlugin?.executionMode === 'glsl-fragment'
        ? this.readbackGlslRunnerForExport() ?? this.lastCellOutput
        : this.lastCellOutput;

    if (!output) {
      const count = fallbackCols * fallbackRows;
      return {
        cols: fallbackCols,
        rows: fallbackRows,
        glyphs: new Array<string>(count).fill(' '),
        fgRgba: new Uint8ClampedArray(count * 4),
        bgRgba: new Uint8ClampedArray(count * 4),
      };
    }

    const { cols, rows } = output;
    const count = cols * rows;
    const glyphs = new Array<string>(count).fill(' ');
    const fgRgba = new Uint8ClampedArray(count * 4);
    const bgRgba = new Uint8ClampedArray(count * 4);
    const [bgR, bgG, bgB, bgA] = this.palette.bgRgba;

    for (let i = 0; i < count; i += 1) {
      const resolved = this.resolveCellAppearance(output, i, metrics);
      const b = i * 4;
      bgRgba[b] = bgR;
      bgRgba[b + 1] = bgG;
      bgRgba[b + 2] = bgB;
      bgRgba[b + 3] = bgA;

      if (!resolved) continue;
      glyphs[i] = resolved.ch;
      fgRgba[b] = resolved.fgR;
      fgRgba[b + 1] = resolved.fgG;
      fgRgba[b + 2] = resolved.fgB;
      fgRgba[b + 3] = resolved.fgA;
    }

    return { cols, rows, glyphs, fgRgba, bgRgba };
  }

  public setPlaying(playing: boolean): void {
    if (this.isPlaying === playing) return;
    this.isPlaying = playing;

    const video = this.media.getVideoElement();
    if (this.sourceKind === 'media' && video) {
      if (playing) {
        void video.play().catch(() => {});
      } else {
        video.pause();
      }
    }

    this.syncScheduler();
    if (playing) {
      this.markDirty();
    }
    this.scheduleUiNotify();
  }

  public setFontSize(fontSizeCssPx: number): void {
    if (this.atlas.updateTypography(fontSizeCssPx, this.dpr)) {
      this.media.markDirty();
      this.markDirty();
      this.scheduleUiNotify();
    }
  }

  public setFilterMode(mode: AtlasFilterMode): void {
    this.filterMode = mode;
    this.atlas.setFilterMode(mode);
    this.markDirty();
    this.scheduleUiNotify();
  }

  public setRamp(ramp: string, sortByDensity = false): void {
    const resolved = resolveRampChars(ramp);
    const isDensePreset =
      ramp === 'dense' ||
      ramp === BUILTIN_RAMPS.dense ||
      ramp === this.sortedDenseRamp;
    this.activeRampIsDensePreset = isDensePreset;
    this.rampString = isDensePreset
      ? this.sortedDenseRamp
      : sortByDensity
        ? this.atlas.sortRampByVisualDensity(resolved)
        : resolved;
    this.rampChars = Array.from(this.rampString);
    this.atlas.ensureGlyphs(this.rampString);
    this.markDirty();
    this.scheduleUiNotify();
  }

  public setGrading(partial: Partial<MediaGradingParams>): void {
    this.grading = { ...this.grading, ...partial };
    if (this.grading.brailleMode) {
      this.atlas.ensureBrailleRange();
    }
    this.media.markDirty();
    this.markDirty();
    this.scheduleUiNotify();
  }

  public setPalette(partial: Partial<PaletteConfig>): void {
    this.palette = { ...this.palette, ...partial };
    this.markDirty();
    this.scheduleUiNotify();
  }

  public setPostFx(partial: Partial<PostFxUniforms>): void {
    this.postFx = { ...this.postFx, ...partial };
    this.markDirty();
    this.scheduleUiNotify();
  }

  public setAudioBands(subBass: number, bass: number, mid: number, treble: number): void {
    this.audioBands = [subBass, bass, mid, treble];
    if (this.sourceKind === 'generative' && !this.isPlaying) {
      this.markDirty();
    }
  }

  public setPointer(normX: number, normY: number, isDown: boolean, speed: number): void {
    this.pointerState = [normX, normY, isDown ? 1 : 0, speed];
  }

  public resetSeed(seed = (Date.now() >>> 0)): void {
    this.simSeed = seed >>> 0;
    this.workerSim?.reset(this.simSeed);
    this.rdWorkerBridge?.reset(this.simSeed);
    this.markDirty();
  }

  public markDirty(): void {
    this.dirty = true;
    if (this.exportHold) return;
    if (!this.shouldRunContinuousLoop() && this.dirtyRafId === null) {
      this.dirtyRafId = requestAnimationFrame((ts) => {
        this.dirtyRafId = null;
        if (!this.exportHold && this.dirty) {
          this.dirty = false;
          this.renderStep(ts, 0, true);
        }
      });
    }
  }

  // --- Deterministic Offline / High-DPI Export ---

  /**
   * Pauses live playback, renders an exact deterministic frame at `timestampMs`
   * and optional export scale (e.g., 2x / 4x), extracts an ImageBitmap or Blob,
   * and restores live state cleanly.
   */
  public async renderFrameAtTime(
    timestampMs: number,
    options: ExportRenderOptions = {}
  ): Promise<ImageBitmap | Blob> {
    const scale = Math.max(1, options.scale ?? 1);
    const outputKind = options.output ?? 'blob';
    const mimeType = options.mimeType ?? 'image/png';
    const quality = options.quality ?? 0.95;

    const wasPlaying = this.isPlaying;
    const prevCssW = this.viewportCssW;
    const prevCssH = this.viewportCssH;
    const prevDpr = this.dpr;
    const prevFontPx = this.atlas.getMetrics().fontSizeCssPx;

    this.exportHold = true;
    this.cancelLoops();

    const video = this.media.getVideoElement();
    const prevVideoTime = video ? video.currentTime : 0;
    const wasVideoPlaying = video ? !video.paused && !video.ended : false;

    try {
      if (video && wasVideoPlaying) {
        video.pause();
      }

      if (this.sourceKind === 'media' && video) {
        await this.seekVideoDeterministically(video, timestampMs / 1000);
      }

      if (scale !== 1) {
        const exportDpr = prevDpr * scale;
        this.dpr = exportDpr;
        this.atlas.updateTypography(prevFontPx, exportDpr);
        this.renderer.resize(prevCssW * exportDpr, prevCssH * exportDpr);
      }

      const prevElapsed = this.elapsedGenSec;
      this.elapsedGenSec = Math.max(0, timestampMs / 1000);
      this.renderStep(timestampMs, 0, true);
      this.elapsedGenSec = prevElapsed;

      if (outputKind === 'imageBitmap') {
        return await createImageBitmap(this.canvas);
      }

      return await new Promise<Blob>((resolve, reject) => {
        this.canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas export produced null Blob.'));
          },
          mimeType,
          quality
        );
      });
    } finally {
      if (scale !== 1) {
        this.dpr = prevDpr;
        this.atlas.updateTypography(prevFontPx, prevDpr);
        this.renderer.resize(prevCssW * prevDpr, prevCssH * prevDpr);
      }

      if (video && this.sourceKind === 'media') {
        await this.seekVideoDeterministically(video, prevVideoTime);
        if (wasVideoPlaying) {
          void video.play().catch(() => {});
        }
      }

      this.exportHold = false;
      this.isPlaying = wasPlaying;
      this.markDirty();
      this.syncScheduler();
    }
  }

  public async refreshFonts(): Promise<boolean> {
    if (this.disposed) return false;
    const rebuilt = await this.atlas.refreshAfterFontsReady();
    if (this.disposed || !rebuilt) return false;

    this.sortedDenseRamp = this.atlas.sortRampByVisualDensity(resolveRampChars('dense'));
    if (this.activeRampIsDensePreset) {
      this.rampString = this.sortedDenseRamp;
      this.rampChars = Array.from(this.rampString);
      this.atlas.ensureGlyphs(this.rampString);
    }

    this.media.markDirty();
    this.markDirty();
    this.scheduleUiNotify();
    return true;
  }

  public dispose(): void {
    this.disposed = true;
    this.cancelLoops();
    if (this.uiNotifyRafId !== null) {
      cancelAnimationFrame(this.uiNotifyRafId);
      this.uiNotifyRafId = null;
    }
    this.disposeGlslRunner();
    this.rdWorkerBridge?.dispose();
    this.rdWorkerBridge = null;
    this.media.dispose();
    this.atlas.dispose();
    this.renderer.dispose();
    this.listeners.clear();
  }

  // --- Internal Frame Loop & Pipeline Execution ---

  private shouldRunContinuousLoop(): boolean {
    if (!this.isPlaying) return false;
    if (this.sourceKind === 'generative') return this.activePlugin !== null;
    return this.media.isContinuousMedia();
  }

  private syncScheduler(): void {
    if (this.exportHold) return;

    if (!this.shouldRunContinuousLoop()) {
      if (this.continuousRafId !== null) {
        cancelAnimationFrame(this.continuousRafId);
        this.continuousRafId = null;
        this.loopGeneration += 1;
      }
      return;
    }

    if (this.continuousRafId !== null) return;

    const generation = ++this.loopGeneration;
    this.lastTickMs = performance.now();
    this.fpsWindowStartMs = this.lastTickMs;
    this.fpsFrameCount = 0;

    const tick = (nowMs: number): void => {
      if (generation !== this.loopGeneration || this.exportHold) return;

      const dtSec = Math.min(0.1, Math.max(0, (nowMs - this.lastTickMs) / 1000));
      this.lastTickMs = nowMs;

      const rendered = this.renderStep(nowMs, dtSec, this.dirty);
      this.dirty = false;

      if (rendered) {
        this.fpsFrameCount += 1;
      }

      if (nowMs - this.fpsWindowStartMs >= 1000) {
        const nextFps = Math.round(
          (this.fpsFrameCount * 1000) / Math.max(1, nowMs - this.fpsWindowStartMs)
        );
        this.fpsWindowStartMs = nowMs;
        this.fpsFrameCount = 0;
        if (nextFps !== this.currentFps) {
          this.currentFps = nextFps;
          this.scheduleUiNotify();
        }
      }

      if (generation === this.loopGeneration && this.shouldRunContinuousLoop()) {
        this.continuousRafId = requestAnimationFrame(tick);
      } else {
        this.continuousRafId = null;
      }
    };

    this.continuousRafId = requestAnimationFrame(tick);
  }

  private cancelLoops(): void {
    this.loopGeneration += 1;
    if (this.continuousRafId !== null) {
      cancelAnimationFrame(this.continuousRafId);
      this.continuousRafId = null;
    }
    if (this.dirtyRafId !== null) {
      cancelAnimationFrame(this.dirtyRafId);
      this.dirtyRafId = null;
    }
  }

  private renderStep(_nowMs: number, dtSec: number, force: boolean): boolean {
    if (!this.renderer.canRender()) return false;

    const metrics = this.atlas.getMetrics();
    const viewW = this.canvas.width;
    const viewH = this.canvas.height;
    const { cols, rows } = this.computeGridDims();

    if (cols !== this.lastCols || rows !== this.lastRows) {
      this.lastCols = cols;
      this.lastRows = rows;
      this.workerSim?.resize(cols, rows);
      this.rdWorkerBridge?.resize(cols, rows);
      this.scheduleUiNotify();
    }

    let cellField: (CellFieldOutput & Partial<RealtimeStyleOutput>) | null = null;

    if (this.sourceKind === 'media') {
      if (this.activeRealtimePlugin) {
        const subX = this.activeRealtimePlugin.subSampleFactor?.[0] ?? 1;
        const subY = this.activeRealtimePlugin.subSampleFactor?.[1] ?? 1;
        const sample = this.media.sampleDownsampledRgba(
          viewW,
          viewH,
          metrics,
          this.grading.fitMode,
          subX,
          subY,
          force
        );
        if (!sample) return false;
        const gradedRgba = this.applyGlobalGradingToRgba(sample.rgba);
        cellField = this.activeRealtimePlugin.process({
          cols: sample.cols,
          rows: sample.rows,
          rgba: gradedRgba,
          subSampleWidth: sample.sampleW,
          subSampleHeight: sample.sampleH,
          params: this.realtimeParams,
          grading: this.grading,
        });
      } else {
        cellField = this.media.processFrame(
          viewW,
          viewH,
          metrics,
          this.grading,
          force
        );
        if (!cellField) return false;
      }
    } else if (this.activePlugin) {
      if (this.isPlaying && dtSec > 0) {
        this.elapsedGenSec += dtSec;
      }

      if (this.activePlugin.executionMode === 'glsl-fragment') {
        if (!this.renderer.isUsingFallback2d()) {
          const gpuPass = this.executeGlslRunnerPass(this.activePlugin, cols, rows, dtSec);
          this.frameCounter += 1;
          if (!gpuPass) return false;

          this.lastCellOutput = null;
          this.renderer.flushGenerativeGrid({
            atlas: this.atlas,
            fieldTex: gpuPass.fieldTex,
            colorTex: gpuPass.colorTex,
            cols,
            rows,
            rampChars: this.rampChars,
            allowDirectional: Boolean(this.activePlugin.supportsDirectionalGlyphs),
            directionalMinLum: DIRECTIONAL_MIN_LUMINANCE,
            invertGlyph: this.grading.invert,
            colorMode: this.palette.colorMode,
            fgRgba: this.palette.fgRgba,
            bgRgba: this.palette.bgRgba,
            postFx: this.postFx,
          });
          return true;
        }
      }

      cellField = this.evaluateGenerativeField(this.activePlugin, cols, rows, dtSec);
      this.frameCounter += 1;
    }

    if (!cellField) return false;

    this.lastCellOutput = cellField;
    this.submitCellsToBatcher(cellField, metrics);
    const bg = this.palette.bgRgba;
    const backdropSurface =
      this.sourceKind === 'media' && (this.postFx.backdropOpacity ?? 0) > 0.001
        ? this.media.getBlurredBackdropSurface(viewW, viewH, this.grading.fitMode)
        : null;

    this.renderer.flush(
      this.atlas,
      metrics.cellWidthPx,
      metrics.cellHeightPx,
      [bg[0] / 255, bg[1] / 255, bg[2] / 255, bg[3] / 255],
      this.postFx,
      backdropSurface
    );

    return true;
  }

  private resolveCellAppearance(
    output: CellFieldOutput & Partial<RealtimeStyleOutput>,
    idx: number,
    _metrics: GlyphAtlasMetrics
  ): {
    ch: string;
    fgR: number;
    fgG: number;
    fgB: number;
    fgA: number;
    flags: number;
  } | null {
    const { field, rgb, edgeStrength, brailleMasks, glyphs, resolvedRamp } = output;
    const fBase = idx * 4;
    const lum = field[fBase] ?? 0;
    const angle = field[fBase + 1] ?? 0;
    const paletteIdx = field[fBase + 2] ?? 0;
    const alpha = field[fBase + 3] ?? 1;

    if (alpha <= 0.005) return null;

    const activeRampChars = resolvedRamp ? Array.from(resolvedRamp) : this.rampChars;
    const rampLen = activeRampChars.length;
    const allowDirectional =
      (this.sourceKind === 'media' &&
        (this.grading.edgeEmphasis > 0.001 || !!this.activeRealtimePlugin?.supportsDirectionalGlyphs)) ||
      (this.sourceKind === 'generative' && !!this.activePlugin?.supportsDirectionalGlyphs);
    const edgeThresh = this.grading.edgeThreshold;
    const invertFlag = this.grading.invert ? CELL_FLAG_INVERT_GLYPH : 0;

    let ch: string;
    let flags = invertFlag;

    if (glyphs && glyphs[idx] !== undefined) {
      ch = glyphs[idx] ?? ' ';
    } else if (brailleMasks) {
      const mask = brailleMasks[idx] ?? 0;
      if (mask === 0) return null;
      ch = String.fromCharCode(0x2800 + mask);
    } else {
      const edgeVal = edgeStrength
        ? (edgeStrength[idx] ?? 0)
        : Math.abs(angle) > 1e-3 && lum >= DIRECTIONAL_MIN_LUMINANCE
          ? 1
          : 0;
      if (allowDirectional && edgeVal >= edgeThresh && (edgeStrength || (Math.abs(angle) > 1e-3 && lum >= DIRECTIONAL_MIN_LUMINANCE))) {
        ch = quantizeAngleToGlyph(angle);
        flags |= CELL_FLAG_EDGE_EMPHASIS;
      } else {
        const rIdx = Math.min(rampLen - 1, Math.max(0, Math.floor(lum * rampLen)));
        ch = activeRampChars[rIdx] ?? ' ';
      }
    }

    if (ch === ' ') return null;

    const [fgDefR, fgDefG, fgDefB, fgDefA] = this.palette.fgRgba;
    const [bgR, bgG, bgB] = this.palette.bgRgba;
    const colorMode = this.palette.colorMode;

    let fgR = fgDefR;
    let fgG = fgDefG;
    let fgB = fgDefB;
    const fgA = Math.round(fgDefA * alpha);

    if (colorMode === 'source') {
      if (rgb) {
        fgR = rgb[fBase] ?? fgDefR;
        fgG = rgb[fBase + 1] ?? fgDefG;
        fgB = rgb[fBase + 2] ?? fgDefB;
      } else if (this.sourceKind === 'generative' && paletteIdx > 0.001) {
        const twoPi = Math.PI * 2;
        fgR = Math.round((0.5 + 0.5 * Math.cos(twoPi * paletteIdx)) * 255);
        fgG = Math.round((0.5 + 0.5 * Math.cos(twoPi * (paletteIdx + 0.33))) * 255);
        fgB = Math.round((0.5 + 0.5 * Math.cos(twoPi * (paletteIdx + 0.67))) * 255);
      }
    } else if (colorMode === 'duotone') {
      const t = this.sourceKind === 'generative' ? paletteIdx : rgb ? lum : paletteIdx;
      fgR = Math.round(bgR + (fgDefR - bgR) * t);
      fgG = Math.round(bgG + (fgDefG - bgG) * t);
      fgB = Math.round(bgB + (fgDefB - bgB) * t);
    }

    return { ch, fgR, fgG, fgB, fgA, flags };
  }

  private submitCellsToBatcher(
    output: CellFieldOutput & Partial<RealtimeStyleOutput>,
    metrics: GlyphAtlasMetrics
  ): void {
    const { cols, rows } = output;
    const cellW = metrics.cellWidthPx;
    const cellH = metrics.cellHeightPx;
    const [bgR, bgG, bgB] = this.palette.bgRgba;

    this.renderer.beginFrame();
    this.renderer.ensureCapacity(cols * rows);

    for (let r = 0; r < rows; r += 1) {
      const yPx = r * cellH;
      for (let c = 0; c < cols; c += 1) {
        const idx = r * cols + c;
        const resolved = this.resolveCellAppearance(output, idx, metrics);
        if (!resolved) continue;

        const slot = this.atlas.getOrInsertGlyph(resolved.ch);
        if (!slot) continue;

        // Canvas clear provides the uniform background; pass bgA = 0 to avoid double-blend.
        this.renderer.pushCell(
          c * cellW,
          yPx,
          slot,
          resolved.fgR,
          resolved.fgG,
          resolved.fgB,
          resolved.fgA,
          bgR,
          bgG,
          bgB,
          0,
          0,
          1,
          resolved.flags
        );
      }
    }
  }

  private evaluateGenerativeField(
    plugin: GenerativeStylePlugin,
    cols: number,
    rows: number,
    dtSec: number
  ): CellFieldOutput | null {
    const cellCount = cols * rows;
    if (this.workerFieldBuf.length < cellCount * 4) {
      this.workerFieldBuf = new Float32Array(cellCount * 4);
    }

    if (plugin.executionMode === 'worker-grid') {
      if (this.rdWorkerBridge && !this.exportHold) {
        const stepDt = 1 / Math.max(1, plugin.fixedTimestepHz ?? 60);
        this.rdWorkerBridge.requestStep(stepDt, this.generativeParams);
        const workerLatest = this.rdWorkerBridge.getLatestField();
        if (workerLatest && workerLatest.length >= cellCount * 4) {
          return {
            cols,
            rows,
            field: this.applyGlobalGradingToField(workerLatest.subarray(0, cellCount * 4), cellCount),
          };
        }
      }
      if (!this.workerSim) {
        this.workerSim = plugin.createSimulation(cols, rows, this.simSeed);
      }
      const stepDt = 1 / Math.max(1, plugin.fixedTimestepHz ?? 60);
      this.simAccumulatorSec += dtSec;
      let subSteps = 0;
      while (this.simAccumulatorSec >= stepDt && subSteps < 4) {
        this.workerSim.step(stepDt, this.generativeParams);
        this.simAccumulatorSec -= stepDt;
        subSteps += 1;
      }
      this.workerSim.writeCellField(this.workerFieldBuf.subarray(0, cellCount * 4));
      return {
        cols,
        rows,
        field: this.applyGlobalGradingToField(this.workerFieldBuf.subarray(0, cellCount * 4), cellCount),
      };
    }

    if (this.renderer.isUsingFallback2d() || !this.renderer.getContext() || !this.glslRunner) {
      return this.evaluateGenerativeCpuFallback(plugin, cols, rows);
    }

    const gpuPass = this.executeGlslRunnerPass(plugin, cols, rows, dtSec);
    if (!gpuPass) return null;
    return this.readbackGlslRunnerForExport();
  }

  /**
   * Lightweight CPU procedural fallback when WebGL2 is unavailable so Canvas2D
   * fallback mode still animates `glsl-fragment` generative presets smoothly.
   */
  private evaluateGenerativeCpuFallback(
    plugin: Extract<GenerativeStylePlugin, { executionMode: 'glsl-fragment' }>,
    cols: number,
    rows: number
  ): CellFieldOutput {
    const cellCount = cols * rows;
    if (this.workerFieldBuf.length < cellCount * 4) {
      this.workerFieldBuf = new Float32Array(cellCount * 4);
    }
    const out = this.workerFieldBuf.subarray(0, cellCount * 4);
    const t = this.elapsedGenSec;
    const isFlow = plugin.id === 'simplex-flow-field';
    const isHarmonic = plugin.id === 'harmonic-interference';

    for (let r = 0; r < rows; r += 1) {
      const ny = (r + 0.5) / Math.max(1, rows) - 0.5;
      for (let c = 0; c < cols; c += 1) {
        const nx = (c + 0.5) / Math.max(1, cols) - 0.5;
        const b = (r * cols + c) * 4;
        let lum = 0.5;
        let angle = 0;
        let pal = 0;

        if (isHarmonic) {
          const d1 = Math.hypot(nx - 0.2 * Math.sin(t * 0.6), ny - 0.2 * Math.cos(t * 0.5));
          const d2 = Math.hypot(nx + 0.2 * Math.cos(t * 0.4), ny + 0.2 * Math.sin(t * 0.7));
          const wave = 0.5 * (Math.sin(d1 * 18 - t * 2.4) + Math.sin(d2 * 18 - t * 2.1));
          lum = Math.max(0, Math.min(1, 0.5 + 0.5 * wave));
          pal = (lum * 0.85 + t * 0.05) % 1;
        } else {
          const vx = Math.sin(nx * 5.5 + t * 0.8) * Math.cos(ny * 4.5 - t * 0.5);
          const vy = Math.cos(nx * 4.5 - t * 0.6) * Math.sin(ny * 5.5 + t * 0.7);
          const mag = Math.hypot(vx, vy);
          lum = Math.max(0, Math.min(1, isFlow ? (mag - 0.2) * 1.1 : 0.5 + 0.5 * vx));
          angle = isFlow ? Math.atan2(vy, vx) : 0;
          pal = ((0.5 + 0.5 * Math.sin(nx * 3 + ny * 3 + t * 0.35)) % 1 + 1) % 1;
        }

        out[b] = lum;
        out[b + 1] = angle;
        out[b + 2] = pal;
        out[b + 3] = 1;
      }
    }

    return {
      cols,
      rows,
      field: this.applyGlobalGradingToField(out, cellCount),
    };
  }

  /**
   * Executes the GPU generative fragment shader pass into offscreen MRT FBO
   * attachments (`COLOR_ATTACHMENT0` field + `COLOR_ATTACHMENT1` RGB) without
   * issuing a blocking `gl.readPixels` stall.
   */
  private executeGlslRunnerPass(
    plugin: Extract<GenerativeStylePlugin, { executionMode: 'glsl-fragment' }>,
    cols: number,
    rows: number,
    dtSec: number
  ): { readonly fieldTex: WebGLTexture; readonly colorTex: WebGLTexture } | null {
    const gl = this.renderer.getContext();
    if (!gl || !this.glslRunner) return null;

    this.resizeGlslRunnerTargets(gl, this.glslRunner, cols, rows);
    const runner = this.glslRunner;
    const prevTex = runner.pingIndex === 0 ? runner.texA : runner.texB;
    const dstFbo = runner.pingIndex === 0 ? runner.fboB : runner.fboA;
    const dstFieldTex = runner.pingIndex === 0 ? runner.texB : runner.texA;
    const dstColorTex = runner.pingIndex === 0 ? runner.texColorB : runner.texColorA;

    // Update StudioFrame UBO
    const metrics = this.atlas.getMetrics();
    runner.uboF32[0] = cols;
    runner.uboF32[1] = rows;
    runner.uboF32[2] = metrics.cellWidthPx;
    runner.uboF32[3] = metrics.cellHeightPx;
    runner.uboF32[4] = this.canvas.width;
    runner.uboF32[5] = this.canvas.height;
    runner.uboF32[6] = this.elapsedGenSec;
    runner.uboF32[7] = dtSec;
    runner.uboU32[8] = this.simSeed;
    runner.uboU32[9] = this.frameCounter;
    runner.uboF32[12] = this.audioBands[0];
    runner.uboF32[13] = this.audioBands[1];
    runner.uboF32[14] = this.audioBands[2];
    runner.uboF32[15] = this.audioBands[3];
    runner.uboF32[16] = this.pointerState[0];
    runner.uboF32[17] = this.pointerState[1];
    runner.uboF32[18] = this.pointerState[2];
    runner.uboF32[19] = this.pointerState[3];
    runner.uboF32[20] = this.grading.brightness;
    runner.uboF32[21] = this.grading.contrast;
    runner.uboF32[22] = this.grading.gamma;
    runner.uboF32[23] = 0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, cols, rows);
    gl.useProgram(runner.program);

    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, runner.ubo);
    gl.bindBuffer(gl.UNIFORM_BUFFER, runner.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, runner.uboF32);

    this.uploadPluginUniforms(gl, runner.program, plugin);

    if (plugin.usesPingPong) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      const loc = gl.getUniformLocation(runner.program, 'u_prevField');
      if (loc) gl.uniform1i(loc, 1);
    }

    gl.bindVertexArray(runner.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    runner.pingIndex = runner.pingIndex === 0 ? 1 : 0;
    runner.hasRenderedPass = true;
    return { fieldTex: dstFieldTex, colorTex: dstColorTex };
  }

  /**
   * Lazy export-only CPU readback of the latest generative FBO textures for
   * plain-text, ANSI, and SVG exporters.
   */
  private readbackGlslRunnerForExport(): CellFieldOutput | null {
    const gl = this.renderer.getContext();
    const runner = this.glslRunner;
    if (!gl || !runner || !runner.hasRenderedPass || runner.cols <= 0 || runner.rows <= 0) return null;

    const { cols, rows } = runner;
    const cellCount = cols * rows;
    if (this.workerFieldBuf.length < cellCount * 4) {
      this.workerFieldBuf = new Float32Array(cellCount * 4);
    }
    if (runner.readbackBuf.length < cellCount * 4) {
      runner.readbackBuf = new Uint8Array(cellCount * 4);
    }
    if (runner.colorReadbackBuf.length < cellCount * 4) {
      runner.colorReadbackBuf = new Uint8Array(cellCount * 4);
    }
    if (runner.colorOutBuf.length < cellCount * 4) {
      runner.colorOutBuf = new Uint8ClampedArray(cellCount * 4);
    }

    const activeFbo = runner.pingIndex === 1 ? runner.fboB : runner.fboA;
    gl.bindFramebuffer(gl.FRAMEBUFFER, activeFbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, runner.readbackBuf);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, runner.colorReadbackBuf);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const out = this.workerFieldBuf;
    const rgbOut = runner.colorOutBuf;
    let hasCustomRgb = false;
    for (let i = 0; i < cellCount; i += 1) {
      const b = i * 4;
      out[b] = (runner.readbackBuf[b] ?? 0) / 255;
      out[b + 1] = (((runner.readbackBuf[b + 1] ?? 128) - 128) / 127) * Math.PI;
      out[b + 2] = (runner.readbackBuf[b + 2] ?? 0) / 255;
      out[b + 3] = (runner.readbackBuf[b + 3] ?? 255) / 255;

      const cA = runner.colorReadbackBuf[b + 3] ?? 0;
      if (cA >= 128) {
        hasCustomRgb = true;
        rgbOut[b] = runner.colorReadbackBuf[b] ?? 0;
        rgbOut[b + 1] = runner.colorReadbackBuf[b + 1] ?? 0;
        rgbOut[b + 2] = runner.colorReadbackBuf[b + 2] ?? 0;
        rgbOut[b + 3] = 255;
      } else {
        rgbOut[b] = 0;
        rgbOut[b + 1] = 0;
        rgbOut[b + 2] = 0;
        rgbOut[b + 3] = 0;
      }
    }

    return {
      cols,
      rows,
      field: out.subarray(0, cellCount * 4),
      rgb: hasCustomRgb ? rgbOut.subarray(0, cellCount * 4) : undefined,
    };
  }

  private rebuildGlslRunner(
    plugin: Extract<GenerativeStylePlugin, { executionMode: 'glsl-fragment' }>
  ): void {
    const gl = this.renderer.getContext();
    if (!gl) return;

    const fragSrc = `${GLSL_PRELUDE}
${plugin.fragmentBody}
void main() {
  _cellRgbOverride = vec4(0.0);
  vec2 cellCoord = floor(v_uv * u_gridDims);
  vec4 cell = evaluateCell(cellCoord, u_gridDims, u_time);
  float gradedLum = applyGlobalGrading(cell.r);
  float encodedAngle = clamp(cell.g / 6.2831853, -0.5, 0.5) * (254.0 / 255.0) + (128.0 / 255.0);
  outCellField = vec4(gradedLum, encodedAngle, clamp(cell.b, 0.0, 1.0), clamp(cell.a, 0.0, 1.0));
  outCellColor = _cellRgbOverride;
}
`;

    const vs = this.compileGlShader(gl, gl.VERTEX_SHADER, GENERATIVE_VERT_GLSL);
    const fs = this.compileGlShader(gl, gl.FRAGMENT_SHADER, fragSrc);
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return;
    }

    const blockIdx = gl.getUniformBlockIndex(program, 'StudioFrame');
    if (blockIdx !== gl.INVALID_INDEX) {
      gl.uniformBlockBinding(program, blockIdx, 0);
    }

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const ubo = gl.createBuffer();
    const fboA = gl.createFramebuffer();
    const fboB = gl.createFramebuffer();
    const texA = gl.createTexture();
    const texB = gl.createTexture();
    const texColorA = gl.createTexture();
    const texColorB = gl.createTexture();

    if (!vao || !vbo || !ubo || !fboA || !fboB || !texA || !texB || !texColorA || !texColorB) return;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const uboData = new ArrayBuffer(96);
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, uboData, gl.DYNAMIC_DRAW);

    const runner: GlslPluginRunner = {
      program,
      vao,
      vbo,
      ubo,
      fboA,
      texA,
      texColorA,
      fboB,
      texB,
      texColorB,
      pingIndex: 0,
      hasRenderedPass: false,
      cols: 0,
      rows: 0,
      readbackBuf: new Uint8Array(0),
      colorReadbackBuf: new Uint8Array(0),
      colorOutBuf: new Uint8ClampedArray(0),
      uboData,
      uboF32: new Float32Array(uboData),
      uboU32: new Uint32Array(uboData),
    };

    const { cols, rows } = this.computeGridDims();
    this.resizeGlslRunnerTargets(gl, runner, cols, rows);
    this.glslRunner = runner;
  }

  private resizeGlslRunnerTargets(
    gl: WebGL2RenderingContext,
    runner: GlslPluginRunner,
    cols: number,
    rows: number
  ): void {
    if (runner.cols === cols && runner.rows === rows) return;
    runner.cols = cols;
    runner.rows = rows;

    const pairs: readonly [WebGLFramebuffer, WebGLTexture, WebGLTexture][] = [
      [runner.fboA, runner.texA, runner.texColorA],
      [runner.fboB, runner.texB, runner.texColorB],
    ];

    for (const [fbo, texField, texColor] of pairs) {
      for (const tex of [texField, texColor]) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texField, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, texColor, 0);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private uploadPluginUniforms(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    plugin: GenerativeStylePlugin
  ): void {
    for (const control of plugin.uniformSchema) {
      const loc = gl.getUniformLocation(program, control.uniformName);
      if (!loc) continue;

      const value = this.generativeParams[control.id] ?? control.default;
      if (control.kind === 'slider' && typeof value === 'number') {
        gl.uniform1f(loc, value);
      } else if (control.kind === 'toggle' && typeof value === 'boolean') {
        gl.uniform1f(loc, value ? 1 : 0);
      } else if (control.kind === 'vec2' && Array.isArray(value)) {
        gl.uniform2f(loc, Number(value[0] ?? 0), Number(value[1] ?? 0));
      } else if (control.kind === 'color' && typeof value === 'string') {
        const clean = value.replace('#', '');
        const hex = parseInt(clean.length === 6 ? clean : 'ffffff', 16);
        gl.uniform3f(
          loc,
          ((hex >> 16) & 0xff) / 255,
          ((hex >> 8) & 0xff) / 255,
          (hex & 0xff) / 255
        );
      } else if (control.kind === 'select' && typeof value === 'string') {
        const optionIdx = control.options.findIndex((o) => o.value === value);
        gl.uniform1i(loc, Math.max(0, optionIdx));
      }
    }
  }

  private compileGlShader(
    gl: WebGL2RenderingContext,
    type: number,
    src: string
  ): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create WebGLShader.');
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
      gl.deleteShader(shader);
      throw new Error(`Generative shader compile failed: ${log}`);
    }
    return shader;
  }

  private disposeGlslRunner(): void {
    const gl = this.renderer.getContext();
    const runner = this.glslRunner;
    this.glslRunner = null;
    if (!runner || !gl || gl.isContextLost()) return;

    gl.deleteProgram(runner.program);
    gl.deleteVertexArray(runner.vao);
    gl.deleteBuffer(runner.vbo);
    gl.deleteBuffer(runner.ubo);
    gl.deleteFramebuffer(runner.fboA);
    gl.deleteFramebuffer(runner.fboB);
    gl.deleteTexture(runner.texA);
    gl.deleteTexture(runner.texB);
    gl.deleteTexture(runner.texColorA);
    gl.deleteTexture(runner.texColorB);
  }

  private applyGlobalGradingToRgba(src: Uint8ClampedArray): Uint8ClampedArray {
    const { brightness, contrast, gamma, autoLevels, autoLevelsLowPct, autoLevelsHighPct } =
      this.grading;
    const hasGrade =
      Math.abs(brightness) > 1e-4 ||
      Math.abs(contrast) > 1e-4 ||
      Math.abs(gamma - 1) > 1e-4 ||
      autoLevels;
    if (!hasGrade) return src;

    if (this.gradedRgbaScratch.length < src.length) {
      this.gradedRgbaScratch = new Uint8ClampedArray(src.length);
    }
    const dst = this.gradedRgbaScratch.subarray(0, src.length);

    const c = Math.max(-0.99, Math.min(1, contrast)) * 255;
    const contrastFactor = (259 * (c + 255)) / (255 * (259 - c));
    const bOffset = brightness * 255;
    const invGamma = 1 / Math.max(0.05, gamma);
    const applyGamma = Math.abs(invGamma - 1) > 1e-4;
    const pixelCount = src.length >> 2;
    const hist = autoLevels ? new Uint32Array(256) : null;

    for (let i = 0; i < pixelCount; i += 1) {
      const p4 = i * 4;
      let r = ((src[p4] ?? 0) - 128) * contrastFactor + 128 + bOffset;
      let g = ((src[p4 + 1] ?? 0) - 128) * contrastFactor + 128 + bOffset;
      let b = ((src[p4 + 2] ?? 0) - 128) * contrastFactor + 128 + bOffset;

      r = r < 0 ? 0 : r > 255 ? 255 : r;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      b = b < 0 ? 0 : b > 255 ? 255 : b;

      if (applyGamma) {
        r = Math.pow(r / 255, invGamma) * 255;
        g = Math.pow(g / 255, invGamma) * 255;
        b = Math.pow(b / 255, invGamma) * 255;
      }

      const rByte = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
      const gByte = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
      const bByte = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);

      dst[p4] = rByte;
      dst[p4 + 1] = gByte;
      dst[p4 + 2] = bByte;
      dst[p4 + 3] = src[p4 + 3] ?? 255;

      if (hist) {
        const yBin = Math.min(255, Math.max(0, Math.round(0.2126 * rByte + 0.7152 * gByte + 0.0722 * bByte)));
        hist[yBin] = (hist[yBin] ?? 0) + 1;
      }
    }

    if (hist && pixelCount > 0) {
      const findQuantile = (pct: number): number => {
        const target = pixelCount * Math.max(0, Math.min(1, pct));
        let acc = 0;
        for (let i = 0; i < 256; i += 1) {
          acc += hist[i] ?? 0;
          if (acc >= target) return i;
        }
        return 255;
      };
      const lo = findQuantile(autoLevelsLowPct);
      const hi = findQuantile(autoLevelsHighPct);
      const span = hi - lo;
      if (span >= 1) {
        const scale = 255 / span;
        for (let i = 0; i < pixelCount; i += 1) {
          const p4 = i * 4;
          dst[p4] = Math.min(255, Math.max(0, Math.round(((dst[p4] ?? 0) - lo) * scale)));
          dst[p4 + 1] = Math.min(255, Math.max(0, Math.round(((dst[p4 + 1] ?? 0) - lo) * scale)));
          dst[p4 + 2] = Math.min(255, Math.max(0, Math.round(((dst[p4 + 2] ?? 0) - lo) * scale)));
        }
      }
    }

    return dst;
  }

  private applyGlobalGradingToField(src: Float32Array, cellCount: number): Float32Array {
    const { brightness, contrast, gamma } = this.grading;
    const hasGrade =
      Math.abs(brightness) > 1e-4 ||
      Math.abs(contrast) > 1e-4 ||
      Math.abs(gamma - 1) > 1e-4;
    if (!hasGrade) return src;

    const needed = cellCount * 4;
    if (this.gradedWorkerFieldBuf.length < needed) {
      this.gradedWorkerFieldBuf = new Float32Array(needed);
    }
    const dst = this.gradedWorkerFieldBuf.subarray(0, needed);
    dst.set(src.subarray(0, needed));

    const c = Math.max(-0.99, Math.min(1, contrast)) * 255;
    const contrastFactor = (259 * (c + 255)) / (255 * (259 - c));
    const invGamma = 1 / Math.max(0.05, gamma);
    const applyGamma = Math.abs(invGamma - 1) > 1e-4;

    for (let i = 0; i < cellCount; i += 1) {
      const base = i * 4;
      let y = ((dst[base] ?? 0) - 0.5) * contrastFactor + 0.5 + brightness;
      y = y < 0 ? 0 : y > 1 ? 1 : y;
      if (applyGamma) {
        y = Math.pow(y, invGamma);
      }
      dst[base] = y < 0 ? 0 : y > 1 ? 1 : y;
    }

    return dst;
  }

  private computeGridDims(): { cols: number; rows: number } {
    const m = this.atlas.getMetrics();
    return {
      cols: Math.max(1, Math.floor(this.canvas.width / Math.max(1, m.cellWidthPx))),
      rows: Math.max(1, Math.floor(this.canvas.height / Math.max(1, m.cellHeightPx))),
    };
  }

  private seekVideoDeterministically(
    video: HTMLVideoElement,
    targetSec: number
  ): Promise<void> {
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : targetSec;
    const clamped = Math.max(0, Math.min(duration, targetSec));
    if (Math.abs(video.currentTime - clamped) <= 0.001) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', finish);
        resolve();
      };
      video.addEventListener('seeked', finish, { once: true });
      video.currentTime = clamped;
      setTimeout(finish, 2000);
    });
  }

  private scheduleUiNotify(): void {
    if (this.uiNotifyRafId !== null) return;
    this.uiNotifyRafId = requestAnimationFrame(() => {
      this.uiNotifyRafId = null;
      this.snapshot = this.buildSnapshot();
      for (const listener of this.listeners) {
        listener();
      }
    });
  }

  private buildSnapshot(): AsciiEngineSnapshot {
    const metrics = this.atlas.getMetrics();
    const { cols, rows } = this.computeGridDims();
    const activeStyleId =
      this.sourceKind === 'generative'
        ? this.activePlugin?.id ?? null
        : this.activeRealtimePlugin?.id ?? null;

    return {
      sourceKind: this.sourceKind,
      activeStyleId,
      activeGenerativeId: this.activePlugin?.id ?? null,
      backendTier: this.renderer.isUsingFallback2d() || this.renderer.isContextLost()
        ? 'canvas2d-fallback'
        : 'webgl2-instanced',
      isPlaying: this.isPlaying,
      isWebcamActive: this.media.isWebcamActive(),
      isVideoOrWebcam: this.media.isVideoOrWebcam(),
      hasMediaInput: this.media.hasInput(),
      isContextLost: !this.renderer.canRender(),
      fps: this.currentFps,
      cols,
      rows,
      aspectRatio: metrics.aspectRatio,
      fontSize: metrics.fontSizeCssPx,
      ramp: this.rampString,
      sortedDenseRamp: this.sortedDenseRamp,
      filterMode: this.filterMode,
      grading: this.grading,
      palette: this.palette,
      postFx: this.postFx,
      realtimeParams: this.realtimeParams,
      generativeParams: this.generativeParams,
    };
  }
}
