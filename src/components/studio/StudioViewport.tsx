'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import {
  Play,
  Pause,
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Music,
  VolumeX,
  RotateCcw,
  Upload,
  Download,
  Image as ImageIcon,
  SplitSquareHorizontal,
} from 'lucide-react';

import type { AudioAnalyzerState } from '../../engine/audio/AudioAnalyzer';
import type { AsciiEngineSnapshot } from '../../engine/core/types';
import type { SamplePresetId } from '../../hooks/useAsciiEngine';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

export interface StudioViewportProps {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly snapshot: AsciiEngineSnapshot;
  readonly audioState: AudioAnalyzerState;
  readonly onTogglePlay: () => void;
  readonly onToggleWebcam: () => Promise<void>;
  readonly onToggleAudioMic: () => Promise<void>;
  readonly onLoadAudioFile: (file: File) => Promise<void>;
  readonly onStopAudio: () => void;
  readonly onLoadFile: (file: File) => Promise<void>;
  readonly onLoadSamplePreset: (presetId: SamplePresetId) => void;
  readonly onRenderCompareSource: (targetCanvas: HTMLCanvasElement) => boolean;
  readonly onResetSimulation: () => void;
  readonly onOpenExport: () => void;
  readonly onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: () => void;
}

export function StudioViewport({
  containerRef,
  canvasRef,
  snapshot,
  audioState,
  onTogglePlay,
  onToggleWebcam,
  onToggleAudioMic,
  onLoadAudioFile,
  onStopAudio,
  onLoadFile,
  onLoadSamplePreset,
  onRenderCompareSource,
  onResetSimulation,
  onOpenExport,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: StudioViewportProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const compareCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const panDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const splitDragRef = useRef<number | null>(null);
  const viewRef = useRef<{ zoom: number; panX: number; panY: number }>({
    zoom: 1,
    panX: 0,
    panY: 0,
  });

  const [isDragging, setIsDragging] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [splitPos, setSplitPos] = useState(0.5);
  const [mediaRevision, setMediaRevision] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const isCompareAvailable = snapshot.sourceKind === 'media' && snapshot.hasMediaInput;
  const isCompareActive = compareEnabled && isCompareAvailable;
  const isInteractiveSeeding = snapshot.activeStyleId === 'reaction-diffusion';
  const isZoomModified = Math.abs(zoom - 1) > 0.005 || Math.abs(pan.x) > 0.5 || Math.abs(pan.y) > 0.5;

  const resetZoomAndPan = useCallback(() => {
    viewRef.current = { zoom: 1, panX: 0, panY: 0 };
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Native non-passive wheel listener for smooth cursor-centered 0.5x..4x zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: globalThis.WheelEvent): void => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const cur = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cur.zoom * factor));
      if (Math.abs(nextZoom - cur.zoom) < 1e-4) return;

      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const mx = e.clientX - cx;
      const my = e.clientY - cy;

      const localX = (mx - cur.panX) / cur.zoom;
      const localY = (my - cur.panY) / cur.zoom;

      const maxPanX = rect.width * nextZoom * 0.85;
      const maxPanY = rect.height * nextZoom * 0.85;
      const nextPanX = Math.max(-maxPanX, Math.min(maxPanX, mx - localX * nextZoom));
      const nextPanY = Math.max(-maxPanY, Math.min(maxPanY, my - localY * nextZoom));

      viewRef.current = { zoom: nextZoom, panX: nextPanX, panY: nextPanY };
      setZoom(nextZoom);
      setPan({ x: nextPanX, y: nextPanY });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [containerRef]);

  // Keep Before/After raw source canvas synchronized with Real-Time media frames & viewport size
  useEffect(() => {
    if (!isCompareActive) return;

    const drawCompare = (): void => {
      const target = compareCanvasRef.current;
      if (target) {
        onRenderCompareSource(target);
      }
    };

    drawCompare();

    const container = containerRef.current;
    const observer = container ? new ResizeObserver(drawCompare) : null;
    if (container && observer) {
      observer.observe(container);
    }

    let rafId = 0;
    const shouldAnimateCompare = snapshot.isPlaying && snapshot.isVideoOrWebcam;
    if (shouldAnimateCompare) {
      const loop = (): void => {
        drawCompare();
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }

    return () => {
      observer?.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [
    containerRef,
    isCompareActive,
    mediaRevision,
    onRenderCompareSource,
    snapshot.activeStyleId,
    snapshot.cols,
    snapshot.grading.fitMode,
    snapshot.isPlaying,
    snapshot.isVideoOrWebcam,
    snapshot.isWebcamActive,
    snapshot.rows,
  ]);

  const handleStagePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const wantsPan = !isInteractiveSeeding || e.button === 1 || e.shiftKey;
    if (wantsPan && (e.button === 0 || e.button === 1)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      panDragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: viewRef.current.panX,
        originY: viewRef.current.panY,
      };
      setIsPanning(true);
      return;
    }
    onPointerDown(e);
  };

  const handleStagePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      const rect = containerRef.current?.getBoundingClientRect();
      const maxPanX = rect ? rect.width * viewRef.current.zoom * 0.85 : 1200;
      const maxPanY = rect ? rect.height * viewRef.current.zoom * 0.85 : 1200;
      const nextPanX = Math.max(
        -maxPanX,
        Math.min(maxPanX, drag.originX + (e.clientX - drag.startX))
      );
      const nextPanY = Math.max(
        -maxPanY,
        Math.min(maxPanY, drag.originY + (e.clientY - drag.startY))
      );
      viewRef.current = { ...viewRef.current, panX: nextPanX, panY: nextPanY };
      setPan({ x: nextPanX, y: nextPanY });
      return;
    }
    onPointerMove(e);
  };

  const handleStagePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (panDragRef.current?.pointerId === e.pointerId) {
      panDragRef.current = null;
      setIsPanning(false);
    }
    onPointerUp();
  };

  const updateSplitFromClientX = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const next = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setSplitPos(next);
  };

  const handleSplitPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    splitDragRef.current = e.pointerId;
    updateSplitFromClientX(e.clientX);
  };

  const handleSplitPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (splitDragRef.current !== e.pointerId) return;
    e.stopPropagation();
    updateSplitFromClientX(e.clientX);
  };

  const handleSplitPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (splitDragRef.current !== e.pointerId) return;
    e.stopPropagation();
    splitDragRef.current = null;
  };

  const handleSplitKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSplitPos((p) => Math.max(0, p - 0.02));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSplitPos((p) => Math.min(1, p + 0.02));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setSplitPos(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setSplitPos(1);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setMediaError(null);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.type.startsWith('audio/')) {
      try {
        await onLoadAudioFile(file);
      } catch (err) {
        setMediaError(err instanceof Error ? err.message : 'Failed to load audio file.');
      }
      return;
    }
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      setMediaError('Unsupported file type. Drop an image, video, or audio file.');
      return;
    }
    try {
      await onLoadFile(file);
      setMediaRevision((r) => r + 1);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Failed to load media file.');
    }
  };

  const handleWebcamClick = async () => {
    setMediaError(null);
    try {
      await onToggleWebcam();
      setMediaRevision((r) => r + 1);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Unable to access webcam.');
    }
  };

  const handleAudioMicClick = async () => {
    setMediaError(null);
    try {
      await onToggleAudioMic();
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Unable to access microphone.');
    }
  };

  const backendLabel =
    snapshot.backendTier === 'webgl2-instanced' ? 'WebGL2 Instanced' : 'Canvas2D Fallback';
  const zoomPercent = Math.round(zoom * 100);
  const stageTransformStyle = {
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
    transformOrigin: 'center center',
  };

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex h-full w-full flex-1 items-center justify-center overflow-hidden bg-zinc-950"
    >
      {/* Interactive Pan/Zoom/Pointer Stage Surface */}
      <div
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerUp}
        className={`relative h-full w-full touch-none ${
          isInteractiveSeeding
            ? 'cursor-crosshair'
            : isPanning
              ? 'cursor-grabbing'
              : 'cursor-grab'
        }`}
      >
        {/* Bottom Before Layer: Un-stylized Source Media (Real-Time Compare Mode) */}
        {isCompareActive && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="h-full w-full" style={stageTransformStyle}>
              <canvas
                ref={compareCanvasRef}
                aria-hidden="true"
                className="pointer-events-none block h-full w-full"
              />
            </div>
          </div>
        )}

        {/* Top After Layer: ASCII Canvas clipped at split handle when Compare is active */}
        <div
          className="pointer-events-none absolute inset-0"
          style={
            isCompareActive
              ? { clipPath: `inset(0 0 0 ${(splitPos * 100).toFixed(3)}%)` }
              : undefined
          }
        >
          <div className="h-full w-full" style={stageTransformStyle}>
            <canvas
              ref={canvasRef}
              className="pointer-events-none block h-full w-full"
            />
          </div>
        </div>
      </div>

      {/* Draggable Vertical Before / After Split Handle */}
      {isCompareActive && (
        <div
          role="slider"
          tabIndex={0}
          aria-label="Before and after split comparison"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(splitPos * 100)}
          onPointerDown={handleSplitPointerDown}
          onPointerMove={handleSplitPointerMove}
          onPointerUp={handleSplitPointerUp}
          onPointerCancel={handleSplitPointerUp}
          onDoubleClick={() => setSplitPos(0.5)}
          onKeyDown={handleSplitKeyDown}
          style={{ left: `${(splitPos * 100).toFixed(3)}%` }}
          className="group absolute inset-y-0 z-10 w-6 -translate-x-1/2 touch-none cursor-ew-resize focus:outline-none"
        >
          <div className="mx-auto h-full w-[2px] bg-emerald-400/90 shadow-[0_0_12px_rgba(16,185,129,0.55)]" />
          <div className="pointer-events-none absolute top-14 right-4 rounded bg-zinc-950/85 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-200 border border-zinc-800/90 backdrop-blur">
            Original
          </div>
          <div className="pointer-events-none absolute top-14 left-4 rounded bg-zinc-950/85 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-300 border border-emerald-500/30 backdrop-blur">
            ASCII
          </div>
          <div className="absolute top-1/2 left-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-emerald-400/80 bg-zinc-950/90 text-emerald-300 shadow-xl backdrop-blur transition group-hover:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-emerald-400">
            <SplitSquareHorizontal className="h-3.5 w-3.5" />
          </div>
        </div>
      )}

      {/* Top-Left Telemetry & Zoom Reset Pills */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2">
        <div className="pointer-events-none flex flex-wrap items-center gap-2 rounded-full border border-zinc-800/90 bg-zinc-900/80 px-3 py-1.5 text-[11px] font-mono text-zinc-200 backdrop-blur-md shadow-lg">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                snapshot.isContextLost
                  ? 'bg-red-500'
                  : snapshot.isPlaying
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-zinc-400'
              }`}
            />
            {snapshot.fps > 0 ? `${snapshot.fps} FPS` : snapshot.isPlaying ? 'LIVE' : 'IDLE'}
          </span>
          <span className="text-zinc-600">|</span>
          <span>
            {snapshot.cols} × {snapshot.rows}
          </span>
          <span className="text-zinc-600">|</span>
          <span className="text-emerald-300">{backendLabel}</span>
        </div>

        <button
          type="button"
          onClick={resetZoomAndPan}
          title="Reset zoom and pan to 100% (Scroll wheel to zoom, drag to pan)"
          aria-label={isZoomModified ? `Reset zoom from ${zoomPercent}% to 100%` : 'Zoom level 100%'}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-mono backdrop-blur-md shadow-lg transition ${
            isZoomModified
              ? 'border-emerald-500/50 bg-emerald-950/80 text-emerald-200 hover:bg-emerald-900/80'
              : 'border-zinc-800/90 bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800/90'
          }`}
        >
          <span>{zoomPercent}%</span>
          {isZoomModified && <span className="text-emerald-300">Reset</span>}
        </button>
      </div>

      {/* Media / Context Warning Toast */}
      {mediaError && (
        <div
          role="alert"
          className="absolute top-14 left-3 z-20 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/90 px-3 py-2 text-xs text-red-200 shadow-lg backdrop-blur-md"
        >
          <span>{mediaError}</span>
          <button
            type="button"
            onClick={() => setMediaError(null)}
            className="rounded px-1.5 py-0.5 text-[10px] hover:bg-red-900/80"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Drag-and-Drop Overlay */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-400 bg-zinc-950/80 backdrop-blur-sm">
          <Upload className="h-8 w-8 text-emerald-400" />
          <p className="mt-2 text-sm font-medium text-white">
            Drop image, video, or audio to render in ASCII
          </p>
        </div>
      )}

      {/* Floating Bottom Playback & Input Dock */}
      <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-zinc-800/90 bg-zinc-900/85 px-2.5 py-1.5 text-xs text-zinc-200 shadow-2xl backdrop-blur-md">
        <button
          type="button"
          onClick={onTogglePlay}
          title="Play / Pause (Space)"
          aria-label={snapshot.isPlaying ? 'Pause' : 'Play'}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-white hover:bg-zinc-700 transition"
        >
          {snapshot.isPlaying ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5 translate-x-[0.5px]" />
          )}
        </button>

        <button
          type="button"
          onClick={handleWebcamClick}
          title="Toggle Webcam"
          aria-label={snapshot.isWebcamActive ? 'Disable webcam' : 'Enable webcam'}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition ${
            snapshot.isWebcamActive
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : 'hover:bg-zinc-800 text-zinc-300'
          }`}
        >
          {snapshot.isWebcamActive ? (
            <CameraOff className="h-3.5 w-3.5" />
          ) : (
            <Camera className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">Webcam</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setMediaError(null);
            try {
              await onLoadFile(file);
              setMediaRevision((r) => r + 1);
            } catch (err) {
              setMediaError(err instanceof Error ? err.message : 'Failed to load media.');
            }
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Upload Image or Video"
          aria-label="Upload image or video"
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium text-zinc-300 hover:bg-zinc-800 transition"
        >
          <Upload className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Upload</span>
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setSamplesOpen((o) => !o)}
            title="Choose Sample Preset"
            aria-label="Choose sample preset"
            aria-expanded={samplesOpen}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium text-zinc-300 hover:bg-zinc-800 transition"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Samples</span>
          </button>
          {samplesOpen && (
            <div className="absolute bottom-11 left-0 w-40 rounded-lg border border-zinc-800 bg-zinc-900 p-1 shadow-xl">
              {(
                [
                  { id: 'calibration', label: 'Nebula Sculpture' },
                  { id: 'rings', label: 'Harmonic Rings' },
                  { id: 'prism', label: 'Prism Gradient' },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    onLoadSamplePreset(preset.id);
                    setMediaRevision((r) => r + 1);
                    setSamplesOpen(false);
                  }}
                  className="block w-full rounded px-2.5 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onResetSimulation}
          title="Reset Simulation / Seed"
          aria-label="Reset simulation"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-300 hover:bg-zinc-800 transition"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>

        {isCompareAvailable && (
          <button
            type="button"
            onClick={() => setCompareEnabled((v) => !v)}
            aria-pressed={isCompareActive}
            aria-label="Toggle before and after split comparison"
            title="Before / After Split Comparison"
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-medium transition ${
              isCompareActive
                ? 'border border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                : 'text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <SplitSquareHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Compare</span>
          </button>
        )}

        {snapshot.sourceKind === 'generative' && (
          <>
            <div className="h-4 w-px bg-zinc-800" />
            <button
              type="button"
              onClick={handleAudioMicClick}
              title={
                audioState.active && audioState.source === 'mic'
                  ? 'Stop Audio Microphone'
                  : 'Drive Shader with Live Microphone'
              }
              aria-label={
                audioState.active && audioState.source === 'mic'
                  ? 'Disable audio microphone'
                  : 'Enable audio microphone'
              }
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-medium transition ${
                audioState.active && audioState.source === 'mic'
                  ? 'border border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                  : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {audioState.active && audioState.source === 'mic' ? (
                <MicOff className="h-3.5 w-3.5" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">Audio Mic</span>
            </button>

            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setMediaError(null);
                try {
                  await onLoadAudioFile(file);
                } catch (err) {
                  setMediaError(err instanceof Error ? err.message : 'Failed to load audio.');
                }
              }}
            />
            {audioState.active && audioState.source === 'file' ? (
              <button
                type="button"
                onClick={onStopAudio}
                title={`Stop Audio: ${audioState.label ?? 'Track'}`}
                aria-label="Stop audio playback"
                className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/20 px-2.5 py-1.5 font-medium text-sky-200 hover:bg-sky-500/30 transition"
              >
                <VolumeX className="h-3.5 w-3.5" />
                <span className="hidden max-w-[90px] truncate sm:inline">
                  {audioState.label ?? 'Stop Audio'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                title="Load or Drop Audio Track (.mp3, .wav, .ogg)"
                aria-label="Load audio file"
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-medium text-zinc-300 hover:bg-zinc-800 transition"
              >
                <Music className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Drop Audio</span>
              </button>
            )}
          </>
        )}

        <div className="h-4 w-px bg-zinc-800" />

        <button
          type="button"
          onClick={onOpenExport}
          title="Export ASCII (Cmd/Ctrl+E)"
          aria-label="Export ASCII artwork"
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-3.5 py-1.5 font-semibold text-zinc-950 hover:bg-emerald-400 transition"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Export</span>
        </button>
      </div>
    </div>
  );
}
