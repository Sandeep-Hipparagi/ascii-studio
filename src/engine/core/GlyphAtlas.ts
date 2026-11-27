/**
 * Dynamic WebGL2 Texture Atlas for monospace ASCII, directional, and Braille glyphs.
 * Rasterizes glyphs lazily on an offscreen 2D canvas up to 2048x2048 and uploads
 * dirty sub-regions incrementally via `gl.texSubImage2D`.
 */

import type { AtlasFilterMode, GlyphAtlasMetrics, GlyphSlot } from './types';

export interface GlyphAtlasOptions {
  readonly fontFamily?: string;
  readonly fontSizeCssPx?: number;
  readonly dpr?: number;
  readonly maxAtlasSize?: number;
  readonly paddingPx?: number;
  readonly filterMode?: AtlasFilterMode;
}

interface DirtyRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type CanvasSurface = HTMLCanvasElement | OffscreenCanvas;
type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const DEFAULT_FONT_FAMILY = "'Geist Mono', 'JetBrains Mono', monospace";
const DEFAULT_MAX_ATLAS_SIZE = 2048;
const DEFAULT_PADDING_PX = 2;

const BRAILLE_DOT_BITS = [
  0x01, 0x02, 0x04, 0x40, // Left column (rows 0..3)
  0x08, 0x10, 0x20, 0x80, // Right column (rows 0..3)
] as const;

function extractCssFontToken(cssValue: string): string | null {
  const trimmed = cssValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolves Next.js font CSS variables (`--font-geist-mono`, `--font-jetbrains-mono`)
 * attached to the DOM root before falling back to literal family names.
 */
function resolveDefaultMonoFontFamily(): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return DEFAULT_FONT_FAMILY;
  }

  const root = document.documentElement ?? document.body;
  if (!root) return DEFAULT_FONT_FAMILY;

  const computed = getComputedStyle(root);
  const bodyComputed = document.body ? getComputedStyle(document.body) : null;
  const parts: string[] = [];

  for (const varName of ['--font-geist-mono', '--font-jetbrains-mono'] as const) {
    const token =
      extractCssFontToken(computed.getPropertyValue(varName)) ??
      (bodyComputed ? extractCssFontToken(bodyComputed.getPropertyValue(varName)) : null);
    if (token && !parts.includes(token)) {
      parts.push(token);
    }
  }

  return parts.length > 0 ? `${parts.join(', ')}, ${DEFAULT_FONT_FAMILY}` : DEFAULT_FONT_FAMILY;
}

function drawGlyphBitmap(
  ctx: Canvas2DContext,
  char: string,
  originX: number,
  originY: number,
  cellWidthPx: number,
  cellHeightPx: number,
  fontSpec: string
): void {
  const code = char.length === 1 ? char.charCodeAt(0) : -1;
  ctx.fillStyle = '#ffffff';

  if (code >= 0x2800 && code <= 0x28ff) {
    // Rasterize Unicode Braille across the full cell box cleanly so stacked
    // rows align seamlessly without monospace descender scan-gaps.
    const mask = code - 0x2800;
    if (mask === 0) return;

    const pitchX = cellWidthPx / 2;
    const pitchY = cellHeightPx / 4;
    const radius = Math.max(0.75, Math.min(pitchX, pitchY) * 0.36);

    for (let dx = 0; dx < 2; dx += 1) {
      const cx = originX + (dx + 0.5) * pitchX;
      for (let dy = 0; dy < 4; dy += 1) {
        const bit = BRAILLE_DOT_BITS[dx * 4 + dy] ?? 0;
        if ((mask & bit) === 0) continue;
        const cy = originY + (dy + 0.5) * pitchY;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return;
  }

  ctx.font = fontSpec;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(char, originX, originY);
}

function createSurface(width: number, height: number): {
  canvas: CanvasSurface;
  ctx: Canvas2DContext;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Failed to acquire OffscreenCanvas 2D context for GlyphAtlas.');
    }
    return { canvas, ctx };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Failed to acquire HTMLCanvasElement 2D context for GlyphAtlas.');
  }
  return { canvas, ctx };
}

/**
 * Computes tight monospace glyph metrics and lazily packs rasterized glyphs into
 * a WebGL2 RGBA8 texture atlas with premultiplied alpha.
 */
export class GlyphAtlas {
  private readonly maxAtlasSize: number;
  private readonly paddingPx: number;
  private hasCustomFontFamily: boolean;
  private fontFamily: string;
  private fontSizeCssPx: number;
  private dpr: number;
  private filterMode: AtlasFilterMode;

  private atlasWidth: number;
  private atlasHeight: number;
  private cellWidthPx = 8;
  private cellHeightPx = 14;
  private slotWidthPx = 12;
  private slotHeightPx = 18;
  private gridCols = 1;
  private maxSlots = 1;

  private readonly surface: { canvas: CanvasSurface; ctx: Canvas2DContext };
  private readonly densityScratch: { canvas: CanvasSurface; ctx: Canvas2DContext };
  private readonly slots = new Map<string, GlyphSlot>();
  private dirtyRects: DirtyRect[] = [];

  private texture: WebGLTexture | null = null;
  private boundGl: WebGL2RenderingContext | null = null;
  private needsFullUpload = true;

  public constructor(options: GlyphAtlasOptions = {}) {
    this.hasCustomFontFamily = options.fontFamily !== undefined;
    this.fontFamily = options.fontFamily ?? resolveDefaultMonoFontFamily();
    this.fontSizeCssPx = Math.max(4, options.fontSizeCssPx ?? 12);
    this.dpr = Math.max(1, options.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
    this.maxAtlasSize = Math.min(2048, Math.max(256, options.maxAtlasSize ?? DEFAULT_MAX_ATLAS_SIZE));
    this.paddingPx = Math.max(1, options.paddingPx ?? DEFAULT_PADDING_PX);
    this.filterMode = options.filterMode ?? 'linear';

    this.atlasWidth = this.maxAtlasSize;
    this.atlasHeight = this.maxAtlasSize;

    this.surface = createSurface(this.atlasWidth, this.atlasHeight);
    this.densityScratch = createSurface(64, 64);

    this.reconfigureFontMetrics();
  }

  public getMetrics(): GlyphAtlasMetrics {
    return {
      fontFamily: this.fontFamily,
      fontSizeCssPx: this.fontSizeCssPx,
      dpr: this.dpr,
      cellWidthPx: this.cellWidthPx,
      cellHeightPx: this.cellHeightPx,
      aspectRatio: this.cellWidthPx / Math.max(1e-4, this.cellHeightPx),
      slotWidthPx: this.slotWidthPx,
      slotHeightPx: this.slotHeightPx,
      atlasWidth: this.atlasWidth,
      atlasHeight: this.atlasHeight,
    };
  }

  public getFilterMode(): AtlasFilterMode {
    return this.filterMode;
  }

  public setFilterMode(mode: AtlasFilterMode): void {
    if (this.filterMode === mode) return;
    this.filterMode = mode;
    if (this.boundGl && this.texture) {
      this.applyTextureParameters(this.boundGl, this.texture);
    }
  }

  public updateTypography(
    fontSizeCssPx: number,
    dpr: number = this.dpr,
    fontFamily?: string
  ): boolean {
    const nextFontPx = Math.max(4, fontSizeCssPx);
    const nextDpr = Math.max(1, dpr);
    const nextFamily = fontFamily ?? (this.hasCustomFontFamily ? this.fontFamily : resolveDefaultMonoFontFamily());
    if (fontFamily !== undefined) {
      this.hasCustomFontFamily = true;
    }

    if (
      nextFontPx === this.fontSizeCssPx &&
      nextDpr === this.dpr &&
      nextFamily === this.fontFamily
    ) {
      return false;
    }

    this.fontSizeCssPx = nextFontPx;
    this.dpr = nextDpr;
    this.fontFamily = nextFamily;
    this.reconfigureFontMetrics();
    return true;
  }

  /**
   * Awaits browser font resolution (`document.fonts.ready`) and rebuilds the
   * glyph atlas from the actual loaded web font rather than OS fallback metrics.
   */
  public async refreshAfterFontsReady(): Promise<boolean> {
    if (typeof document === 'undefined' || !document.fonts) {
      return false;
    }

    if (!this.hasCustomFontFamily) {
      this.fontFamily = resolveDefaultMonoFontFamily();
    }

    if (typeof document.fonts.load === 'function') {
      await document.fonts.load(this.buildFontSpec(), ' .:-=+*#%@M').catch(() => []);
    }
    await document.fonts.ready;

    if (!this.hasCustomFontFamily) {
      this.fontFamily = resolveDefaultMonoFontFamily();
    }

    if (this.boundGl && this.texture && !this.boundGl.isContextLost()) {
      this.boundGl.deleteTexture(this.texture);
    }
    this.invalidateTexture();
    this.reconfigureFontMetrics();
    return true;
  }

  /**
   * Returns an existing glyph slot or lazily rasterizes and queues the glyph
   * for incremental GPU upload.
   */
  public getOrInsertGlyph(char: string): GlyphSlot | null {
    const existing = this.slots.get(char);
    if (existing) return existing;

    const index = this.slots.size;
    if (index >= this.maxSlots) {
      return null;
    }

    const col = index % this.gridCols;
    const row = Math.floor(index / this.gridCols);
    const x = col * this.slotWidthPx;
    const y = row * this.slotHeightPx;

    this.rasterizeGlyph(char, x, y);

    // Map UV bounds to the inner glyph cell (excluding guard padding) so
    // bilinear sampling stays crisp inside the glyph slot.
    const innerX = x + this.paddingPx;
    const innerY = y + this.paddingPx;
    const innerW = this.slotWidthPx - 2 * this.paddingPx;
    const innerH = this.slotHeightPx - 2 * this.paddingPx;

    const invW = 1 / this.atlasWidth;
    const invH = 1 / this.atlasHeight;

    const slot: GlyphSlot = {
      char,
      index,
      x: innerX,
      y: innerY,
      width: innerW,
      height: innerH,
      u0Norm: Math.round(innerX * invW * 65535),
      v0Norm: Math.round(innerY * invH * 65535),
      uWNorm: Math.round(innerW * invW * 65535),
      vHNorm: Math.round(innerH * invH * 65535),
    };

    this.slots.set(char, slot);
    this.dirtyRects.push({
      x,
      y,
      width: this.slotWidthPx,
      height: this.slotHeightPx,
    });

    return slot;
  }

  public ensureGlyphs(chars: string): void {
    for (const ch of Array.from(chars)) {
      this.getOrInsertGlyph(ch);
    }
  }

  /**
   * Ensures all Unicode Braille codepoints (U+2800..U+28FF) fit and are cached
   * if capacity allows, or lazily cached as used.
   */
  public ensureBrailleRange(): void {
    for (let mask = 0; mask < 256; mask += 1) {
      this.getOrInsertGlyph(String.fromCharCode(0x2800 + mask));
    }
  }

  /**
   * Measures the normalized ink coverage [0..1] of a single glyph by summing
   * rasterized alpha over the cell box.
   */
  public measureGlyphDensity(char: string): number {
    const w = Math.max(4, Math.round(this.cellWidthPx));
    const h = Math.max(4, Math.round(this.cellHeightPx));
    const { canvas, ctx } = this.densityScratch;

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);
    drawGlyphBitmap(ctx, char, 0, 0, w, h, this.buildFontSpec());

    const { data } = ctx.getImageData(0, 0, w, h);
    let alphaSum = 0;
    for (let i = 3; i < data.length; i += 4) {
      alphaSum += data[i] ?? 0;
    }

    return alphaSum / (w * h * 255);
  }

  /**
   * Sorts a custom character ramp from lowest visual ink coverage (darkest)
   * to highest visual ink coverage (brightest), deduplicating codepoints.
   */
  public sortRampByVisualDensity(chars: string): string {
    const unique = Array.from(new Set(Array.from(chars)));
    const measured = unique.map((ch) => ({
      ch,
      density: this.measureGlyphDensity(ch),
      codePoint: ch.codePointAt(0) ?? 0,
    }));

    measured.sort((a, b) => {
      if (a.density !== b.density) return a.density - b.density;
      return a.codePoint - b.codePoint;
    });

    return measured.map((entry) => entry.ch).join('');
  }

  /**
   * Marks the WebGL texture handle invalid (e.g. after `webglcontextlost`) so
   * the next `syncTexture()` call recreates and re-uploads all cached glyphs.
   */
  public invalidateTexture(): void {
    this.texture = null;
    this.boundGl = null;
    this.needsFullUpload = true;
    this.dirtyRects = [];
  }

  /**
   * Synchronizes the offscreen glyph canvas with the WebGL2 `RGBA8` texture.
   * Performs a full upload on initial creation/recovery and coalesced
   * `gl.texSubImage2D` uploads for newly cached glyphs.
   */
  public syncTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
    const maxGpuTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (maxGpuTex > 0 && (this.atlasWidth > maxGpuTex || this.atlasHeight > maxGpuTex)) {
      const clamped = Math.min(this.maxAtlasSize, maxGpuTex);
      if (clamped !== this.atlasWidth) {
        this.atlasWidth = clamped;
        this.atlasHeight = clamped;
        this.surface.canvas.width = clamped;
        this.surface.canvas.height = clamped;
        this.reconfigureFontMetrics();
      }
    }

    if (!this.texture || this.boundGl !== gl) {
      this.texture = gl.createTexture();
      if (!this.texture) return null;
      this.boundGl = gl;
      this.needsFullUpload = true;
    }

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.applyTextureParameters(gl, this.texture);

    if (this.needsFullUpload) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.surface.canvas
      );
      this.needsFullUpload = false;
      this.dirtyRects = [];
      return this.texture;
    }

    if (this.dirtyRects.length > 0) {
      const merged = this.mergeDirtyBounds(this.dirtyRects);
      const imageData = this.surface.ctx.getImageData(
        merged.x,
        merged.y,
        merged.width,
        merged.height
      );
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        merged.x,
        merged.y,
        merged.width,
        merged.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        imageData
      );
      this.dirtyRects = [];
    }

    return this.texture;
  }

  public dispose(): void {
    if (this.boundGl && this.texture) {
      this.boundGl.deleteTexture(this.texture);
    }
    this.texture = null;
    this.boundGl = null;
    this.slots.clear();
    this.dirtyRects = [];
  }

  private buildFontSpec(): string {
    const px = Math.round(this.fontSizeCssPx * this.dpr * 100) / 100;
    return `400 ${px}px ${this.fontFamily}`;
  }

  private reconfigureFontMetrics(): void {
    const { ctx } = this.surface;
    ctx.clearRect(0, 0, this.atlasWidth, this.atlasHeight);
    ctx.font = this.buildFontSpec();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const sample = ctx.measureText('M');
    const physicalFontPx = this.fontSizeCssPx * this.dpr;
    const measuredAdvance = sample.width > 0 ? sample.width : physicalFontPx * 0.6;

    const ascent = sample.fontBoundingBoxAscent ?? 0;
    const descent = sample.fontBoundingBoxDescent ?? 0;
    const measuredLineHeight =
      ascent + descent > 0 ? ascent + descent : physicalFontPx * 1.2;

    this.cellWidthPx = Math.max(4, Math.round(measuredAdvance));
    this.cellHeightPx = Math.max(4, Math.round(measuredLineHeight));

    this.slotWidthPx = Math.max(4, this.cellWidthPx + 2 * this.paddingPx);
    this.slotHeightPx = Math.max(4, this.cellHeightPx + 2 * this.paddingPx);

    this.gridCols = Math.max(1, Math.floor(this.atlasWidth / this.slotWidthPx));
    const gridRows = Math.max(1, Math.floor(this.atlasHeight / this.slotHeightPx));
    this.maxSlots = this.gridCols * gridRows;

    const previousChars = Array.from(this.slots.keys());
    this.slots.clear();
    this.dirtyRects = [];
    this.needsFullUpload = true;

    for (const ch of previousChars) {
      this.getOrInsertGlyph(ch);
    }
  }

  private rasterizeGlyph(char: string, slotX: number, slotY: number): void {
    const { ctx } = this.surface;
    ctx.clearRect(slotX, slotY, this.slotWidthPx, this.slotHeightPx);
    drawGlyphBitmap(
      ctx,
      char,
      slotX + this.paddingPx,
      slotY + this.paddingPx,
      this.cellWidthPx,
      this.cellHeightPx,
      this.buildFontSpec()
    );
  }

  private applyTextureParameters(gl: WebGL2RenderingContext, texture: WebGLTexture): void {
    const glFilter = this.filterMode === 'nearest' ? gl.NEAREST : gl.LINEAR;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, glFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, glFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private mergeDirtyBounds(rects: readonly DirtyRect[]): DirtyRect {
    let minX = this.atlasWidth;
    let minY = this.atlasHeight;
    let maxX = 0;
    let maxY = 0;

    for (const r of rects) {
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.width > maxX) maxX = r.x + r.width;
      if (r.y + r.height > maxY) maxY = r.y + r.height;
    }

    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }
}
