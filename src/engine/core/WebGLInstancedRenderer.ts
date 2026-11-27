/**
 * WebGL2 Instanced Glyph Renderer (#version 300 es).
 * Renders 100,000+ ASCII cells in a single `gl.drawArraysInstanced` call using
 * a 28-byte interleaved per-instance stride with premultiplied alpha blending.
 */

import type { GlyphAtlas } from './GlyphAtlas';
import {
  CELL_FLAG_INVERT_GLYPH,
  CELL_FLAG_ROTATE_QUAD,
  INSTANCE_STRIDE_BYTES,
  type GlyphSlot,
  type PostFxUniforms,
} from './types';

export type BackdropSource =
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap
  | HTMLImageElement
  | HTMLVideoElement;

export interface RendererLifecycleCallbacks {
  readonly onContextLost?: () => void;
  readonly onContextRestored?: () => void;
}

const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2  a_corner;
layout(location = 1) in vec2  a_cellPos;
layout(location = 2) in vec4  a_glyphUvRect;
layout(location = 3) in vec4  a_fgColor;
layout(location = 4) in vec4  a_bgColor;
layout(location = 5) in uint  a_rotationOrFlags;

uniform vec2 u_viewportPx;
uniform vec2 u_cellSizePx;

out vec2 v_uv;
out vec4 v_uvBounds;
out vec4 v_fgColor;
out vec4 v_bgColor;
flat out uint v_flags;

void main() {
  float scale = float((a_rotationOrFlags >> 8u) & 0xFFu) / 127.5;
  scale = (scale > 0.0) ? scale : 1.0;

  vec2 snappedCell = max(vec2(1.0), floor(u_cellSizePx + 0.5));
  vec2 gridCoord = floor(a_cellPos / max(u_cellSizePx, vec2(1e-4)) + 0.5);
  vec2 snappedOrigin = gridCoord * snappedCell;
  vec2 snappedSize = max(vec2(1.0), floor(snappedCell * scale + 0.5));

  vec2 worldPx;
  if ((a_rotationOrFlags & 65536u) != 0u) {
    float angle = (float(a_rotationOrFlags & 0xFFu) / 255.0 - 0.5) * 6.2831853;
    float c = cos(angle);
    float s = sin(angle);
    vec2 centered = (a_corner - 0.5) * snappedSize;
    vec2 rotated = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c);
    worldPx = floor(snappedOrigin + 0.5 * snappedCell + rotated + 0.5);
  } else {
    worldPx = snappedOrigin + a_corner * snappedSize;
  }

  vec2 ndc = (worldPx / max(u_viewportPx, vec2(1.0))) * vec2(2.0, -2.0) + vec2(-1.0, 1.0);
  gl_Position = vec4(ndc, 0.0, 1.0);

  v_uv = a_glyphUvRect.xy + a_corner * a_glyphUvRect.zw;
  v_uvBounds = vec4(a_glyphUvRect.xy, a_glyphUvRect.xy + a_glyphUvRect.zw);
  v_fgColor = a_fgColor;
  v_bgColor = a_bgColor;
  v_flags = a_rotationOrFlags;
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;

uniform sampler2D u_atlasTex;
uniform float u_crtScanlineIntensity;
uniform float u_crtScanlineDensity;
uniform float u_bloomIntensity;
uniform float u_bloomThreshold;

in vec2 v_uv;
in vec4 v_uvBounds;
in vec4 v_fgColor;
in vec4 v_bgColor;
flat in uint v_flags;

out vec4 outColor;

void main() {
  float glyphAlpha = texture(u_atlasTex, v_uv).a;
  if ((v_flags & 131072u) != 0u) {
    glyphAlpha = 1.0 - glyphAlpha;
  }

  // Optional single-pass phosphor halo inside the current glyph's atlas bounds.
  float bloomGlow = 0.0;
  if (u_bloomIntensity > 0.001) {
    vec2 texel = 1.0 / vec2(textureSize(u_atlasTex, 0));
    vec2 r = texel * 1.5;
    float halo = 0.25 * (
      texture(u_atlasTex, clamp(v_uv + vec2( r.x,  0.0), v_uvBounds.xy, v_uvBounds.zw)).a +
      texture(u_atlasTex, clamp(v_uv + vec2(-r.x,  0.0), v_uvBounds.xy, v_uvBounds.zw)).a +
      texture(u_atlasTex, clamp(v_uv + vec2( 0.0,  r.y), v_uvBounds.xy, v_uvBounds.zw)).a +
      texture(u_atlasTex, clamp(v_uv + vec2( 0.0, -r.y), v_uvBounds.xy, v_uvBounds.zw)).a
    );
    float fgLuma = dot(v_fgColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float gate = smoothstep(u_bloomThreshold, 1.0, fgLuma);
    bloomGlow = halo * gate * u_bloomIntensity;
  }

  float effectiveInk = clamp(glyphAlpha + bloomGlow * (1.0 - glyphAlpha), 0.0, 1.0);
  float fgA = v_fgColor.a * effectiveInk;
  float bgA = v_bgColor.a * (1.0 - fgA);
  vec3 premulRgb = v_fgColor.rgb * fgA + v_bgColor.rgb * bgA;

  if (u_crtScanlineIntensity > 0.001) {
    float wave = 0.5 - 0.5 * cos(gl_FragCoord.y * u_crtScanlineDensity);
    float scanFactor = 1.0 - u_crtScanlineIntensity * wave;
    premulRgb *= scanFactor;
  }

  outColor = vec4(premulRgb, clamp(fgA + bgA, 0.0, 1.0));
}
`;

const MAX_GPU_RAMP_RECTS = 128;

const GENERATIVE_GRID_VERT_SOURCE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

layout(location = 0) in vec2 a_corner;

uniform sampler2D  u_fieldTex;
uniform sampler2D  u_colorTex;
uniform vec4       u_rampUvRects[128];

uniform vec2  u_viewportPx;
uniform vec2  u_cellSizePx;
uniform int   u_gridCols;
uniform int   u_rampLen;
uniform float u_firstRampIsSpace;
uniform float u_allowDirectional;
uniform float u_directionalMinLum;
uniform uint  u_invertFlag;
uniform int   u_colorMode;
uniform vec4  u_fgColor;
uniform vec4  u_bgColor;

out vec2 v_uv;
out vec4 v_uvBounds;
out vec4 v_fgColor;
out vec4 v_bgColor;
flat out uint v_flags;

void main() {
  int cols = max(1, u_gridCols);
  int col = gl_InstanceID % cols;
  int row = gl_InstanceID / cols;

  vec4 cellField = texelFetch(u_fieldTex, ivec2(col, row), 0);
  vec4 cellColor = texelFetch(u_colorTex, ivec2(col, row), 0);

  float lum = cellField.r;
  float angle = (cellField.g * 255.0 - 128.0) / 127.0 * 3.14159265;
  float paletteIdx = cellField.b;
  float alpha = cellField.a;

  int rampCount = min(u_rampLen, 124);
  int glyphIdx = -1;
  uint flags = u_invertFlag;

  if (alpha > 0.005 && rampCount > 0) {
    bool useDirectional =
      u_allowDirectional > 0.5 &&
      lum >= u_directionalMinLum &&
      abs(angle) > 1e-3;

    if (useDirectional) {
      float wrapped = mod(mod(angle, 3.14159265) + 3.14159265, 3.14159265);
      int bin = int(floor(wrapped / 0.78539816 + 0.5)) & 3;
      glyphIdx = rampCount + bin;
      flags |= 262144u;
    } else {
      glyphIdx = clamp(int(floor(lum * float(rampCount))), 0, rampCount - 1);
    }
  }

  if (glyphIdx < 0 || glyphIdx >= 128 || (glyphIdx == 0 && u_firstRampIsSpace > 0.5)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_uv = vec2(0.0);
    v_uvBounds = vec4(0.0);
    v_fgColor = vec4(0.0);
    v_bgColor = vec4(0.0);
    v_flags = 0u;
    return;
  }

  vec4 glyphUvRect = u_rampUvRects[glyphIdx];

  vec2 snappedCell = max(vec2(1.0), floor(u_cellSizePx + 0.5));
  vec2 snappedOrigin = vec2(float(col), float(row)) * snappedCell;
  vec2 worldPx = snappedOrigin + a_corner * snappedCell;
  vec2 ndc = (worldPx / max(u_viewportPx, vec2(1.0))) * vec2(2.0, -2.0) + vec2(-1.0, 1.0);
  gl_Position = vec4(ndc, 0.0, 1.0);

  vec3 fgRgb = u_fgColor.rgb;
  if (u_colorMode == 0) {
    if (cellColor.a > 0.5) {
      fgRgb = cellColor.rgb;
    } else if (paletteIdx > 0.001) {
      fgRgb = clamp(0.5 + 0.5 * cos(6.2831853 * (paletteIdx + vec3(0.0, 0.33, 0.67))), 0.0, 1.0);
    }
  } else if (u_colorMode == 2) {
    fgRgb = mix(u_bgColor.rgb, u_fgColor.rgb, paletteIdx);
  }

  v_uv = glyphUvRect.xy + a_corner * glyphUvRect.zw;
  v_uvBounds = vec4(glyphUvRect.xy, glyphUvRect.xy + glyphUvRect.zw);
  v_fgColor = vec4(fgRgb, u_fgColor.a * alpha);
  v_bgColor = vec4(u_bgColor.rgb, 0.0);
  v_flags = flags;
}
`;

const BACKDROP_VERT_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_corner.x, 1.0 - a_corner.y);
  gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const BACKDROP_FRAG_SOURCE = `#version 300 es
precision mediump float;
uniform sampler2D u_backdropTex;
uniform float u_backdropOpacity;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 tex = texture(u_backdropTex, v_uv);
  float a = clamp(u_backdropOpacity * tex.a, 0.0, 1.0);
  outColor = vec4(tex.rgb * a, a);
}
`;

const INITIAL_INSTANCE_CAPACITY = 4096;

const CANVAS2D_BRAILLE_DOT_BITS = [
  0x01, 0x02, 0x04, 0x40,
  0x08, 0x10, 0x20, 0x80,
] as const;

function rgbaCss(r: number, g: number, b: number, aByte: number): string {
  if (aByte >= 255) {
    return `rgb(${r},${g},${b})`;
  }
  const a = Math.round((aByte / 255) * 1000) / 1000;
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Software Canvas 2D fallback renderer mirroring the instanced cell batcher
 * (`fillRect` background cells + horizontally batched `fillText` runs) when
 * WebGL2 is unavailable or unrecoverable.
 */
export class Canvas2DRenderer {
  private readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;

  private capacity = 0;
  private cellCount = 0;
  private xPx = new Float32Array(0);
  private yPx = new Float32Array(0);
  private chars: string[] = [];
  private fgRgba = new Uint8ClampedArray(0);
  private bgRgba = new Uint8ClampedArray(0);
  private flags = new Uint32Array(0);

  public constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.ensureCapacity(INITIAL_INSTANCE_CAPACITY);
  }

  public hasContext(): boolean {
    if (!this.ctx) {
      this.ctx = this.canvas.getContext('2d', { alpha: true });
    }
    return this.ctx !== null;
  }

  public beginFrame(): void {
    this.cellCount = 0;
  }

  public ensureCapacity(requiredCells: number): void {
    if (requiredCells <= this.capacity) return;

    let nextCap = Math.max(INITIAL_INSTANCE_CAPACITY, this.capacity || INITIAL_INSTANCE_CAPACITY);
    while (nextCap < requiredCells) {
      nextCap *= 2;
    }

    const nextX = new Float32Array(nextCap);
    const nextY = new Float32Array(nextCap);
    const nextFg = new Uint8ClampedArray(nextCap * 4);
    const nextBg = new Uint8ClampedArray(nextCap * 4);
    const nextFlags = new Uint32Array(nextCap);

    if (this.cellCount > 0) {
      nextX.set(this.xPx.subarray(0, this.cellCount));
      nextY.set(this.yPx.subarray(0, this.cellCount));
      nextFg.set(this.fgRgba.subarray(0, this.cellCount * 4));
      nextBg.set(this.bgRgba.subarray(0, this.cellCount * 4));
      nextFlags.set(this.flags.subarray(0, this.cellCount));
    }

    this.chars.length = nextCap;
    this.xPx = nextX;
    this.yPx = nextY;
    this.fgRgba = nextFg;
    this.bgRgba = nextBg;
    this.flags = nextFlags;
    this.capacity = nextCap;
  }

  public pushCell(
    xPx: number,
    yPx: number,
    ch: string,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    flags = 0
  ): void {
    const idx = this.cellCount;
    if (idx >= this.capacity) {
      this.ensureCapacity(idx + 1);
    }
    const p4 = idx * 4;
    this.xPx[idx] = xPx;
    this.yPx[idx] = yPx;
    this.chars[idx] = ch;
    this.fgRgba[p4] = fgR;
    this.fgRgba[p4 + 1] = fgG;
    this.fgRgba[p4 + 2] = fgB;
    this.fgRgba[p4 + 3] = fgA;
    this.bgRgba[p4] = bgR;
    this.bgRgba[p4 + 1] = bgG;
    this.bgRgba[p4 + 2] = bgB;
    this.bgRgba[p4 + 3] = bgA;
    this.flags[idx] = flags;
    this.cellCount = idx + 1;
  }

  public flush(
    atlas: GlyphAtlas,
    cellWidthPx: number,
    cellHeightPx: number,
    clearRgba: readonly [number, number, number, number] = [0, 0, 0, 1],
    postFx: PostFxUniforms = {
      crtScanlineIntensity: 0,
      crtScanlineDensity: 1.5,
      bloomIntensity: 0,
      bloomThreshold: 0.55,
      backdropOpacity: 0,
    },
    backdropSource: BackdropSource | null = null
  ): void {
    if (!this.hasContext() || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cellW = Math.max(1, Math.round(cellWidthPx));
    const cellH = Math.max(1, Math.round(cellHeightPx));

    ctx.fillStyle = rgbaCss(
      Math.round(clearRgba[0] * 255),
      Math.round(clearRgba[1] * 255),
      Math.round(clearRgba[2] * 255),
      Math.round(clearRgba[3] * 255)
    );
    ctx.fillRect(0, 0, w, h);

    const backdropAlpha = Math.max(0, Math.min(1, postFx.backdropOpacity ?? 0));
    if (backdropSource && backdropAlpha > 0.001) {
      ctx.save();
      ctx.globalAlpha = backdropAlpha;
      ctx.filter = 'blur(8px)';
      ctx.drawImage(backdropSource, 0, 0, w, h);
      ctx.restore();
    }

    if (this.cellCount === 0) return;

    // Pass 1: Background & inverted cell rects
    let lastRectStyle = '';
    for (let i = 0; i < this.cellCount; i += 1) {
      const p4 = i * 4;
      const inverted = ((this.flags[i] ?? 0) & CELL_FLAG_INVERT_GLYPH) !== 0;
      const bgA = this.bgRgba[p4 + 3] ?? 0;
      if (!inverted && bgA <= 0) continue;

      const style = inverted
        ? rgbaCss(
            this.fgRgba[p4] ?? 240,
            this.fgRgba[p4 + 1] ?? 245,
            this.fgRgba[p4 + 2] ?? 240,
            this.fgRgba[p4 + 3] ?? 255
          )
        : rgbaCss(
            this.bgRgba[p4] ?? 0,
            this.bgRgba[p4 + 1] ?? 0,
            this.bgRgba[p4 + 2] ?? 0,
            bgA
          );

      if (style !== lastRectStyle) {
        ctx.fillStyle = style;
        lastRectStyle = style;
      }
      const x = Math.round(this.xPx[i] ?? 0);
      const y = Math.round(this.yPx[i] ?? 0);
      ctx.fillRect(x, y, cellW, cellH);
    }

    // Pass 2: Batched foreground fillText runs + full-cell Braille vectors
    const metrics = atlas.getMetrics();
    const fontPx = Math.round(metrics.fontSizeCssPx * metrics.dpr * 100) / 100;
    ctx.font = `400 ${fontPx}px ${metrics.fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    let lastFgStyle = '';
    let i = 0;
    while (i < this.cellCount) {
      const p4 = i * 4;
      const ch = this.chars[i] ?? ' ';
      const fgA = this.fgRgba[p4 + 3] ?? 0;
      if (fgA <= 0 || ch === ' ') {
        i += 1;
        continue;
      }

      const inverted = ((this.flags[i] ?? 0) & CELL_FLAG_INVERT_GLYPH) !== 0;
      const style = inverted
        ? rgbaCss(
            this.bgRgba[p4] ?? 10,
            this.bgRgba[p4 + 1] ?? 12,
            this.bgRgba[p4 + 2] ?? 14,
            255
          )
        : rgbaCss(
            this.fgRgba[p4] ?? 240,
            this.fgRgba[p4 + 1] ?? 245,
            this.fgRgba[p4 + 2] ?? 240,
            fgA
          );

      if (style !== lastFgStyle) {
        ctx.fillStyle = style;
        lastFgStyle = style;
      }

      const x0 = Math.round(this.xPx[i] ?? 0);
      const y0 = Math.round(this.yPx[i] ?? 0);
      const code = ch.length === 1 ? ch.charCodeAt(0) : -1;

      if (code >= 0x2800 && code <= 0x28ff) {
        const mask = code - 0x2800;
        if (mask !== 0) {
          const pitchX = cellW / 2;
          const pitchY = cellH / 4;
          const radius = Math.max(0.75, Math.min(pitchX, pitchY) * 0.36);
          for (let dx = 0; dx < 2; dx += 1) {
            const cx = x0 + (dx + 0.5) * pitchX;
            for (let dy = 0; dy < 4; dy += 1) {
              const bit = CANVAS2D_BRAILLE_DOT_BITS[dx * 4 + dy] ?? 0;
              if ((mask & bit) === 0) continue;
              ctx.beginPath();
              ctx.arc(cx, y0 + (dy + 0.5) * pitchY, radius, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        i += 1;
        continue;
      }

      // Batch contiguous same-row, same-color glyphs into one fillText call
      let run = ch;
      let nextIdx = i + 1;
      let expectedX = x0 + cellW;
      while (nextIdx < this.cellCount) {
        const nCh = this.chars[nextIdx] ?? ' ';
        const nCode = nCh.length === 1 ? nCh.charCodeAt(0) : -1;
        if (nCh === ' ' || (nCode >= 0x2800 && nCode <= 0x28ff)) break;

        const nY = Math.round(this.yPx[nextIdx] ?? 0);
        const nX = Math.round(this.xPx[nextIdx] ?? 0);
        if (nY !== y0 || nX !== expectedX) break;

        const np4 = nextIdx * 4;
        const nInv = ((this.flags[nextIdx] ?? 0) & CELL_FLAG_INVERT_GLYPH) !== 0;
        if (
          nInv !== inverted ||
          this.fgRgba[np4] !== this.fgRgba[p4] ||
          this.fgRgba[np4 + 1] !== this.fgRgba[p4 + 1] ||
          this.fgRgba[np4 + 2] !== this.fgRgba[p4 + 2] ||
          this.fgRgba[np4 + 3] !== fgA
        ) {
          break;
        }

        run += nCh;
        expectedX += cellW;
        nextIdx += 1;
      }

      ctx.fillText(run, x0, y0);
      i = nextIdx;
    }

    if (postFx.crtScanlineIntensity > 0.001) {
      const stepY = Math.max(2, Math.round(4 / Math.max(0.5, postFx.crtScanlineDensity)));
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.65, postFx.crtScanlineIntensity * 0.65)})`;
      for (let sy = 0; sy < h; sy += stepY) {
        ctx.fillRect(0, sy, w, 1);
      }
    }
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to allocate WebGLShader.');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${log}`);
  }
  return shader;
}

export class WebGLInstancedRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: RendererLifecycleCallbacks;

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private quadVbo: WebGLBuffer | null = null;
  private instanceVbo: WebGLBuffer | null = null;
  private lastAtlas: GlyphAtlas | null = null;

  private uViewportPx: WebGLUniformLocation | null = null;
  private uCellSizePx: WebGLUniformLocation | null = null;
  private uAtlasTex: WebGLUniformLocation | null = null;
  private uCrtIntensity: WebGLUniformLocation | null = null;
  private uCrtDensity: WebGLUniformLocation | null = null;
  private uBloomIntensity: WebGLUniformLocation | null = null;
  private uBloomThreshold: WebGLUniformLocation | null = null;

  private generativeProgram: WebGLProgram | null = null;
  private generativeVao: WebGLVertexArrayObject | null = null;
  private rampUvF32 = new Float32Array(MAX_GPU_RAMP_RECTS * 4);
  private lastRampCacheKey = '';

  private ugAtlasTex: WebGLUniformLocation | null = null;
  private ugFieldTex: WebGLUniformLocation | null = null;
  private ugColorTex: WebGLUniformLocation | null = null;
  private ugRampUvRects: WebGLUniformLocation | null = null;
  private ugViewportPx: WebGLUniformLocation | null = null;
  private ugCellSizePx: WebGLUniformLocation | null = null;
  private ugGridCols: WebGLUniformLocation | null = null;
  private ugRampLen: WebGLUniformLocation | null = null;
  private ugFirstRampIsSpace: WebGLUniformLocation | null = null;
  private ugAllowDirectional: WebGLUniformLocation | null = null;
  private ugDirectionalMinLum: WebGLUniformLocation | null = null;
  private ugInvertFlag: WebGLUniformLocation | null = null;
  private ugColorMode: WebGLUniformLocation | null = null;
  private ugFgColor: WebGLUniformLocation | null = null;
  private ugBgColor: WebGLUniformLocation | null = null;
  private ugCrtIntensity: WebGLUniformLocation | null = null;
  private ugCrtDensity: WebGLUniformLocation | null = null;
  private ugBloomIntensity: WebGLUniformLocation | null = null;
  private ugBloomThreshold: WebGLUniformLocation | null = null;

  private backdropProgram: WebGLProgram | null = null;
  private backdropTex: WebGLTexture | null = null;
  private ubBackdropTex: WebGLUniformLocation | null = null;
  private ubBackdropOpacity: WebGLUniformLocation | null = null;

  private capacity: number;
  private instanceBuffer: ArrayBuffer;
  private f32View: Float32Array;
  private u16View: Uint16Array;
  private u8View: Uint8Array;
  private u32View: Uint32Array;
  private instanceCount = 0;

  private contextLost = false;
  private usingFallback2d = false;
  private fallback2d: Canvas2DRenderer | null = null;
  private disposed = false;

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.program = null;
    this.vao = null;
    this.quadVbo = null;
    this.instanceVbo = null;
    this.generativeProgram = null;
    this.generativeVao = null;
    this.backdropProgram = null;
    this.backdropTex = null;
    this.lastRampCacheKey = '';
    this.lastAtlas?.invalidateTexture();
    if (!this.fallback2d) {
      this.fallback2d = new Canvas2DRenderer(this.canvas);
    }
    this.usingFallback2d = this.fallback2d.hasContext();
    this.callbacks.onContextLost?.();
  };

  private readonly handleContextRestored = (): void => {
    if (this.disposed) return;
    this.contextLost = false;
    this.usingFallback2d = false;
    this.initGpuResources();
    if (this.gl && this.lastAtlas) {
      this.lastAtlas.invalidateTexture();
      this.lastAtlas.syncTexture(this.gl);
    }
    this.callbacks.onContextRestored?.();
  };

  public constructor(
    canvas: HTMLCanvasElement,
    callbacks: RendererLifecycleCallbacks = {}
  ) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.capacity = INITIAL_INSTANCE_CAPACITY;
    this.instanceBuffer = new ArrayBuffer(this.capacity * INSTANCE_STRIDE_BYTES);
    this.f32View = new Float32Array(this.instanceBuffer);
    this.u16View = new Uint16Array(this.instanceBuffer);
    this.u8View = new Uint8Array(this.instanceBuffer);
    this.u32View = new Uint32Array(this.instanceBuffer);

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    this.initGpuResources();
  }

  public getContext(): WebGL2RenderingContext | null {
    return this.contextLost ? null : this.gl;
  }

  public isContextLost(): boolean {
    return this.contextLost || !this.gl || this.gl.isContextLost();
  }

  public isUsingFallback2d(): boolean {
    return this.usingFallback2d && Boolean(this.fallback2d?.hasContext());
  }

  public canRender(): boolean {
    return !this.isContextLost() || this.isUsingFallback2d();
  }

  public resize(widthPx: number, heightPx: number): void {
    const w = Math.max(1, Math.round(widthPx));
    const h = Math.max(1, Math.round(heightPx));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    if (this.gl && !this.contextLost) {
      this.gl.viewport(0, 0, w, h);
    }
  }

  public beginFrame(): void {
    this.instanceCount = 0;
    if (this.isUsingFallback2d()) {
      this.fallback2d?.beginFrame();
    }
  }

  public ensureCapacity(requiredCells: number): void {
    if (requiredCells <= this.capacity) return;

    let nextCapacity = this.capacity;
    while (nextCapacity < requiredCells) {
      nextCapacity *= 2;
    }

    const nextBuffer = new ArrayBuffer(nextCapacity * INSTANCE_STRIDE_BYTES);
    new Uint8Array(nextBuffer).set(
      this.u8View.subarray(0, this.instanceCount * INSTANCE_STRIDE_BYTES)
    );

    this.capacity = nextCapacity;
    this.instanceBuffer = nextBuffer;
    this.f32View = new Float32Array(nextBuffer);
    this.u16View = new Uint16Array(nextBuffer);
    this.u8View = new Uint8Array(nextBuffer);
    this.u32View = new Uint32Array(nextBuffer);
  }

  /**
   * Appends one glyph cell into the 28-byte interleaved instance stream.
   */
  public pushCell(
    xPx: number,
    yPx: number,
    slot: GlyphSlot,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    angleRad = 0,
    scale = 1,
    flags = 0
  ): void {
    if (this.isUsingFallback2d()) {
      this.fallback2d?.pushCell(
        xPx,
        yPx,
        slot.char,
        fgR,
        fgG,
        fgB,
        fgA,
        bgR,
        bgG,
        bgB,
        bgA,
        flags
      );
      return;
    }

    const idx = this.instanceCount;
    if (idx >= this.capacity) {
      this.ensureCapacity(idx + 1);
    }

    const fBase = idx * 7;
    const u16Base = idx * 14;
    const u8Base = idx * 28;

    this.f32View[fBase] = xPx;
    this.f32View[fBase + 1] = yPx;

    this.u16View[u16Base + 4] = slot.u0Norm;
    this.u16View[u16Base + 5] = slot.v0Norm;
    this.u16View[u16Base + 6] = slot.uWNorm;
    this.u16View[u16Base + 7] = slot.vHNorm;

    this.u8View[u8Base + 16] = fgR;
    this.u8View[u8Base + 17] = fgG;
    this.u8View[u8Base + 18] = fgB;
    this.u8View[u8Base + 19] = fgA;

    this.u8View[u8Base + 20] = bgR;
    this.u8View[u8Base + 21] = bgG;
    this.u8View[u8Base + 22] = bgB;
    this.u8View[u8Base + 23] = bgA;

    const normAngle = ((angleRad / (Math.PI * 2) + 0.5) % 1 + 1) % 1;
    const angleByte = Math.round(normAngle * 255) & 0xff;
    const scaleByte = Math.max(0, Math.min(255, Math.round(scale * 127.5))) & 0xff;
    const rotateFlag = angleRad !== 0 ? CELL_FLAG_ROTATE_QUAD : 0;

    this.u32View[fBase + 6] =
      (angleByte | (scaleByte << 8) | flags | rotateFlag) >>> 0;

    this.instanceCount = idx + 1;
  }

  public static packFlags(options: {
    rotateQuad?: boolean;
    invertGlyph?: boolean;
  }): number {
    let f = 0;
    if (options.rotateQuad) f |= CELL_FLAG_ROTATE_QUAD;
    if (options.invertGlyph) f |= CELL_FLAG_INVERT_GLYPH;
    return f;
  }

  public flush(
    atlas: GlyphAtlas,
    cellWidthPx: number,
    cellHeightPx: number,
    clearRgba: readonly [number, number, number, number] = [0, 0, 0, 1],
    postFx: PostFxUniforms = {
      crtScanlineIntensity: 0,
      crtScanlineDensity: 1.5,
      bloomIntensity: 0,
      bloomThreshold: 0.55,
      backdropOpacity: 0,
    },
    backdropSource: BackdropSource | null = null
  ): void {
    if (this.isUsingFallback2d()) {
      this.lastAtlas = atlas;
      this.fallback2d?.flush(
        atlas,
        cellWidthPx,
        cellHeightPx,
        clearRgba,
        postFx,
        backdropSource
      );
      return;
    }

    const gl = this.gl;
    if (!gl || this.contextLost || !this.program || !this.vao || !this.instanceVbo) {
      return;
    }

    this.lastAtlas = atlas;
    const tex = atlas.syncTexture(gl);
    if (!tex) return;

    const width = this.canvas.width;
    const height = this.canvas.height;
    gl.viewport(0, 0, width, height);

    gl.clearColor(
      clearRgba[0] * clearRgba[3],
      clearRgba[1] * clearRgba[3],
      clearRgba[2] * clearRgba[3],
      clearRgba[3]
    );
    gl.clear(gl.COLOR_BUFFER_BIT);

    const backdropAlpha = Math.max(0, Math.min(1, postFx.backdropOpacity ?? 0));
    if (backdropSource && backdropAlpha > 0.001) {
      this.drawBackdropQuad(gl, backdropSource, backdropAlpha);
    }

    if (this.instanceCount === 0) return;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.uAtlasTex, 0);

    gl.uniform2f(this.uViewportPx, width, height);
    gl.uniform2f(this.uCellSizePx, cellWidthPx, cellHeightPx);
    gl.uniform1f(this.uCrtIntensity, postFx.crtScanlineIntensity);
    gl.uniform1f(this.uCrtDensity, postFx.crtScanlineDensity);
    gl.uniform1f(this.uBloomIntensity, postFx.bloomIntensity);
    gl.uniform1f(this.uBloomThreshold, postFx.bloomThreshold);

    const uploadBytes = new Uint8Array(
      this.instanceBuffer,
      0,
      this.instanceCount * INSTANCE_STRIDE_BYTES
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
    gl.bufferData(gl.ARRAY_BUFFER, uploadBytes, gl.DYNAMIC_DRAW);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.instanceCount);
    gl.bindVertexArray(null);
  }

  /**
   * Renders a GPU generative cell field directly from its offscreen FBO textures
   * via `gl_InstanceID` without synchronous `gl.readPixels` CPU round-trips.
   */
  public flushGenerativeGrid(options: {
    readonly atlas: GlyphAtlas;
    readonly fieldTex: WebGLTexture;
    readonly colorTex: WebGLTexture;
    readonly cols: number;
    readonly rows: number;
    readonly rampChars: readonly string[];
    readonly allowDirectional: boolean;
    readonly directionalMinLum: number;
    readonly invertGlyph: boolean;
    readonly colorMode: 'source' | 'monochrome' | 'duotone';
    readonly fgRgba: readonly [number, number, number, number];
    readonly bgRgba: readonly [number, number, number, number];
    readonly postFx: PostFxUniforms;
  }): void {
    const gl = this.gl;
    if (
      !gl ||
      this.contextLost ||
      !this.generativeProgram ||
      !this.generativeVao
    ) {
      return;
    }

    const {
      atlas,
      fieldTex,
      colorTex,
      cols,
      rows,
      rampChars,
      allowDirectional,
      directionalMinLum,
      invertGlyph,
      colorMode,
      fgRgba,
      bgRgba,
      postFx,
    } = options;

    this.lastAtlas = atlas;
    this.syncRampUniformBuffer(gl, atlas, rampChars);
    const atlasTex = atlas.syncTexture(gl);
    if (!atlasTex) return;

    const metrics = atlas.getMetrics();
    const width = this.canvas.width;
    const height = this.canvas.height;
    gl.viewport(0, 0, width, height);

    const clearR = bgRgba[0] / 255;
    const clearG = bgRgba[1] / 255;
    const clearB = bgRgba[2] / 255;
    const clearA = bgRgba[3] / 255;
    gl.clearColor(clearR * clearA, clearG * clearA, clearB * clearA, clearA);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const instanceTotal = cols * rows;
    if (instanceTotal <= 0 || rampChars.length === 0) return;

    gl.useProgram(this.generativeProgram);
    gl.bindVertexArray(this.generativeVao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(this.ugAtlasTex, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.uniform1i(this.ugFieldTex, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.uniform1i(this.ugColorTex, 2);

    if (this.ugRampUvRects) {
      gl.uniform4fv(this.ugRampUvRects, this.rampUvF32);
    }

    gl.uniform2f(this.ugViewportPx, width, height);
    gl.uniform2f(this.ugCellSizePx, metrics.cellWidthPx, metrics.cellHeightPx);
    gl.uniform1i(this.ugGridCols, cols);
    gl.uniform1i(this.ugRampLen, rampChars.length);
    gl.uniform1f(this.ugFirstRampIsSpace, rampChars[0] === ' ' ? 1 : 0);
    gl.uniform1f(this.ugAllowDirectional, allowDirectional ? 1 : 0);
    gl.uniform1f(this.ugDirectionalMinLum, directionalMinLum);
    gl.uniform1ui(this.ugInvertFlag, invertGlyph ? CELL_FLAG_INVERT_GLYPH : 0);
    gl.uniform1i(
      this.ugColorMode,
      colorMode === 'monochrome' ? 1 : colorMode === 'duotone' ? 2 : 0
    );
    gl.uniform4f(
      this.ugFgColor,
      fgRgba[0] / 255,
      fgRgba[1] / 255,
      fgRgba[2] / 255,
      fgRgba[3] / 255
    );
    gl.uniform4f(this.ugBgColor, clearR, clearG, clearB, clearA);
    gl.uniform1f(this.ugCrtIntensity, postFx.crtScanlineIntensity);
    gl.uniform1f(this.ugCrtDensity, postFx.crtScanlineDensity);
    gl.uniform1f(this.ugBloomIntensity, postFx.bloomIntensity);
    gl.uniform1f(this.ugBloomThreshold, postFx.bloomThreshold);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceTotal);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  }

  public dispose(): void {
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);

    const gl = this.gl;
    if (gl && !gl.isContextLost()) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.generativeProgram) gl.deleteProgram(this.generativeProgram);
      if (this.generativeVao) gl.deleteVertexArray(this.generativeVao);
      if (this.backdropProgram) gl.deleteProgram(this.backdropProgram);
      if (this.backdropTex) gl.deleteTexture(this.backdropTex);
      if (this.quadVbo) gl.deleteBuffer(this.quadVbo);
      if (this.instanceVbo) gl.deleteBuffer(this.instanceVbo);
    }

    this.program = null;
    this.vao = null;
    this.generativeProgram = null;
    this.generativeVao = null;
    this.backdropProgram = null;
    this.backdropTex = null;
    this.lastRampCacheKey = '';
    this.quadVbo = null;
    this.instanceVbo = null;
    this.gl = null;
  }

  private syncRampUniformBuffer(
    gl: WebGL2RenderingContext,
    atlas: GlyphAtlas,
    rampChars: readonly string[]
  ): void {
    const metrics = atlas.getMetrics();
    const clampedRampLen = Math.min(124, rampChars.length);
    const totalEntries = clampedRampLen + 4;
    const key = `${metrics.fontFamily}|${metrics.cellWidthPx}x${metrics.cellHeightPx}|${metrics.atlasWidth}x${metrics.atlasHeight}|${rampChars.join('')}`;

    if (key === this.lastRampCacheKey) {
      return;
    }

    this.rampUvF32.fill(0);
    const dirGlyphs = ['|', '/', '-', '\\'] as const;
    for (let i = 0; i < totalEntries; i += 1) {
      const ch =
        i < clampedRampLen
          ? (rampChars[i] ?? ' ')
          : (dirGlyphs[i - clampedRampLen] ?? '|');
      const slot = atlas.getOrInsertGlyph(ch);
      const b = i * 4;
      if (slot) {
        this.rampUvF32[b] = slot.u0Norm / 65535;
        this.rampUvF32[b + 1] = slot.v0Norm / 65535;
        this.rampUvF32[b + 2] = slot.uWNorm / 65535;
        this.rampUvF32[b + 3] = slot.vHNorm / 65535;
      }
    }

    // Re-sync atlas in case missing glyphs were inserted lazily while packing LUT.
    atlas.syncTexture(gl);
    this.lastRampCacheKey = key;
  }

  private drawBackdropQuad(
    gl: WebGL2RenderingContext,
    source: BackdropSource,
    opacity: number
  ): void {
    if (!this.backdropProgram || !this.generativeVao) return;
    if (!this.backdropTex) {
      this.backdropTex = gl.createTexture();
      if (!this.backdropTex) return;
    }

    gl.bindTexture(gl.TEXTURE_2D, this.backdropTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    gl.useProgram(this.backdropProgram);
    gl.bindVertexArray(this.generativeVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.backdropTex);
    gl.uniform1i(this.ubBackdropTex, 0);
    gl.uniform1f(this.ubBackdropOpacity, opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  private initGpuResources(): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      this.contextLost = true;
      this.fallback2d = new Canvas2DRenderer(this.canvas);
      this.usingFallback2d = this.fallback2d.hasContext();
      return;
    }

    const vert = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      throw new Error('Failed to create WebGLProgram.');
    }

    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'unknown link error';
      gl.deleteProgram(program);
      throw new Error(`Program link failed: ${log}`);
    }

    const vao = gl.createVertexArray();
    const quadVbo = gl.createBuffer();
    const instanceVbo = gl.createBuffer();
    if (!vao || !quadVbo || !instanceVbo) {
      throw new Error('Failed to allocate VAO/VBO resources.');
    }

    gl.bindVertexArray(vao);

    // Location 0: Unit quad corner (2 triangles via TRIANGLE_STRIP)
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Locations 1..5: 28-byte interleaved per-instance stream
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo);

    // a_cellPos: 8 bytes (2 x float32) @ offset 0
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, INSTANCE_STRIDE_BYTES, 0);
    gl.vertexAttribDivisor(1, 1);

    // a_glyphUvRect: 8 bytes (4 x uint16 normalized) @ offset 8
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_SHORT, true, INSTANCE_STRIDE_BYTES, 8);
    gl.vertexAttribDivisor(2, 1);

    // a_fgColor: 4 bytes (4 x uint8 normalized) @ offset 16
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, INSTANCE_STRIDE_BYTES, 16);
    gl.vertexAttribDivisor(3, 1);

    // a_bgColor: 4 bytes (4 x uint8 normalized) @ offset 20
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, INSTANCE_STRIDE_BYTES, 20);
    gl.vertexAttribDivisor(4, 1);

    // a_rotationOrFlags: 4 bytes (1 x uint32) @ offset 24
    gl.enableVertexAttribArray(5);
    gl.vertexAttribIPointer(5, 1, gl.UNSIGNED_INT, INSTANCE_STRIDE_BYTES, 24);
    gl.vertexAttribDivisor(5, 1);

    gl.bindVertexArray(null);

    const genVert = compileShader(gl, gl.VERTEX_SHADER, GENERATIVE_GRID_VERT_SOURCE);
    const genFrag = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    const genProgram = gl.createProgram();
    if (!genProgram) {
      gl.deleteShader(genVert);
      gl.deleteShader(genFrag);
      throw new Error('Failed to create generative WebGLProgram.');
    }
    gl.attachShader(genProgram, genVert);
    gl.attachShader(genProgram, genFrag);
    gl.linkProgram(genProgram);
    gl.deleteShader(genVert);
    gl.deleteShader(genFrag);

    if (!gl.getProgramParameter(genProgram, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(genProgram) ?? 'unknown link error';
      gl.deleteProgram(genProgram);
      throw new Error(`Generative grid program link failed: ${log}`);
    }

    const genVao = gl.createVertexArray();
    if (!genVao) {
      throw new Error('Failed to allocate generative VAO.');
    }
    gl.bindVertexArray(genVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const bdVert = compileShader(gl, gl.VERTEX_SHADER, BACKDROP_VERT_SOURCE);
    const bdFrag = compileShader(gl, gl.FRAGMENT_SHADER, BACKDROP_FRAG_SOURCE);
    const bdProgram = gl.createProgram();
    if (!bdProgram) {
      gl.deleteShader(bdVert);
      gl.deleteShader(bdFrag);
      throw new Error('Failed to create backdrop WebGLProgram.');
    }
    gl.attachShader(bdProgram, bdVert);
    gl.attachShader(bdProgram, bdFrag);
    gl.linkProgram(bdProgram);
    gl.deleteShader(bdVert);
    gl.deleteShader(bdFrag);

    if (!gl.getProgramParameter(bdProgram, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(bdProgram) ?? 'unknown link error';
      gl.deleteProgram(bdProgram);
      throw new Error(`Backdrop program link failed: ${log}`);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.gl = gl;
    this.program = program;
    this.vao = vao;
    this.quadVbo = quadVbo;
    this.instanceVbo = instanceVbo;
    this.generativeProgram = genProgram;
    this.generativeVao = genVao;
    this.backdropProgram = bdProgram;

    this.ubBackdropTex = gl.getUniformLocation(bdProgram, 'u_backdropTex');
    this.ubBackdropOpacity = gl.getUniformLocation(bdProgram, 'u_backdropOpacity');

    this.uViewportPx = gl.getUniformLocation(program, 'u_viewportPx');
    this.uCellSizePx = gl.getUniformLocation(program, 'u_cellSizePx');
    this.uAtlasTex = gl.getUniformLocation(program, 'u_atlasTex');
    this.uCrtIntensity = gl.getUniformLocation(program, 'u_crtScanlineIntensity');
    this.uCrtDensity = gl.getUniformLocation(program, 'u_crtScanlineDensity');
    this.uBloomIntensity = gl.getUniformLocation(program, 'u_bloomIntensity');
    this.uBloomThreshold = gl.getUniformLocation(program, 'u_bloomThreshold');

    this.ugAtlasTex = gl.getUniformLocation(genProgram, 'u_atlasTex');
    this.ugFieldTex = gl.getUniformLocation(genProgram, 'u_fieldTex');
    this.ugColorTex = gl.getUniformLocation(genProgram, 'u_colorTex');
    this.ugRampUvRects = gl.getUniformLocation(genProgram, 'u_rampUvRects');
    this.ugViewportPx = gl.getUniformLocation(genProgram, 'u_viewportPx');
    this.ugCellSizePx = gl.getUniformLocation(genProgram, 'u_cellSizePx');
    this.ugGridCols = gl.getUniformLocation(genProgram, 'u_gridCols');
    this.ugRampLen = gl.getUniformLocation(genProgram, 'u_rampLen');
    this.ugFirstRampIsSpace = gl.getUniformLocation(genProgram, 'u_firstRampIsSpace');
    this.ugAllowDirectional = gl.getUniformLocation(genProgram, 'u_allowDirectional');
    this.ugDirectionalMinLum = gl.getUniformLocation(genProgram, 'u_directionalMinLum');
    this.ugInvertFlag = gl.getUniformLocation(genProgram, 'u_invertFlag');
    this.ugColorMode = gl.getUniformLocation(genProgram, 'u_colorMode');
    this.ugFgColor = gl.getUniformLocation(genProgram, 'u_fgColor');
    this.ugBgColor = gl.getUniformLocation(genProgram, 'u_bgColor');
    this.ugCrtIntensity = gl.getUniformLocation(genProgram, 'u_crtScanlineIntensity');
    this.ugCrtDensity = gl.getUniformLocation(genProgram, 'u_crtScanlineDensity');
    this.ugBloomIntensity = gl.getUniformLocation(genProgram, 'u_bloomIntensity');
    this.ugBloomThreshold = gl.getUniformLocation(genProgram, 'u_bloomThreshold');
  }
}
