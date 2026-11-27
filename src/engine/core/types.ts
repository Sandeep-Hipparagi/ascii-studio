/**
 * Core engine types and binary instance constants for ASCII Studio.
 * Zero external or React/DOM-framework dependencies.
 */

export const INSTANCE_STRIDE_BYTES = 28;
export const INSTANCE_STRIDE_FLOATS = 7;

export const CELL_FLAG_ROTATE_QUAD = 1 << 16;
export const CELL_FLAG_INVERT_GLYPH = 1 << 17;
export const CELL_FLAG_EDGE_EMPHASIS = 1 << 18;

export type AtlasFilterMode = 'linear' | 'nearest';
export type DitherMode = 'none' | 'bayer4' | 'bayer8';
export type ColorMode = 'source' | 'monochrome' | 'duotone';
export type MediaFitMode = 'contain' | 'cover';
export type EngineSourceKind = 'media' | 'generative';

export interface GlyphSlot {
  readonly char: string;
  readonly index: number;
  /** Pixel coordinates inside the atlas canvas. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Normalized [0..65535] UV rect for 28-byte Uint16 instance attributes. */
  readonly u0Norm: number;
  readonly v0Norm: number;
  readonly uWNorm: number;
  readonly vHNorm: number;
}

export interface GlyphAtlasMetrics {
  readonly fontFamily: string;
  readonly fontSizeCssPx: number;
  readonly dpr: number;
  readonly cellWidthPx: number;
  readonly cellHeightPx: number;
  /** Monospace advance-to-height ratio: cellWidthPx / cellHeightPx. */
  readonly aspectRatio: number;
  readonly slotWidthPx: number;
  readonly slotHeightPx: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
}

export interface PostFxUniforms {
  readonly crtScanlineIntensity: number;
  readonly crtScanlineDensity: number;
  readonly bloomIntensity: number;
  readonly bloomThreshold: number;
}

export interface MediaGradingParams {
  /** Normalized brightness offset in [-1, 1]. */
  readonly brightness: number;
  /** Normalized contrast in [-1, 1]. */
  readonly contrast: number;
  /** Midtone gamma exponent (> 0, default 1.0). */
  readonly gamma: number;
  readonly autoLevels: boolean;
  readonly autoLevelsLowPct: number;
  readonly autoLevelsHighPct: number;
  readonly invert: boolean;
  /** Sobel edge boost strength in [0, 1]. */
  readonly edgeEmphasis: number;
  /** Sobel magnitude threshold in [0, 1] for directional glyph substitution. */
  readonly edgeThreshold: number;
  readonly ditherMode: DitherMode;
  readonly ditherStrength: number;
  readonly brailleMode: boolean;
  readonly fitMode: MediaFitMode;
}

export interface PaletteConfig {
  readonly colorMode: ColorMode;
  /** RGBA8 [0..255] foreground tint (used for monochrome & duotone light). */
  readonly fgRgba: readonly [number, number, number, number];
  /** RGBA8 [0..255] background tint (used for cell background & duotone dark). */
  readonly bgRgba: readonly [number, number, number, number];
}

export type MediaInput =
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap
  | MediaStream;

export interface CellFieldOutput {
  readonly cols: number;
  readonly rows: number;
  /**
   * Length = 4 * cols * rows:
   * [luminance (0..1), gradientAngle (-pi..pi), hueOrPaletteIdx (0..1), alpha (0..1)].
   */
  readonly field: Float32Array;
  /** Optional graded RGBA8 colors (length = 4 * cols * rows). */
  readonly rgb?: Uint8ClampedArray;
  /** Optional Sobel edge magnitude per cell (length = cols * rows). */
  readonly edgeStrength?: Float32Array;
  /** Optional 8-bit Unicode Braille dot masks (length = cols * rows). */
  readonly brailleMasks?: Uint8Array;
}

export interface CellBuffer {
  readonly cols: number;
  readonly rows: number;
  /** Length = cols * rows; glyph string per cell (' ' when empty). */
  readonly glyphs: readonly string[];
  /** Length = 4 * cols * rows; RGBA8 foreground color per cell. */
  readonly fgRgba: Uint8ClampedArray;
  /** Length = 4 * cols * rows; RGBA8 background color per cell. */
  readonly bgRgba: Uint8ClampedArray;
}

export interface ExportRenderOptions {
  readonly scale?: number;
  readonly output?: 'blob' | 'imageBitmap';
  readonly mimeType?: 'image/png' | 'image/webp' | 'image/jpeg';
  readonly quality?: number;
}

export interface AsciiEngineSnapshot {
  readonly sourceKind: EngineSourceKind;
  readonly activeStyleId: string | null;
  readonly activeGenerativeId: string | null;
  readonly backendTier: 'webgl2-instanced' | 'canvas2d-fallback';
  readonly isPlaying: boolean;
  readonly isWebcamActive: boolean;
  readonly hasMediaInput: boolean;
  readonly isContextLost: boolean;
  readonly fps: number;
  readonly cols: number;
  readonly rows: number;
  readonly aspectRatio: number;
  readonly fontSize: number;
  readonly ramp: string;
  readonly filterMode: AtlasFilterMode;
  readonly grading: MediaGradingParams;
  readonly palette: PaletteConfig;
  readonly postFx: PostFxUniforms;
  readonly realtimeParams: Readonly<Record<string, number | string | boolean | readonly [number, number]>>;
  readonly generativeParams: Readonly<Record<string, number | string | boolean | readonly [number, number]>>;
}
