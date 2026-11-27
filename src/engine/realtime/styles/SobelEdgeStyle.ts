/**
 * Sobel Edge-Detection Real-Time ASCII Style.
 * Computes 3x3 Sobel Gx/Gy gradients over linearized Rec. 709 luminance,
 * suppresses low-gradient interiors below `edgeThreshold`, quantizes gradient
 * orientation into directional glyphs (`|`, `-`, `/`, `\`), and optionally
 * blends subtle interior density shading.
 */

import type { RealtimeStylePlugin } from '../../../registry/types';
import {
  REALTIME_RAMP_PRESETS,
  RealtimeBufferPool,
  clamp01,
  extractGradedLuminanceFieldInto,
  gradeSourceRgbaInto,
  quantizeGradientToEdgeGlyph,
  readBooleanParam,
  readNumberParam,
} from './shared';

const sobelPool = new RealtimeBufferPool();

export const SobelEdgeStyle: RealtimeStylePlugin = {
  mode: 'realtime',
  executionMode: 'realtime-kernel',
  id: 'sobel-edge',
  name: 'Sobel Edge',
  category: 'edge-detection',
  description:
    '3x3 Sobel directional gradient extraction mapping structural contours to oriented line strokes (|, -, /, \\).',
  defaultRamp: 'classic',
  supportsDirectionalGlyphs: true,
  uniformSchema: [
    {
      id: 'edgeThreshold',
      uniformName: 'u_edgeThreshold',
      label: 'Edge Threshold',
      kind: 'slider',
      group: 'shape',
      min: 0.05,
      max: 0.85,
      step: 0.01,
      default: 0.22,
    },
    {
      id: 'edgeGain',
      uniformName: 'u_edgeGain',
      label: 'Edge Gain',
      kind: 'slider',
      group: 'shape',
      min: 0.25,
      max: 3.0,
      step: 0.05,
      default: 1.0,
    },
    {
      id: 'interiorFill',
      uniformName: 'u_interiorFill',
      label: 'Interior Shading',
      kind: 'slider',
      group: 'grading',
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.2,
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
      default: 0.1,
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
    const edgeThreshold = readNumberParam(params, 'edgeThreshold', 0.22);
    const edgeGain = readNumberParam(params, 'edgeGain', 1.0);
    const interiorFill = readNumberParam(params, 'interiorFill', 0.2);
    const contrast = readNumberParam(params, 'contrast', 0.1);
    const invert = readBooleanParam(params, 'invert', false);

    const { luma, gradedRgb, field, edgeStrength, glyphs } = sobelPool.acquire(
      cols,
      rows,
      cellCount
    );
    extractGradedLuminanceFieldInto(
      rgba,
      cellCount,
      {
        brightness: 0,
        contrast,
        gamma: 1.0,
        invert,
      },
      luma
    );
    gradeSourceRgbaInto(rgba, cellCount, 0, contrast, invert, gradedRgb);
    const shadeRamp = sobelPool.getRampChars(REALTIME_RAMP_PRESETS.minimal);

    const lumaAt = (x: number, y: number): number => {
      const cx = x < 0 ? 0 : x >= cols ? cols - 1 : x;
      const cy = y < 0 ? 0 : y >= rows ? rows - 1 : y;
      return luma[cy * cols + cx] ?? 0;
    };

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const idx = r * cols + c;
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
        const mag = clamp01(Math.hypot(gx, gy) * 0.25 * edgeGain);
        const angle = Math.atan2(gy, gx);

        edgeStrength[idx] = mag;
        const alpha = (rgba[idx * 4 + 3] ?? 255) / 255;
        const baseLuma = luma[idx] ?? 0;

        const b = idx * 4;
        if (mag >= edgeThreshold) {
          field[b] = clamp01(Math.max(mag, baseLuma * 0.4 + 0.6));
          field[b + 1] = angle;
          field[b + 2] = mag;
          field[b + 3] = alpha;
          glyphs[idx] = quantizeGradientToEdgeGlyph(angle);
        } else {
          const shaded = clamp01(baseLuma * interiorFill);
          field[b] = shaded;
          field[b + 1] = 0;
          field[b + 2] = shaded;
          field[b + 3] = alpha;

          if (interiorFill <= 0.01) {
            glyphs[idx] = ' ';
          } else {
            const sIdx = Math.min(
              shadeRamp.length - 1,
              Math.max(0, Math.floor(shaded * shadeRamp.length))
            );
            glyphs[idx] = shadeRamp[sIdx] ?? ' ';
          }
        }
      }
    }

    return {
      cols,
      rows,
      field,
      rgb: gradedRgb,
      edgeStrength,
      glyphs,
    };
  },
};
