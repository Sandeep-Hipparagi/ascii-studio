/**
 * Central Style & Palette Registry for ASCII Studio.
 * Registers all built-in real-time and procedural generative style plugins
 * and extracts typed default parameters directly from `uniformSchema`.
 */

import { DomainWarpedPlasma } from '../engine/generative/shaders/DomainWarpedPlasma';
import { HarmonicInterference } from '../engine/generative/shaders/HarmonicInterference';
import { SimplexFlowField } from '../engine/generative/shaders/SimplexFlowField';
import { ReactionDiffusionStyle } from '../engine/generative/ReactionDiffusionStyle';
import { BayerDitherStyle } from '../engine/realtime/styles/BayerDitherStyle';
import { BrailleHighResStyle } from '../engine/realtime/styles/BrailleHighResStyle';
import { ClassicDensityStyle } from '../engine/realtime/styles/ClassicDensityStyle';
import { SobelEdgeStyle } from '../engine/realtime/styles/SobelEdgeStyle';
import type {
  ColorPalettePreset,
  GenerativeStylePlugin,
  RealtimeStylePlugin,
  StyleMode,
  StylePlugin,
  UniformValue,
} from './types';

export * from './types';

export const COLOR_PALETTE_PRESETS: readonly ColorPalettePreset[] = [
  {
    id: 'source',
    name: 'Source Color',
    colorMode: 'source',
    fgRgba: [240, 245, 240, 255],
    bgRgba: [10, 12, 14, 255],
    accentHex: '#e2e8f0',
  },
  {
    id: 'phosphor-green',
    name: 'Phosphor Green',
    colorMode: 'monochrome',
    fgRgba: [74, 246, 118, 255],
    bgRgba: [6, 16, 9, 255],
    accentHex: '#4af676',
  },
  {
    id: 'amber-crt',
    name: 'Amber CRT',
    colorMode: 'monochrome',
    fgRgba: [255, 176, 46, 255],
    bgRgba: [18, 11, 4, 255],
    accentHex: '#ffb02e',
  },
  {
    id: 'matrix',
    name: 'Matrix',
    colorMode: 'duotone',
    fgRgba: [0, 255, 65, 255],
    bgRgba: [3, 12, 5, 255],
    accentHex: '#00ff41',
  },
  {
    id: 'nord',
    name: 'Nord',
    colorMode: 'duotone',
    fgRgba: [136, 192, 208, 255],
    bgRgba: [46, 52, 64, 255],
    accentHex: '#88c0d0',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    colorMode: 'duotone',
    fgRgba: [255, 56, 168, 255],
    bgRgba: [14, 10, 32, 255],
    accentHex: '#ff38a8',
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    colorMode: 'monochrome',
    fgRgba: [245, 245, 245, 255],
    bgRgba: [10, 10, 12, 255],
    accentHex: '#f5f5f5',
  },
] as const;

export function getPaletteById(id: string): ColorPalettePreset | undefined {
  return COLOR_PALETTE_PRESETS.find((p) => p.id === id);
}

function getPluginMode(plugin: StylePlugin): StyleMode {
  return plugin.mode === 'realtime' ? 'realtime' : 'generative';
}

export class StyleRegistry {
  private static instance: StyleRegistry | null = null;
  private readonly plugins = new Map<string, StylePlugin>();

  private constructor() {}

  public static getInstance(): StyleRegistry {
    if (!StyleRegistry.instance) {
      StyleRegistry.instance = new StyleRegistry();
    }
    return StyleRegistry.instance;
  }

  public registerStyle(plugin: StylePlugin): this {
    if (!plugin.id.trim()) {
      throw new Error('Cannot register style plugin with empty id.');
    }
    if (!plugin.defaultRamp || plugin.defaultRamp.length === 0) {
      throw new Error(`Style plugin "${plugin.id}" must declare a non-empty defaultRamp.`);
    }
    this.plugins.set(plugin.id, plugin);
    return this;
  }

  public getStyleById(id: string): StylePlugin | undefined {
    return this.plugins.get(id);
  }

  public listAllStyles(): readonly StylePlugin[] {
    return Array.from(this.plugins.values());
  }

  public listStylesByMode(mode: 'realtime'): readonly RealtimeStylePlugin[];
  public listStylesByMode(mode: 'generative'): readonly GenerativeStylePlugin[];
  public listStylesByMode(mode: StyleMode): readonly StylePlugin[];
  public listStylesByMode(mode: StyleMode): readonly StylePlugin[] {
    return Array.from(this.plugins.values()).filter(
      (plugin) => getPluginMode(plugin) === mode
    );
  }

  public getDefaultParams(
    pluginOrId: StylePlugin | string
  ): Record<string, UniformValue> {
    const plugin =
      typeof pluginOrId === 'string' ? this.getStyleById(pluginOrId) : pluginOrId;
    if (!plugin) {
      throw new Error(`Unknown style plugin: "${String(pluginOrId)}"`);
    }

    const defaults: Record<string, UniformValue> = {};
    for (const control of plugin.uniformSchema) {
      defaults[control.id] = control.default;
    }
    return defaults;
  }
}

export const styleRegistry = StyleRegistry.getInstance();

// Register built-in Phase 3 styles (4 Real-Time + 4 Generative)
styleRegistry
  .registerStyle(ClassicDensityStyle)
  .registerStyle(SobelEdgeStyle)
  .registerStyle(BayerDitherStyle)
  .registerStyle(BrailleHighResStyle)
  .registerStyle(SimplexFlowField)
  .registerStyle(HarmonicInterference)
  .registerStyle(DomainWarpedPlasma)
  .registerStyle(ReactionDiffusionStyle);

export function registerStyle(plugin: StylePlugin): StyleRegistry {
  return styleRegistry.registerStyle(plugin);
}

export function getStyleById(id: string): StylePlugin | undefined {
  return styleRegistry.getStyleById(id);
}

export function listStylesByMode(mode: 'realtime'): readonly RealtimeStylePlugin[];
export function listStylesByMode(mode: 'generative'): readonly GenerativeStylePlugin[];
export function listStylesByMode(mode: StyleMode): readonly StylePlugin[];
export function listStylesByMode(mode: StyleMode): readonly StylePlugin[] {
  return styleRegistry.listStylesByMode(mode);
}

export function getDefaultParams(
  pluginOrId: StylePlugin | string
): Record<string, UniformValue> {
  return styleRegistry.getDefaultParams(pluginOrId);
}
