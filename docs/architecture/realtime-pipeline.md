# Real-Time Media-to-ASCII Pipeline — Architectural Specification

**Status:** Clean-Room Architectural Specification  
**Target Stack:** WebGL2 (`#version 300 es`) + Canvas 2D Fallback, TypeScript, Next.js App Router (Client-Side)  
**Compliance:** Authored strictly under [`CLEAN_ROOM_GUIDELINES.md`](../../CLEAN_ROOM_GUIDELINES.md). Mathematical formulations cite primary standards and signal-processing literature; no third-party identifiers, shader source, or implementation structures are reproduced.

---

## 1. Reference Architecture Separation (REA Findings)

Passive browser scenario capture and bundle triage against public client-side web renderers establish a clear architectural boundary between real-time interactive rendering and generative modes:

1. **Real-Time Mode (100% Client-Side):**
   - Switching between real-time ASCII, ordered dithering, and geometric glyph styles triggers **zero server-side compute API requests**. Only static UI thumbnails and font assets are fetched on demand.
   - All pixel sampling, luminance/contrast grading, spatial edge filtering, and glyph compositing execute locally in the browser using **Canvas 2D**, **WebGL2 (`#version 300 es`)**, and **Web Workers** for CPU-side edge-field extraction.
2. **Generative Mode Separation:**
   - In the observed reference application, the "Generative" tab dispatches server-side AI image-to-image jobs gated behind user credits, whereas procedural animated backgrounds (2D Simplex noise, fractional Brownian motion, domain warping, and harmonic wave fields) execute client-side as single-pass WebGL2 fragment shaders.
   - **ASCII Studio Design Decision:** Both our **Real-Time Media** pipeline (`src/engine/realtime/`) and our **Procedural Generative** pipeline (`src/engine/generative/`) will run **100% client-side** on WebGL2/Canvas 2D, guaranteeing zero server compute cost on Vercel Edge/Static hosting.

---

## 2. Input Ingestion & Monospace Grid Downsampling

### 2.1 Media Ingestion & Video Frame Gating

Incoming media (`HTMLImageElement`, `HTMLVideoElement`, `MediaStream`, or procedural test patterns) is normalized onto an offscreen staging surface or uploaded as a `TexImageSource` (`RGBA8` texture):

- **Static Images:** Decoded once into a display-fitted working buffer (`sourceW × sourceH` scaled by device pixel ratio $d_{\text{px}}$). Re-renders occur only upon parameter mutation or viewport resize.
- **Video / Camera Streams:** Synchronized to display refresh via `requestAnimationFrame` and gated by `HTMLVideoElement.requestVideoFrameCallback` where available. If the media decoder has not presented a new video frame since the previous tick and no procedural animation/dither clock is active, frame ingestion is skipped to avoid redundant pixel readbacks.
- **Dynamic Video Downsampling:** When processing live video whose pixel dimensions $(W_{\text{src}}, H_{\text{src}})$ substantially exceed the target character grid $(N_x, N_y)$ (e.g., $W_{\text{src}} > 1.2 N_x$ or $H_{\text{src}} > 1.2 N_y$), ingestion pre-scales the frame to an intermediate sampling resolution close to $(N_x, N_y)$ before pixel readback or filtering. This bounds per-frame CPU memory bandwidth from $O(W_{\text{src}} H_{\text{src}})$ down to $O(N_x N_y)$.

### 2.2 Monospace Cell Geometry & Aspect-Ratio Correction

Monospace glyphs are taller than they are wide. Without aspect correction, mapping square image blocks directly to character cells stretches the output vertically. Given a nominal font height $h_{\text{cell}}$ (in physical pixels, $h_{\text{cell}} = s_{\text{font}} \cdot d_{\text{px}}$) and empirical monospace advance ratio $r_{\text{mono}} \in [0.55, 0.60]$:

$$w_{\text{cell}} = r_{\text{mono}} \cdot h_{\text{cell}}$$

For a target canvas of physical dimensions $(W, H)$, the discrete character grid dimensions $(N_x, N_y)$ are:

$$N_x = \left\lfloor \frac{W}{w_{\text{cell}}} \right\rfloor, \qquad N_y = \left\lfloor \frac{H}{h_{\text{cell}}} \right\rfloor$$

*(Block/mosaic modes that must cover edge partial tiles use $\lceil \cdot \rceil$ instead of $\lfloor \cdot \rfloor$.)*

Each grid cell $(c, r) \in \{0, \dots, N_x - 1\} \times \{0, \dots, N_y - 1\}$ maps to a rectangular footprint in source image space $(W_{\text{img}}, H_{\text{img}})$ via scale factors $\sigma_x = W_{\text{img}} / W$ and $\sigma_y = H_{\text{img}} / H$:

$$\Omega_{c, r} = \left[ c \, w_{\text{cell}} \sigma_x,\; (c + 1) w_{\text{cell}} \sigma_x \right) \times \left[ r \, h_{\text{cell}} \sigma_y,\; (r + 1) h_{\text{cell}} \sigma_y \right)$$

- **GPU Path (WebGL2):** Cell averages are computed either via mipmapped box-filtered `textureLod` sampling at $\text{lod} = \log_2(\max(w_{\text{cell}}\sigma_x, h_{\text{cell}}\sigma_y))$ or a dedicated downsample reduction pass into an $N_x \times N_y$ floating-point/RGBA8 FBO.
- **CPU Fallback Path (Canvas 2D):** A cell value is obtained via a strided sub-sample (e.g., cell center sample or $3 \times 3$ box stride over $\Omega_{c, r}$) to maintain $O(N_x N_y)$ complexity independent of source resolution.

---

## 3. Color-to-Luminance & Feature Extraction

### 3.1 Perceptual Luminance & Colorimetry

Two standard luminance formulations apply depending on color-space assumptions:

1. **Gamma-Encoded Rec. 601 (Fast Integer/Luma Approximation):**
   $$Y_{601} = 0.299 R' + 0.587 G' + 0.114 B'$$

2. **Physically Linear Rec. 709 (Preferred for ASCII Studio):**
   First invert the sRGB companding transfer function per channel $u \in \{R', G', B'\} \subset [0, 1]$:
   $$u_{\text{lin}} = \begin{cases} \dfrac{u}{12.92}, & u \le 0.04045 \\[6pt] \left(\dfrac{u + 0.055}{1.055}\right)^{2.4}, & u > 0.04045 \end{cases}$$
   Then compute linear relative luminance:
   $$Y_{709} = 0.2126 R_{\text{lin}} + 0.7152 G_{\text{lin}} + 0.0722 B_{\text{lin}}$$

### 3.2 Contrast, Brightness, Levels & Dynamic Auto-Stretch

Before glyph indexing, normalized RGB/luminance values undergo linear contrast and brightness grading. Using standard 8-bit centered contrast factor $k_c$ for slider parameter $C \in [-255, 255]$ and normalized brightness bias $\beta \in [-1, 1]$:

$$k_c = \frac{259 \, (C + 255)}{255 \, (259 - C)}, \qquad u_{\text{graded}} = \operatorname{clamp}\!\Big(k_c \cdot (u - 0.5) + 0.5 + \beta,\; 0,\; 1\Big)$$

For power-law midtone gamma $\gamma > 0$ and optional levels clamping $[L_{\text{in,min}}, L_{\text{in,max}}] \to [L_{\text{out,min}}, L_{\text{out,max}}]$:

$$Y_{\text{lvl}} = L_{\text{out,min}} + (L_{\text{out,max}} - L_{\text{out,min}}) \cdot \left[ \operatorname{clamp}\!\left(\frac{Y - L_{\text{in,min}}}{L_{\text{in,max}} - L_{\text{in,min}}},\; 0,\; 1\right) \right]^{1/\gamma}$$

When adaptive shadow clipping / auto-contrast is enabled, a fast strided 256-bin luminance histogram $H[0\dots 255]$ is accumulated across sampled cells to extract empirical lower and upper quantiles $(q_{\text{lo}}, q_{\text{hi}})$ (e.g., $2\text{nd}$ and $98\text{th}$ percentiles) for dynamic range normalization:

$$Y_{\text{norm}} = \operatorname{clamp}\!\left(\frac{Y_{\text{graded}} - q_{\text{lo}}}{\max(q_{\text{hi}} - q_{\text{lo}}, \varepsilon)},\; 0,\; 1\right)$$

If inversion is enabled, $Y_{\text{norm}} \leftarrow 1 - Y_{\text{norm}}$.

### 3.3 Spatial Edge Detection (Sobel / Prewitt) & Orientation Quantization

To preserve crisp structural contours that pure luminance averaging blurs out, a spatial gradient pass runs over the luminance field $Y(x, y)$ (either on a WebGL2 FBO or asynchronously on a dedicated Web Worker):

The discrete $3 \times 3$ **Sobel** convolution kernels are:

$$\mathbf{K}_x = \begin{bmatrix} -1 & 0 & +1 \\ -2 & 0 & +2 \\ -1 & 0 & +1 \end{bmatrix}, \qquad \mathbf{K}_y = \begin{bmatrix} -1 & -2 & -1 \\ 0 & 0 & 0 \\ +1 & +2 & +1 \end{bmatrix}$$

*(Alternatively, Prewitt replaces weights $2$ with $1$ for isotropic box weighting.)*  
Convolving around pixel $(x, y)$ yields directional derivatives $G_x = (\mathbf{K}_x * Y)(x, y)$ and $G_y = (\mathbf{K}_y * Y)(x, y)$, from which gradient magnitude and orientation follow:

$$G(x, y) = \sqrt{G_x^2 + G_y^2}, \qquad \theta(x, y) = \operatorname{atan2}(G_y, G_x) \in (-\pi, \pi]$$

- **Edge-Strength Boosting:** Within each cell $\Omega_{c, r}$, the maximum or RMS ridge magnitude $E_{c, r} = \max_{(x,y) \in \Omega_{c,r}} G(x, y)$ modulates effective brightness/density using a sublinear curve (e.g., $E_{c,r}^{\alpha}$ with $\alpha \in [0.3, 0.4]$) scaled by user edge emphasis $w_e \in [0, 1]$:
  $$Y_{\text{eff}} = \operatorname{clamp}\!\Big(Y_{\text{norm}} + \kappa \, E_{c,r}^{\alpha} \, w_e,\; 0,\; 1\Big)$$
- **Directional Glyph Selection:** When $E_{c,r}$ exceeds an edge threshold $\tau_e$, the quantized orientation bin
  $$b = \left\lfloor \frac{(\theta \bmod \pi)}{\pi / 4} + \frac{1}{2} \right\rfloor \bmod 4 \in \{0, 1, 2, 3\}$$
  selects an oriented stroke glyph (mapping horizontal, $+45^\circ$ diagonal, vertical, and $-45^\circ$ diagonal edges to `|`, `/`, `-`, `\`, accounting for gradient normal $\perp$ tangent).

### 3.4 Ordered Bayer Dithering & Sub-Cell Braille Quantization

For ordered dithering without frame-to-frame temporal flicker, normalized threshold matrices $\mathbf{B}^{(n)}$ of dimension $2^n \times 2^n$ are constructed recursively from $\mathbf{B}^{(1)} = \begin{bmatrix} 0 & 2 \\ 3 & 1 \end{bmatrix}$:

$$\mathbf{B}^{(n)} = \begin{bmatrix} 4\mathbf{B}^{(n-1)} & 4\mathbf{B}^{(n-1)} + 2\mathbf{J} \\ 4\mathbf{B}^{(n-1)} + 3\mathbf{J} & 4\mathbf{B}^{(n-1)} + \mathbf{J} \end{bmatrix}, \qquad T(x, y) = \frac{\mathbf{B}^{(n)}_{y \bmod 2^n,\; x \bmod 2^n} + 0.5}{4^n}$$

For **Unicode Braille (`U+2800`–`U+28FF`)**, each cell is partitioned into a $2 \times 4$ sub-pixel dot matrix. Each sub-sample $(u, v) \in \{0,1\} \times \{0,1,2,3\}$ is compared against an ordered $2\times 4$ threshold; active dots set bit $k \in \{0,\dots,7\}$ according to the Unicode Braille bit layout, yielding codepoint $\text{0x2800} + \sum_{k=0}^{7} b_k 2^k$.

---

## 4. Glyph Mapping & GPU Rendering Strategy

### 4.1 Evaluation of Rendering Backends

| Strategy | Draw Call / Layout Cost | Max 60 FPS Cell Budget | Verdict |
| :--- | :--- | :--- | :--- |
| **DOM Nodes (`<span>` / `<pre>`)** | High layout/style invalidation per frame | ~3,000–6,000 cells | Unsuitable for 60 FPS video/HD |
| **CPU `Canvas2D.fillText`** | Per-cell glyph rasterization + state change | ~5,000–12,000 cells | Fallback only / glow FX path |
| **WebGL2 Instanced Texture Atlas** | Single `drawArraysInstanced` call | **100,000+ cells** | **Primary Real-Time Path** |
| **Shader-Inline Bitpacked Glyphs** | Zero texture lookup (5×5 bitmask in `uint`) | Resolution-independent | Optional retro/forensic shader mode |

### 4.2 Dynamic WebGL2 Instanced Texture-Atlas Architecture

To achieve 60 FPS across high-DPI displays while supporting arbitrary Unicode/ASCII character sets and font sizes:

1. **Lazy Offscreen Atlas Packing:**
   - Maintain a $2048 \times 2048$ `RGBA8` WebGL2 texture (`LINEAR` filtering, `CLAMP_TO_EDGE`, premultiplied alpha).
   - Partition the atlas into uniform padded glyph slots of size $(s_w, s_h) = (\lceil 1.1\, s_{\text{font}} \rceil + 4,\; \lceil 1.3\, s_{\text{font}} \rceil + 4)$, yielding $G_{\text{cols}} = \lfloor 2048 / s_w \rfloor$ slots per row.
   - Maintain a `Map<string, number>` cache mapping glyph strings to slot indices. On cache miss, rasterize the glyph once onto a matching $2048 \times 2048$ 2D canvas with `fillStyle = "#fff"` and mark the atlas dirty for upload (`texImage2D` / `texSubImage2D`) prior to the draw flush.
   - Changing font family or font size invalidates and clears the slot map.

2. **Instanced Quad Submission:**
   - Static unit quad VBO (`[0,0], [1,0], [0,1], [1,1]`) bound at attribute location `0`.
   - Dynamic per-instance `Float32Array` buffer (7 floats = 28 bytes per cell: `x`, `y`, `slotIndex`, `r`, `g`, `b`, `a`) with `vertexAttribDivisor(loc, 1)`.
   - Vertex shader computes NDC position from pixel coordinates and converts `slotIndex` to atlas UV:
     $$\text{col} = \text{slot} \bmod G_{\text{cols}}, \quad \text{row} = \left\lfloor \frac{\text{slot}}{G_{\text{cols}}} \right\rfloor, \quad \mathbf{uv}_{\text{atlas}} = \frac{(\text{col}, \text{row}) + \mathbf{a}_{\text{corner}}}{2048} \cdot (s_w, s_h)$$
   - Fragment shader samples alpha from the atlas (`texture(uAtlas, vUV).a`) and outputs premultiplied color `vec4(vColor.rgb * alpha, alpha)` with `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`.

3. **Character Density Ramp Indexing:**
   Given a character ramp $\mathcal{R} = [g_0, g_1, \dots, g_{L-1}]$ ordered from highest ink coverage to lowest (or vice-versa depending on light/dark polarity), effective scalar $Y_{\text{eff}} \in [0, 1]$ maps deterministically to glyph index:
   $$i = \min\!\Big(L - 1,\; \left\lfloor (1 - Y_{\text{eff}}) \cdot L \right\rfloor\Big)$$
   In pure GPU multi-pass mode, the character ramp itself is sampled directly inside a fullscreen fragment pass from a 1D/packed atlas lookup without CPU per-cell loops, while CPU-side `CellBuffer` readback runs on demand only for `.txt` / ANSI / SVG export.

---

## 5. State Management & 60 FPS Frame Loop Decoupling

To prevent React reconciliation from stalling the render thread during 60 FPS playback or rapid slider scrubbing:

1. **Imperative Engine Store Outside React:**
   - All hot-path state (active media source, `ImageData`/textures, edge buffers, numeric shader/render parameters, animation clocks, and WebGL/Canvas handles) resides in a framework-agnostic store (`src/state/studioStore.ts`).
   - React inspector panels subscribe selectively via `useSyncExternalStore`. UI re-notifications are coalesced with `requestAnimationFrame` so rapid pointer drags never trigger synchronous React tree renders on every input event.

2. **Dual-Mode Frame Scheduler (`useAsciiEngine`):**
   - **Demand-Driven (Static Media, No Motion):** Parameter updates set a pending flag and schedule a single `requestAnimationFrame` render pass, coalescing multiple state edits within the same 16.6 ms vsync window into one draw call.
   - **Continuous Loop (Video, Webcam, Animated Shaders/FX):** A persistent `requestAnimationFrame` loop runs with a monotonic generation token to cancel stale loops immediately on unmount, mode switch, or export hold.
   - **Telemetry Isolation:** Frame time and rolling FPS are written directly to a lightweight readout ref/element once per 1,000 ms rather than calling `setState` every frame.
   - **Export Hold Protocol:** High-resolution PNG/SVG/Video exports pause live `rAF` scheduling, render deterministically at target DPI/timestamp, release GPU/media holds, and resume playback cleanly.
