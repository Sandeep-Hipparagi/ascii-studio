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

  vec2 snappedOrigin = floor(a_cellPos + 0.5);
  vec2 snappedSize = max(vec2(1.0), floor(u_cellSizePx * scale + 0.5));

  vec2 worldPx;
  if ((a_rotationOrFlags & 65536u) != 0u) {
    float angle = (float(a_rotationOrFlags & 0xFFu) / 255.0 - 0.5) * 6.2831853;
    float c = cos(angle);
    float s = sin(angle);
    vec2 centered = (a_corner - 0.5) * snappedSize;
    vec2 rotated = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c);
    worldPx = floor(snappedOrigin + 0.5 * u_cellSizePx + rotated + 0.5);
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

const INITIAL_INSTANCE_CAPACITY = 4096;

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

  private capacity: number;
  private instanceBuffer: ArrayBuffer;
  private f32View: Float32Array;
  private u16View: Uint16Array;
  private u8View: Uint8Array;
  private u32View: Uint32Array;
  private instanceCount = 0;

  private contextLost = false;
  private disposed = false;

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.program = null;
    this.vao = null;
    this.quadVbo = null;
    this.instanceVbo = null;
    this.lastAtlas?.invalidateTexture();
    this.callbacks.onContextLost?.();
  };

  private readonly handleContextRestored = (): void => {
    if (this.disposed) return;
    this.contextLost = false;
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
    }
  ): void {
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

  public dispose(): void {
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);

    const gl = this.gl;
    if (gl && !gl.isContextLost()) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.quadVbo) gl.deleteBuffer(this.quadVbo);
      if (this.instanceVbo) gl.deleteBuffer(this.instanceVbo);
    }

    this.program = null;
    this.vao = null;
    this.quadVbo = null;
    this.instanceVbo = null;
    this.gl = null;
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

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.gl = gl;
    this.program = program;
    this.vao = vao;
    this.quadVbo = quadVbo;
    this.instanceVbo = instanceVbo;

    this.uViewportPx = gl.getUniformLocation(program, 'u_viewportPx');
    this.uCellSizePx = gl.getUniformLocation(program, 'u_cellSizePx');
    this.uAtlasTex = gl.getUniformLocation(program, 'u_atlasTex');
    this.uCrtIntensity = gl.getUniformLocation(program, 'u_crtScanlineIntensity');
    this.uCrtDensity = gl.getUniformLocation(program, 'u_crtScanlineDensity');
    this.uBloomIntensity = gl.getUniformLocation(program, 'u_bloomIntensity');
    this.uBloomThreshold = gl.getUniformLocation(program, 'u_bloomThreshold');
  }
}
