# Procedural Generative ASCII Taxonomy & Plugin Contract

**Status:** Clean-Room Architectural Specification  
**Target Stack:** WebGL2 (`#version 300 es`) + Dedicated Web Worker Typed-Array Runtime  
**Contract Source:** [`src/registry/types.ts`](../../src/registry/types.ts)  
**Compliance:** Authored strictly under [`CLEAN_ROOM_GUIDELINES.md`](../../CLEAN_ROOM_GUIDELINES.md).

---

## 1. Mathematical Classification of Procedural ASCII Generators

Every procedural generator in ASCII Studio maps discrete grid cell coordinates $\mathbf{c} = (c_x, c_y) \in [0, N_x) \times [0, N_y)$ and simulation time $t \ge 0$ to a standardized 4-channel cell field:

$$\mathbf{F}(\mathbf{c}, t) = \big(Y,\; \theta,\; \eta,\; \alpha\big) \in [0, 1] \times [-\pi, \pi] \times [0, 1] \times [0, 1]$$

where $Y$ is normalized scalar luminance (glyph density), $\theta$ is local orientation angle in radians (for directional glyph substitution), $\eta$ is palette/hue index, and $\alpha$ is cell opacity. Generators are organized into **five mathematical families**:

---

### Family 1: Simplex / Perlin fBm & Domain-Warped Scalar Fields (`noise-field`)

Continuous multi-scale gradient noise fields evaluated analytically per cell on the GPU (`glsl-fragment`). Given an aspect-corrected coordinate $\mathbf{p} = \frac{\mathbf{c} - 0.5\,\mathbf{N}}{N_y} \cdot s$:

- **Fractional Brownian Motion (fBm):**
  $$F(\mathbf{p}, t) = \sum_{k=0}^{O - 1} g^k \, \mathcal{N}\!\left(\ell^k \mathbf{p} + \mathbf{v}_k t\right)$$
  where $\mathcal{N}: \mathbb{R}^2 \to [-1, 1]$ is 2D Simplex gradient noise, $O \in [1, 8]$ is the octave count, $\ell \approx 2.0$ is lacunarity, and $g \in (0, 1)$ is persistence/gain.

- **Recursive Domain Warping:**
  $$\mathbf{q}(\mathbf{p}, t) = \begin{bmatrix} F_1(\mathbf{p}, t) \\ F_2(\mathbf{p} + \mathbf{d}_1, t) \end{bmatrix}, \quad \mathbf{r}(\mathbf{p}, t) = \begin{bmatrix} F_3(\mathbf{p} + w_1 \mathbf{q} + \mathbf{d}_2, t) \\ F_4(\mathbf{p} + w_1 \mathbf{q} + \mathbf{d}_3, t) \end{bmatrix}$$
  $$f(\mathbf{p}, t) = \frac{1}{2} + \frac{1}{2} F_5(\mathbf{p} + w_2 \mathbf{r}, t)$$
  producing flowing smoke, topographic contours, and marble veining.

- **Directional Gradient Orientation:** Finite-difference gradient over $\mathbf{p} \pm \varepsilon \mathbf{e}_{x,y}$ yields $\theta = \operatorname{atan2}(\partial_y f, \partial_x f)$.

---

### Family 2: Trigonometric Wave Interference & Harmonic Superposition (`wave-interference`)

Analytic periodic fields formed by summing planar and radial oscillators (`glsl-fragment`), well-suited for plasma, moiré interference, and concentric ripple patterns.

- **Damped Multi-Source Radial Interference:**
  For $M$ moving wave emitters $\{\mathbf{s}_i(t)\}_{i=1}^{M}$ with wavenumber $k_i$, angular frequency $\omega_i$, phase $\phi_i$, and spatial attenuation $\lambda \ge 0$:
  $$\Phi(\mathbf{p}, t) = \frac{\sum_{i=1}^{M} w_i(\mathbf{p}, t) \, \sin\!\big(k_i \|\mathbf{p} - \mathbf{s}_i(t)\| - \omega_i t + \phi_i\big)}{\max\!\left(\sum_{i=1}^{M} w_i(\mathbf{p}, t),\; \varepsilon\right)}, \qquad w_i(\mathbf{p}, t) = e^{-\lambda \|\mathbf{p} - \mathbf{s}_i(t)\|}$$

- **Cell Field Mapping:**
  $$Y = \operatorname{clamp}\!\left(\tfrac{1}{2} + \tfrac{1}{2}\Phi(\mathbf{p}, t),\; 0,\; 1\right), \qquad \theta = \operatorname{atan2}\!\left(\frac{\partial \Phi}{\partial y},\; \frac{\partial \Phi}{\partial x}\right)$$

---

### Family 3: Reaction–Diffusion & Stateful Cellular Automata (`reaction-diffusion`)

Discrete coupled PDEs and stateful lattice automata where frame $n+1$ depends on frame $n$. Executed either via CPU typed arrays in a Web Worker (`worker-grid`) or GPU ping-pong FBOs (`usesPingPong: true`).

- **Gray–Scott Reaction–Diffusion PDEs:**
  Two virtual chemical species $(U, V)$ evolve on the $N_x \times N_y$ grid with diffusion rates $(D_u, D_v)$, feed rate $F$, and kill rate $k$:
  $$\frac{\partial U}{\partial t} = D_u \nabla^2 U - U V^2 + F(1 - U)$$
  $$\frac{\partial V}{\partial t} = D_v \nabla^2 V + U V^2 - (F + k) V$$
  Discretized via a 9-point isotropic Laplacian stencil $\nabla^2$ and explicit Euler sub-stepping $\Delta t_{\text{sub}}$ with stability bound $\Delta t_{\text{sub}} \cdot \max(D_u, D_v) \le 0.25$. Cell output maps concentration $Y = \operatorname{clamp}(1 - U + V, 0, 1)$ (or $V / V_{\max}$) and $\theta = \operatorname{atan2}(\partial_y V, \partial_x V)$.

- **Outer-Totalistic Cellular Automata (e.g., Conway / Brian's Brain / Lenia):**
  $$s_{c,r}^{(n+1)} = \delta\!\left(s_{c,r}^{(n)},\; \sum_{(\Delta x, \Delta y) \in \mathcal{N}} \kappa(\Delta x, \Delta y)\, s_{c+\Delta x,\, r+\Delta y}^{(n)}\right)$$
  with temporally smoothed persistence $Y_{c,r}^{(n+1)} = \max\!\big(s_{c,r}^{(n+1)},\; \gamma_{\text{decay}}\, Y_{c,r}^{(n)}\big)$ for phosphor-trail ASCII decay.

---

### Family 4: Divergence-Free Curl-Noise & Vector Flow Fields (`vector-flow`)

Velocity-driven streamline and particle advection systems where glyph orientation directly visualizes vector flow direction.

- **2D Curl of Scalar Stream Potential $\psi(\mathbf{p}, t)$:**
  $$\mathbf{u}(\mathbf{p}, t) = \nabla^\perp \psi = \left(\frac{\partial \psi}{\partial y},\; -\frac{\partial \psi}{\partial x}\right)$$
  By identity, $\nabla \cdot \mathbf{u} = \partial_{xy}\psi - \partial_{yx}\psi = 0$, preventing artificial sinks/sources during particle advection.

- **Lagrangian Particle Advection (`worker-grid`) or Eulerian Field (`glsl-fragment`):**
  Particles integrate $\mathbf{x}_{k+1} = \mathbf{x}_k + \Delta t \, \mathbf{u}(\mathbf{x}_k, t)$ and deposit velocity into a grid accumulation buffer with exponential decay $A_{c,r} \leftarrow \rho A_{c,r}$ ($\rho \in [0.85, 0.99]$):
  $$Y = \operatorname{clamp}\!\left(\frac{\|\mathbf{u}(\mathbf{p}, t)\|}{u_{\text{ref}}},\; 0,\; 1\right) \text{ (or } A_{c,r}\text{)}, \qquad \theta = \operatorname{atan2}(u_y, u_x)$$

---

### Family 5: Audio-FFT Spectral & Harmonic Mapping (`audio-spectral`)

Real-time acoustic energy fields driven by Web Audio `AnalyserNode` short-time Fourier transform (STFT) magnitude bins $X[k, t]$.

- **Log-Frequency Band Compression (Decibel Normalization):**
  Partition FFT bins $k \in [0, N_{\text{FFT}}/2)$ into $B$ logarithmic frequency bands $\mathcal{B}_b$:
  $$S(b, t) = \operatorname{clamp}\!\left(\frac{20 \log_{10}\!\left(\frac{1}{|\mathcal{B}_b|} \sum_{k \in \mathcal{B}_b} |X[k, t]| + \varepsilon\right) - \text{dB}_{\min}}{\text{dB}_{\max} - \text{dB}_{\min}},\; 0,\; 1\right)$$

- **Spatial Mapping Topologies:**
  - *Cartesian Waterfall:* Row $r$ shifts historical spectrum slices $S(c, t - r\,\Delta t)$ downward.
  - *Polar Radial Rings:* Converts cell coordinate to $(r_{\text{polar}}, \phi) = \big(\|\mathbf{p}\|, \operatorname{atan2}(p_y, p_x)\big)$ and samples $S(r_{\text{polar}}, t)$ with angular harmonic modulation.

---

## 2. Unified Plugin Contract (`GenerativeStylePlugin`)

All generative styles register via a single discriminated TypeScript union defined in [`src/registry/types.ts`](../../src/registry/types.ts). No style requires custom React inspector components; the UI dynamically renders controls from `uniformSchema`.

### 2.1 Structural Summary

- **Metadata Fields:**
  - `id`: Stable kebab-case identifier (e.g., `'simplex-smoke'`, `'gray-scott'`).
  - `name`: Display name in the Studio gallery.
  - `category`: One of the five families (`'noise-field' | 'wave-interference' | 'reaction-diffusion' | 'vector-flow' | 'audio-spectral'`).
  - `description`: Short summary of the mathematical mechanism.
  - `defaultRamp`: Default character ramp ID (`'classic'`, `'blocks'`, `'braille'`, `'directional'`, etc.) or custom glyph sequence.
  - `supportsDirectionalGlyphs` / `supportsAudio`: Capability hints for the compositor and audio router.
- **Declarative `uniformSchema`:**
  Array of `UniformControlSchema` entries supporting five strongly typed primitives:
  - `'slider'` (`min`, `max`, `step`, `default`, optional `unit`)
  - `'color'` (`default` hex `#rrggbb`)
  - `'select'` (`options: { value, label }[]`, `default`)
  - `'toggle'` (`default` boolean)
  - `'vec2'` (`min`, `max`, `step`, `default` 2-tuples)
- **Dual Execution Modes:**
  1. `'glsl-fragment'`: Compiles `fragmentBody` inside the WebGL2 cell-evaluation wrapper. Optionally sets `usesPingPong: true` to read the prior frame's `RGBA16F` cell buffer via `u_prevField`.
  2. `'worker-grid'`: Runs `createSimulation(cols, rows, seed)` inside a dedicated Web Worker at `fixedTimestepHz`, writing `Float32Array` `[luminance, gradientAngle, hueOrPaletteIndex, alpha]` tuples per cell.

Both modes converge on the exact same `Nx × Ny` 4-channel cell representation consumed by the instanced Glyph Atlas pass and text/SVG exporters.

---

## 3. GLSL ES 3.00 Entrypoint Contract

Every `'glsl-fragment'` plugin is injected into a standardized `#version 300 es` host shader. The host binds a shared `std140` Uniform Buffer Object (`StudioFrame`), optional feedback/spectral textures, and built-in noise/color utilities before invoking `evaluateCell`.

### 3.1 Host Uniform Block & Standard Samplers

```glsl
#version 300 es
precision highp float;

layout(std140) uniform StudioFrame {
  vec2  u_gridDims;    // (cols, rows) of the discrete ASCII cell grid
  vec2  u_cellSize;    // (cellWidthPx, cellHeightPx) in physical pixels
  vec2  u_resolution;  // (canvasWidthPx, canvasHeightPx)
  float u_time;        // Elapsed studio clock in seconds
  float u_deltaTime;   // Frame delta in seconds (clamped <= 0.1)
  uint  u_seed;        // Deterministic 32-bit generator seed
  uint  u_frameIndex;  // Monotonic frame counter
  vec4  u_audioBands;  // (subBass, bass, mid, treble) normalized [0..1]
  vec4  u_pointer;     // (normX, normY, downFlag, speed)
};

uniform sampler2D u_prevField;    // Prior frame cell buffer (when usesPingPong = true)
uniform sampler2D u_spectrumTex;  // 1 x N_bands R32F/R8 audio FFT row (when supportsAudio = true)

in vec2 v_uv;          // Fullscreen quad UV in [0..1]^2
out vec4 outCellField; // RGBA16F cell output: (luminance, gradientAngle, hueOrPaletteIndex, alpha)
```

### 3.2 Plugin Entrypoint Signature

Every procedural fragment plugin **must** implement:

```glsl
vec4 evaluateCell(vec2 cellCoord, vec2 gridDims, float time);
```

- **Inputs:**
  - `cellCoord`: Cell-center integer/half-integer index `floor(v_uv * u_gridDims)` $\in [0, N_x - 1] \times [0, N_y - 1]$.
  - `gridDims`: `u_gridDims` $(N_x, N_y)$.
  - `time`: `u_time` in seconds.
- **Output (`vec4`):**
  - `.r` (`luminance`): Scalar density in $[0.0, 1.0]$ used to index the active character ramp (or Braille dot threshold).
  - `.g` (`gradientAngle`): Orientation angle $\theta \in [-\pi, \pi]$ in radians; consumed when `supportsDirectionalGlyphs` is active to select directional strokes (`|`, `/`, `-`, `\`).
  - `.b` (`hueOrPaletteIndex`): Normalized $[0.0, 1.0]$ palette lookup or hue coordinate for the active color mode.
  - `.a` (`alpha`): Cell coverage/opacity in $[0.0, 1.0]$; cells with $\alpha \le 0$ are culled from the instanced draw list.

### 3.3 Host Wrapper Invocation & Atlas Handoff

The host shader wraps each plugin cleanly:

```glsl
// --- Host-injected prelude (StudioFrame UBO + 2D/3D simplex/hash helpers) ---
// ...

// --- Plugin-supplied uniforms + evaluateCell(...) ---
// <plugin.fragmentBody>

void main() {
  vec2 cellCoord = floor(v_uv * u_gridDims);
  vec4 cell = evaluateCell(cellCoord, u_gridDims, u_time);
  outCellField = vec4(
    clamp(cell.r, 0.0, 1.0),
    cell.g,
    clamp(cell.b, 0.0, 1.0),
    clamp(cell.a, 0.0, 1.0)
  );
}
```

**Handoff to the Instanced Glyph Atlas:**  
Because `outCellField` is rendered into an $N_x \times N_y$ `RGBA16F` FBO, the downstream Glyph Atlas pass launches a single `gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Nx * Ny)` draw call. Using `gl_InstanceID`, the vertex shader fetches `texelFetch(u_cellField, ivec2(col, row), 0)` directly on the GPU—requiring **zero CPU readback** during normal 60 FPS playback, while preserving optional `readPixels` / worker buffer export for `.txt`, ANSI, and `.svg` downloads.
