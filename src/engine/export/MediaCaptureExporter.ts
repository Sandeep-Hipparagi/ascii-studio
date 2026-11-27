/**
 * High-DPI Raster (.png) & Real-Time Canvas Video (.webm / .mp4) Exporter.
 */

import type { AsciiEngine } from '../core/AsciiEngine';

export interface VideoExportResult {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly extension: 'webm' | 'mp4';
}

export async function exportPng(
  engine: AsciiEngine,
  scaleFactor = 2
): Promise<Blob> {
  const result = await engine.renderFrameAtTime(performance.now(), {
    scale: Math.max(1, scaleFactor),
    output: 'blob',
    mimeType: 'image/png',
  });

  if (result instanceof Blob) {
    return result;
  }

  throw new Error('Expected PNG Blob from renderFrameAtTime.');
}

function selectSupportedVideoMime(): {
  mimeType: string;
  extension: 'webm' | 'mp4';
} {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder API is not supported in this browser.');
  }

  const candidates: readonly { mimeType: string; extension: 'webm' | 'mp4' }[] = [
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
    { mimeType: 'video/mp4', extension: 'mp4' },
  ];

  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate.mimeType)) {
      return candidate;
    }
  }

  return { mimeType: 'video/webm', extension: 'webm' };
}

export async function exportVideo(
  engine: AsciiEngine,
  durationMs: number,
  fps = 30,
  onProgress?: (progress01: number) => void
): Promise<VideoExportResult> {
  const canvas = engine.getCanvas();
  if (typeof canvas.captureStream !== 'function') {
    throw new Error('canvas.captureStream() is not supported in this browser.');
  }

  const clampedDuration = Math.max(500, Math.min(30_000, durationMs));
  const { mimeType, extension } = selectSupportedVideoMime();

  const wasPlaying = engine.getSnapshot().isPlaying;
  if (!wasPlaying) {
    engine.setPlaying(true);
  }

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev: BlobEvent): void => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  };

  return await new Promise<VideoExportResult>((resolve, reject) => {
    const startMs = performance.now();
    let progressRaf: number | null = null;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (progressRaf !== null) cancelAnimationFrame(progressRaf);
      if (stopTimer !== null) clearTimeout(stopTimer);
      for (const track of stream.getTracks()) {
        track.stop();
      }
      if (!wasPlaying) {
        engine.setPlaying(false);
      }
    };

    recorder.onerror = (): void => {
      cleanup();
      reject(new Error('Video MediaRecorder encountered a recording error.'));
    };

    recorder.onstop = (): void => {
      cleanup();
      onProgress?.(1);
      const blob = new Blob(chunks, { type: mimeType });
      resolve({ blob, mimeType, extension });
    };

    const updateProgress = (): void => {
      const elapsed = performance.now() - startMs;
      onProgress?.(Math.min(0.99, Math.max(0, elapsed / clampedDuration)));
      if (recorder.state === 'recording') {
        progressRaf = requestAnimationFrame(updateProgress);
      }
    };

    recorder.start(100);
    progressRaf = requestAnimationFrame(updateProgress);
    stopTimer = setTimeout(() => {
      if (recorder.state === 'recording') {
        recorder.stop();
      }
    }, clampedDuration);
  });
}
