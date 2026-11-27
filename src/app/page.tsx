'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { PanelRightClose, PanelRightOpen, Terminal } from 'lucide-react';

import { ExportModal } from '../components/studio/ExportModal';
import { StudioViewport } from '../components/studio/StudioViewport';
import { StyleControlsPanel } from '../components/studio/StyleControlsPanel';
import { useAsciiEngine } from '../hooks/useAsciiEngine';
import { styleRegistry } from '../registry';

export default function AsciiStudioPage() {
  const {
    containerRef,
    canvasRef,
    snapshot,
    setStyle,
    updateUniform,
    loadMediaFile,
    loadSamplePreset,
    toggleWebcam,
    setFontSize,
    setRamp,
    sortRampByVisualDensity,
    setGrading,
    setPalette,
    setPostFx,
    setFilterMode,
    togglePlay,
    resetSimulation,
    exportArtifact,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = useAsciiEngine('classic-density');

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);

  const quickStyleIds = useMemo(
    () => styleRegistry.listAllStyles().map((s) => s.id),
    []
  );

  // Global Studio Keyboard Shortcuts: Space (play/pause), Cmd/Ctrl+E (export), 1-9 (styles)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditingText =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        Boolean(target?.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setExportOpen((open) => !open);
        return;
      }

      if (isEditingText || exportOpen) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
        return;
      }

      if (e.key >= '1' && e.key <= '9') {
        const idx = Number(e.key) - 1;
        const styleId = quickStyleIds[idx];
        if (styleId) {
          e.preventDefault();
          setStyle(styleId);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exportOpen, quickStyleIds, setStyle, togglePlay]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Top Studio Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800/80 bg-zinc-950 px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
            <Terminal className="h-4 w-4" />
          </div>
          <h1 className="text-sm font-semibold tracking-tight text-white">
            ASCII Studio
          </h1>
          <span className="hidden rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 sm:inline-block">
            WebGL2 · Client-Side
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-[11px] text-zinc-500 md:inline">
            Space: Play/Pause · 1–8: Styles · ⌘/Ctrl+E: Export
          </span>
          <button
            type="button"
            onClick={() => setSidebarOpen((s) => !s)}
            aria-label={sidebarOpen ? 'Collapse inspector' : 'Expand inspector'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            {sidebarOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Inspector</span>
          </button>
        </div>
      </header>

      {/* Responsive Split-Pane Workspace */}
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        <section className="relative flex min-w-0 flex-1">
          <StudioViewport
            containerRef={containerRef}
            canvasRef={canvasRef}
            snapshot={snapshot}
            onTogglePlay={togglePlay}
            onToggleWebcam={toggleWebcam}
            onLoadFile={loadMediaFile}
            onLoadSamplePreset={loadSamplePreset}
            onResetSimulation={resetSimulation}
            onOpenExport={() => setExportOpen(true)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        </section>

        {/* Docked Desktop Inspector / Collapsible Mobile Drawer */}
        {sidebarOpen && (
          <div className="absolute inset-y-0 right-0 z-30 w-80 border-l border-zinc-800/80 bg-zinc-950 shadow-2xl md:static md:w-[340px] lg:w-[360px] md:shadow-none">
            <StyleControlsPanel
              snapshot={snapshot}
              onSelectStyle={setStyle}
              onUpdateUniform={updateUniform}
              onSetFontSize={setFontSize}
              onSetFilterMode={setFilterMode}
              onSetRamp={setRamp}
              onSortRampByVisualDensity={sortRampByVisualDensity}
              onSetGrading={setGrading}
              onSetPalette={setPalette}
              onSetPostFx={setPostFx}
            />
          </div>
        )}
      </main>

      <ExportModal
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        onExport={exportArtifact}
      />
    </div>
  );
}
