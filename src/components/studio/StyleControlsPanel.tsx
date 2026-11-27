'use client';

import React, { useMemo, useState } from 'react';
import { Sliders, Sparkles, Monitor, ArrowUpDown, Palette, Tv } from 'lucide-react';

import type {
  AsciiEngineSnapshot,
  AtlasFilterMode,
  MediaGradingParams,
  PaletteConfig,
  PostFxUniforms,
} from '../../engine/core/types';
import {
  COLOR_PALETTE_PRESETS,
  listStylesByMode,
} from '../../registry';
import type {
  StyleMode,
  StylePlugin,
  UniformControl,
  UniformValue,
} from '../../registry/types';

export interface StyleControlsPanelProps {
  readonly snapshot: AsciiEngineSnapshot;
  readonly onSelectStyle: (styleId: string) => void;
  readonly onUpdateUniform: (id: string, value: UniformValue) => void;
  readonly onSetFontSize: (px: number) => void;
  readonly onSetFilterMode: (mode: AtlasFilterMode) => void;
  readonly onSetRamp: (ramp: string, sortByDensity?: boolean) => void;
  readonly onSortRampByVisualDensity: () => string;
  readonly onSetGrading: (partial: Partial<MediaGradingParams>) => void;
  readonly onSetPalette: (partial: Partial<PaletteConfig>) => void;
  readonly onSetPostFx: (partial: Partial<PostFxUniforms>) => void;
}

const RAMP_OPTIONS = [
  { id: 'classic', label: 'Standard', value: ' .:-=+*#%@' },
  {
    id: 'dense',
    label: 'Dense (70)',
    value: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  },
  { id: 'minimal', label: 'Minimal', value: ' .:+*#@' },
  { id: 'blocks', label: 'Blocks', value: ' ░▒▓█' },
  { id: 'directional', label: 'Directional', value: ' .-|/\\+*' },
] as const;

function getPluginBadge(plugin: StylePlugin): { label: string; tone: string } {
  if (plugin.mode === 'realtime') {
    if (plugin.category === 'braille') {
      return { label: 'Braille', tone: 'bg-violet-500/15 text-violet-300 border-violet-500/30' };
    }
    if (plugin.category === 'edge-detection') {
      return { label: 'Edge', tone: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' };
    }
    return { label: 'WebGL2', tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
  }
  if (plugin.executionMode === 'worker-grid') {
    return { label: 'Worker', tone: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
  }
  return { label: 'WebGL2', tone: 'bg-sky-500/15 text-sky-300 border-sky-500/30' };
}

export function StyleControlsPanel({
  snapshot,
  onSelectStyle,
  onUpdateUniform,
  onSetFontSize,
  onSetFilterMode,
  onSetRamp,
  onSortRampByVisualDensity,
  onSetGrading,
  onSetPalette,
  onSetPostFx,
}: StyleControlsPanelProps) {
  const [selectedMode, setSelectedMode] = useState<StyleMode>(
    snapshot.sourceKind === 'generative' ? 'generative' : 'realtime'
  );
  const [customRampDraft, setCustomRampDraft] = useState<string>(snapshot.ramp);
  const [activeDrawer, setActiveDrawer] = useState<'style' | 'typography' | 'postfx'>('style');

  const realtimeStyles = useMemo(() => listStylesByMode('realtime'), []);
  const generativeStyles = useMemo(() => listStylesByMode('generative'), []);

  const currentMode: StyleMode =
    snapshot.sourceKind === 'generative' ? 'generative' : selectedMode;
  const visibleStyles = currentMode === 'realtime' ? realtimeStyles : generativeStyles;

  const activePlugin = useMemo(() => {
    const all = [...realtimeStyles, ...generativeStyles];
    return all.find((p) => p.id === snapshot.activeStyleId) ?? visibleStyles[0] ?? null;
  }, [generativeStyles, realtimeStyles, snapshot.activeStyleId, visibleStyles]);

  const activeParamValues =
    snapshot.sourceKind === 'generative'
      ? snapshot.generativeParams
      : snapshot.realtimeParams;

  const handleModeSwitch = (mode: StyleMode) => {
    setSelectedMode(mode);
    const list = mode === 'realtime' ? realtimeStyles : generativeStyles;
    const first = list[0];
    if (first && snapshot.activeStyleId !== first.id) {
      onSelectStyle(first.id);
    }
  };

  return (
    <aside className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100 select-none">
      {/* Top Mode Switcher */}
      <div className="border-b border-zinc-800/80 p-3">
        <div
          role="tablist"
          aria-label="Rendering mode"
          className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-900 p-1 border border-zinc-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={currentMode === 'realtime'}
            onClick={() => handleModeSwitch('realtime')}
            className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              currentMode === 'realtime'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Monitor className="h-3.5 w-3.5" />
            Real-Time
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={currentMode === 'generative'}
            onClick={() => handleModeSwitch('generative')}
            className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              currentMode === 'generative'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Generative
          </button>
        </div>

        {/* Style Cards */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {visibleStyles.map((plugin) => {
            const isActive = snapshot.activeStyleId === plugin.id;
            const badge = getPluginBadge(plugin);
            return (
              <button
                key={plugin.id}
                type="button"
                onClick={() => onSelectStyle(plugin.id)}
                className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition ${
                  isActive
                    ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-1">
                  <span className="truncate text-xs font-semibold">{plugin.name}</span>
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.tone}`}
                  >
                    {badge.label}
                  </span>
                </div>
                <span className="line-clamp-2 text-[11px] leading-tight text-zinc-400">
                  {plugin.category}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Inspector Sub-Tabs */}
      <div className="flex border-b border-zinc-800/80 px-3 pt-2 gap-1 text-xs">
        <button
          type="button"
          onClick={() => setActiveDrawer('style')}
          className={`flex items-center gap-1.5 border-b-2 px-2.5 py-2 font-medium transition ${
            activeDrawer === 'style'
              ? 'border-emerald-400 text-white'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          Parameters
        </button>
        <button
          type="button"
          onClick={() => setActiveDrawer('typography')}
          className={`flex items-center gap-1.5 border-b-2 px-2.5 py-2 font-medium transition ${
            activeDrawer === 'typography'
              ? 'border-emerald-400 text-white'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Palette className="h-3.5 w-3.5" />
          Type &amp; Color
        </button>
        <button
          type="button"
          onClick={() => setActiveDrawer('postfx')}
          className={`flex items-center gap-1.5 border-b-2 px-2.5 py-2 font-medium transition ${
            activeDrawer === 'postfx'
              ? 'border-emerald-400 text-white'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Tv className="h-3.5 w-3.5" />
          CRT / Grading
        </button>
      </div>

      {/* Scrollable Inspector Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {activeDrawer === 'style' && activePlugin && (
          <div className="space-y-3">
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
              <div className="text-xs font-semibold text-zinc-200">{activePlugin.name}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                {activePlugin.description}
              </p>
            </div>

            {activePlugin.uniformSchema.map((control) => (
              <UniformControlField
                key={`${activePlugin.id}:${control.id}`}
                control={control}
                value={activeParamValues[control.id] ?? control.default}
                onChange={(val) => onUpdateUniform(control.id, val)}
              />
            ))}
          </div>
        )}

        {activeDrawer === 'typography' && (
          <div className="space-y-4">
            {/* Font Size / Grid Density */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="studio-font-size" className="text-zinc-300 font-medium">
                  Cell Size (Grid: {snapshot.cols}×{snapshot.rows})
                </label>
                <span className="font-mono text-zinc-400">{snapshot.fontSize}px</span>
              </div>
              <input
                id="studio-font-size"
                type="range"
                min={6}
                max={28}
                step={0.5}
                value={snapshot.fontSize}
                onDoubleClick={() => onSetFontSize(12)}
                onChange={(e) => onSetFontSize(parseFloat(e.target.value))}
                className="w-full accent-emerald-400"
              />
            </div>

            {/* Atlas Filtering */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-300 font-medium">Atlas Filtering</span>
              <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-900 p-0.5">
                {(['linear', 'nearest'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onSetFilterMode(mode)}
                    className={`rounded px-2 py-1 text-[11px] font-medium capitalize transition ${
                      snapshot.filterMode === mode
                        ? 'bg-zinc-700 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Character Ramp Selector & Density Sort */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300 font-medium">Character Ramp</span>
                <button
                  type="button"
                  onClick={() => {
                    onSetRamp(customRampDraft, false);
                    const sorted = onSortRampByVisualDensity();
                    if (sorted) setCustomRampDraft(sorted);
                  }}
                  className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-emerald-300 hover:border-emerald-500/50"
                >
                  <ArrowUpDown className="h-3 w-3" />
                  Sort by Visual Density
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {RAMP_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setCustomRampDraft(opt.value);
                      onSetRamp(opt.value, false);
                    }}
                    className={`rounded border px-2 py-1 text-[11px] transition ${
                      snapshot.ramp === opt.value
                        ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                aria-label="Custom character ramp"
                value={customRampDraft}
                onChange={(e) => {
                  setCustomRampDraft(e.target.value);
                  if (e.target.value.length > 0) {
                    onSetRamp(e.target.value, false);
                  }
                }}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                placeholder=" .:-=+*#%@"
              />
            </div>

            {/* Color Palette Presets */}
            <div className="space-y-2">
              <span className="block text-xs font-medium text-zinc-300">
                Color Palette Preset
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {COLOR_PALETTE_PRESETS.map((preset) => {
                  const selected =
                    snapshot.palette.colorMode === preset.colorMode &&
                    snapshot.palette.fgRgba[0] === preset.fgRgba[0] &&
                    snapshot.palette.fgRgba[1] === preset.fgRgba[1] &&
                    snapshot.palette.bgRgba[0] === preset.bgRgba[0];

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        onSetPalette({
                          colorMode: preset.colorMode,
                          fgRgba: preset.fgRgba,
                          bgRgba: preset.bgRgba,
                        })
                      }
                      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition ${
                        selected
                          ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      <span
                        className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/20"
                        style={{ backgroundColor: preset.accentHex }}
                      />
                      <span className="truncate">{preset.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeDrawer === 'postfx' && (
          <div className="space-y-4">
            <div className="space-y-3 border-b border-zinc-800/80 pb-3">
              <div className="text-xs font-semibold text-zinc-300">Tone &amp; Grading</div>
              <SimpleSlider
                label="Brightness"
                value={snapshot.grading.brightness}
                min={-0.5}
                max={0.5}
                step={0.02}
                defaultValue={0}
                onChange={(v) => onSetGrading({ brightness: v })}
              />
              <SimpleSlider
                label="Contrast"
                value={snapshot.grading.contrast}
                min={-0.9}
                max={0.9}
                step={0.02}
                defaultValue={0}
                onChange={(v) => onSetGrading({ contrast: v })}
              />
              <SimpleSlider
                label="Gamma"
                value={snapshot.grading.gamma}
                min={0.3}
                max={2.5}
                step={0.05}
                defaultValue={1.0}
                onChange={(v) => onSetGrading({ gamma: v })}
              />
            </div>

            <div className="space-y-3">
              <div className="text-xs font-semibold text-zinc-300">CRT &amp; Phosphor FX</div>
              <SimpleSlider
                label="CRT Scanlines"
                value={snapshot.postFx.crtScanlineIntensity}
                min={0}
                max={0.85}
                step={0.02}
                defaultValue={0}
                onChange={(v) => onSetPostFx({ crtScanlineIntensity: v })}
              />
              <SimpleSlider
                label="Scanline Density"
                value={snapshot.postFx.crtScanlineDensity}
                min={0.5}
                max={3.5}
                step={0.1}
                defaultValue={1.5}
                onChange={(v) => onSetPostFx({ crtScanlineDensity: v })}
              />
              <SimpleSlider
                label="Phosphor Bloom"
                value={snapshot.postFx.bloomIntensity}
                min={0}
                max={1.5}
                step={0.05}
                defaultValue={0}
                onChange={(v) => onSetPostFx({ bloomIntensity: v })}
              />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

// --- Schema-Driven Uniform Field Renderer ---

function UniformControlField({
  control,
  value,
  onChange,
}: {
  readonly control: UniformControl;
  readonly value: UniformValue;
  readonly onChange: (value: UniformValue) => void;
}) {
  switch (control.kind) {
    case 'slider': {
      const numVal = typeof value === 'number' ? value : control.default;
      return (
        <SimpleSlider
          label={control.label}
          value={numVal}
          min={control.min}
          max={control.max}
          step={control.step}
          defaultValue={control.default}
          unit={control.unit}
          onChange={onChange}
        />
      );
    }

    case 'toggle': {
      const boolVal = typeof value === 'boolean' ? value : control.default;
      return (
        <div className="flex items-center justify-between py-1">
          <span className="text-xs font-medium text-zinc-300">{control.label}</span>
          <button
            type="button"
            role="switch"
            aria-checked={boolVal}
            aria-label={control.label}
            onClick={() => onChange(!boolVal)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              boolVal ? 'bg-emerald-500' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                boolVal ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      );
    }

    case 'select': {
      const strVal = typeof value === 'string' ? value : control.default;
      if (control.options.length <= 4) {
        return (
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-zinc-300">
              {control.label}
            </span>
            <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
              {control.options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange(opt.value)}
                  className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition ${
                    strVal === opt.value
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        );
      }

      return (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-zinc-300">
            {control.label}
          </label>
          <select
            value={strVal}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
          >
            {control.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );
    }

    case 'color': {
      const colorVal = typeof value === 'string' ? value : control.default;
      return (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-zinc-300">{control.label}</span>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              aria-label={`${control.label} swatch`}
              value={colorVal}
              onChange={(e) => onChange(e.target.value)}
              className="h-6 w-7 cursor-pointer rounded border border-zinc-700 bg-transparent p-0"
            />
            <input
              type="text"
              aria-label={`${control.label} hex`}
              value={colorVal}
              onChange={(e) => onChange(e.target.value)}
              className="w-20 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-200"
            />
          </div>
        </div>
      );
    }

    case 'vec2': {
      const vecVal = Array.isArray(value) ? value : control.default;
      const vx = Number(vecVal[0] ?? control.default[0]);
      const vy = Number(vecVal[1] ?? control.default[1]);
      return (
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-zinc-300">
            {control.label}
          </span>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs">
              <span className="text-zinc-500">X</span>
              <input
                type="number"
                min={control.min[0]}
                max={control.max[0]}
                step={control.step[0]}
                value={vx}
                onChange={(e) => onChange([parseFloat(e.target.value) || 0, vy])}
                className="w-full bg-transparent font-mono text-zinc-100 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs">
              <span className="text-zinc-500">Y</span>
              <input
                type="number"
                min={control.min[1]}
                max={control.max[1]}
                step={control.step[1]}
                value={vy}
                onChange={(e) => onChange([vx, parseFloat(e.target.value) || 0])}
                className="w-full bg-transparent font-mono text-zinc-100 focus:outline-none"
              />
            </label>
          </div>
        </div>
      );
    }
  }
}

function SimpleSlider({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  unit,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultValue: number;
  readonly unit?: string;
  readonly onChange: (val: number) => void;
}) {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-zinc-300">{label}</span>
        <span className="font-mono text-[11px] text-zinc-400">
          {value.toFixed(decimals)}
          {unit ?? ''}
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        title="Double-click to reset to default"
        onDoubleClick={() => onChange(defaultValue)}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full cursor-pointer accent-emerald-400"
      />
    </div>
  );
}
