'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Grid2x2,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  Sliders,
  Terminal,
  X,
} from 'lucide-react';

import { styleRegistry } from '../../registry';

export interface HeaderBarProps {
  readonly activeRoute: 'studio' | 'styles';
  readonly sidebarOpen?: boolean;
  readonly onToggleSidebar?: () => void;
}

export function HeaderBar({
  activeRoute,
  sidebarOpen = false,
  onToggleSidebar,
}: HeaderBarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const totalStyles = styleRegistry.listAllStyles().length;

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

  return (
    <header className="relative z-40 shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]">
      <div className="flex h-12 items-center justify-between px-4">
        {/* Left: Brand Identity + Primary Route Links */}
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
              <Terminal className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-white">
              ASCII Studio
            </span>
            <span className="hidden rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 lg:inline-block">
              WebGL2 · Client-Side
            </span>
          </Link>

          <nav
            aria-label="Workspace routes"
            className="hidden items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-0.5 md:flex"
          >
            <Link
              href="/"
              aria-current={activeRoute === 'studio' ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
                activeRoute === 'studio'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>Studio</span>
            </Link>
            <Link
              href="/styles"
              aria-current={activeRoute === 'styles' ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
                activeRoute === 'styles'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              <Grid2x2 className="h-3.5 w-3.5" />
              <span>Styles</span>
              <span className="rounded bg-zinc-950/80 px-1 py-0.2 font-mono text-[10px] tabular-nums text-zinc-400">
                {totalStyles}
              </span>
            </Link>
          </nav>
        </div>

        {/* Right: Route Action CTA / Studio Inspector Toggle + Mobile Hamburger */}
        <div className="flex items-center gap-2">
          {activeRoute === 'studio' ? (
            <>
              <span className="hidden font-mono text-[11px] text-zinc-500 xl:inline">
                Space: Play/Pause · 1–9: Styles · ⌘/Ctrl+E: Export
              </span>
              {onToggleSidebar && (
                <button
                  type="button"
                  onClick={onToggleSidebar}
                  aria-label={sidebarOpen ? 'Collapse inspector' : 'Expand inspector'}
                  aria-expanded={sidebarOpen}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                >
                  {sidebarOpen ? (
                    <PanelRightClose className="h-4 w-4" />
                  ) : (
                    <PanelRightOpen className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">Inspector</span>
                </button>
              )}
            </>
          ) : (
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            >
              <span>Open Studio</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}

          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav-drawer"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] md:hidden"
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer (< 768px) */}
      {mobileMenuOpen && (
        <nav
          id="mobile-nav-drawer"
          aria-label="Mobile workspace navigation"
          className="border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-3 md:hidden"
        >
          <div className="flex flex-col gap-1.5">
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              aria-current={activeRoute === 'studio' ? 'page' : undefined}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition ${
                activeRoute === 'studio'
                  ? 'border-[var(--border-active)] bg-[var(--accent-signal-soft)] text-white'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Sliders className="h-3.5 w-3.5 text-emerald-400" />
                Studio Workspace
              </span>
              <span className="font-mono text-[10px] text-zinc-400">/</span>
            </Link>
            <Link
              href="/styles"
              onClick={() => setMobileMenuOpen(false)}
              aria-current={activeRoute === 'styles' ? 'page' : undefined}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition ${
                activeRoute === 'styles'
                  ? 'border-[var(--border-active)] bg-[var(--accent-signal-soft)] text-white'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Grid2x2 className="h-3.5 w-3.5 text-sky-400" />
                Styles Gallery
              </span>
              <span className="font-mono text-[10px] tabular-nums text-zinc-400">
                {totalStyles} styles
              </span>
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
