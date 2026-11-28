/**
 * Plain-Text & 24-Bit Truecolor ANSI Terminal Exporter.
 */

import type { CellBuffer } from '../core/types';

/**
 * Neutralizes C0/C1 terminal control characters (including ESC, which would
 * otherwise smuggle arbitrary SGR/OSC sequences into exported .ans files) and
 * 7-bit DEL. Printable ASCII and Unicode glyphs pass through untouched.
 */
export function safeGlyph(ch: string): string {
  if (ch.length === 0) return ' ';
  const code = ch.codePointAt(0) ?? 0x20;
  if (code >= 0x20 && code < 0x7f) return ch;
  if (code > 0x009f) return ch;
  return ' ';
}

/**
 * Exports the CellBuffer as newline-delimited UTF-8 plain text, preserving
 * trailing spaces and exact `cols x rows` grid dimensions.
 */
export function exportPlainText(cellBuffer: CellBuffer): string {
  const { cols, rows, glyphs } = cellBuffer;
  const lines: string[] = new Array(rows);

  for (let r = 0; r < rows; r += 1) {
    let rowStr = '';
    const rowBase = r * cols;
    for (let c = 0; c < cols; c += 1) {
      rowStr += safeGlyph(glyphs[rowBase + c] ?? ' ');
    }
    lines[r] = rowStr;
  }

  return lines.join('\n');
}

/**
 * Exports the CellBuffer as 24-bit Truecolor ANSI (.ans) terminal art with
 * run-length color deduplication per line and `\x1b[0m` reset at each EOL.
 */
export function exportAnsiTrueColor(cellBuffer: CellBuffer): string {
  const { cols, rows, glyphs, fgRgba, bgRgba } = cellBuffer;
  const lines: string[] = new Array(rows);

  for (let r = 0; r < rows; r += 1) {
    let rowOut = '';
    let prevFgR = -1;
    let prevFgG = -1;
    let prevFgB = -1;
    let prevBgR = -1;
    let prevBgG = -1;
    let prevBgB = -1;

    const rowBase = r * cols;
    for (let c = 0; c < cols; c += 1) {
      const idx = rowBase + c;
      const p4 = idx * 4;
      const ch = safeGlyph(glyphs[idx] ?? ' ');

      const fgR = fgRgba[p4] ?? 240;
      const fgG = fgRgba[p4 + 1] ?? 245;
      const fgB = fgRgba[p4 + 2] ?? 240;

      const bgR = bgRgba[p4] ?? 10;
      const bgG = bgRgba[p4 + 1] ?? 12;
      const bgB = bgRgba[p4 + 2] ?? 14;

      if (bgR !== prevBgR || bgG !== prevBgG || bgB !== prevBgB) {
        rowOut += `\x1b[48;2;${bgR};${bgG};${bgB}m`;
        prevBgR = bgR;
        prevBgG = bgG;
        prevBgB = bgB;
      }

      if (ch !== ' ' && (fgR !== prevFgR || fgG !== prevFgG || fgB !== prevFgB)) {
        rowOut += `\x1b[38;2;${fgR};${fgG};${fgB}m`;
        prevFgR = fgR;
        prevFgG = fgG;
        prevFgB = fgB;
      }

      rowOut += ch;
    }

    rowOut += '\x1b[0m';
    lines[r] = rowOut;
  }

  return lines.join('\n');
}
