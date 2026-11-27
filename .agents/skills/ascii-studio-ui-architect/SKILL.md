---
name: ascii-studio-ui-architect
description: Principal Design Systems and Frontend UI architecture skill for building, extending, or auditing ASCII Studio's `/styles` showcase gallery, shared navigation header, `?style=<id>` deep-link routing, style preview cards, and `/` Studio dashboard inspector ergonomics. Use whenever redesigning `src/app/page.tsx`, adding `src/app/styles/page.tsx`, modifying `src/components/studio/*`, or enforcing dark-room design tokens, GPU thumbnail budgets, and Next.js static-export compatibility.
---

# ASCII Studio UI Architect

A deterministic frontend specification for elevating **ASCII Studio** (`src/app/`, `src/components/studio/`, `src/components/styles/`, `src/hooks/useAsciiEngine.ts`) to tactile, hardware-grade clarity across both the **`/styles` Showcase Gallery** and the **`/` Studio Workspace**.

---

## 1. Design Philosophy & Clean-Room Guardrails

### Core Principle
> **The ASCII canvas is the hero; UI chrome is ultra-quiet dark-room hardware.**

Every surface, border hairline, label, and transition exists to calibrate attention toward the rendered glyphs—never to compete with them.

### Structural Lessons (Clean-Room Spatial Synthesis)
1. **Framed Editorial Precision:** Use restrained `1px` vertical rails and horizontal section hairlines inside a deep obsidian void (`#050507` / `#09090b`) to create studio blueprint structure without heavy drop shadows or frosted-glass clutter.
2. **High-Contrast Restraint:** Keep navigation, filters, and card metadata monochrome/neutral zinc (`#f4f4f5`, `#a1a1aa`, `#71717a`). Reserve saturated accents exclusively for active selection states, live telemetry indicators, and primary CTAs (`Launch in Studio ->` / `Export`).
3. **Honest Live Previews:** Every style card in `/styles` shows the actual engine output rendered via our own `StylePlugin` / `AsciiEngine` / offscreen canvas pipeline—never pre-baked marketing screenshots. On Real-Time style cards, hovering or focusing reveals a clean split/wipe or subtle source peek so users immediately see what the filter changes.
4. **Zero-Friction Gallery-to-Studio Handoff:** Clicking any card on `/styles` routes directly to `/?style=<plugin.id>` and mounts that exact `StylePlugin` (`realtime` or `generative`) immediately with zero modal friction.
5. **Mobile-First Canvas Respect:** Below `768px`, never cover the active canvas on load; inspector panels default collapsed (`sidebarOpen = false`), category filter strips scroll horizontally with `snap-x` without breaking page width (`overflow-x: hidden`), and all icon-only controls carry explicit `aria-label` attributes.

### Strict Clean-Room Boundary
- **Allowed:** Adopting structural grid grammar, spacing rhythm, restrained border contrast, monochrome-plus-signal color discipline, and deep-link information architecture.
- **Forbidden:** Copying any third-party HTML/CSS rules, class names, proprietary copy/marketing descriptions, logos, SVGs, external font URLs, or sample CDN image URLs. All artwork, glyphs, UI copy, and sample inputs (`createProceduralSampleCanvas`) must remain 100% original to ASCII Studio.

---

## 2. Design Token & Typography System

### CSS Custom Properties (`src/app/globals.css`)
Notice that `src/app/globals.css` currently sets `overflow: hidden` globally on `html, body`. When introducing scrollable pages like `/styles`, move viewport-locked overflow to the Studio workspace container (`h-dvh overflow-hidden` on `/` only) while keeping `html, body` naturally scrollable (`min-h-full`) with `overflow-x: hidden`.

```css
@import "tailwindcss";

@theme inline {
  --font-mono: var(--font-geist-mono), var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-sans: var(--font-sans-ui), system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

  --color-void: var(--bg-void);
  --color-panel: var(--bg-panel);
  --color-card: var(--bg-card);
  --color-card-hover: var(--bg-card-hover);
  --color-signal: var(--accent-signal);
}

:root {
  color-scheme: dark;

  /* Surface Elevation Steps */
  --bg-void: #050507;        /* Outer gallery void & canvas clear floor */
  --bg-panel: #09090b;       /* Studio chrome, header bar, inspector panel (zinc-950) */
  --bg-card: #111114;        /* Unselected style cards & control wells */
  --bg-card-hover: #18181c;  /* Hover card elevation & active tabs (zinc-900+) */
  --bg-control: #1c1c21;     /* Recessed slider tracks, inputs, pill docks */

  /* 1px Hairline Borders */
  --border-subtle: rgba(39, 39, 42, 0.72);   /* Section dividers & framing rails */
  --border-default: rgba(63, 63, 70, 0.65);  /* Cards & secondary buttons */
  --border-active: rgba(16, 185, 129, 0.55); /* Active selected style / mode */
  --border-focus: rgba(52, 211, 153, 0.90);  /* Keyboard focus rings */

  /* Typography Hierarchy */
  --text-primary: #f4f4f5;   /* Headings, active style names (zinc-100) */
  --text-secondary: #a1a1aa; /* Body copy, uniform labels (zinc-400) */
  --text-muted: #71717a;     /* Eyebrows, shortcuts, parameter units (zinc-500) */

  /* Signal & Telemetry Accents */
  --accent-signal: #10b981;        /* Primary interactive emerald (emerald-500) */
  --accent-signal-text: #6ee7b7;   /* Legible badge/telemetry ink (emerald-300) */
  --accent-signal-soft: rgba(16, 185, 129, 0.12);
}
```

### Typography Scale (`src/app/layout.tsx`)
Pair loaded monospace faces (`JetBrains_Mono` + `Geist_Mono` already configured in `src/app/layout.tsx`) with geometric sans (`Geist` or `Inter` via `next/font/google`, attached as `--font-sans-ui`) for readable editorial copy on `/styles`:

| Role | Font Family | Size / Line-Height | Tracking / Weight | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Page Title (H1)** | `--font-sans` | `text-2xl sm:text-4xl` (`24–36px`) / `1.15` | `tracking-tight`, `font-semibold` | `/styles` editorial hero heading |
| **Section Heading (H2)** | `--font-sans` | `text-lg sm:text-xl` (`18–20px`) / `1.25` | `tracking-tight`, `font-semibold` | Category sections & modal headers |
| **Card Title (H3)** | `--font-sans` | `text-sm` (`14px`) / `1.35` | `font-semibold` | Style cards & inspector summary |
| **Micro Eyebrow** | `--font-mono` | `text-[11px]` (`11px`) / `1.2` | `uppercase tracking-[0.12em]` | `/CURATED STYLES`, `/REAL-TIME` |
| **Telemetry / Readouts** | `--font-mono` | `text-[11px]` (`11px`) / `1.0` | `tabular-nums`, `font-medium` | `60 FPS`, `150 × 53`, slider values |
| **Body / Descriptions** | `--font-sans` | `text-xs sm:text-sm` (`12–14px`) / `1.5` | `font-normal` | Card descriptions & control help |

### Semantic Capability Badges
Badges must reflect **truthful execution hardware** (`StylePlugin` metadata in `src/registry/types.ts`)—never mislabel CPU kernels as WebGL2:

| Style Trait | Badge Label | Token Classes |
| :--- | :--- | :--- |
| `plugin.mode === 'realtime'` (`density`, `dithering`) | `CPU Kernel` | `bg-emerald-500/15 text-emerald-300 border-emerald-500/30` |
| `plugin.mode === 'realtime'` (`edge-detection`) | `CPU Kernel` | `bg-cyan-500/15 text-cyan-300 border-cyan-500/30` |
| `plugin.mode === 'realtime'` (`braille` / `subSampleFactor`) | `Braille 2×4` | `bg-violet-500/15 text-violet-300 border-violet-500/30` |
| `plugin.executionMode === 'glsl-fragment'` (`supportsAudio`) | `Audio-FFT · WebGL2` | `bg-indigo-500/15 text-indigo-300 border-indigo-500/30` |
| `plugin.executionMode === 'glsl-fragment'` | `WebGL2 Shader` | `bg-sky-500/15 text-sky-300 border-sky-500/30` |
| `plugin.executionMode === 'worker-grid'` | `WebWorker` | `bg-amber-500/15 text-amber-300 border-amber-500/30` |

---

## 3. Component Blueprints & Layout Grammar

### Existing Engine & Registry Contracts (Authoritative Interfaces)
All UI components consume metadata strictly from `src/registry/index.ts` and `src/registry/types.ts` without duplicating style lists:
- `styleRegistry.listAllStyles(): readonly StylePlugin[]`
- `listStylesByMode('realtime'): readonly RealtimeStylePlugin[]`
- `listStylesByMode('generative'): readonly GenerativeStylePlugin[]`
- `getStyleById(id: string): StylePlugin | undefined`
- Every `StylePlugin` provides: `id`, `name`, `mode` (`'realtime'` | `'generative'`), `executionMode` (`'realtime-kernel'` | `'glsl-fragment'` | `'worker-grid'`), `category` (`RealtimeCategory` or `GenerativeCategory`), `description`, `defaultRamp`, and `uniformSchema` (with optional `ControlGroup`: `'shape' | 'motion' | 'color' | 'simulation' | 'grading'`).

---

### A. Global Navigation Header (`src/components/studio/HeaderBar.tsx`)
Extract the current `<header>` from `src/app/page.tsx` into a reusable `HeaderBar` shared identically by `/` and `/styles` so cross-route navigation incurs **zero layout shift**:

- **Height & Chrome:** `h-12 shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 flex items-center justify-between`
- **Left Slot (Identity + Primary Route Switcher):**
  - Brand link `<Link href="/">`: `7×7` emerald-bordered `Terminal` icon mark + `ASCII Studio` wordmark + optional `WebGL2` micro-tag (`hidden lg:inline-block`).
  - Route segmented nav (`<nav aria-label="Workspace routes">`):
    - **Studio (`/`):** Interactive workbench icon + `Studio`
    - **Styles (`/styles`):** Grid/Sparkles icon + `Styles` (`N` count badge from `styleRegistry.listAllStyles().length`)
    - Active route receives `bg-zinc-800 text-white border border-zinc-700/70`; inactive receives `text-zinc-400 hover:text-zinc-100`.
- **Right Slot (Context-Aware Hardware Controls):**
  - On `/`: Keyboard legend (`Space: Play/Pause · 1–9: Styles · ⌘/Ctrl+E: Export` on `hidden xl:inline`), plus `Inspector` drawer toggle (`aria-label`, `aria-expanded={sidebarOpen}`).
  - On `/styles`: One primary rectangular/pill CTA (`<Link href="/">Open Studio -></Link>`) with high-contrast styling (`bg-zinc-100 text-zinc-950 hover:bg-white font-semibold` or emerald accent) for instant workspace entry.

---

### B. `/styles` Showcase Page (`src/app/styles/page.tsx`)

#### Structural Layout
- Outer wrapper: `min-h-screen bg-[var(--bg-void)] text-[var(--text-primary)] flex flex-col`
- Framed editorial container: `mx-auto w-full max-w-7xl flex-1 border-x border-[var(--border-subtle)]`
- Divided vertically into 3 quiet hairline bands (`divide-y divide-[var(--border-subtle)]`):
  1. **Editorial Hero Band (`px-4 py-8 sm:px-8 sm:py-10`):**
     - Monospace eyebrow: `/CURATED STYLE REGISTRY`
     - `<h1>`: Clear, non-hype headline (e.g., `"Every filter and shader in ASCII Studio"`)
     - Short 2-line subtitle stating exact engine facts (real-time CPU kernels, GPU fragment shaders, off-thread Web Worker simulations, client-side WebGL2 glyph instancing).
  2. **Sticky Filter & Search Bar (`sticky top-0 z-20 bg-[var(--bg-void)]/95 backdrop-blur-md px-4 py-3 sm:px-8`):**
     - Left/Top row: Horizontally scrollable filter pills (`role="tablist"`, `aria-label="Filter styles by category"`):
       - `All` (`styleRegistry.listAllStyles().length`)
       - `Real-Time Filters` (`realtime` excluding `braille`, or `mode === 'realtime'`)
       - `Generative Shaders` (`glsl-fragment`)
       - `Simulations` (`worker-grid`)
       - `High-Res Unicode` (`category === 'braille'` or directional vector styles)
       - Active filter uses crisp high-contrast inversion (`bg-zinc-100 text-zinc-950 border-zinc-100`); inactive pills use `border-[var(--border-default)] bg-[var(--bg-card)] text-zinc-300 hover:border-zinc-500`. Each pill renders its count in muted `tabular-nums`.
     - Right side (`sm:ml-auto`): Compact monospace search input (`placeholder="Filter styles..."`, `aria-label="Search styles"`) filtering live by `name`, `description`, `category`, or `executionMode`.
  3. **Responsive Gallery Grid (`px-4 py-8 sm:px-8`):**
     - Grid classes: `grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`
     - Empty filter state: centered quiet card with `"No matching styles"` and a one-click `Reset Filters` button.

#### Style Showcase Card (`src/components/styles/StyleCard.tsx`)
Each `<article>` follows a strict vertical rhythm inside `rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] transition-colors hover:border-zinc-500 hover:bg-[var(--bg-card-hover)] flex flex-col overflow-hidden`:

1. **Preview Frame (`aspect-[16/10] relative overflow-hidden border-b border-[var(--border-subtle)] bg-[var(--bg-void)]`):**
   - Renders `<StylePreviewCanvas plugin={plugin} isHovered={isHovered || isFocused} isVisible={isVisible} />`.
   - Top-left overlay badge: semantic capability pill (`CPU Kernel`, `WebGL2 Shader`, `WebWorker`, `Braille 2×4`, `Audio-FFT · WebGL2`).
   - Top-right subtle hover badge (only for `mode === 'realtime'`): `Hover: Source` / `Live ASCII` micro-indicator showing the source comparison affordance on pointer hover or keyboard focus.
2. **Card Body (`p-4 flex flex-1 flex-col justify-between gap-4`):**
   - Header: `<h3 className="text-sm font-semibold text-zinc-100">{plugin.name}</h3>` + monospace category/id metadata line (`{plugin.id} · {plugin.uniformSchema.length} controls`).
   - Description: 2-line clamped concise summary (`line-clamp-2 text-xs leading-relaxed text-zinc-400`).
   - Footer Action Bar (`pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2`):
     - Ramp preview snippet (`font-mono text-[10px] text-zinc-500 truncate max-w-[110px]`, showing `defaultRamp` label or sample chars).
     - Primary launch link (`<Link href={\`/?style=${encodeURIComponent(plugin.id)}\`} aria-label={\`Launch ${plugin.name} in Studio\`} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-100 transition group-hover:border-emerald-500/60 group-hover:bg-emerald-500/15 group-hover:text-emerald-200">Launch in Studio <ArrowRight className="h-3.5 w-3.5" /></Link>`).

#### Live Miniature Thumbnail Renderer (`src/components/styles/StylePreviewCanvas.tsx`)
**CRITICAL GPU BUDGET RULE:** Browsers cap active WebGL contexts (`~8–16` contexts per tab). Launching 9+ separate `WebGL2` contexts on `/styles` will trigger `WebGL context lost` warnings!

To guarantee crisp, zero-error live previews across all cards simultaneously:
- Render lightweight **2D Canvas ASCII thumbnails** (`36 × 18` to `44 × 22` cell grid at `9px–10px` monospace, DPR-scaled cleanly) — OR drive a single shared offscreen renderer — consuming our **actual plugin logic**:
  - **Real-Time plugins (`realtime-kernel`):** Run `plugin.process(...)` once against a cached miniature `createProceduralSampleCanvas('calibration')` / `'rings'` buffer (`~40 × 20` cells -> `< 1ms` CPU cost total!). Draw the styled ASCII frame onto `<canvas>` once; on hover/focus, cross-fade or slide a crisp `clip-path` wipe revealing the original miniature sample pixels underneath.
  - **Worker Simulations (`worker-grid`):** Instantiate `plugin.createSimulation(40, 20, 1337)`, step 40 warm-up iterations on mount for an immediate Turing/coral frame, then advance via `rAF` at `20–30fps` **only while `isVisible && (isHovered || isFocused)`** and `!prefersReducedMotion`.
  - **GLSL Fragment Styles (`glsl-fragment`):** Either render via one shared singleton offscreen WebGL2 preview runner (`PreviewGlslAtlas`) blitting `ctx.drawImage(...)` onto each visible card's 2D canvas on demand, or render deterministic preview evaluations matching the shader's palette/field at thumbnail grid size (`40 × 20`) while animating smoothly **only when `isVisible && (isHovered || isFocused)`**. This keeps active WebGL2 contexts at **1 max** across the entire `/styles` page!

---

### C. Studio Dashboard Workspace (`src/app/page.tsx` & `src/components/studio/`)

1. **Deep-Link Query Hydration (`?style=<id>`):**
   - Never call `useSearchParams()` unwrapped in `src/app/page.tsx` because `next.config` uses static `output: 'export'` and Next 15 fails prerendering without a `<Suspense>` boundary.
   - Instead, either read `?style=` inside a client `useEffect` (`new URLSearchParams(window.location.search).get('style')`) syncing via `setStyle(styleId)` cleanly once `getStyleById(styleId)` validates it, **or** wrap a child client reader inside `<Suspense fallback={null}>` reading `useSearchParams()` and calling `setStyle(...)` when `styleParam` changes.
   - Also validate against `getStyleById(param)`; silently ignore unknown `?style=` values so invalid URLs safely fall back to `'classic-density'`.
2. **Primary Canvas Stage (`StudioViewport.tsx`):**
   - Unobstructed edge-to-edge workspace (`h-full w-full`) with subtle pan/zoom (`0.5×–4×`), top-left telemetry + `100%` zoom reset pills, draggable `Compare` before/after split handle in real-time mode, and floating bottom capsule dock (`Play/Pause`, `Webcam`, `Upload`, `Samples`, `Reset`, `Compare` in real-time or `Audio Mic`/`Drop Audio` in generative, `Export`).
3. **Quick-Switch Sync & Accordion Inspector (`StyleControlsPanel.tsx`):**
   - Top mode tabs (`Real-Time` | `Generative`) + compact preset cards highlighting `snapshot.activeStyleId` and showing a subtle `"Browse all ->"` link (`<Link href="/styles">`) right beside the style grid header.
   - Inspector sub-tabs (`Parameters`, `Type & Color`, `CRT / Grading`) with:
     - **Accordion/Collapsible Control Groups** inside `Parameters`: group controls by `control.group` (`shape`, `motion`, `color`, `simulation`, `grading`) when a plugin exposes >4 controls, keeping the first group expanded and allowing 1-click collapse/expand with crisp chevrons.
     - Per-style **`Reset Style`** button restoring `uniformSchema` defaults and `plugin.defaultRamp`.
4. **Responsive Mobile Behavior (`< 768px`):**
   - `sidebarOpen` starts `false` below `768px` so mobile users land directly on the interactive canvas.
   - When opened on mobile, the inspector converts cleanly to a responsive right drawer or bottom sheet (`max-h-[72dvh]` anchored bottom OR `w-80 max-w-[88vw]` slide-over) with a visible backdrop scrim (`bg-black/60`) that closes on click or `Escape`.

---

## 4. Interaction, Motion & Accessibility Rules

1. **Shared `IntersectionObserver` Budget:**
   - Attach one shared `IntersectionObserver` (`rootMargin: '120px'`, `threshold: 0.1`) across `/styles` cards. Offscreen cards must stop all `requestAnimationFrame` loops immediately (`isVisible = false`).
   - Animate generative card thumbnails on hover/focus (`isHovered || isFocused`) or optionally only the active spotlight card so idle GPU usage remains near `0%`.
2. **`prefers-reduced-motion` Compliance:**
   - Respect `window.matchMedia('(prefers-reduced-motion: reduce)').matches` in both `/styles` preview loops and `/` UI transitions: skip continuous `rAF` thumbnail loops (render one sharp representative frame), remove `animate-pulse` on telemetry dots, and disable hover scale transforms.
3. **Keyboard Navigation:**
   - **`/styles`:** Filter tabs support `ArrowLeft`/`ArrowRight` focus movement; Style grid links use standard `Tab` order plus optional directional `Arrow` grid navigation; visible `focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950`.
   - **`/` Studio:** Preserve `Space` (Play/Pause, ignored when typing in `<input>`/`<select>` or when `ExportModal` is open), `1–9` (quick style switch across all registered styles), `Cmd/Ctrl+E` (toggle Export modal), and `ArrowLeft`/`ArrowRight`/`Home`/`End` on the Before/After split slider (`role="slider"`).
4. **ARIA & Contrast Hygiene:**
   - Every icon-only button (`Reset`, `Play/Pause`, `Webcam`, `Upload`, `Samples`, `Export`, `Compare`, `Inspector`) must carry descriptive `aria-label` and `aria-pressed` / `aria-expanded` where stateful.
   - Maintain WCAG AA text contrast (`>= 4.5:1` for body/labels against `#09090b` / `#111114`; avoid zinc-600 or lower for readable text).

---

## 5. Execution Checklist & Verification Gates

Execute changes in this exact sequence to avoid regressions or Next.js static-export breaks:

1. **Step 1 — Tokens & Scroll Boundaries:**
   - Update `src/app/globals.css` with surface/border/text CSS custom properties and replace global `overflow: hidden` on `html, body` with `overflow-x: hidden; min-height: 100%;`.
   - Ensure `src/app/page.tsx` root wrapper keeps `h-dvh w-screen overflow-hidden` so `/` stays lock-fitted to the viewport.
   - Add `--font-sans-ui` via `next/font/google` in `src/app/layout.tsx` alongside `geistMono` and `jetbrainsMono`.
2. **Step 2 — Shared Header Shell (`src/components/studio/HeaderBar.tsx`):**
   - Extract the top `h-12` bar from `src/app/page.tsx` into `HeaderBar.tsx` supporting active route state (`'/' | '/styles'`), style count pill, and slot props for Studio inspector toggle vs Gallery CTA.
3. **Step 3 — Deep-Link URL Hydration (`src/app/page.tsx` & `src/hooks/useAsciiEngine.ts`):**
   - Resolve `?style=<id>` safely under `output: 'export'` (inside `useEffect` reading `window.location.search` or a `<Suspense>`-wrapped reader) and call `setStyle(styleId)` when `getStyleById(styleId)` exists.
4. **Step 4 — Style Preview & Card Components (`src/components/styles/`):**
   - Implement `StylePreviewCanvas.tsx` (single shared offscreen/2D thumbnail pipeline + shared `IntersectionObserver` + reduced-motion guard; never allocate one `WebGL2` context per card).
   - Implement `StyleCard.tsx` with truthful capability badge, parameter count, clamped description, hover source-compare peek (for `realtime`), and `<Link href="/?style=<id>">Launch in Studio</Link>`.
5. **Step 5 — `/styles` Gallery Page (`src/app/styles/page.tsx`):**
   - Render `HeaderBar`, framed editorial container (`max-w-7xl border-x`), sticky category filter bar with live counts, live search filter, and responsive 1–4 column grid.
6. **Step 6 — Studio Inspector Polish (`src/components/studio/StyleControlsPanel.tsx`):**
   - Add `"All Styles ->"` `<Link href="/styles">` in the style switcher header and collapsible `ControlGroup` accordions in the `Parameters` tab while preserving existing `Reset Style`, ramp sorting, and `CRT / Grading` controls.
7. **Step 7 — Mandatory Verification Gates:**
   - Run `npm run typecheck && npm test && npm run build`:
     - Verify `tsc --noEmit` exits `0`.
     - Verify all Vitest specs pass (`src/engine/__tests__/styles.test.ts`, plus add unit checks if helper utilities are extracted).
     - Verify `next build` statically exports both `/` and `/styles` with zero `useSearchParams` prerender errors.
   - Verify rendered output cleanly in Chromium / REA (`inspect_web_page` + `capture_web_screenshot`) on `/` and `/styles` at **Desktop (`1440×900`)** and **Mobile (`390×844`)**:
     - Confirm `0` console/page errors and `0` WebGL context loss warnings.
     - Confirm horizontal scroll width (`document.documentElement.scrollWidth <= window.innerWidth`) on both viewports.
     - Confirm clicking a card's `Launch in Studio ->` link navigates to `/?style=<id>` and activates that exact `activeStyleId` in telemetry and inspector UI.
