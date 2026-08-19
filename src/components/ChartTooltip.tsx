"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

export interface TooltipContent {
  title?: string;
  rows: TooltipRow[];
}

interface TooltipSnapshot {
  content: TooltipContent;
  x: number;
  y: number;
}

/**
 * Tooltip state lives outside React (module-level singleton + pub/sub) rather
 * than in component/store state. Chart widgets only ever call the imperative
 * show/move/hide functions below on hover — they never re-render themselves
 * on mousemove. Only the single <ChartTooltip /> subscriber (mounted once in
 * the root layout) re-renders as the pointer moves.
 */
let snapshot: TooltipSnapshot | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return null;
}

let tooltipsSuppressed = false;

function show(x: number, y: number, content: TooltipContent) {
  if (tooltipsSuppressed) return;
  if (typeof document !== "undefined" && document.body.classList.contains("is-tile-dragging")) return;
  snapshot = { x, y, content };
  notify();
}

function move(x: number, y: number) {
  if (tooltipsSuppressed || !snapshot) return;
  snapshot = { ...snapshot, x, y };
  notify();
}

function hide() {
  if (!snapshot) return;
  snapshot = null;
  notify();
}

export function suppressChartTooltips(on: boolean) {
  tooltipsSuppressed = on;
  if (on) hide();
}

type PointerLikeEvent = { clientX: number; clientY: number };

/**
 * Hook returning a factory for mouse handlers that wire an individual data
 * mark (a bar, point, segment, cell...) up to the shared floating tooltip.
 * `getContent` is only invoked on hover-start, so parent charts don't pay any
 * render cost for pointer movement.
 */
export function useChartTooltip() {
  return {
    handlers(getContent: () => TooltipContent) {
      return {
        onMouseEnter: (e: PointerLikeEvent) => show(e.clientX, e.clientY, getContent()),
        onMouseMove: (e: PointerLikeEvent) => move(e.clientX, e.clientY),
        onMouseLeave: () => hide(),
      };
    },
  };
}

const GAP = 14;
const EDGE = 8;

/** Singleton floating tooltip, portal-rendered to <body> with fixed
 * positioning so it always escapes clipped/overflow-hidden tile ancestors
 * and sits above every other tile. Mount exactly once (root layout). */
export function ChartTooltip() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const elRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; visible: boolean }>({ left: 0, top: 0, visible: false });

  useLayoutEffect(() => {
    if (!state || !elRef.current) {
      setPos((p) => (p.visible ? { ...p, visible: false } : p));
      return;
    }
    const rect = elRef.current.getBoundingClientRect();
    let left = state.x + GAP;
    let top = state.y + GAP;
    if (left + rect.width > window.innerWidth - EDGE) left = state.x - rect.width - GAP;
    if (top + rect.height > window.innerHeight - EDGE) top = state.y - rect.height - GAP;
    left = Math.max(EDGE, Math.min(left, window.innerWidth - rect.width - EDGE));
    top = Math.max(EDGE, Math.min(top, window.innerHeight - rect.height - EDGE));
    setPos({ left, top, visible: true });
  }, [state]);

  if (typeof document === "undefined" || !state) return null;

  return createPortal(
    <div
      ref={elRef}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        opacity: pos.visible ? 1 : 0,
        zIndex: 9999,
        pointerEvents: "none",
        background: "#17161a",
        color: "#f5f4f1",
        borderRadius: 10,
        padding: "8px 12px",
        minWidth: 96,
        maxWidth: 240,
        boxShadow: "0 18px 34px -14px rgba(23,22,26,0.5), 0 2px 8px rgba(23,22,26,0.22)",
        border: "1px solid rgba(255,255,255,0.09)",
        fontFamily: "var(--font-plex-sans), sans-serif",
        transition: "opacity 90ms ease-out",
      }}
    >
      {state.content.title && (
        <div
          style={{
            fontFamily: "var(--font-space-grotesk), sans-serif",
            fontWeight: 600,
            fontSize: 12.5,
            letterSpacing: "-0.01em",
            color: "#fff",
            marginBottom: state.content.rows.length ? 5 : 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {state.content.title}
        </div>
      )}
      {state.content.rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {state.content.rows.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5, color: "rgba(245,244,241,0.62)", minWidth: 0 }}>
                {r.color && <span style={{ width: 6, height: 6, borderRadius: 2, background: r.color, flex: "none" }} />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
              </span>
              <span style={{ fontFamily: "var(--font-plex-mono), monospace", fontWeight: 500, color: "#fff", flex: "none" }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}
