/**
 * Scalable Vector Graphics (.svg) Exporter.
 * Emits horizontally run-length merged background <rect> runs and exact
 * monospace-grid positioned <text> glyphs.
 */

import type {
  CellBuffer,
  GlyphAtlasMetrics,
  PaletteConfig,
} from '../core/types';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rgbaToCss(r: number, g: number, b: number, a: number): string {
  if (a >= 255) {
    const hex = ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    return `#${hex}`;
  }
  const alpha = Math.round((a / 255) * 1000) / 1000;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function exportSvg(
  cellBuffer: CellBuffer,
  atlasMetrics: GlyphAtlasMetrics,
  palette: PaletteConfig
): string {
  const { cols, rows, glyphs, fgRgba, bgRgba } = cellBuffer;
  const cellW = atlasMetrics.cellWidthPx / Math.max(1, atlasMetrics.dpr);
  const cellH = atlasMetrics.cellHeightPx / Math.max(1, atlasMetrics.dpr);
  const fontSize = atlasMetrics.fontSizeCssPx;

  const width = Math.max(1, Math.round(cols * cellW * 100) / 100);
  const height = Math.max(1, Math.round(rows * cellH * 100) / 100);

  const [rootBgR, rootBgG, rootBgB, rootBgA] = palette.bgRgba;
  const rootBgCss = rgbaToCss(rootBgR, rootBgG, rootBgB, rootBgA);

  const rects: string[] = [];
  if (rootBgA > 0) {
    rects.push(`<rect width="${width}" height="${height}" fill="${rootBgCss}"/>`);
  }

  // Merge consecutive cells with identical non-root background colors horizontally
  for (let r = 0; r < rows; r += 1) {
    let c = 0;
    const y = (r * cellH).toFixed(2);
    const h = cellH.toFixed(2);

    while (c < cols) {
      const p4 = (r * cols + c) * 4;
      const bR = bgRgba[p4] ?? rootBgR;
      const bG = bgRgba[p4 + 1] ?? rootBgG;
      const bB = bgRgba[p4 + 2] ?? rootBgB;
      const bA = bgRgba[p4 + 3] ?? rootBgA;

      if (
        bA === 0 ||
        (bR === rootBgR && bG === rootBgG && bB === rootBgB && bA === rootBgA)
      ) {
        c += 1;
        continue;
      }

      let runEnd = c + 1;
      while (runEnd < cols) {
        const n4 = (r * cols + runEnd) * 4;
        if (
          (bgRgba[n4] ?? rootBgR) === bR &&
          (bgRgba[n4 + 1] ?? rootBgG) === bG &&
          (bgRgba[n4 + 2] ?? rootBgB) === bB &&
          (bgRgba[n4 + 3] ?? rootBgA) === bA
        ) {
          runEnd += 1;
        } else {
          break;
        }
      }

      const x = (c * cellW).toFixed(2);
      const w = ((runEnd - c) * cellW).toFixed(2);
      rects.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${rgbaToCss(bR, bG, bB, bA)}"/>`
      );
      c = runEnd;
    }
  }

  const textNodes: string[] = [];
  const baselineOffset = fontSize * 0.85;

  for (let r = 0; r < rows; r += 1) {
    const y = (r * cellH + baselineOffset).toFixed(2);
    const rowBase = r * cols;
    for (let c = 0; c < cols; c += 1) {
      const idx = rowBase + c;
      const ch = glyphs[idx] ?? ' ';
      if (ch === ' ') continue;

      const p4 = idx * 4;
      const fgA = fgRgba[p4 + 3] ?? 255;
      if (fgA <= 0) continue;

      const fgR = fgRgba[p4] ?? 240;
      const fgG = fgRgba[p4 + 1] ?? 245;
      const fgB = fgRgba[p4 + 2] ?? 240;

      const x = (c * cellW).toFixed(2);
      textNodes.push(
        `<text x="${x}" y="${y}" fill="${rgbaToCss(fgR, fgG, fgB, fgA)}">${escapeXml(ch)}</text>`
      );
    }
  }

  const fontAttr = escapeXml(atlasMetrics.fontFamily);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    ...rects,
    `<g font-family="${fontAttr}" font-size="${fontSize}px" xml:space="preserve">`,
    ...textNodes,
    `</g>`,
    `</svg>`,
  ].join('\n');
}
