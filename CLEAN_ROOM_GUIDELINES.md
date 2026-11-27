# Clean-Room Engineering Guidelines — ASCII Studio

**Project:** ASCII Studio (Open-Source WebGL2 / Canvas 2D ASCII Rendering & Generative Art Studio)  
**Scope:** All source code, GLSL shaders, TypeScript modules, React components, documentation, presets, and visual/typographic assets committed to this repository.

---

## 1. Core Legal & Architectural Principle

Copyright protects **original expression** (specific source code, shader implementations, CSS/UI layouts, icons, fonts, sample media, preset catalogs, and copy). Copyright does **not** protect **mathematical formulas, physical/signal-processing models, standard algorithms, or general functional ideas**.

ASCII Studio is developed under a strict **two-phase clean-room firewall**:

1. **Specification Extraction (Analysis Phase):** Any study of prior art, academic literature, or reference applications may produce **only** abstract functional specifications, mathematical equations, data-flow diagrams, and capability requirements recorded in `docs/architecture/`.
2. **Clean Implementation (Authoring Phase):** All production code in `src/` must be authored from scratch using only our written specifications in `docs/architecture/`, public technical standards (e.g., WebGL2 / GLSL ES 3.00, ITU-R colorimetry, peer-reviewed graphics papers), and original engineering judgment.

> **Hard Rule:** Never copy, paste, deobfuscate-and-rename, translate line-by-line, or keep a reference implementation open side-by-side while writing code in `src/`.

---

## 2. Separation of Mathematical Inspiration vs. Protected Expression

| Domain | Permitted Mathematical / Algorithmic Inspiration (Ideas) | Prohibited Protected Content (Expression) |
| :--- | :--- | :--- |
| **Luminance & Color Science** | Standard colorimetry equations: ITU-R BT.601 (`0.299R + 0.587G + 0.114B`), ITU-R BT.709 (`0.2126R + 0.7152G + 0.0722B`), sRGB transfer/linearization functions, Oklab/HSV/HSL color-space transforms, power-law gamma (`x^γ`), linear contrast/exposure scaling. | Proprietary 3D LUT files, vendor-specific color-grading preset tables, copied GLSL tone-mapping functions, or branded palette names/hex sets copied verbatim from another product. |
| **Edge Detection & Spatial Filtering** | Classical discrete convolution kernels: $3\times3$ Sobel ($G_x, G_y$), Scharr, Prewitt, Difference of Gaussians (DoG), separable Gaussian blur, gradient magnitude $\sqrt{G_x^2 + G_y^2}$, and orientation quantization $\theta = \operatorname{atan2}(G_y, G_x)$ into angular glyph bins (`\|`, `-`, `/`, `\`). | Copying exact multi-pass heuristic tuning constants, proprietary threshold schedules, or GLSL function/variable structure from third-party shaders. |
| **Dithering & Quantization** | Recursive Bayer ordered dithering matrices ($2\times2, 4\times4, 8\times8$), classical error-diffusion kernels (Floyd–Steinberg, Atkinson, Stucki, Jarvis–Judice–Ninke), and void-and-cluster blue-noise theory. | Extracting precomputed blue-noise textures/arrays from third-party apps without compatible license provenance, or copying error-diffusion loops verbatim. |
| **Procedural & Generative Fields** | Published mathematical systems: gradient/simplex/value noise, fractional Brownian motion (fBm), domain warping, Gray–Scott reaction–diffusion PDEs, curl-noise divergence-free fields, signed distance functions (SDFs), Conway/elementary cellular automata, wave superposition. | Pasting non-permissive Shadertoy / commercial fragment shaders, copying proprietary preset JSON definitions, or cloning distinctive generative artwork compositions and titles. |
| **Glyph Atlases & Typography** | Standard printable ASCII (`0x20`–`0x7E`), Unicode Box Drawing (`U+2500`–`U+257F`) and Block Elements (`U+2580`–`U+259F`), original programmatic ink-coverage and directional-moment calibration computed at runtime from open-source fonts. | Redistributing commercial/proprietary font files, ripping pre-rendered bitmap glyph atlas textures, or copying curated ASCII art stamps and proprietary character ramps verbatim. |
| **UI, UX & Brand Assets** | General studio ergonomics: central canvas viewport, transport controls, schema-driven parameter inspector, drag-and-drop media loader, export modal. | Copying component trees, Tailwind/CSS stylesheets, design tokens, SVG icons, landing-page copy, brand marks, sample photos/videos, or exact layout geometry. |

---

## 3. Clean-Room Firewall Rules for Contributors & Agents

1. **No Reference Code in `src/`:** Reference repositories, extracted bundles, or scratch analysis artifacts must never reside inside `src/`, `public/`, or `tests/`, and must be excluded from TypeScript/bundler resolution and git commits.
2. **Spec-First Workflow:** Before implementing a new pass or generator, document its inputs, outputs, coordinate space, uniform types, and mathematical definition in `docs/architecture/` citing the **primary mathematical or standards source** (e.g., *Bayer 1973*, *Floyd & Steinberg 1976*, *ITU-R BT.709*).
3. **Original Shader & Kernel Authorship:** Write all GLSL ES 3.00 shaders and Canvas 2D kernels from our own `docs/architecture/` specs using ASCII Studio's uniform conventions, FBO ping-pong patterns, and naming scheme.
4. **Independent Constant Selection:** Where visual thresholds (e.g., edge magnitude cutoffs, DoG radii, Gray–Scott feed/kill ranges) are chosen, derive and tune them empirically against our own test patterns and procedural calibration cards—never copy magic constant tables verbatim.
5. **Original Default Assets:** Any bundled fonts must carry verified permissive/open font licenses (e.g., SIL OFL 1.1) recorded in `THIRD_PARTY_NOTICES.md`. Sample test media should be generated procedurally on the client (test cards, gradients, geometric grids) or be original/CC0 assets with documented provenance.

---

## 4. Dependency & License Policy

- **Permitted Licenses:** `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `Zlib`, `CC0-1.0`, and `OFL-1.1` (for fonts only).
- **Disallowed Without Maintainer Approval:** Copyleft (`GPL-*`, `AGPL-*`), source-available/non-commercial licenses, or unlicensed code snippets (including unattributed snippets from blogs/Shadertoy).
- **Zero-Runtime-Bloat Rule:** Prefer small, self-contained math and WebGL2 helpers in `src/engine/core/` over large opaque third-party graphics frameworks.

---

## 5. Pre-Merge Verification Checklist

Every pull request adding rendering passes, generators, ramps, UI, or assets must confirm:

- [ ] No source code, GLSL, CSS, SVG paths, or binary assets were copied from proprietary or incompatible-license sources.
- [ ] All new algorithms correspond to a mathematical/functional specification in `docs/architecture/`.
- [ ] New character ramps and palette defaults are original or mathematically derived (e.g., sorted by measured glyph ink coverage).
- [ ] Any external font or CC0 asset is logged with license and upstream URL in `THIRD_PARTY_NOTICES.md`.
- [ ] `npm run typecheck`, `npm run lint`, and `npm test` pass with zero errors.
