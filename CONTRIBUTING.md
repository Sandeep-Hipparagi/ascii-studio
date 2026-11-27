# Contributing to ASCII Studio

Thank you for contributing! Every contribution must follow our clean-room policy in [`CLEAN_ROOM_GUIDELINES.md`](./CLEAN_ROOM_GUIDELINES.md)—write original TypeScript and `#version 300 es` GLSL shaders from mathematical principles and never copy proprietary code or assets.

---

## Adding a New Style Plugin (< 50 Lines of TypeScript)

All UI inspector controls are auto-generated from your plugin's `uniformSchema`. Choose either a **Real-Time** kernel (`RealtimeStylePlugin`) or a **Generative** shader/worker (`GenerativeStylePlugin`).

### Option A: Add a GPU Procedural Style (`glsl-fragment`)

1. Create `src/engine/generative/shaders/MyRippleStyle.ts`:

```ts
import type { GlslFragmentStylePlugin } from '../../../registry/types';

export const MyRippleStyle: GlslFragmentStylePlugin = {
  mode: 'generative',
  executionMode: 'glsl-fragment',
  id: 'my-ripple',
  name: 'Radial Ripple',
  category: 'wave-interference',
  description: 'Concentric harmonic ripple field.',
  defaultRamp: 'classic',
  uniformSchema: [
    {
      id: 'freq',
      uniformName: 'u_freq',
      label: 'Frequency',
      kind: 'slider',
      min: 2,
      max: 30,
      step: 0.5,
      default: 12,
    },
  ] as const,
  fragmentBody: `
uniform float u_freq;

vec4 evaluateCell(vec2 cellCoord, vec2 gridDims, float time) {
  vec2 uv = (cellCoord + 0.5) / max(gridDims, vec2(1.0)) - 0.5;
  float r = length(uv);
  float lum = 0.5 + 0.5 * sin(r * u_freq - time * 3.0);
  float angle = atan(uv.y, uv.x);
  return vec4(lum, angle, lum, 1.0);
}
`,
};
```

> Available GLSL helpers injected automatically from `src/engine/glsl/prelude.glsl.ts`: `snoise2`, `snoise3`, `fbm`, `curlNoise2D`, `bayer4`, `bayer8`, `cosinePalette`, `luminance709`, plus `StudioFrame` UBO (`u_gridDims`, `u_cellSize`, `u_resolution`, `u_time`, `u_deltaTime`, `u_seed`, `u_audioBands`, `u_pointer`).

### Option B: Add a Real-Time Kernel (`realtime-kernel`)

Create a `RealtimeStylePlugin` in `src/engine/realtime/styles/` implementing `process({ cols, rows, rgba, params })` and returning `(luminance, angle, paletteIdx, alpha)` in `field: Float32Array` (optionally using shared helpers in `src/engine/realtime/styles/shared.ts`).

### Copy-Paste Starter Templates

- GPU Procedural Generator (`glsl-fragment`): [`docs/examples/CustomGlslGenerator.template.ts`](./docs/examples/CustomGlslGenerator.template.ts)
- Real-Time Media Kernel (`realtime-kernel`): [`docs/examples/CustomRealtimeFilter.template.ts`](./docs/examples/CustomRealtimeFilter.template.ts)

### Register Your Plugin

Import your plugin in `src/registry/index.ts` and register it with `styleRegistry.registerStyle(...)`:

```ts
import { MyRippleStyle } from '../engine/generative/shaders/MyRippleStyle';

styleRegistry.registerStyle(MyRippleStyle);
```

### Verify Before Opening a PR

```bash
npm run typecheck
npm test
npm run build
```
