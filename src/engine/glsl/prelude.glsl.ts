/**
 * Shared #version 300 es GLSL prelude injected into every procedural ASCII fragment shader.
 * Includes the StudioFrame std140 UBO, 2D/3D Simplex noise, fBm, curl noise,
 * Bayer 4x4/8x8 dithering, cosine palettes, and linearized Rec. 709 luminance.
 */

export const GLSL_PRELUDE = `#version 300 es
precision highp float;

layout(std140) uniform StudioFrame {
  vec2  u_gridDims;
  vec2  u_cellSize;
  vec2  u_resolution;
  float u_time;
  float u_deltaTime;
  uint  u_seed;
  uint  u_frameIndex;
  vec4  u_audioBands;
  vec4  u_pointer;
  vec4  u_grading; // (brightness, contrast, gamma, reserved)
};

uniform sampler2D u_prevField;
uniform sampler2D u_spectrumTex;

in vec2 v_uv;
layout(location = 0) out vec4 outCellField;
layout(location = 1) out vec4 outCellColor;

vec4 _cellRgbOverride = vec4(0.0);

void emitCellRgb(vec3 rgb) {
  _cellRgbOverride = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}

// --- Modular Arithmetic Helpers ---
vec2 _mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 _mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 _mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 _permute(vec3 x) { return _mod289(((x * 34.0) + 1.0) * x); }
vec4 _permute(vec4 x) { return _mod289(((x * 34.0) + 1.0) * x); }
vec4 _taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

// --- Fast 2D Simplex Noise ---
float snoise2(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
    -0.577350269189626,
    0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = _mod289(i);
  vec3 p = _permute(_permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// --- Fast 3D Simplex Noise ---
float snoise3(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = _mod289(i);
  vec4 p = _permute(
    _permute(
      _permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
      i.y + vec4(0.0, i1.y, i2.y, 1.0)
    ) +
    i.x + vec4(0.0, i1.x, i2.x, 1.0)
  );

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = _taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// --- 4-Octave Fractal Brownian Motion (plus parameterized overloads) ---
float fbm(vec2 p, int octaves, float lacunarity, float gain) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * snoise2(p);
    p *= lacunarity;
    amp *= gain;
  }
  return sum;
}

float fbm(vec2 p) {
  return fbm(p, 4, 2.0, 0.5);
}

float fbm3(vec3 p, int octaves, float lacunarity, float gain) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * snoise3(p);
    p *= lacunarity;
    amp *= gain;
  }
  return sum;
}

// --- 2D Divergence-Free Curl-Noise Vector Field ---
vec2 curlNoise2D(vec2 p, float t) {
  const float eps = 0.01;
  float nUp = snoise3(vec3(p.x, p.y + eps, t));
  float nDn = snoise3(vec3(p.x, p.y - eps, t));
  float nRt = snoise3(vec3(p.x + eps, p.y, t));
  float nLt = snoise3(vec3(p.x - eps, p.y, t));
  float dPsiDy = (nUp - nDn) / (2.0 * eps);
  float dPsiDx = (nRt - nLt) / (2.0 * eps);
  return vec2(dPsiDy, -dPsiDx);
}

// --- Ordered Bayer Dithering Thresholds ---
float bayer4(ivec2 p) {
  int x = p.x & 3;
  int y = p.y & 3;
  int v = 0;
  for (int bit = 2; bit >= 1; bit >>= 1) {
    int rx = (x & bit) != 0 ? 1 : 0;
    int ry = (y & bit) != 0 ? 1 : 0;
    v = (v << 2) | ((rx ^ ry) << 1) | ry;
  }
  return (float(v) + 0.5) / 16.0;
}

float bayer8(ivec2 p) {
  int x = p.x & 7;
  int y = p.y & 7;
  int v = 0;
  for (int bit = 4; bit >= 1; bit >>= 1) {
    int rx = (x & bit) != 0 ? 1 : 0;
    int ry = (y & bit) != 0 ? 1 : 0;
    v = (v << 2) | ((rx ^ ry) << 1) | ry;
  }
  return (float(v) + 0.5) / 64.0;
}

// --- Cosine Color Palette Generator ---
vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return clamp(a + b * cos(6.2831853 * (c * t + d)), 0.0, 1.0);
}

// --- Linearized Rec. 709 Luminance ---
float srgbToLinear(float u) {
  return (u <= 0.04045) ? (u / 12.92) : pow((u + 0.055) / 1.055, 2.4);
}

float luminance709(vec3 srgb) {
  vec3 lin = vec3(srgbToLinear(srgb.r), srgbToLinear(srgb.g), srgbToLinear(srgb.b));
  return dot(lin, vec3(0.2126, 0.7152, 0.0722));
}

float applyGlobalGrading(float lum) {
  float y = clamp(lum, 0.0, 1.0);
  float c = clamp(u_grading.y, -0.99, 1.0) * 255.0;
  float contrastFactor = (259.0 * (c + 255.0)) / (255.0 * (259.0 - c));
  y = clamp((y - 0.5) * contrastFactor + 0.5 + u_grading.x, 0.0, 1.0);
  return clamp(pow(y, 1.0 / max(u_grading.z, 0.05)), 0.0, 1.0);
}
`;
