'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { ExportModal } from '../components/studio/ExportModal';
import { HeaderBar } from '../components/studio/HeaderBar';
import { StudioViewport } from '../components/studio/StudioViewport';
import { StyleControlsPanel } from '../components/studio/StyleControlsPanel';
import { useAsciiEngine } from '../hooks/useAsciiEngine';
import { getStyleById, styleRegistry } from '../registry';

function StyleQuerySync({
  onSelectStyle,
}: {
  readonly onSelectStyle: (styleId: string) => void;
}) {
  const searchParams = useSearchParams();
  const styleParam = searchParams.get('style');
  const lastAppliedParamRef = useRef<string | null>(null);

  useEffect(() => {
    if (!styleParam || styleParam === lastAppliedParamRef.current) return;
    const plugin = getStyleById(styleParam);
    if (!plugin) return;
    lastAppliedParamRef.current = plugin.id;
    onSelectStyle(plugin.id);
  }, [onSelectStyle, styleParam]);

  return null;
}

export default function AsciiStudioPage() {
  const {
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
  } = useAsciiEngine('classic-density');

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // Open docked inspector by default on desktop/tablet viewports (>= 768px)
  // while keeping mobile (< 768px) unobstructed on initial load.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      setSidebarOpen(true);
    }
  }, []);

  const quickStyleIds = useMemo(
    () => styleRegistry.listAllStyles().map((s) => s.id),
    []
  );

  // Global Studio Keyboard Shortcuts: Space (play/pause), Cmd/Ctrl+E (export), 1-9 (styles), Escape (mobile drawer)
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

      if (e.key === 'Escape' && !exportOpen && typeof window !== 'undefined' && window.innerWidth < 768) {
        setSidebarOpen(false);
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
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-[var(--bg-panel)] text-[var(--text-primary)]">
      <Suspense fallback={null}>
        <StyleQuerySync onSelectStyle={setStyle} />
      </Suspense>

      <HeaderBar
        activeRoute="studio"
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((s) => !s)}
      />

      {/* Responsive Split-Pane Workspace */}
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        <section className="relative flex min-w-0 flex-1">
          <StudioViewport
            containerRef={containerRef}
            canvasRef={canvasRef}
            snapshot={snapshot}
            audioState={audioState}
            onTogglePlay={togglePlay}
            onToggleWebcam={toggleWebcam}
            onToggleAudioMic={toggleAudioMic}
            onLoadAudioFile={loadAudioFile}
            onStopAudio={stopAudio}
            onLoadFile={loadMediaFile}
            onLoadSamplePreset={loadSamplePreset}
            onRenderCompareSource={renderCompareSource}
            onResetSimulation={resetSimulation}
            onOpenExport={() => setExportOpen(true)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        </section>

        {/* Mobile Inspector Scrim Backdrop */}
        {sidebarOpen && (
          <div
            aria-hidden="true"
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 z-20 bg-black/60 backdrop-blur-[1px] md:hidden"
          />
        )}

        {/* Docked Desktop Inspector / Collapsible Mobile Slide-Over Drawer */}
        {sidebarOpen && (
          <div className="absolute inset-y-0 right-0 z-30 w-80 max-w-[88vw] border-l border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-2xl md:static md:w-[360px] lg:w-[384px] md:shadow-none">
            <StyleControlsPanel
              snapshot={snapshot}
              onSelectStyle={setStyle}
              onUpdateUniform={updateUniform}
              onResetStyle={resetStyle}
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
        snapshot={snapshot}
        onExport={exportArtifact}
      />
    </div>
  );
}
