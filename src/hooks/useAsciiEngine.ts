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
import {
  REALTIME_STYLE_SAMPLE_PATHS,
  createProceduralSampleCanvas,
  loadStyleSampleImage,
  type SamplePresetId,
} from '../engine/realtime/samplePresets';
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

export type { SamplePresetId };

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

export function useAsciiEngine(initialStyleId = 'classic-density') {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<AsciiEngine | null>(null);
  const pendingStyleIdRef = useRef<string | null>(null);
  const hasCustomMediaRef = useRef(false);
  const sampleRequestSeqRef = useRef(0);
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

    const targetStyleId = pendingStyleIdRef.current ?? initialStyleId;
    pendingStyleIdRef.current = null;
    const initialPlugin = getStyleById(targetStyleId) ?? getStyleById(initialStyleId);
    engine.setMediaInput(createProceduralSampleCanvas('calibration'));
    if (initialPlugin) {
      engine.setStylePlugin(initialPlugin);
      if (
        initialPlugin.mode === 'realtime' &&
        REALTIME_STYLE_SAMPLE_PATHS[initialPlugin.id]
      ) {
        const reqSeq = ++sampleRequestSeqRef.current;
        void loadStyleSampleImage(initialPlugin.id).then((img) => {
          if (
            !cancelled &&
            img &&
            !hasCustomMediaRef.current &&
            sampleRequestSeqRef.current === reqSeq &&
            engineRef.current === engine
          ) {
            engine.setMediaInput(img);
          }
        });
      }
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
    const plugin = getStyleById(styleId);
    if (!plugin) return;

    const engine = engineRef.current;
    if (!engine) {
      pendingStyleIdRef.current = plugin.id;
      return;
    }

    if (plugin.mode === 'realtime' && !engine.getSnapshot().hasMediaInput) {
      engine.setMediaInput(createProceduralSampleCanvas('calibration'));
    }
    engine.setStylePlugin(plugin);

    if (
      plugin.mode === 'realtime' &&
      !hasCustomMediaRef.current &&
      REALTIME_STYLE_SAMPLE_PATHS[plugin.id]
    ) {
      const reqSeq = ++sampleRequestSeqRef.current;
      void loadStyleSampleImage(plugin.id).then((img) => {
        if (
          img &&
          !hasCustomMediaRef.current &&
          sampleRequestSeqRef.current === reqSeq &&
          engineRef.current === engine &&
          engine.getSnapshot().activeStyleId === plugin.id
        ) {
          engine.setMediaInput(img);
        }
      });
    }
  }, []);

  const updateUniform = useCallback((id: string, value: UniformValue) => {
    engineRef.current?.updateUniform(id, value);
  }, []);

  const loadSamplePreset = useCallback(
    (presetId: SamplePresetId) => {
      const engine = engineRef.current;
      if (!engine) return;
      hasCustomMediaRef.current = true;
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

      hasCustomMediaRef.current = true;
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
      hasCustomMediaRef.current = false;
      const activeId = engine.getSnapshot().activeStyleId ?? 'classic-density';
      if (REALTIME_STYLE_SAMPLE_PATHS[activeId]) {
        const reqSeq = ++sampleRequestSeqRef.current;
        void loadStyleSampleImage(activeId).then((img) => {
          if (
            img &&
            !hasCustomMediaRef.current &&
            sampleRequestSeqRef.current === reqSeq &&
            engineRef.current === engine
          ) {
            engine.setMediaInput(img);
          } else if (engineRef.current === engine && !engine.getSnapshot().hasMediaInput) {
            engine.setMediaInput(createProceduralSampleCanvas('calibration'));
          }
        });
      } else {
        engine.setMediaInput(createProceduralSampleCanvas('calibration'));
      }
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Webcam access is unavailable in this browser context.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    hasCustomMediaRef.current = true;
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
