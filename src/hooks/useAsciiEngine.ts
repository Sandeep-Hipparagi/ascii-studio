'use client';

/**
 * React 18/19 Hook bridging imperative `AsciiEngine` to declarative Studio UI
 * via `useSyncExternalStore`, `ResizeObserver`, and pointer-to-grid mapping.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  AudioAnalyzer,
  type AudioAnalyzerState,
} from '../engine/audio/AudioAnalyzer';
import { AsciiEngine } from '../engine/core/AsciiEngine';
import type {
  AsciiEngineSnapshot,
  AtlasFilterMode,
  MediaGradingParams,
  PaletteConfig,
  PostFxUniforms,
} from '../engine/core/types';
import { exportPng, exportVideo, type VideoExportResult } from '../engine/export/MediaCaptureExporter';
import { exportSvg } from '../engine/export/SvgVectorExporter';
import { exportAnsiTrueColor, exportPlainText } from '../engine/export/TextAnsiExporter';
import { DEFAULT_MEDIA_GRADING } from '../engine/realtime/MediaPipeline';
import { getStyleById } from '../registry';
import type { UniformValue } from '../registry/types';

export type SamplePresetId = 'calibration' | 'rings' | 'prism';

export type ExportArtifactRequest =
  | { readonly format: 'txt' }
  | { readonly format: 'ans' }
  | { readonly format: 'svg' }
  | { readonly format: 'png'; readonly scaleFactor?: number }
  | {
      readonly format: 'video';
      readonly durationMs: number;
      readonly fps?: number;
      readonly onProgress?: (progress01: number) => void;
    };

export type ExportArtifactResult =
  | { readonly format: 'txt'; readonly content: string }
  | { readonly format: 'ans'; readonly content: string }
  | { readonly format: 'svg'; readonly content: string }
  | { readonly format: 'png'; readonly blob: Blob }
  | ({ readonly format: 'video' } & VideoExportResult);

const DEFAULT_AUDIO_STATE: AudioAnalyzerState = {
  active: false,
  source: 'none',
  label: null,
  rms: 0,
};

const SERVER_SNAPSHOT: AsciiEngineSnapshot = {
  sourceKind: 'media',
  activeStyleId: 'classic-density',
  activeGenerativeId: null,
  backendTier: 'webgl2-instanced',
  isPlaying: false,
  isWebcamActive: false,
  isVideoOrWebcam: false,
  hasMediaInput: false,
  isContextLost: false,
  fps: 0,
  cols: 80,
  rows: 40,
  aspectRatio: 0.6,
  fontSize: 12,
  ramp: ' .:-=+*#%@',
  sortedDenseRamp:
    " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  filterMode: 'linear',
  grading: DEFAULT_MEDIA_GRADING,
  palette: {
    colorMode: 'source',
    fgRgba: [240, 245, 240, 255],
    bgRgba: [10, 12, 14, 255],
  },
  postFx: {
    crtScanlineIntensity: 0,
    crtScanlineDensity: 1.5,
    bloomIntensity: 0,
    bloomThreshold: 0.55,
    backdropOpacity: 0,
  },
  realtimeParams: {},
  generativeParams: {},
};

function createProceduralSampleCanvas(presetId: SamplePresetId): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, w, h);

  if (presetId === 'rings') {
    for (let r = 240; r >= 24; r -= 22) {
      const t = 1 - r / 240;
      const hue = Math.round(180 + t * 140);
      ctx.strokeStyle = `hsl(${hue}, 85%, ${35 + t * 40}%)`;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.5, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const rad = ctx.createRadialGradient(w * 0.42, h * 0.38, 8, w * 0.5, h * 0.5, 130);
    rad.addColorStop(0, '#ffffff');
    rad.addColorStop(0.5, '#38bdf8');
    rad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rad;
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.5, 130, 0, Math.PI * 2);
    ctx.fill();
    return canvas;
  }

  if (presetId === 'prism') {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#0f172a');
    bg.addColorStop(0.5, '#1e1b4b');
    bg.addColorStop(1, '#09090b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.14);
    ctx.lineTo(w * 0.78, h * 0.78);
    ctx.lineTo(w * 0.22, h * 0.78);
    ctx.closePath();
    ctx.stroke();

    const grad = ctx.createLinearGradient(w * 0.5, h * 0.14, w * 0.5, h * 0.78);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, '#22d3ee');
    grad.addColorStop(0.7, '#a855f7');
    grad.addColorStop(1, '#f43f5e');
    ctx.fillStyle = grad;
    ctx.fill();
    return canvas;
  }

  // Default: Rich borderless Nebula Sculpture studio showcase (zero outer frame)
  const bg = ctx.createRadialGradient(w * 0.52, h * 0.48, 24, w * 0.5, h * 0.5, w * 0.68);
  bg.addColorStop(0, '#0f172a');
  bg.addColorStop(0.55, '#070b18');
  bg.addColorStop(1, '#020308');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Volumetric cyan/magenta nebula plumes for tonal range across density & dithering
  const plumeCyan = ctx.createRadialGradient(w * 0.28, h * 0.34, 10, w * 0.3, h * 0.36, 250);
  plumeCyan.addColorStop(0, 'rgba(56, 189, 248, 0.72)');
  plumeCyan.addColorStop(0.45, 'rgba(37, 99, 235, 0.34)');
  plumeCyan.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = plumeCyan;
  ctx.fillRect(0, 0, w, h);

  const plumeMagenta = ctx.createRadialGradient(w * 0.72, h * 0.64, 12, w * 0.7, h * 0.62, 240);
  plumeMagenta.addColorStop(0, 'rgba(244, 63, 94, 0.65)');
  plumeMagenta.addColorStop(0.45, 'rgba(168, 85, 247, 0.3)');
  plumeMagenta.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = plumeMagenta;
  ctx.fillRect(0, 0, w, h);

  // Tilted luminous accretion ring behind sculpture
  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  ctx.rotate(-0.34);
  const ringGrad = ctx.createLinearGradient(-230, 0, 230, 0);
  ringGrad.addColorStop(0, 'rgba(56, 189, 248, 0.15)');
  ringGrad.addColorStop(0.35, 'rgba(125, 211, 252, 0.92)');
  ringGrad.addColorStop(0.65, 'rgba(251, 191, 36, 0.88)');
  ringGrad.addColorStop(1, 'rgba(244, 63, 94, 0.18)');
  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.ellipse(0, 0, 225, 58, 0, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Key-lit iridescent sculpture sphere with soft rim highlight
  const sphere = ctx.createRadialGradient(w * 0.42, h * 0.39, 10, w * 0.5, h * 0.5, 146);
  sphere.addColorStop(0, '#ffffff');
  sphere.addColorStop(0.24, '#bae6fd');
  sphere.addColorStop(0.55, '#3b82f6');
  sphere.addColorStop(0.84, '#4c1d95');
  sphere.addColorStop(1, '#090d1a');
  ctx.fillStyle = sphere;
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.5, 144, 0, Math.PI * 2);
  ctx.fill();

  // Warm rim crescent along lower-right edge for strong Sobel & Braille silhouette
  ctx.strokeStyle = 'rgba(251, 146, 60, 0.85)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.5, 142, 0.12, 1.35);
  ctx.stroke();

  // Foreground half of orbital ring passing across sphere
  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  ctx.rotate(-0.34);
  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.ellipse(0, 0, 225, 58, 0, 0, Math.PI);
  ctx.stroke();
  ctx.restore();

  return canvas;
}

export function useAsciiEngine(initialStyleId = 'classic-density') {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<AsciiEngine | null>(null);
  const audioAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const pointerDownRef = useRef(false);
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null);
  const [audioState, setAudioState] = useState<AudioAnalyzerState>(DEFAULT_AUDIO_STATE);

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stopWebcamStream = useCallback(() => {
    if (webcamStreamRef.current) {
      for (const track of webcamStreamRef.current.getTracks()) {
        track.stop();
      }
      webcamStreamRef.current = null;
    }
  }, []);

  // Initialize AsciiEngine + ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const engine = new AsciiEngine(canvas, {
      fontSizeCssPx: 12,
      dpr,
    });
    engineRef.current = engine;

    const initialPlugin = getStyleById(initialStyleId);
    engine.setMediaInput(createProceduralSampleCanvas('calibration'));
    if (initialPlugin) {
      engine.setStylePlugin(initialPlugin);
    }

    const syncSize = (): void => {
      const rect = container.getBoundingClientRect();
      const nextDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      if (rect.width > 0 && rect.height > 0) {
        engine.resize(rect.width, rect.height, nextDpr);
      }
    };

    syncSize();
    const observer = new ResizeObserver(() => {
      syncSize();
    });
    observer.observe(container);

    let cancelled = false;
    void engine.refreshFonts().then((rebuilt) => {
      if (!cancelled && rebuilt) {
        syncSize();
      }
    });

    return () => {
      cancelled = true;
      observer.disconnect();
      audioAnalyzerRef.current?.dispose();
      audioAnalyzerRef.current = null;
      stopWebcamStream();
      revokeObjectUrl();
      engine.dispose();
      engineRef.current = null;
    };
  }, [initialStyleId, revokeObjectUrl, stopWebcamStream]);

  const subscribe = useCallback((listener: () => void) => {
    const engine = engineRef.current;
    if (!engine) return () => {};
    return engine.subscribe(listener);
  }, []);

  const getSnapshot = useCallback((): AsciiEngineSnapshot => {
    return engineRef.current?.getSnapshot() ?? SERVER_SNAPSHOT;
  }, []);

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => SERVER_SNAPSHOT
  );

  // --- Action Handlers ---

  const setStyle = useCallback((styleId: string) => {
    const engine = engineRef.current;
    const plugin = getStyleById(styleId);
    if (!engine || !plugin) return;

    if (plugin.mode === 'realtime' && !engine.getSnapshot().hasMediaInput) {
      engine.setMediaInput(createProceduralSampleCanvas('calibration'));
    }
    engine.setStylePlugin(plugin);
  }, []);

  const updateUniform = useCallback((id: string, value: UniformValue) => {
    engineRef.current?.updateUniform(id, value);
  }, []);

  const loadSamplePreset = useCallback(
    (presetId: SamplePresetId) => {
      const engine = engineRef.current;
      if (!engine) return;
      stopWebcamStream();
      revokeObjectUrl();
      engine.setMediaInput(createProceduralSampleCanvas(presetId));
    },
    [revokeObjectUrl, stopWebcamStream]
  );

  const loadMediaFile = useCallback(
    async (file: File): Promise<void> => {
      const engine = engineRef.current;
      if (!engine) return;

      stopWebcamStream();
      revokeObjectUrl();

      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;

      if (file.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = url;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';

        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error(`Failed to decode video: ${file.name}`));
        });

        await video.play().catch(() => {});
        engine.setMediaInput(video);
        return;
      }

      const img = new Image();
      img.src = url;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to decode image: ${file.name}`));
      });

      const bitmap = await createImageBitmap(img);
      engine.setMediaInput(bitmap);
    },
    [revokeObjectUrl, stopWebcamStream]
  );

  const toggleWebcam = useCallback(async (): Promise<void> => {
    const engine = engineRef.current;
    if (!engine) return;

    if (webcamStreamRef.current) {
      stopWebcamStream();
      engine.setMediaInput(createProceduralSampleCanvas('calibration'));
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Webcam access is unavailable in this browser context.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    revokeObjectUrl();
    webcamStreamRef.current = stream;
    engine.setMediaInput(stream);
  }, [revokeObjectUrl, stopWebcamStream]);

  const getAudioAnalyzer = useCallback((): AudioAnalyzer => {
    if (!audioAnalyzerRef.current) {
      audioAnalyzerRef.current = new AudioAnalyzer();
    }
    return audioAnalyzerRef.current;
  }, []);

  const stopAudio = useCallback(() => {
    const analyzer = audioAnalyzerRef.current;
    const next = analyzer ? analyzer.stop() : DEFAULT_AUDIO_STATE;
    setAudioState(next);
    engineRef.current?.setAudioBands(0, 0, 0, 0);
  }, []);

  const ensureAudioGenerativeTarget = useCallback((engine: AsciiEngine) => {
    if (engine.getSnapshot().sourceKind !== 'generative') {
      const spectral = getStyleById('audio-spectral');
      if (spectral) {
        engine.setStylePlugin(spectral);
      }
    }
    engine.setPlaying(true);
  }, []);

  const toggleAudioMic = useCallback(async (): Promise<void> => {
    const engine = engineRef.current;
    if (!engine) return;
    const analyzer = getAudioAnalyzer();

    if (analyzer.getState().source === 'mic' && analyzer.getState().active) {
      stopAudio();
      return;
    }

    const next = await analyzer.startMicrophone((bands) => {
      engineRef.current?.setAudioBands(bands[0], bands[1], bands[2], bands[3]);
    });
    setAudioState(next);
    ensureAudioGenerativeTarget(engine);
  }, [ensureAudioGenerativeTarget, getAudioAnalyzer, stopAudio]);

  const loadAudioFile = useCallback(
    async (file: File): Promise<void> => {
      const engine = engineRef.current;
      if (!engine) return;
      const analyzer = getAudioAnalyzer();

      const next = await analyzer.startAudioFile(file, (bands) => {
        engineRef.current?.setAudioBands(bands[0], bands[1], bands[2], bands[3]);
      });
      setAudioState(next);
      ensureAudioGenerativeTarget(engine);
    },
    [ensureAudioGenerativeTarget, getAudioAnalyzer]
  );

  const setGridResolution = useCallback((cols: number) => {
    engineRef.current?.setGridResolution(cols);
  }, []);

  const setFontSize = useCallback((fontSizePx: number) => {
    engineRef.current?.setFontSize(fontSizePx);
  }, []);

  const setRamp = useCallback((ramp: string, sortByDensity = false) => {
    engineRef.current?.setRamp(ramp, sortByDensity);
  }, []);

  const sortRampByVisualDensity = useCallback((): string => {
    return engineRef.current?.sortActiveRampByVisualDensity() ?? '';
  }, []);

  const setGrading = useCallback((partial: Partial<MediaGradingParams>) => {
    engineRef.current?.setGrading(partial);
  }, []);

  const setPalette = useCallback((partial: Partial<PaletteConfig>) => {
    engineRef.current?.setPalette(partial);
  }, []);

  const setPostFx = useCallback((partial: Partial<PostFxUniforms>) => {
    engineRef.current?.setPostFx(partial);
  }, []);

  const setFilterMode = useCallback((mode: AtlasFilterMode) => {
    engineRef.current?.setFilterMode(mode);
  }, []);

  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setPlaying(!engine.getSnapshot().isPlaying);
  }, []);

  const resetSimulation = useCallback(() => {
    engineRef.current?.resetSeed();
  }, []);

  const resetStyle = useCallback(() => {
    engineRef.current?.resetActiveStyle();
  }, []);

  const renderCompareSource = useCallback((targetCanvas: HTMLCanvasElement): boolean => {
    return engineRef.current?.renderCompareSource(targetCanvas) ?? false;
  }, []);

  const exportArtifact = useCallback(
    async (request: ExportArtifactRequest): Promise<ExportArtifactResult> => {
      const engine = engineRef.current;
      if (!engine) {
        throw new Error('ASCII Engine is not initialized.');
      }

      switch (request.format) {
        case 'txt': {
          const cellBuffer = engine.captureCellBuffer();
          return { format: 'txt', content: exportPlainText(cellBuffer) };
        }
        case 'ans': {
          const cellBuffer = engine.captureCellBuffer();
          return { format: 'ans', content: exportAnsiTrueColor(cellBuffer) };
        }
        case 'svg': {
          const cellBuffer = engine.captureCellBuffer();
          const metrics = engine.getAtlasMetrics();
          const snap = engine.getSnapshot();
          return {
            format: 'svg',
            content: exportSvg(cellBuffer, metrics, snap.palette),
          };
        }
        case 'png': {
          const blob = await exportPng(engine, request.scaleFactor ?? 2);
          return { format: 'png', blob };
        }
        case 'video': {
          const result = await exportVideo(
            engine,
            request.durationMs,
            request.fps ?? 30,
            request.onProgress
          );
          return { format: 'video', ...result };
        }
      }
    },
    []
  );

  // --- Pointer Forwarding to Grid Coordinates ---

  const forwardPointer = useCallback(
    (event: ReactPointerEvent<HTMLElement>, isDownEvent: boolean) => {
      const engine = engineRef.current;
      const canvas = canvasRef.current;
      if (!engine || !canvas) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const normX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

      const prev = lastPointerPosRef.current;
      const speed = prev
        ? Math.hypot(normX - prev.x, normY - prev.y)
        : 0;
      lastPointerPosRef.current = { x: normX, y: normY };

      const isActive = pointerDownRef.current || isDownEvent;
      engine.setPointer(normX, normY, isActive, speed);

      if (isActive) {
        const snap = engine.getSnapshot();
        const gridX = Math.floor(normX * snap.cols);
        const gridY = Math.floor(normY * snap.rows);
        engine.injectPointerDrop(gridX, gridY, 3);
      }
    },
    []
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      pointerDownRef.current = true;
      forwardPointer(event, true);
    },
    [forwardPointer]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      forwardPointer(event, false);
    },
    [forwardPointer]
  );

  const onPointerUp = useCallback(() => {
    pointerDownRef.current = false;
    const last = lastPointerPosRef.current;
    if (last && engineRef.current) {
      engineRef.current.setPointer(last.x, last.y, false, 0);
    }
  }, []);

  return {
    containerRef,
    canvasRef,
    snapshot,
    audioState,
    setStyle,
    updateUniform,
    loadMediaFile,
    loadSamplePreset,
    toggleWebcam,
    toggleAudioMic,
    loadAudioFile,
    stopAudio,
    setGridResolution,
    setFontSize,
    setRamp,
    sortRampByVisualDensity,
    setGrading,
    setPalette,
    setPostFx,
    setFilterMode,
    togglePlay,
    resetSimulation,
    resetStyle,
    renderCompareSource,
    exportArtifact,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
