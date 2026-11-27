import { describe, expect, it } from 'vitest';

import {
  COLOR_PALETTE_PRESETS,
  getDefaultParams,
  getStyleById,
  listStylesByMode,
  styleRegistry,
} from '../../registry';
import { ReactionDiffusionStyle } from '../generative/ReactionDiffusionStyle';
import { BayerDitherStyle } from '../realtime/styles/BayerDitherStyle';
import { BrailleHighResStyle } from '../realtime/styles/BrailleHighResStyle';
import { SobelEdgeStyle } from '../realtime/styles/SobelEdgeStyle';

describe('StyleRegistry & Plugin Schema Validation', () => {
  it('registers expected realtime and generative plugins with valid schemas', () => {
    const realtime = listStylesByMode('realtime');
    const generative = listStylesByMode('generative');
    const all = styleRegistry.listAllStyles();

    expect(realtime.length).toBeGreaterThanOrEqual(4);
    expect(generative.length).toBeGreaterThanOrEqual(5);
    expect(getStyleById('audio-spectral')).toBeDefined();
    expect(all.length).toBe(realtime.length + generative.length);
    expect(COLOR_PALETTE_PRESETS.length).toBeGreaterThanOrEqual(6);

    for (const plugin of all) {
      expect(plugin.id.trim().length).toBeGreaterThan(0);
      expect(plugin.name.trim().length).toBeGreaterThan(0);
      expect(plugin.defaultRamp.length).toBeGreaterThan(0);

      if (plugin.mode === 'realtime') {
        expect(plugin.executionMode).toBe('realtime-kernel');
        expect(typeof plugin.process).toBe('function');
      } else {
        expect(['glsl-fragment', 'worker-grid']).toContain(plugin.executionMode);
        if (plugin.executionMode === 'glsl-fragment') {
          expect(plugin.fragmentBody).toContain('evaluateCell');
        } else {
          expect(typeof plugin.createSimulation).toBe('function');
        }
      }

      const defaults = getDefaultParams(plugin);
      for (const control of plugin.uniformSchema) {
        const def = defaults[control.id];
        expect(def).toBeDefined();

        if (control.kind === 'slider') {
          expect(typeof def).toBe('number');
          expect(control.min).toBeLessThanOrEqual(control.max);
          expect(control.step).toBeGreaterThan(0);
          expect(def as number).toBeGreaterThanOrEqual(control.min);
          expect(def as number).toBeLessThanOrEqual(control.max);
        } else if (control.kind === 'vec2') {
          expect(Array.isArray(def)).toBe(true);
          const v = def as readonly [number, number];
          expect(v[0]).toBeGreaterThanOrEqual(control.min[0]);
          expect(v[0]).toBeLessThanOrEqual(control.max[0]);
          expect(v[1]).toBeGreaterThanOrEqual(control.min[1]);
          expect(v[1]).toBeLessThanOrEqual(control.max[1]);
        } else if (control.kind === 'select') {
          expect(control.options.length).toBeGreaterThan(0);
          expect(control.options.some((opt) => opt.value === def)).toBe(true);
        } else if (control.kind === 'toggle') {
          expect(typeof def).toBe('boolean');
        } else if (control.kind === 'color') {
          expect(typeof def).toBe('string');
          expect(def as string).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
      }
    }
  });
});

describe('SobelEdgeStyle Directional Quantization', () => {
  it('outputs "|" along a synthetic vertical step-edge', () => {
    const cols = 9;
    const rows = 9;
    const rgba = new Uint8ClampedArray(cols * rows * 4);

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const val = c < 4 ? 0 : 255;
        const p = (r * cols + c) * 4;
        rgba[p] = val;
        rgba[p + 1] = val;
        rgba[p + 2] = val;
        rgba[p + 3] = 255;
      }
    }

    const result = SobelEdgeStyle.process({
      cols,
      rows,
      rgba,
      params: { ...getDefaultParams(SobelEdgeStyle), interiorFill: 0 },
    });

    // Edge boundary at c = 3 and c = 4 should register vertical strokes "|"
    const centerIdx = 4 * cols + 4;
    expect(result.glyphs?.[centerIdx]).toBe('|');
    expect(result.edgeStrength?.[centerIdx]).toBeGreaterThan(0.5);
    // Flat interior far from boundary is suppressed
    expect(result.glyphs?.[4 * cols + 0]).toBe(' ');
  });

  it('outputs "-" along a synthetic horizontal step-edge', () => {
    const cols = 9;
    const rows = 9;
    const rgba = new Uint8ClampedArray(cols * rows * 4);

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const val = r < 4 ? 0 : 255;
        const p = (r * cols + c) * 4;
        rgba[p] = val;
        rgba[p + 1] = val;
        rgba[p + 2] = val;
        rgba[p + 3] = 255;
      }
    }

    const result = SobelEdgeStyle.process({
      cols,
      rows,
      rgba,
      params: { ...getDefaultParams(SobelEdgeStyle), interiorFill: 0 },
    });

    // Edge boundary at r = 3 and r = 4 should register horizontal strokes "-"
    const centerIdx = 4 * cols + 4;
    expect(result.glyphs?.[centerIdx]).toBe('-');
    expect(result.edgeStrength?.[centerIdx]).toBeGreaterThan(0.5);
    expect(result.glyphs?.[0 * cols + 4]).toBe(' ');
  });
});

describe('BrailleHighResStyle 2x4 Sub-Cell Packing', () => {
  it('maps an all-white 2x4 block to U+28FF (⣿) and an all-black block to U+2800 (⠀)', () => {
    const cols = 2;
    const rows = 1;
    const subW = cols * 2;
    const subH = rows * 4;
    const rgba = new Uint8ClampedArray(subW * subH * 4);

    // Cell (0, 0) [x in 0..1, y in 0..3]: all white (255)
    // Cell (1, 0) [x in 2..3, y in 0..3]: all black (0)
    for (let sy = 0; sy < subH; sy += 1) {
      for (let sx = 0; sx < subW; sx += 1) {
        const val = sx < 2 ? 255 : 0;
        const p = (sy * subW + sx) * 4;
        rgba[p] = val;
        rgba[p + 1] = val;
        rgba[p + 2] = val;
        rgba[p + 3] = 255;
      }
    }

    const result = BrailleHighResStyle.process({
      cols,
      rows,
      rgba,
      subSampleWidth: subW,
      subSampleHeight: subH,
      params: getDefaultParams(BrailleHighResStyle),
    });

    expect(result.brailleMasks?.[0]).toBe(0xff);
    expect(result.glyphs?.[0]).toBe('\u28FF'); // ⣿
    expect(result.brailleMasks?.[1]).toBe(0x00);
    expect(result.glyphs?.[1]).toBe('\u2800'); // ⠀
  });
});

describe('ReactionDiffusionStyle Gray-Scott Simulation', () => {
  it('advances deterministically without NaN divergence over 100 simulation steps', () => {
    const cols = 32;
    const rows = 24;
    const params = getDefaultParams(ReactionDiffusionStyle);

    const simA = ReactionDiffusionStyle.createSimulation(cols, rows, 4242);
    const simB = ReactionDiffusionStyle.createSimulation(cols, rows, 4242);

    const outA = new Float32Array(cols * rows * 4);
    const outB = new Float32Array(cols * rows * 4);

    for (let step = 0; step < 100; step += 1) {
      simA.step(1 / 60, params);
      simB.step(1 / 60, params);
    }

    simA.writeCellField(outA);
    simB.writeCellField(outB);

    let nonZeroLumCount = 0;
    for (let i = 0; i < outA.length; i += 1) {
      const valA = outA[i] ?? Number.NaN;
      const valB = outB[i] ?? Number.NaN;
      expect(Number.isFinite(valA)).toBe(true);
      expect(valA).toBe(valB);
      if (i % 4 === 0 && valA > 0.01) {
        nonZeroLumCount += 1;
      }
    }

    expect(nonZeroLumCount).toBeGreaterThan(0);

    // Interactive pointer drop perturbs chemical concentrations locally
    simA.injectDrop?.(4, 4, 3);
    simA.step(1 / 60, params);
    const outAfterDrop = new Float32Array(cols * rows * 4);
    simA.writeCellField(outAfterDrop);
    expect(Number.isFinite(outAfterDrop[4 * cols * 4 + 4 * 4])).toBe(true);
  });

  it('produces active warmed-up Turing patterns immediately on creation', () => {
    const cols = 48;
    const rows = 32;
    const sim = ReactionDiffusionStyle.createSimulation(cols, rows, 1337);
    const initialOut = new Float32Array(cols * rows * 4);
    sim.writeCellField(initialOut);

    let activeCells = 0;
    for (let i = 0; i < cols * rows; i += 1) {
      if ((initialOut[i * 4] ?? 0) > 0.15) activeCells += 1;
    }
    expect(activeCells).toBeGreaterThan(20);
  });
});

describe('BayerDitherStyle Shadow Cutoff Gate', () => {
  it('keeps near-black background pixels empty spaces rather than checker noise', () => {
    const cols = 8;
    const rows = 8;
    const rgba = new Uint8ClampedArray(cols * rows * 4);
    for (let i = 0; i < cols * rows; i += 1) {
      const p = i * 4;
      rgba[p] = 12;
      rgba[p + 1] = 15;
      rgba[p + 2] = 22;
      rgba[p + 3] = 255;
    }

    const result = BayerDitherStyle.process({
      cols,
      rows,
      rgba,
      params: getDefaultParams(BayerDitherStyle),
    });

    expect(result.glyphs?.every((g) => g === ' ')).toBe(true);
  });
});
