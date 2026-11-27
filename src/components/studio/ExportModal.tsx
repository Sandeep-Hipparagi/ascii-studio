'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, Copy, Check, Download, FileText, Code2, Film } from 'lucide-react';

import type {
  ExportArtifactRequest,
  ExportArtifactResult,
} from '../../hooks/useAsciiEngine';

export interface ExportModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onExport: (request: ExportArtifactRequest) => Promise<ExportArtifactResult>;
}

type ExportTab = 'text' | 'svg' | 'media';

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function triggerDownload(blobOrText: Blob | string, filename: string, mime: string): void {
  const blob =
    blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function stripAnsiEscapes(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, '');
}

export function ExportModal({ isOpen, onClose, onExport }: ExportModalProps) {
  const [tab, setTab] = useState<ExportTab>('text');
  const [textKind, setTextKind] = useState<'txt' | 'ans'>('txt');
  const [textPreview, setTextPreview] = useState('');
  const [svgContent, setSvgContent] = useState('');
  const [copied, setCopied] = useState(false);

  const [pngScale, setPngScale] = useState<1 | 2 | 4>(2);
  const [videoDurationSec, setVideoDurationSec] = useState<3 | 5 | 10>(5);
  const [recordingProgress, setRecordingProgress] = useState<number | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);

    if (tab === 'text') {
      void onExport({ format: textKind })
        .then((res) => {
          if (res.format === 'txt' || res.format === 'ans') {
            setTextPreview(res.content);
          }
        })
        .catch((err) => setErrorMsg(err instanceof Error ? err.message : 'Preview failed.'));
    } else if (tab === 'svg') {
      void onExport({ format: 'svg' })
        .then((res) => {
          if (res.format === 'svg') {
            setSvgContent(res.content);
          }
        })
        .catch((err) => setErrorMsg(err instanceof Error ? err.message : 'SVG build failed.'));
    }
  }, [isOpen, onExport, tab, textKind]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const svgBytes = useMemo(() => new Blob([svgContent]).size, [svgContent]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textPreview);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setErrorMsg('Clipboard access denied by browser.');
    }
  };

  const handlePngDownload = async () => {
    setErrorMsg(null);
    setBusyMessage(`Rendering ${pngScale}× PNG…`);
    try {
      const res = await onExport({ format: 'png', scaleFactor: pngScale });
      if (res.format === 'png') {
        triggerDownload(res.blob, `ascii-studio-${pngScale}x.png`, 'image/png');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'PNG export failed.');
    } finally {
      setBusyMessage(null);
    }
  };

  const handleVideoDownload = async () => {
    setErrorMsg(null);
    setRecordingProgress(0);
    try {
      const res = await onExport({
        format: 'video',
        durationMs: videoDurationSec * 1000,
        fps: 30,
        onProgress: (p) => setRecordingProgress(p),
      });
      if (res.format === 'video') {
        triggerDownload(
          res.blob,
          `ascii-studio-${videoDurationSec}s.${res.extension}`,
          res.mimeType
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Video recording failed.');
    } finally {
      setRecordingProgress(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export ASCII Studio Artwork"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold">Export Artwork</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export modal"
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 px-5 gap-2 text-xs">
          {(
            [
              { id: 'text', label: 'Text / ANSI', Icon: FileText },
              { id: 'svg', label: 'Vector (SVG)', Icon: Code2 },
              { id: 'media', label: 'Raster / Video', Icon: Film },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 font-medium transition ${
                tab === id
                  ? 'border-emerald-400 text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {errorMsg && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/60 px-3 py-2 text-xs text-red-200">
              {errorMsg}
            </div>
          )}

          {tab === 'text' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setTextKind('txt')}
                    className={`rounded-md px-3 py-1 font-medium ${
                      textKind === 'txt' ? 'bg-zinc-700 text-white' : 'text-zinc-400'
                    }`}
                  >
                    Plain UTF-8 (.txt)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTextKind('ans')}
                    className={`rounded-md px-3 py-1 font-medium ${
                      textKind === 'ans' ? 'bg-zinc-700 text-white' : 'text-zinc-400'
                    }`}
                  >
                    24-bit ANSI (.ans)
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerDownload(
                        textPreview,
                        `ascii-studio.${textKind}`,
                        'text/plain;charset=utf-8'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download .{textKind}
                  </button>
                </div>
              </div>

              <pre className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-black p-3 font-mono text-[10px] leading-[1.15] text-zinc-200">
                {textKind === 'ans' ? stripAnsiEscapes(textPreview) : textPreview}
              </pre>
            </div>
          )}

          {tab === 'svg' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <div>
                  <div className="text-xs font-semibold text-zinc-100">
                    Standalone Vector Document (.svg)
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Run-length merged background rectangles + exact monospace grid text.
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-emerald-300">
                    Estimated size: {formatByteSize(svgBytes)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    triggerDownload(svgContent, 'ascii-studio.svg', 'image/svg+xml;charset=utf-8')
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download .svg
                </button>
              </div>
            </div>
          )}

          {tab === 'media' && (
            <div className="space-y-4">
              {/* High-DPI PNG */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <div>
                  <div className="text-xs font-semibold text-zinc-100">
                    High-DPI Raster Snapshot (.png)
                  </div>
                  <div className="mt-2 inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
                    {([1, 2, 4] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setPngScale(s)}
                        className={`rounded-md px-2.5 py-1 font-mono font-medium ${
                          pngScale === s ? 'bg-zinc-700 text-white' : 'text-zinc-400'
                        }`}
                      >
                        {s}×
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busyMessage !== null || recordingProgress !== null}
                  onClick={handlePngDownload}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  {busyMessage ?? `Export ${pngScale}× PNG`}
                </button>
              </div>

              {/* Real-Time Canvas Video */}
              <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-zinc-100">
                      Canvas Video Capture (.webm / .mp4 @ 30 FPS)
                    </div>
                    <div className="mt-2 inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
                      {([3, 5, 10] as const).map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => setVideoDurationSec(sec)}
                          className={`rounded-md px-2.5 py-1 font-mono font-medium ${
                            videoDurationSec === sec
                              ? 'bg-zinc-700 text-white'
                              : 'text-zinc-400'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={recordingProgress !== null || busyMessage !== null}
                    onClick={handleVideoDownload}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    <Film className="h-3.5 w-3.5" />
                    {recordingProgress !== null
                      ? `Recording ${Math.round(recordingProgress * 100)}%`
                      : `Record ${videoDurationSec}s`}
                  </button>
                </div>

                {recordingProgress !== null && (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full bg-emerald-400 transition-all duration-100"
                      style={{ width: `${Math.round(recordingProgress * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
