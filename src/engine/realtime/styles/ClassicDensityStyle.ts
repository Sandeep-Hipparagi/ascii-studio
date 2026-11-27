/**
 * Classic Density Real-Time ASCII Style.
 * High-contrast linearized Rec. 709 luminance mapping with selectable character
 * ramps, gamma/contrast grading, and percentile auto-levels stretch.
 */

import type { RealtimeStylePlugin } from '../../../registry/types';
import {
  REALTIME_RAMP_PRESETS,
  extractGradedLuminanceField,
  gradeSourceRgba,
  readBooleanParam,
  readNumberParam,
  readStringParam,
  type RealtimeRampKey,
} from './shared';

export const ClassicDensityStyle: RealtimeStylePlugin = {
  mode: 'realtime',
  executionMode: 'realtime-kernel',
  id: 'classic-density',
  name: 'Classic Density',
  category: 'density',
  description:
    'Perceptual Rec. 709 luminance mapping with gamma/contrast grading, auto-levels stretch, and selectable ASCII/block ramps.',
  defaultRamp: 'classic',
  uniformSchema: [
    {
      id: 'rampPreset',
      uniformName: 'u_rampPreset',
      label: 'Character Ramp',
      kind: 'select',
      group: 'shape',
      options: [
        { value: 'standard', label: 'Standard (10)' },
        { value: 'dense', label: 'Dense (70)' },
        { value: 'minimal', label: 'Minimal (7)' },
        { value: 'blocks', label: 'Unicode Blocks' },
      ],
      default: 'standard',
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
      id: 'brightness',
      uniformName: 'u_brightness',
      label: 'Brightness',
      kind: 'slider',
      group: 'grading',
      min: -0.5,
      max: 0.5,
      step: 0.02,
      default: 0,
    },
    {
      id: 'gamma',
      uniformName: 'u_gamma',
      label: 'Gamma',
      kind: 'slider',
      group: 'grading',
      min: 0.3,
      max: 2.5,
      step: 0.05,
      default: 1.0,
    },
    {
      id: 'autoLevels',
      uniformName: 'u_autoLevels',
      label: 'Auto-Levels Stretch',
      kind: 'toggle',
      group: 'grading',
      default: false,
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
    const rampKey = readStringParam(params, 'rampPreset', 'standard') as RealtimeRampKey;
    const resolvedRamp = REALTIME_RAMP_PRESETS[rampKey] ?? REALTIME_RAMP_PRESETS.standard;
    const rampChars = Array.from(resolvedRamp);

    const brightness = readNumberParam(params, 'brightness', 0);
    const contrast = readNumberParam(params, 'contrast', 0.15);
    const gamma = readNumberParam(params, 'gamma', 1.0);
    const autoLevels = readBooleanParam(params, 'autoLevels', false);
    const invert = readBooleanParam(params, 'invert', false);

    const luma = extractGradedLuminanceField(rgba, cellCount, {
      brightness,
      contrast,
      gamma,
      invert,
      autoLevels,
      lowPct: 0.02,
      highPct: 0.98,
    });

    const gradedRgb = gradeSourceRgba(rgba, cellCount, brightness, contrast, invert);
    const field = new Float32Array(cellCount * 4);
    const glyphs: string[] = new Array(cellCount);

    for (let i = 0; i < cellCount; i += 1) {
      const y = luma[i] ?? 0;
      const alpha = (rgba[i * 4 + 3] ?? 255) / 255;
      const b = i * 4;
      field[b] = y;
      field[b + 1] = 0;
      field[b + 2] = y;
      field[b + 3] = alpha;

      const rIdx = Math.min(rampChars.length - 1, Math.max(0, Math.floor(y * rampChars.length)));
      glyphs[i] = rampChars[rIdx] ?? ' ';
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
