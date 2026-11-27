/**
 * High-Resolution Unicode Braille Real-Time Style.
 * Sub-samples each character cell as a 2x4 binary dot matrix against an
 * adaptive local luminance threshold, packing the 8 bits into Unicode Braille
 * codepoints (U+2800..U+28FF) for 8x effective spatial resolution.
 */

import type { RealtimeStylePlugin } from '../../../registry/types';
import {
  BAYER_MATRIX_4,
  clamp01,
  extractGradedLuminanceField,
  gradeSourceRgba,
  readBooleanParam,
  readNumberParam,
} from './shared';

// Unicode Braille dot bits: col 0 (rows 0..3) -> bits 0,1,2,6; col 1 -> bits 3,4,5,7
const BRAILLE_BIT_TABLE = new Uint8Array([
  0x01, 0x02, 0x04, 0x40,
  0x08, 0x10, 0x20, 0x80,
]);

export const BrailleHighResStyle: RealtimeStylePlugin = {
  mode: 'realtime',
  executionMode: 'realtime-kernel',
  id: 'braille-highres',
  name: 'Braille 2×4 High-Res',
  category: 'braille',
  description:
    '2×4 sub-cell adaptive thresholding into Unicode Braille patterns (U+2800–U+28FF) for 8× spatial resolution.',
  defaultRamp: 'braille',
  subSampleFactor: [2, 4] as const,
  uniformSchema: [
    {
      id: 'threshold',
      uniformName: 'u_threshold',
      label: 'Luminance Threshold',
      kind: 'slider',
      group: 'shape',
      min: 0.05,
      max: 0.95,
      step: 0.01,
      default: 0.5,
    },
    {
      id: 'adaptiveStrength',
      uniformName: 'u_adaptiveStrength',
      label: 'Adaptive Local Bias',
      kind: 'slider',
      group: 'shape',
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.35,
    },
    {
      id: 'ditherSubpixels',
      uniformName: 'u_ditherSubpixels',
      label: 'Bayer Sub-Pixel Dither',
      kind: 'toggle',
      group: 'shape',
      default: false,
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

  process({ cols, rows, rgba, subSampleWidth, subSampleHeight, params }) {
    const expectedSubW = cols * 2;
    const expectedSubH = rows * 4;
    const isSubSampled =
      (subSampleWidth === expectedSubW && subSampleHeight === expectedSubH) ||
      rgba.length === expectedSubW * expectedSubH * 4;

    const srcW = isSubSampled ? expectedSubW : cols;
    const srcH = isSubSampled ? expectedSubH : rows;
    const sampleCount = srcW * srcH;
    const cellCount = cols * rows;

    const baseThreshold = readNumberParam(params, 'threshold', 0.5);
    const adaptiveStrength = readNumberParam(params, 'adaptiveStrength', 0.35);
    const ditherSubpixels = readBooleanParam(params, 'ditherSubpixels', false);
    const contrast = readNumberParam(params, 'contrast', 0.1);
    const invert = readBooleanParam(params, 'invert', false);

    const luma = extractGradedLuminanceField(rgba, sampleCount, {
      brightness: 0,
      contrast,
      gamma: 1.0,
      invert,
    });
    const gradedSrcRgb = gradeSourceRgba(rgba, sampleCount, 0, contrast, invert);

    const field = new Float32Array(cellCount * 4);
    const cellRgb = new Uint8ClampedArray(cellCount * 4);
    const brailleMasks = new Uint8Array(cellCount);
    const glyphs: string[] = new Array(cellCount);

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const cellIdx = r * cols + c;
        let localSum = 0;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let aSum = 0;

        for (let du = 0; du < 2; du += 1) {
          for (let dv = 0; dv < 4; dv += 1) {
            const sx = isSubSampled ? c * 2 + du : c;
            const sy = isSubSampled ? r * 4 + dv : r;
            const sIdx = sy * srcW + sx;
            const p4 = sIdx * 4;
            localSum += luma[sIdx] ?? 0;
            rSum += gradedSrcRgb[p4] ?? 0;
            gSum += gradedSrcRgb[p4 + 1] ?? 0;
            bSum += gradedSrcRgb[p4 + 2] ?? 0;
            aSum += gradedSrcRgb[p4 + 3] ?? 255;
          }
        }

        const localMean = localSum / 8;
        // Clamp effective threshold inside [0.02, 0.98] so saturated pure white
        // (1.0) always yields U+28FF and pure black (0.0) always yields U+2800.
        const rawThresh =
          baseThreshold * (1 - adaptiveStrength) + localMean * adaptiveStrength;
        const effectiveThresh = Math.max(0.02, Math.min(0.98, rawThresh));

        let mask = 0;
        for (let du = 0; du < 2; du += 1) {
          for (let dv = 0; dv < 4; dv += 1) {
            const sx = isSubSampled ? c * 2 + du : c;
            const sy = isSubSampled ? r * 4 + dv : r;
            const sIdx = sy * srcW + sx;
            const ySub = luma[sIdx] ?? 0;

            const ditherBias = ditherSubpixels
              ? ((BAYER_MATRIX_4[(sy & 3) * 4 + (sx & 3)] ?? 0.5) - 0.5) * 0.25
              : 0;

            if (clamp01(ySub + ditherBias) > effectiveThresh) {
              mask |= BRAILLE_BIT_TABLE[du * 4 + dv] ?? 0;
            }
          }
        }

        brailleMasks[cellIdx] = mask;
        glyphs[cellIdx] = String.fromCharCode(0x2800 | mask);

        const fBase = cellIdx * 4;
        field[fBase] = localMean;
        field[fBase + 1] = 0;
        field[fBase + 2] = localMean;
        field[fBase + 3] = aSum / (8 * 255);

        cellRgb[fBase] = Math.round(rSum / 8);
        cellRgb[fBase + 1] = Math.round(gSum / 8);
        cellRgb[fBase + 2] = Math.round(bSum / 8);
        cellRgb[fBase + 3] = Math.round(aSum / 8);
      }
    }

    return {
      cols,
      rows,
      field,
      rgb: cellRgb,
      brailleMasks,
      glyphs,
    };
  },
};
