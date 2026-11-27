# ASCII Studio — Repository Architecture & Directory Structure

## Architectural Boundaries

1. **Pure Engine Isolation (`src/engine/*`):** Zero imports from `react`, `react-dom`, or `next/*`. All WebGL2, Canvas 2D, glyph atlas generation, math, and export routines operate against standard DOM/WebGL2/Canvas2D interfaces (`HTMLCanvasElement`, `OffscreenCanvas`, `WebGL2RenderingContext`, `TexImageSource`) so the engine is framework-agnostic, testable, and reusable.
2. **Registry-Driven Extensibility (`src/registry/*`):** Generative art modules, character ramps, color palettes, and presets declare typed parameter schemas (`slider`, `toggle`, `select`, `color`, `ramp`). The UI inspector auto-generates controls directly from the registry.
3. **Zero-Overhead Vercel Deployment (`src/app/*`):** All rendering, media decoding, and procedural synthesis execute 100% client-side in WebGL2 / Canvas 2D. Next.js App Router compiles to static HTML/JS/CSS served directly from Vercel's Edge CDN without server compute.

---

## Complete Directory Tree

```text
ascii-studio/
├── CLEAN_ROOM_GUIDELINES.md          # Legal/algorithmic clean-room protocol & PR checklist
├── LICENSE                           # Permissive open-source license (MIT / Apache-2.0)
├── THIRD_PARTY_NOTICES.md            # Provenance log for any OFL fonts / CC0 assets
├── README.md                         # Project overview, local dev, Vercel deploy guide
├── next.config.ts                    # Static/edge Next.js config & security headers
├── package.json                      # Minimal deps, strict scripts, Node >=20.9
├── tsconfig.json                     # Strict TypeScript config (WebGL2/DOM, path aliases)
├── postcss.config.mjs                # Build-time Tailwind CSS v4 PostCSS plugin
├── eslint.config.mjs                 # Next.js + TypeScript strict lint rules
├── vitest.config.ts                  # Unit test runner for math, atlas, and registry
│
├── docs/
│   └── architecture/
│       ├── DIRECTORY_STRUCTURE.md    # This document
│       ├── ENGINE_SPEC.md            # Frame graph, FBO lifecycle, WebGL2/Canvas2D parity
│       ├── GLYPH_ATLAS_SPEC.md       # Runtime glyph rasterization, ink & angle metrics
│       ├── REALTIME_PIPELINE_SPEC.md # BT.709, Sobel edges, Bayer/error diffusion, sampling
│       ├── GENERATIVE_PIPELINE_SPEC.md # Seeded PRNG, noise, Gray-Scott, SDFs, CA
│       └── VERCEL_DEPLOYMENT_SPEC.md # Static export & zero-serverless edge architecture
│
├── public/
│   └── fonts/                        # Self-hosted SIL OFL 1.1 monospace fonts (+ OFL.txt)
│
├── src/
│   ├── app/                          # Next.js App Router (statically prerendered shell)
│   │   ├── layout.tsx                # Root layout, font preload, metadata, dark studio shell
│   │   ├── page.tsx                  # Studio entry page
│   │   ├── globals.css               # Design tokens & zero-runtime CSS variables
│   │   ├── icon.svg                  # Original ASCII Studio vector favicon
│   │   ├── robots.ts                 # Static robots.txt route
│   │   └── sitemap.ts                # Static sitemap.xml route
│   │
│   ├── engine/
│   │   ├── core/                     # Shared WebGL2, Canvas 2D, atlas, math & export kernel
│   │   │   ├── types.ts              # RenderBackend, CellBuffer, FrameTiming, StudioParams
│   │   │   ├── capabilities.ts       # WebGL2 extension probing & Canvas 2D fallback selector
│   │   │   ├── gl/
│   │   │   │   ├── context.ts        # WebGL2 init, context-loss recovery, state cache
│   │   │   │   ├── program.ts        # Shader compile/link & uniform location cache
│   │   │   │   ├── framebuffer.ts    # FBO & ping-pong render target pool + resize
│   │   │   │   └── quad.ts           # Fullscreen triangle & instanced cell VAO
│   │   │   ├── atlas/
│   │   │   │   ├── glyphAtlas.ts     # Offscreen Canvas 2D rasterizer -> WebGL2 atlas texture
│   │   │   │   └── ramps.ts          # Density calibration & directional glyph metadata
│   │   │   ├── math/
│   │   │   │   ├── color.ts          # BT.601/BT.709 luminance, sRGB<->linear, Oklab
│   │   │   │   ├── dither.ts         # Recursive Bayer matrices & CPU error-diffusion kernels
│   │   │   │   ├── prng.ts           # Deterministic Mulberry32 / PCG32 seeded PRNG
│   │   │   │   └── vec.ts            # Lightweight vector/matrix helpers
│   │   │   └── export/
│   │   │       ├── textExporter.ts   # UTF-8 plain text, ANSI truecolor, HTML <pre>
│   │   │       ├── imageExporter.ts  # High-DPI PNG/WebP & crisp vector SVG export
│   │   │       └── videoExporter.ts  # Client-side MediaRecorder / WebCodecs capture
│   │   │
│   │   ├── realtime/                 # Media-to-ASCII real-time rendering pipeline
│   │   │   ├── mediaSource.ts        # Image, Video, Webcam, Screen & Test Card adapter
│   │   │   ├── realtimePipeline.ts   # Multi-pass WebGL2 FBO graph + Canvas 2D fallback
│   │   │   ├── passes/
│   │   │   │   ├── preprocessPass.ts # Fit/cover, exposure, contrast, gamma, invert, BT.709
│   │   │   │   ├── sobelPass.ts      # 3x3 Sobel Gx/Gy, magnitude & directional quantization
│   │   │   │   ├── ditherPass.ts     # Ordered Bayer GPU pass & error-diffusion parity
│   │   │   │   ├── cellSamplePass.ts # Grid-cell downsampling & edge/luminance reduction
│   │   │   │   └── asciiCompositePass.ts # Atlas glyph lookup + fg/bg color compositing
│   │   │   └── shaders/              # GLSL ES 3.00 (#version 300 es) TS string modules
│   │   │       ├── fullscreen.vert.ts
│   │   │       ├── luminance.frag.ts
│   │   │       ├── sobel.frag.ts
│   │   │       ├── dither.frag.ts
│   │   │       └── asciiComposite.frag.ts
│   │   │
│   │   └── generative/               # Procedural generative ASCII art engine
│   │       ├── types.ts              # GeneratorModule, GeneratorUniforms, SimState
│   │       ├── generativePipeline.ts # Fixed/variable timestep loop, ping-pong & readback
│   │       ├── fields/
│   │       │   ├── noise.glsl.ts     # Simplex/gradient noise & fBm GLSL helpers
│   │       │   ├── sdf.glsl.ts       # 2D/3D SDF primitives & boolean operators
│   │       │   ├── reactionDiffusion.ts # Gray-Scott PDE ping-pong simulation
│   │       │   ├── flowField.ts      # Divergence-free curl noise & particle advection
│   │       │   ├── cellularAutomata.ts # Conway / rule-based CA state buffer
│   │       │   └── waveInterference.ts # Multi-source harmonic wave field
│   │       └── generators/           # Built-in generative scenes (registered in registry)
│   │           ├── plasmaWave.ts
│   │           ├── grayScottAscii.ts
│   │           ├── curlFlowAscii.ts
│   │           ├── raymarchedSdfAscii.ts
│   │           └── automataLifeAscii.ts
│   │
│   ├── registry/                     # Declarative schemas for modes, ramps, palettes & presets
│   │   ├── types.ts                  # ParamDescriptor & StudioMode metadata types
│   │   ├── generatorRegistry.ts      # Registered generative modules + parameter schemas
│   │   ├── rampRegistry.ts           # Classic, minimal, block, box-drawing & edge ramps
│   │   ├── paletteRegistry.ts        # Monochrome, CRT phosphor, duotone & color modes
│   │   └── presetRegistry.ts         # Curated clean-room default presets
│   │
│   ├── state/                        # Framework bridge between UI & imperative engine
│   │   ├── studioStore.ts            # Lightweight external store (useSyncExternalStore)
│   │   └── useAsciiEngine.ts         # Canvas ref, ResizeObserver, rAF & GPU cleanup hook
│   │
│   └── components/                   # Client UI components (zero math/GL logic)
│       ├── studio/
│       │   ├── AsciiStudioShell.tsx  # Responsive workspace grid (viewport + inspector)
│       │   ├── ViewportCanvas.tsx    # WebGL2/Canvas2D mount, dropzone, pan/zoom
│       │   ├── ModeSwitcher.tsx      # Real-Time Media <-> Generative Art switcher
│       │   └── TransportBar.tsx      # Play/pause, seed reroll, backend & FPS readout
│       ├── controls/
│       │   ├── ParameterPanel.tsx    # Auto-generated controls from registry schemas
│       │   ├── MediaInputPanel.tsx   # File picker, webcam toggle, procedural test card
│       │   ├── RampEditor.tsx        # Ramp selector & custom character sequence editor
│       │   └── PaletteControls.tsx   # Color mode, fg/bg pickers, contrast/gamma/dither
│       ├── export/
│       │   └── ExportModal.tsx       # Copy UTF-8/ANSI; download .txt/.png/.svg/.webm
│       └── ui/                       # Accessible base primitives (Slider, Select, Toggle)
│           ├── Button.tsx
│           ├── Dialog.tsx
│           ├── Select.tsx
│           ├── Slider.tsx
│           └── Toggle.tsx
│
└── tests/
    ├── engine/
    │   ├── math.test.ts              # BT.709, Bayer recursion, PRNG determinism tests
    │   └── atlas.test.ts             # Glyph density ordering & coverage invariant tests
    └── registry/
        └── registry.test.ts          # Schema validation & unique ID integrity tests
```
