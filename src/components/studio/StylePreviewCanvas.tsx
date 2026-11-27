'use client';

import React, { useEffect, useRef, useState } from 'react';

import { AsciiEngine } from '../../engine/core/AsciiEngine';
import { createProceduralSampleCanvas } from '../../engine/realtime/samplePresets';
import { getStyleById } from '../../registry';
import type { StylePlugin } from '../../registry/types';

const PREVIEW_W = 480;
const PREVIEW_H = 300;
const PREVIEW_FONT_SIZE = 10;

// --- Shared Module-Level Singleton Offscreen Renderer Pool (1 WebGL2 Context Max) ---

interface SharedPreviewHost {
  engine: AsciiEngine;
  offscreenCanvas: HTMLCanvasElement;
  sampleCanvas: HTMLCanvasElement;
  loadedPluginId: string | null;
  fontsReady: Promise<boolean>;
}

let previewHost: SharedPreviewHost | null = null;

function getSharedPreviewHost(): SharedPreviewHost | null {
  if (typeof document === 'undefined') return null;
  if (previewHost) return previewHost;

  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = PREVIEW_W;
  offscreenCanvas.height = PREVIEW_H;

  const sampleCanvas = createProceduralSampleCanvas('calibration', PREVIEW_W, PREVIEW_H);
  const engine = new AsciiEngine(offscreenCanvas, {
    fontSizeCssPx: PREVIEW_FONT_SIZE,
    dpr: 1,
  });
  engine.resize(PREVIEW_W, PREVIEW_H, 1);
  engine.setMediaInput(sampleCanvas);
  engine.setPlaying(false);

  const fontsReady = engine.refreshFonts().catch(() => false);
  previewHost = {
    engine,
    offscreenCanvas,
    sampleCanvas,
    loadedPluginId: null,
    fontsReady,
  };
  return previewHost;
}

function renderPluginToCanvas(
  plugin: StylePlugin,
  target: HTMLCanvasElement,
  elapsedSec: number,
  dtSec = 1 / 30
): boolean {
  const host = getSharedPreviewHost();
  if (!host) return false;

  if (target.width !== PREVIEW_W || target.height !== PREVIEW_H) {
    target.width = PREVIEW_W;
    target.height = PREVIEW_H;
  }

  if (host.loadedPluginId !== plugin.id) {
    if (plugin.mode === 'realtime') {
      host.engine.setMediaInput(host.sampleCanvas);
    }
    host.engine.setStylePlugin(plugin);
    host.loadedPluginId = plugin.id;
  }

  const ok = host.engine.renderPreviewFrame(elapsedSec, dtSec);
  if (!ok) return false;

  const ctx = target.getContext('2d');
  if (!ctx) return false;
  ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
  ctx.drawImage(host.offscreenCanvas, 0, 0, PREVIEW_W, PREVIEW_H);
  return true;
}

// --- Serialized Static Thumbnail Queue (Prevents Worker/Main-Thread Spikes) ---

interface StaticRenderTask {
  readonly plugin: StylePlugin;
  readonly canvas: HTMLCanvasElement;
  readonly elapsedSec: number;
  readonly onDone?: () => void;
}

const staticQueue: StaticRenderTask[] = [];
let staticQueueScheduled = false;

function scheduleStaticQueueFlush(): void {
  if (staticQueueScheduled || staticQueue.length === 0) return;
  staticQueueScheduled = true;

  requestAnimationFrame(() => {
    staticQueueScheduled = false;
    const batchSize = 2;
    let processed = 0;
    while (staticQueue.length > 0 && processed < batchSize) {
      const task = staticQueue.shift();
      if (!task) break;
      renderPluginToCanvas(task.plugin, task.canvas, task.elapsedSec, 1 / 30);
      task.onDone?.();
      processed += 1;
    }

    if (staticQueue.length > 0) {
      scheduleStaticQueueFlush();
    } else if (previewHost?.loadedPluginId === 'reaction-diffusion') {
      // Switch shared host off worker-grid so idle Web Workers terminate promptly.
      const classic = getStyleById('classic-density');
      if (classic) {
        previewHost.engine.setMediaInput(previewHost.sampleCanvas);
        previewHost.engine.setStylePlugin(classic);
        previewHost.engine.setPlaying(false);
        previewHost.loadedPluginId = classic.id;
      }
    }
  });
}

function enqueueStaticPreview(task: StaticRenderTask): void {
  const existingIdx = staticQueue.findIndex((t) => t.canvas === task.canvas);
  if (existingIdx >= 0) {
    staticQueue[existingIdx] = task;
  } else {
    staticQueue.push(task);
  }
  scheduleStaticQueueFlush();
}

// --- Shared IntersectionObserver Across Gallery Cards ---

type VisibilityCallback = (visible: boolean) => void;
const observedElements = new Map<Element, VisibilityCallback>();
let sharedObserver: IntersectionObserver | null = null;

function observeVisibility(el: Element, cb: VisibilityCallback): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    cb(true);
    return () => {};
  }

  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const handler = observedElements.get(entry.target);
          handler?.(entry.isIntersecting);
        }
      },
      { rootMargin: '120px', threshold: 0.05 }
    );
  }

  observedElements.set(el, cb);
  sharedObserver.observe(el);

  return () => {
    observedElements.delete(el);
    sharedObserver?.unobserve(el);
    if (observedElements.size === 0 && sharedObserver) {
      sharedObserver.disconnect();
      sharedObserver = null;
    }
  };
}

// --- Component ---

export interface StylePreviewCanvasProps {
  readonly plugin: StylePlugin;
  readonly active: boolean;
}

export function StylePreviewCanvas({ plugin, active }: StylePreviewCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const asciiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    return observeVisibility(el, setIsVisible);
  }, []);

  // Draw crisp static source thumbnail once for Real-Time hover wipe comparison
  useEffect(() => {
    if (plugin.mode !== 'realtime') return;
    const dest = sourceCanvasRef.current;
    const host = getSharedPreviewHost();
    if (!dest || !host) return;
    if (dest.width !== PREVIEW_W || dest.height !== PREVIEW_H) {
      dest.width = PREVIEW_W;
      dest.height = PREVIEW_H;
    }
    const ctx = dest.getContext('2d');
    ctx?.drawImage(host.sampleCanvas, 0, 0, PREVIEW_W, PREVIEW_H);
  }, [plugin.mode]);

  // Render crisp static frame when card becomes visible (or after web fonts resolve)
  useEffect(() => {
    if (!isVisible) return;
    const canvas = asciiCanvasRef.current;
    const host = getSharedPreviewHost();
    if (!canvas || !host) return;

    let cancelled = false;
    enqueueStaticPreview({ plugin, canvas, elapsedSec: 1.6 });

    void host.fontsReady.then((rebuilt) => {
      if (!cancelled && rebuilt) {
        enqueueStaticPreview({ plugin, canvas, elapsedSec: 1.6 });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isVisible, plugin]);

  // Animate Generative / Worker styles at 30 FPS ONLY while visible + hovered/focused
  useEffect(() => {
    if (!isVisible || !active || reducedMotion || plugin.mode !== 'generative') {
      return;
    }

    const canvas = asciiCanvasRef.current;
    if (!canvas) return;

    let rafId = 0;
    let lastTimeMs = performance.now();
    let elapsedSec = 1.6;

    const tick = (nowMs: number): void => {
      const dtMs = nowMs - lastTimeMs;
      if (dtMs >= 32) {
        const dtSec = Math.min(0.08, dtMs / 1000);
        lastTimeMs = nowMs;
        elapsedSec += dtSec;
        renderPluginToCanvas(plugin, canvas, elapsedSec, dtSec);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      if (plugin.executionMode === 'worker-grid' && previewHost) {
        const classic = getStyleById('classic-density');
        if (classic) {
          previewHost.engine.setMediaInput(previewHost.sampleCanvas);
          previewHost.engine.setStylePlugin(classic);
          previewHost.engine.setPlaying(false);
          previewHost.loadedPluginId = classic.id;
        }
      }
    };
  }, [active, isVisible, plugin, reducedMotion]);

  const showSourceWipe = plugin.mode === 'realtime' && active && !reducedMotion;

  return (
    <div
      ref={hostRef}
      className="relative aspect-[16/10] w-full overflow-hidden border-b border-[var(--border-subtle)] bg-[var(--bg-void)]"
    >
      {/* Underlying un-stylized source frame revealed smoothly on hover for Real-Time filters */}
      {plugin.mode === 'realtime' && (
        <canvas
          ref={sourceCanvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      )}

      {/* Primary rendered ASCII output thumbnail */}
      <div
        className="pointer-events-none absolute inset-0 transition-[clip-path] duration-300 ease-out"
        style={{
          clipPath: showSourceWipe ? 'inset(0 0 0 46%)' : 'inset(0 0 0 0%)',
        }}
      >
        <canvas
          ref={asciiCanvasRef}
          aria-hidden="true"
          className="h-full w-full object-cover"
        />
      </div>

      {/* Crisp center divider line on Real-Time hover wipe */}
      {plugin.mode === 'realtime' && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-[46%] w-px bg-emerald-400/80 shadow-[0_0_8px_rgba(16,185,129,0.6)] transition-opacity duration-200 ${
            showSourceWipe ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  );
}
