/**
 * Unified declarative plugin contract for ASCII Studio styles (real-time & generative).
 * Framework-agnostic: contains zero React or DOM runtime imports.
 */

import type { CellFieldOutput, MediaGradingParams } from '../engine/core/types';

export type { CellFieldOutput };

export type StyleMode = 'realtime' | 'generative';

export type RealtimeCategory =
  | 'density'
  | 'edge-detection'
  | 'dithering'
  | 'braille';

export type GenerativeCategory =
  | 'noise-field'
  | 'wave-interference'
  | 'reaction-diffusion'
  | 'vector-flow'
  | 'audio-spectral';

export type BuiltInRampId =
  | 'classic'
  | 'dense'
  | 'minimal'
  | 'blocks'
  | 'box-drawing'
  | 'braille'
  | 'directional'
  | 'binary';

/** Either a built-in ramp identifier or a custom ordered glyph sequence (dark -> light). */
export type DefaultRampSpec = BuiltInRampId | (string & {});

export type ControlGroup = 'shape' | 'motion' | 'color' | 'simulation' | 'grading';

interface BaseControlSchema {
  /** Unique parameter key within the plugin's parameter state object. */
  readonly id: string;
  /** Target GLSL uniform name (for `glsl-fragment`) or simulation/kernel parameter key. */
  readonly uniformName: string;
  /** Human-readable control label rendered by the Studio inspector. */
  readonly label: string;
  readonly group?: ControlGroup;
  readonly description?: string;
}

export interface SliderControlSchema extends BaseControlSchema {
  readonly kind: 'slider';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  readonly unit?: string;
}

export interface ColorControlSchema extends BaseControlSchema {
  readonly kind: 'color';
  /** Hex color string (`#rrggbb`). */
  readonly default: string;
}

export interface SelectOption<TValue extends string = string> {
  readonly value: TValue;
  readonly label: string;
}

export interface SelectControlSchema<TValue extends string = string>
  extends BaseControlSchema {
  readonly kind: 'select';
  readonly options: readonly SelectOption<TValue>[];
  readonly default: TValue;
}

export interface ToggleControlSchema extends BaseControlSchema {
  readonly kind: 'toggle';
  readonly default: boolean;
}

export interface Vec2ControlSchema extends BaseControlSchema {
  readonly kind: 'vec2';
  readonly min: readonly [number, number];
  readonly max: readonly [number, number];
  readonly step: readonly [number, number];
  readonly default: readonly [number, number];
}

export type UniformControlSchema =
  | SliderControlSchema
  | ColorControlSchema
  | SelectControlSchema
  | ToggleControlSchema
  | Vec2ControlSchema;

/** Alias for declarative inspector controls in Phase 3+ plugins. */
export type UniformControl = UniformControlSchema;

export type UniformValueFor<TControl extends UniformControlSchema> =
  TControl extends SliderControlSchema
    ? number
    : TControl extends ColorControlSchema
      ? string
      : TControl extends SelectControlSchema<infer TValue>
        ? TValue
        : TControl extends ToggleControlSchema
          ? boolean
          : TControl extends Vec2ControlSchema
            ? readonly [number, number]
            : never;

export type UniformValue = number | string | boolean | readonly [number, number];

export type UniformParamMap<
  TSchema extends readonly UniformControlSchema[] = readonly UniformControlSchema[],
> = {
  [K in TSchema[number] as K['id']]: UniformValueFor<K>;
};

export interface ColorPalettePreset {
  readonly id: string;
  readonly name: string;
  readonly colorMode: 'source' | 'monochrome' | 'duotone';
  /** Foreground ink RGBA8 [0..255]. */
  readonly fgRgba: readonly [number, number, number, number];
  /** Background RGBA8 [0..255]. */
  readonly bgRgba: readonly [number, number, number, number];
  readonly accentHex: string;
}

export interface RealtimeProcessorInput {
  readonly cols: number;
  readonly rows: number;
  /**
   * Downsampled RGBA8 pixel buffer. Length is `4 * subSampleWidth * subSampleHeight`
   * (defaults to `cols * rows`, or `(2 * cols) * (4 * rows)` for sub-cell Braille).
   */
  readonly rgba: Uint8ClampedArray;
  readonly subSampleWidth?: number;
  readonly subSampleHeight?: number;
  readonly params: Readonly<Record<string, UniformValue>>;
  /** Global Studio grading state (`CRT / Grading` drawer). */
  readonly grading?: MediaGradingParams;
}

export interface RealtimeStyleOutput extends CellFieldOutput {
  /** Optional resolved glyph character per cell (e.g., directional Sobel or Braille). */
  readonly glyphs?: readonly string[];
  /** Optional quantized character ramp override resolved from plugin params. */
  readonly resolvedRamp?: string;
}

export interface RealtimeStylePlugin<
  TSchema extends readonly UniformControlSchema[] = readonly UniformControlSchema[],
> {
  readonly mode: 'realtime';
  readonly executionMode: 'realtime-kernel';
  readonly id: string;
  readonly name: string;
  readonly category: RealtimeCategory;
  readonly description: string;
  readonly defaultRamp: DefaultRampSpec;
  readonly uniformSchema: TSchema;
  readonly supportsDirectionalGlyphs?: boolean;
  /** Sub-sampling factor per cell (e.g., [2, 4] for Unicode Braille). */
  readonly subSampleFactor?: readonly [number, number];
  readonly process: (input: RealtimeProcessorInput) => RealtimeStyleOutput;
}

export interface GenerativePluginMetadata<
  TSchema extends readonly UniformControlSchema[] = readonly UniformControlSchema[],
> {
  readonly mode?: 'generative';
  readonly id: string;
  readonly name: string;
  readonly category: GenerativeCategory;
  readonly description: string;
  readonly defaultRamp: DefaultRampSpec;
  readonly uniformSchema: TSchema;
  /** Enables directional glyph substitution (`|`, `/`, `-`, `\`) using `gradientAngle`. */
  readonly supportsDirectionalGlyphs?: boolean;
  /** Declares whether the generator consumes live audio-FFT spectrum uniforms/buffers. */
  readonly supportsAudio?: boolean;
}

/**
 * Stateful CPU simulation contract executed inside a Web Worker on fixed/clamped
 * timesteps. Outputs the exact same 4-channel cell field as `evaluateCell(...)`.
 */
export interface WorkerGridSimulation {
  resize(cols: number, rows: number): void;
  reset(seed: number): void;
  step(
    dt: number,
    params: Readonly<Record<string, UniformValue>>,
    audioSpectrum?: Float32Array
  ): void;
  /**
   * Populates `outRgba32f` (length `4 * cols * rows`) with per-cell
   * `[luminance, gradientAngle, hueOrPaletteIndex, alpha]`.
   */
  writeCellField(outRgba32f: Float32Array): void;
  /** Optional interactive perturbation (e.g. Reaction-Diffusion chemical drop). */
  injectDrop?: (gridX: number, gridY: number, radius?: number) => void;
}

export interface GlslFragmentStylePlugin<
  TSchema extends readonly UniformControlSchema[] = readonly UniformControlSchema[],
> extends GenerativePluginMetadata<TSchema> {
  readonly executionMode: 'glsl-fragment';
  /**
   * GLSL ES 3.00 fragment body implementing:
   * `vec4 evaluateCell(vec2 cellCoord, vec2 gridDims, float time)`
   * returning `(luminance, gradientAngle, hueOrPaletteIndex, alpha)`.
   */
  readonly fragmentBody: string;
  /** When true, binds the previous frame's `RGBA16F` cell-field texture as `u_prevField`. */
  readonly usesPingPong?: boolean;
}

export interface WorkerGridStylePlugin<
  TSchema extends readonly UniformControlSchema[] = readonly UniformControlSchema[],
> extends GenerativePluginMetadata<TSchema> {
  readonly executionMode: 'worker-grid';
  /** Factory creating a stateful simulation instance inside the worker runtime. */
  readonly createSimulation: (
    cols: number,
    rows: number,
    seed: number
  ) => WorkerGridSimulation;
  /** Target fixed simulation rate in Hz (e.g. 30 or 60). Defaults to 60. */
  readonly fixedTimestepHz?: number;
}

export type GenerativeStylePlugin<
  TSchema extends readonly UniformControlSchema[] = readonly UniformControlSchema[],
> = GlslFragmentStylePlugin<TSchema> | WorkerGridStylePlugin<TSchema>;

export type StylePlugin = RealtimeStylePlugin | GenerativeStylePlugin;
