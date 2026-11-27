/**
 * Copy-Paste Starter Template: Real-Time Media Filter (`realtime-kernel`)
 *
 * How to use:
 *   1. Copy this file to: `src/engine/realtime/styles/CustomRealtimeFilter.ts`
 *   2. Rename `CustomRealtimeFilter` and implement your kernel inside `process()`.
 *   3. Register it in `src/registry/index.ts`:
 *        import { CustomRealtimeFilter } from '../engine/realtime/styles/CustomRealtimeFilter';
 *        styleRegistry.registerStyle(CustomRealtimeFilter);
 *
 * Performance Note:
 *   `input.rgba` is already downsampled by `MediaPipeline` to `(cols * subX) x (rows * subY)`
 *   corrected for monospace cell aspect ratio—never iterate over full-res 1080p/4K buffers.
 */

import type { RealtimeStylePlugin } from '../../../registry/types';
import {
  clamp01,
  extractGradedLuminanceField,
  gradeSourceRgba,
  readBooleanParam,
  readNumberParam,
  readStringParam,
} from './shared';

const CUSTOM_GLYPH_RAMPS = {
  geometric: ' ·∘○◎●',
  hash: ' .:-=+*#%@',
  blocks: ' ░▒▓█',
} as const;

export const CustomRealtimeFilter: RealtimeStylePlugin = {
  mode: 'realtime',
  executionMode: 'realtime-kernel',
  id: 'custom-realtime-template',
  name: 'Custom Kernel Filter',
  category: 'density',
  description:
    'Starter template demonstrating Rec. 709 luminance extraction, 3x3 Laplacian sharpening, and custom glyph mapping.',
  defaultRamp: 'classic',
  // Omit or set [1, 1] for standard 1:1 cell sampling; set [2, 4] for Braille sub-cells.
  subSampleFactor: [1, 1] as const,

  uniformSchema: [
    {
      id: 'glyphSet',
      uniformName: 'u_glyphSet',
      label: 'Glyph Set',
      kind: 'select',
      group: 'shape',
      options: [
        { value: 'geometric', label: 'Geometric Circles' },
        { value: 'hash', label: 'Classic ASCII' },
        { value: 'blocks', label: 'Shaded Blocks' },
      ],
      default: 'geometric',
    },
    {
      id: 'sharpenAmount',
      uniformName: 'u_sharpenAmount',
      label: 'Laplacian Sharpen',
      kind: 'slider',
      group: 'shape',
      min: 0,
      max: 2.0,
      step: 0.05,
      default: 0.5,
    },
    {
      id: 'contrast',
      uniformName: 'u_contrast',
      label: 'Contrast',
      kind: 'slider',
      group: 'grading',
      min: -0.9,
      max: 0.9,
      step: 0.02,
      default: 0.15,
    },
    {
      id: 'invert',
      uniformName: 'u_invert',
      label: 'Invert Polarity',
      kind: 'toggle',
      group: 'grading',
      default: false,
    },
  ] as const,

  process({ cols, rows, rgba, params }) {
    const cellCount = cols * rows;
    const glyphSetKey = readStringParam(params, 'glyphSet', 'geometric');
    const resolvedRamp =
      CUSTOM_GLYPH_RAMPS[glyphSetKey as keyof typeof CUSTOM_GLYPH_RAMPS] ??
      CUSTOM_GLYPH_RAMPS.geometric;
    const rampChars = Array.from(resolvedRamp);

    const sharpenAmount = readNumberParam(params, 'sharpenAmount', 0.5);
    const contrast = readNumberParam(params, 'contrast', 0.15);
    const invert = readBooleanParam(params, 'invert', false);

    // 1. Extract linearized Rec. 709 luminance & graded RGBA8 source colors
    const luma = extractGradedLuminanceField(rgba, cellCount, {
      brightness: 0,
      contrast,
      gamma: 1.0,
      invert,
    });
    const gradedRgb = gradeSourceRgba(rgba, cellCount, 0, contrast, invert);

    const field = new Float32Array(cellCount * 4);
    const glyphs: string[] = new Array(cellCount);

    const lumaAt = (x: number, y: number): number => {
      const cx = x < 0 ? 0 : x >= cols ? cols - 1 : x;
      const cy = y < 0 ? 0 : y >= rows ? rows - 1 : y;
      return luma[cy * cols + cx] ?? 0;
    };

    // 2. Apply custom 3x3 neighborhood kernel (discrete Laplacian sharpening)
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const idx = r * cols + c;
        const center = lumaAt(c, r);
        const neighbors =
          lumaAt(c - 1, r) + lumaAt(c + 1, r) + lumaAt(c, r - 1) + lumaAt(c, r + 1);
        const laplacian = 4 * center - neighbors;
        const sharpened = clamp01(center + laplacian * sharpenAmount * 0.25);

        const alpha = (rgba[idx * 4 + 3] ?? 255) / 255;

        // 3. Emit standardized 4-channel CellFieldOutput: (luminance, angle, paletteIdx, alpha)
        const base = idx * 4;
        field[base] = sharpened;
        field[base + 1] = 0;
        field[base + 2] = sharpened;
        field[base + 3] = alpha;

        // 4. Map sharpened scalar into custom character ramp
        const rampIdx = Math.min(
          rampChars.length - 1,
          Math.max(0, Math.floor(sharpened * rampChars.length))
        );
        glyphs[idx] = rampChars[rampIdx] ?? ' ';
      }
    }

    return {
      cols,
      rows,
      field,
      rgb: gradedRgb,
      glyphs,
      resolvedRamp,
    };
  },
};
