'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import type { StylePlugin } from '../../registry/types';
import { StylePreviewCanvas } from './StylePreviewCanvas';

export function getCapabilityBadge(plugin: StylePlugin): {
  readonly label: string;
  readonly className: string;
} {
  if (plugin.mode === 'realtime') {
    if (plugin.category === 'braille') {
      return {
        label: 'Braille 2×4',
        className: 'border-violet-500/30 bg-violet-500/15 text-violet-300',
      };
    }
    if (plugin.category === 'edge-detection') {
      return {
        label: 'CPU Kernel',
        className: 'border-cyan-500/30 bg-cyan-500/15 text-cyan-300',
      };
    }
    return {
      label: 'CPU Kernel',
      className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
    };
  }

  if (plugin.executionMode === 'worker-grid') {
    return {
      label: 'WebWorker',
      className: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
    };
  }

  if (plugin.category === 'audio-spectral' || plugin.supportsAudio) {
    return {
      label: 'Audio-FFT · WebGL2',
      className: 'border-indigo-500/30 bg-indigo-500/15 text-indigo-300',
    };
  }

  return {
    label: 'WebGL2 Shader',
    className: 'border-sky-500/30 bg-sky-500/15 text-sky-300',
  };
}

export interface StyleCardProps {
  readonly plugin: StylePlugin;
}

export function StyleCard({ plugin }: StyleCardProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = hovered || focused;
  const badge = getCapabilityBadge(plugin);
  const launchHref = `/?style=${encodeURIComponent(plugin.id)}`;

  return (
    <article
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] transition-colors hover:border-zinc-500 hover:bg-[var(--bg-card-hover)]"
    >
      {/* Thumbnail Viewport + Capability Overlay */}
      <div className="relative">
        <Link href={launchHref} tabIndex={-1} aria-hidden="true" className="block">
          <StylePreviewCanvas plugin={plugin} active={active} />
        </Link>

        <div className="pointer-events-none absolute top-2.5 left-2.5 flex items-center gap-1.5">
          <span
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium backdrop-blur-sm ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>

        <div
          className={`pointer-events-none absolute top-2.5 right-2.5 rounded border border-zinc-800/90 bg-zinc-950/85 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 backdrop-blur-sm transition-opacity duration-200 ${
            active ? 'opacity-100' : 'opacity-70'
          }`}
        >
          {plugin.mode === 'realtime'
            ? active
              ? 'Source / ASCII'
              : 'Hover: Peek'
            : active
              ? 'Live Shader'
              : 'Hover: Animate'}
        </div>
      </div>

      {/* Metadata & Launch Action */}
      <div className="flex flex-1 flex-col justify-between gap-3.5 p-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              /{plugin.category}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
              {plugin.uniformSchema.length} params
            </span>
          </div>

          <h3 className="text-sm font-semibold leading-snug text-[var(--text-primary)]">
            {plugin.name}
          </h3>

          <p className="line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">
            {plugin.description}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
          <span className="max-w-[115px] truncate font-mono text-[10px] text-zinc-500">
            ramp: {plugin.defaultRamp}
          </span>

          <Link
            href={launchHref}
            aria-label={`Try ${plugin.name} in Studio`}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-100 transition group-hover:border-emerald-500/60 group-hover:bg-emerald-500/15 group-hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            <span>Try this style</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </article>
  );
}
