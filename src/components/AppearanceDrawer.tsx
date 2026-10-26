"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronsRight, Palette, X } from "lucide-react";
import { AppearanceControls } from "./AppearanceControls";

const STORAGE_KEY = "ft_appearance_panel";
const MIN_WIDTH = 260;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 340;

// A panel docked to the right edge: the page makes room for it (wide screens) so the kitchen or pantry stays
// visible while you change the look. Drag its left edge to resize; the width and open state are remembered.
export function AppearanceDrawer() {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [restored, setRestored] = useState(false);
  const dragging = useRef(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as {
        open?: boolean;
        width?: number;
      } | null;
      if (saved) {
        /* eslint-disable react-hooks/set-state-in-effect */
        setOpen(Boolean(saved.open));
        if (saved.width) setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, saved.width)));
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch {
      // defaults
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ open, width }));
    } catch {
      // the layout just will not persist
    }
    document.body.style.setProperty("--dock", open ? `${width}px` : "0px");
    return () => {
      document.body.style.removeProperty("--dock");
    };
  }, [open, width, restored]);

  function startDrag(e: React.PointerEvent) {
    dragging.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDrag(e: React.PointerEvent) {
    if (!dragging.current) return;
    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - e.clientX)));
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open appearance panel"
        title="Appearance"
        className="fixed bottom-24 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-paper-raised text-ink shadow-lg hover:bg-ink hover:text-paper md:bottom-6"
      >
        <Palette className="h-5 w-5" />
      </button>
    );
  }

  return (
    <aside
      aria-label="Appearance"
      style={{ width }}
      className="fixed right-0 top-0 z-50 flex h-full max-w-full flex-col border-l border-line bg-paper-raised text-ink shadow-2xl md:shadow-none"
    >
      <div
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={() => {
          dragging.current = false;
        }}
        title="Drag to resize"
        className="absolute left-0 top-0 hidden h-full w-2 -translate-x-1 cursor-col-resize touch-none md:block"
      />
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="label-caps text-ink-soft">Appearance</span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWidth(DEFAULT_WIDTH)}
            className="label-mono hidden px-2 text-ink-faint hover:text-ink md:block"
          >
            Reset width
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Collapse appearance panel"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-paper"
          >
            <ChevronsRight className="hidden h-4 w-4 md:block" />
            <X className="h-4 w-4 md:hidden" />
          </button>
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <AppearanceControls columns="narrow" />
        <p className="label-mono mt-6 text-ink-faint">
          <Link href="/settings" className="underline underline-offset-4">
            All settings
          </Link>{" "}
          · inbox, email parser, data
        </p>
      </div>
    </aside>
  );
}
