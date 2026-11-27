'use client';

import React, { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, Search, X } from 'lucide-react';

import { HeaderBar } from '../../components/studio/HeaderBar';
import { StyleCard } from '../../components/studio/StyleCard';
import { styleRegistry } from '../../registry';
import type { StylePlugin } from '../../registry/types';

type GalleryCategoryId =
  | 'all'
  | 'realtime'
  | 'generative'
  | 'simulations'
  | 'high-res';

interface CategoryFilterDef {
  readonly id: GalleryCategoryId;
  readonly label: string;
  readonly match: (plugin: StylePlugin) => boolean;
}

const CATEGORY_FILTERS: readonly CategoryFilterDef[] = [
  {
    id: 'all',
    label: 'All',
    match: () => true,
  },
  {
    id: 'realtime',
    label: 'Real-Time Filters',
    match: (p) => p.mode === 'realtime',
  },
  {
    id: 'generative',
    label: 'Generative Shaders',
    match: (p) => p.mode === 'generative' && p.executionMode === 'glsl-fragment',
  },
  {
    id: 'simulations',
    label: 'Simulations',
    match: (p) => p.mode === 'generative' && p.executionMode === 'worker-grid',
  },
  {
    id: 'high-res',
    label: 'High-Res Unicode',
    match: (p) =>
      p.category === 'braille' || Boolean(p.supportsDirectionalGlyphs),
  },
] as const;

export default function StylesGalleryPage() {
  const allStyles = useMemo(() => styleRegistry.listAllStyles(), []);
  const [selectedCategory, setSelectedCategory] = useState<GalleryCategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const countsByCategory = useMemo(() => {
    const counts: Record<GalleryCategoryId, number> = {
      all: allStyles.length,
      realtime: 0,
      generative: 0,
      simulations: 0,
      'high-res': 0,
    };
    for (const def of CATEGORY_FILTERS) {
      counts[def.id] = allStyles.filter(def.match).length;
    }
    return counts;
  }, [allStyles]);

  const filteredStyles = useMemo(() => {
    const activeFilter =
      CATEGORY_FILTERS.find((c) => c.id === selectedCategory) ?? CATEGORY_FILTERS[0];
    const q = searchQuery.trim().toLowerCase();

    return allStyles.filter((plugin) => {
      if (activeFilter && !activeFilter.match(plugin)) return false;
      if (!q) return true;
      return (
        plugin.name.toLowerCase().includes(q) ||
        plugin.id.toLowerCase().includes(q) ||
        plugin.category.toLowerCase().includes(q) ||
        plugin.description.toLowerCase().includes(q) ||
        plugin.executionMode.toLowerCase().includes(q)
      );
    });
  }, [allStyles, searchQuery, selectedCategory]);

  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (idx + delta + CATEGORY_FILTERS.length) % CATEGORY_FILTERS.length;
    const nextFilter = CATEGORY_FILTERS[nextIdx];
    if (nextFilter) {
      setSelectedCategory(nextFilter.id);
      tabRefs.current[nextIdx]?.focus();
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-void)] text-[var(--text-primary)]">
      <HeaderBar activeRoute="styles" />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col border-x border-[var(--border-subtle)]">
        {/* Editorial Hero Header */}
        <section className="px-4 py-8 sm:px-8 sm:py-10">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
            /Curated Style Registry
          </p>
          <div className="mt-2.5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div className="max-w-2xl space-y-2.5">
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-4xl">
                Every filter and shader in ASCII Studio
              </h1>
              <p className="text-xs leading-relaxed text-[var(--text-secondary)] sm:text-sm">
                Inspect live outputs from our CPU kernel processors, GLSL ES 3.00 fragment shaders,
                and Web Worker simulations. Hover any card to peek source pixels or animate shaders,
                then jump straight into the Studio workspace.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-zinc-400">
              <span className="rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2.5 py-1 tabular-nums">
                {allStyles.length} Styles Loaded
              </span>
            </div>
          </div>
        </section>

        {/* Sticky Category Filter Tabs & Search */}
        <section
          aria-label="Filter and search styles"
          className="sticky top-0 z-30 border-y border-[var(--border-subtle)] bg-[var(--bg-void)]/95 px-4 py-3 backdrop-blur-md sm:px-8"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div
              role="tablist"
              aria-label="Style categories"
              className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5 lg:pb-0"
            >
              {CATEGORY_FILTERS.map((cat, idx) => {
                const isSelected = selectedCategory === cat.id;
                const count = countsByCategory[cat.id];
                return (
                  <button
                    key={cat.id}
                    ref={(el) => {
                      tabRefs.current[idx] = el;
                    }}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setSelectedCategory(cat.id)}
                    onKeyDown={(e) => handleTabKeyDown(e, idx)}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
                      isSelected
                        ? 'border-zinc-100 bg-zinc-100 text-zinc-950'
                        : 'border-[var(--border-default)] bg-[var(--bg-card)] text-zinc-300 hover:border-zinc-500 hover:text-white'
                    }`}
                  >
                    <span>{cat.label}</span>
                    <span
                      className={`font-mono text-[10px] tabular-nums ${
                        isSelected ? 'text-zinc-700' : 'text-zinc-500'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative w-full lg:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search filters or shaders..."
                aria-label="Search styles"
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] py-1.5 pr-8 pl-8 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search query"
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Responsive 1-4 Column Showcase Grid */}
        <section className="flex-1 px-4 py-8 sm:px-8">
          {filteredStyles.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredStyles.map((plugin) => (
                <StyleCard key={plugin.id} plugin={plugin} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-card)]/40 px-6 py-14 text-center">
              <p className="text-sm font-medium text-zinc-200">
                No styles match your current filter
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                Try clearing the search query or switching back to All styles.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory('all');
                  setSearchQuery('');
                }}
                className="mt-4 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:border-zinc-500"
              >
                Reset Filters
              </button>
            </div>
          )}
        </section>

        {/* Quiet Hardware Footer */}
        <footer className="flex flex-col items-start justify-between gap-3 border-t border-[var(--border-subtle)] px-4 py-5 text-xs text-zinc-500 sm:flex-row sm:items-center sm:px-8">
          <span className="font-mono text-[11px]">
            ASCII Studio · 100% Client-Side WebGL2 Instanced &amp; Web Worker Engine
          </span>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 font-medium text-emerald-300 hover:text-emerald-200"
          >
            <span>Open live Studio</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </footer>
      </main>
    </div>
  );
}
