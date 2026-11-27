/**
 * Ordered Bayer Dithering Real-Time ASCII Style.
 * Perturbs linearized Rec. 709 luminance and RGB channels using recursive
 * 4x4 or 8x8 Bayer threshold matrices prior to character & palette quantization.
 */

import type { RealtimeStylePlugin } from '../../../registry/types';
import {
  BAYER_MATRIX_4,
  BAYER_MATRIX_8,
  REALTIME_RAMP_PRESETS,
  clamp01,
  extractGradedLuminanceField,
  gradeSourceRgba,
  readBooleanParam,
  readNumberParam,
  readStringParam,
} from './shared';

export const BayerDitherStyle: RealtimeStylePlugin = {
  mode: 'realtime',
  executionMode: 'realtime-kernel',
  id: 'bayer-dither',
  name: 'Bayer Dither',
  category: 'dithering',
  description:
    'Temporally stable ordered 4x4 / 8x8 Bayer dithering with configurable spread, step quantization, and 1-bit/4-bit palette locking.',
  defaultRamp: 'blocks',
  uniformSchema: [
    {
      id: 'matrixSize',
      uniformName: 'u_matrixSize',
      label: 'Bayer Matrix',
      kind: 'select',
      group: 'shape',
      options: [
        { value: '4x4', label: 'Bayer 4×4' },
        { value: '8x8', label: 'Bayer 8×8' },
      ],
      default: '8x8',
    },
    {
      id: 'ditherSpread',
      uniformName: 'u_ditherSpread',
      label: 'Dither Spread',
      kind: 'slider',
      group: 'shape',
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.45,
    },
    {
      id: 'colorQuantizationSteps',
      uniformName: 'u_quantSteps',
      label: 'Quantization Steps',
      kind: 'slider',
      group: 'color',
      min: 2,
      max: 16,
      step: 1,
      default: 4,
    },
    {
      id: 'paletteLock',
      uniformName: 'u_paletteLock',
      label: 'Palette Lock',
      kind: 'select',
      group: 'color',
      options: [
        { value: 'none', label: 'Free Steps' },
        { value: '1bit', label: '1-Bit Mono (2 Levels)' },
        { value: '4bit', label: '4-Bit Retro (16 Levels)' },
      ],
      default: 'none',
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
      default: 0.12,
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
    const matrixKey = readStringParam(params, 'matrixSize', '8x8');
    const matrix = matrixKey === '4x4' ? BAYER_MATRIX_4 : BAYER_MATRIX_8;
    const dim = matrixKey === '4x4' ? 4 : 8;
    const dimMask = dim - 1;

    const ditherSpread = readNumberParam(params, 'ditherSpread', 0.45);
    const paletteLock = readStringParam(params, 'paletteLock', 'none');
    const rawSteps = Math.max(2, Math.round(readNumberParam(params, 'colorQuantizationSteps', 4)));
    const steps =
      paletteLock === '1bit' ? 2 : paletteLock === '4bit' ? 16 : rawSteps;
    const maxLevel = steps - 1;

    const contrast = readNumberParam(params, 'contrast', 0.12);
    const invert = readBooleanParam(params, 'invert', false);

    const luma = extractGradedLuminanceField(rgba, cellCount, {
      brightness: 0,
      contrast,
      gamma: 1.0,
      invert,
    });
    const rgb = gradeSourceRgba(rgba, cellCount, 0, contrast, invert);
    const field = new Float32Array(cellCount * 4);
    const ramp = Array.from(REALTIME_RAMP_PRESETS.blocks);
    const glyphs: string[] = new Array(cellCount);

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const idx = r * cols + c;
        const threshold = matrix[(r & dimMask) * dim + (c & dimMask)] ?? 0.5;
        const delta = (threshold - 0.5) * ditherSpread;

        const yPerturbed = clamp01((luma[idx] ?? 0) + delta);
        const yQuant = Math.round(yPerturbed * maxLevel) / maxLevel;

        const p4 = idx * 4;
        if (paletteLock === '1bit') {
          const monoByte = yQuant >= 0.5 ? 255 : 0;
          rgb[p4] = monoByte;
          rgb[p4 + 1] = monoByte;
          rgb[p4 + 2] = monoByte;
        } else {
          for (let ch = 0; ch < 3; ch += 1) {
            const cNorm = clamp01((rgb[p4 + ch] ?? 0) / 255 + delta);
            rgb[p4 + ch] = Math.round((Math.round(cNorm * maxLevel) / maxLevel) * 255);
          }
        }

        const alpha = (rgba[p4 + 3] ?? 255) / 255;
        field[p4] = yQuant;
        field[p4 + 1] = 0;
        field[p4 + 2] = yQuant;
        field[p4 + 3] = alpha;

        const rIdx = Math.min(ramp.length - 1, Math.max(0, Math.floor(yQuant * ramp.length)));
        glyphs[idx] = ramp[rIdx] ?? ' ';
      }
    }

    return {
      cols,
      rows,
      field,
      rgb,
      glyphs,
      resolvedRamp: REALTIME_RAMP_PRESETS.blocks,
    };
  },
};
