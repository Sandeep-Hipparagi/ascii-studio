'use client';

import React, { useRef, useState, type DragEvent, type PointerEvent, type RefObject } from 'react';
import {
  Play,
  Pause,
  Camera,
  CameraOff,
  RotateCcw,
  Upload,
  Download,
  Image as ImageIcon,
} from 'lucide-react';

import type { AsciiEngineSnapshot } from '../../engine/core/types';
import type { SamplePresetId } from '../../hooks/useAsciiEngine';

export interface StudioViewportProps {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly snapshot: AsciiEngineSnapshot;
  readonly onTogglePlay: () => void;
  readonly onToggleWebcam: () => Promise<void>;
  readonly onLoadFile: (file: File) => Promise<void>;
  readonly onLoadSamplePreset: (presetId: SamplePresetId) => void;
  readonly onResetSimulation: () => void;
  readonly onOpenExport: () => void;
  readonly onPointerDown: (e: PointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerMove: (e: PointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerUp: () => void;
}

export function StudioViewport({
  containerRef,
  canvasRef,
  snapshot,
  onTogglePlay,
  onToggleWebcam,
  onLoadFile,
  onLoadSamplePreset,
  onResetSimulation,
  onOpenExport,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: StudioViewportProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [samplesOpen, setSamplesOpen] = useState(false);

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
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      setMediaError('Unsupported file type. Drop an image or video file.');
      return;
    }
    try {
      await onLoadFile(file);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Failed to load media file.');
    }
  };

  const handleWebcamClick = async () => {
    setMediaError(null);
    try {
      await onToggleWebcam();
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Unable to access webcam.');
    }
  };

  const backendLabel =
    snapshot.backendTier === 'webgl2-instanced' ? 'WebGL2 Instanced' : 'Canvas2D Fallback';

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex h-full w-full flex-1 items-center justify-center overflow-hidden bg-zinc-950"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className="block h-full w-full touch-none cursor-crosshair"
      />

      {/* Top-Left Telemetry Pill */}
      <div className="pointer-events-none absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2 rounded-full border border-zinc-800/90 bg-zinc-900/80 px-3 py-1.5 text-[11px] font-mono text-zinc-200 backdrop-blur-md shadow-lg">
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
            Drop image or video to render in ASCII
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
