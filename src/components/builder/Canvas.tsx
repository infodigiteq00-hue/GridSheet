"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate } from "motion";
import { suppressChartTooltips } from "@/components/ChartTooltip";
import { useActiveDataset, useAppStore } from "@/lib/store";
import { useWidgetDataResolver } from "@/lib/useWidgetData";
import { requestTileFromPrompt } from "@/lib/aiClient";
import { looksLikeEditIntent } from "@/lib/tileHeuristic";
import DashboardTile from "@/components/builder/DashboardTile";
import SyncStatus from "@/components/SyncStatus";
import { exportDashboardAsPdf } from "@/lib/exportPdf";
import { TYPE_LABEL, type WidgetType } from "@/lib/types";
import {
  createVelocityTracker,
  DRAG_THRESHOLD,
  prefersReducedMotion,
  rubberClamp,
  SPRING_MOVE,
} from "@/lib/fluid";
import {
  absolutePlacementStyle,
  asBox,
  boardHeight,
  clampHeight,
  clampSpan,
  colToX,
  GRID_COLS,
  MAX_HEIGHT,
  metricsFromInner,
  MIN_SPAN,
  nearestFree,
  nearestFreeUnbounded,
  ROW_SNAP,
  spanToWidth,
  xToCol,
  yToRow,
  type GridBox,
  type GridMetrics,
} from "@/lib/gridLayout";

interface Props {
  chatOpen?: boolean;
  onToggleChat?: () => void;
}

/** "Add a tile" grouped by what it's for, not the raw enum order — visuals first, then stats/text. */
const TILE_GROUPS: WidgetType[][] = [
  ["bar", "line", "area", "pie", "scatter", "gauge", "heatmap", "map"],
  ["kpi", "table", "pivot", "text"],
];

// The board's local origin sits at the center of a large but finite stage, so
// panning past it in any direction (negative col/row) still lands on
// positive, scrollable DOM coordinates — the same trick Figma-like canvases
// use rather than a truly unbounded (infinite-memory) plane.
const INFINITE_EXTENT = 10000;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;
const INFINITE_MAX_SPAN = 300;
const MINIMAP_W = 180;
const MINIMAP_H = 128;
const MINIMAP_PAD = 220;

function clampZoom(z: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

interface MinimapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  scale: number;
}

/** Logical (board-space) bounding box of every tile, padded, mapped to a
 * contain-fit scale for the minimap panel. */
function computeMinimapBounds(boxes: GridBox[], m: GridMetrics): MinimapBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    const left = colToX(b.col, m);
    const top = b.row;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, left + spanToWidth(b.colSpan, m));
    maxY = Math.max(maxY, top + b.height);
  }
  if (!isFinite(minX)) {
    minX = -MINIMAP_PAD;
    minY = -MINIMAP_PAD;
    maxX = MINIMAP_PAD;
    maxY = MINIMAP_PAD;
  } else {
    minX -= MINIMAP_PAD;
    minY -= MINIMAP_PAD;
    maxX += MINIMAP_PAD;
    maxY += MINIMAP_PAD;
  }
  const scale = Math.min(MINIMAP_W / (maxX - minX), MINIMAP_H / (maxY - minY));
  return { minX, minY, maxX, maxY, scale };
}

function othersOf(id: string): GridBox[] {
  return useAppStore
    .getState()
    .dashboard.widgets.filter((w) => w.id !== id)
    .map(asBox);
}

export default function Canvas({ chatOpen = false, onToggleChat }: Props) {
  const dataset = useActiveDataset();
  const datasets = useAppStore((s) => s.datasets);
  const resolveWidget = useWidgetDataResolver();
  const dashboard = useAppStore((s) => s.dashboard);
  const selectedId = useAppStore((s) => s.selectedId);
  const select = useAppStore((s) => s.select);
  const addWidget = useAppStore((s) => s.addWidget);
  const addCustomWidget = useAppStore((s) => s.addCustomWidget);
  const removeWidget = useAppStore((s) => s.removeWidget);
  const updateWidget = useAppStore((s) => s.updateWidget);
  const resizeWidget = useAppStore((s) => s.resizeWidget);
  const setBoardTitle = useAppStore((s) => s.setBoardTitle);

  const selectedWidget = dashboard.widgets.find((w) => w.id === selectedId) || null;
  const [tilePrompt, setTilePrompt] = useState("");
  const [tileType, setTileType] = useState<"auto" | WidgetType>("auto");
  const [tileLoading, setTileLoading] = useState(false);
  const [tileNote, setTileNote] = useState<string | null>(null);

  async function submitTilePrompt() {
    const text = tilePrompt.trim();
    // With no description, the dropdown alone still drops in a default tile
    // of that type — the old icon-bar behavior, just funneled through one bar.
    if (!text) {
      if (tileType !== "auto") addWidget(tileType);
      return;
    }
    if (!dataset || tileLoading) return;
    setTileLoading(true);
    setTileNote(null);
    try {
      const isEdit = !!selectedWidget && looksLikeEditIntent(text);
      const { widget, source, reason } = await requestTileFromPrompt(text, dataset, isEdit ? selectedWidget! : undefined);
      const finalWidget = tileType === "auto" ? widget : { ...widget, type: tileType };
      if (isEdit && selectedWidget) {
        updateWidget(selectedWidget.id, { ...finalWidget, id: selectedWidget.id });
      } else {
        addCustomWidget(finalWidget);
      }
      setTilePrompt("");
      if (source === "heuristic") {
        setTileNote(reason || "Using local keyword matching — add OPENAI_API_KEY in .env.local for smarter results.");
      }
    } catch (err) {
      setTileNote(err instanceof Error ? err.message : "Couldn't create that tile — try again.");
    } finally {
      setTileLoading(false);
    }
  }

  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLButtonElement>(null);
  const zoomCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const minimapPanelRef = useRef<HTMLDivElement>(null);
  const minimapViewportRef = useRef<HTMLDivElement>(null);
  // Mirrors the `minimapBounds` memo for use inside imperative handlers
  // (scroll listener, pointer gestures) whose closures aren't recreated every
  // render — same reasoning as zoomRef below.
  const minimapBoundsRef = useRef<MinimapBounds | null>(null);
  const tileEls = useRef(new Map<string, HTMLDivElement>());
  const velocity = useRef(createVelocityTracker());
  const dragOrigin = useRef({
    left: 0,
    top: 0,
    pointerX: 0,
    pointerY: 0,
    width: 0,
    height: 0,
    boardX: 0,
    boardY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    grabX: 0,
    grabY: 0,
  });
  const dragLive = useRef({ dx: 0, dy: 0 });
  const pendingPtr = useRef<{ id: string; x: number; y: number } | null>(null);
  const dropRef = useRef<GridBox | null>(null);
  const ignoreClick = useRef(false);
  const resizeLive = useRef<{
    id: string;
    corner: "br" | "tl";
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startSpan: number;
    startHeight: number;
    startLeftPx: number;
    startTopPx: number;
    colW: number;
    span: number;
    height: number;
    leftPx: number;
    topPx: number;
    maxSpan: number;
    maxHeight: number;
  } | null>(null);
  const panLive = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number; moved: boolean } | null>(null);

  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<GridBox | null>(null);
  const [resizeId, setResizeId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [innerW, setInnerW] = useState(800);
  const [infiniteMode, setInfiniteMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  // Pointer handlers set up in startTileDrag/startResize close over whatever
  // `zoom` was at gesture-start; reading a ref instead keeps live gestures
  // correct if the value changes mid-drag (or across renders that don't
  // re-run those effects).
  const zoomRef = useRef(1);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const widgets = dashboard.widgets;
  const boxes = useMemo(() => widgets.map(asBox), [widgets]);
  // A tile's pixel geometry must be based on one stable board width. Scaling
  // it from the currently occupied columns makes charts resize themselves
  // after every move and is what caused clipped/tiny widget bodies.
  const metrics = useMemo(() => metricsFromInner(innerW), [innerW]);
  const minimapBounds = useMemo(() => computeMinimapBounds(boxes, metrics), [boxes, metrics]);

  /** Viewport point → board-local px. Scroll lives on canvasRef, not boardRef. */
  function screenToBoard(screenX: number, screenY: number): { x: number; y: number } | null {
    const board = boardRef.current;
    if (!board) return null;
    // getBoundingClientRect() already reflects the current scroll position
    // and the zoomed-stage transform, so the scroller's own scrollLeft/Top
    // would just cancel out of a "screen → content → minus board offset"
    // computation — the visual distance from the cursor to the board's
    // current on-screen corner, divided by zoom, is the logical offset
    // directly.
    const bRect = board.getBoundingClientRect();
    const z = zoomRef.current || 1;
    return { x: (screenX - bRect.left) / z, y: (screenY - bRect.top) / z };
  }

  /** Positions the minimap's viewport rectangle from the current scroll/zoom
   * state. Reuses screenToBoard on the scroller's own corners rather than
   * hand-deriving from scrollLeft, for the same robustness reason zoomBy
   * does — imperative, called from gesture handlers/listeners, never from
   * React render. */
  function updateMinimapViewport() {
    const scroller = canvasRef.current;
    const el = minimapViewportRef.current;
    const b = minimapBoundsRef.current;
    if (!scroller || !el || !b) return;
    const r = scroller.getBoundingClientRect();
    const topLeft = screenToBoard(r.left, r.top);
    const bottomRight = screenToBoard(r.right, r.bottom);
    if (!topLeft || !bottomRight) return;
    el.style.left = `${(topLeft.x - b.minX) * b.scale}px`;
    el.style.top = `${(topLeft.y - b.minY) * b.scale}px`;
    el.style.width = `${Math.max(6, (bottomRight.x - topLeft.x) * b.scale)}px`;
    el.style.height = `${Math.max(6, (bottomRight.y - topLeft.y) * b.scale)}px`;
  }

  /** Scrolls so the given board-local (logical) point becomes the center of
   * the viewport, at the current zoom. Used by the minimap's click/drag-to-
   * pan and by resetView. */
  function centerOn(boardX: number, boardY: number) {
    const scroller = canvasRef.current;
    const board = boardRef.current;
    if (!scroller || !board) return;
    const r = scroller.getBoundingClientRect();
    const bRect = board.getBoundingClientRect();
    const z = zoomRef.current || 1;
    const screenX = bRect.left + boardX * z;
    const screenY = bRect.top + boardY * z;
    scroller.scrollLeft += screenX - (r.left + r.width / 2);
    scroller.scrollTop += screenY - (r.top + r.height / 2);
    updateMinimapViewport();
  }

  useEffect(() => {
    minimapBoundsRef.current = minimapBounds;
    updateMinimapViewport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minimapBounds]);

  useLayoutEffect(() => {
    if (!infiniteMode) return;
    const id = requestAnimationFrame(() => {
      const el = canvasRef.current;
      if (!el) return;
      // Center the viewport on the board's own origin (where existing tiles
      // already cluster at small col/row values) rather than a fixed offset,
      // so entering the canvas always shows the board with room to pan any
      // direction from there.
      const r = el.getBoundingClientRect();
      el.scrollLeft = INFINITE_EXTENT - r.width / 2;
      el.scrollTop = INFINITE_EXTENT - r.height / 2;
      updateMinimapViewport();
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infiniteMode]);

  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => setInnerW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The minimap's viewport rectangle tracks live scroll position. Panning is
  // native browser scrolling (not React-driven), so this has to be a real
  // scroll listener rather than something derived from render state — and
  // it's rAF-throttled since scroll can fire far faster than once per frame.
  useEffect(() => {
    if (!infiniteMode) return;
    const scroller = canvasRef.current;
    if (!scroller) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateMinimapViewport();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    updateMinimapViewport();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infiniteMode]);

  const bindTile = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) tileEls.current.set(id, el);
    else tileEls.current.delete(id);
  }, []);

  function dragTranslate(): { x: number; y: number } {
    const o = dragOrigin.current;
    const d = dragLive.current;
    const scroller = canvasRef.current;
    // scrollLeft/scrollTop move the zoomed stage's visual position 1:1 in
    // screen pixels (confirmed empirically — scrolling by N always shifts
    // getBoundingClientRect by exactly -N regardless of zoom, even though
    // scrollWidth itself is reported in unscaled layout units; the two are
    // just inconsistent with each other, and only the scroll→position
    // relationship matters here). So d.dx and the scroll delta are already in
    // the same visual-pixel space; only their sum needs the /z conversion
    // down to the logical units the tile's own transform/left/top use.
    const dsl = scroller ? scroller.scrollLeft - o.scrollLeft : 0;
    const dst = scroller ? scroller.scrollTop - o.scrollTop : 0;
    const z = zoomRef.current || 1;
    return { x: (d.dx + dsl) / z, y: (d.dy + dst) / z };
  }

  const applyDragTransform = useCallback((id: string) => {
    const el = tileEls.current.get(id);
    if (!el) return;
    const { x, y } = dragTranslate();
    el.style.zIndex = "80";
    el.style.pointerEvents = "none";
    el.style.willChange = "transform";
    el.style.transform = `translate(${x}px, ${y}px)`;
  }, []);

  useLayoutEffect(() => {
    if (!dragId) return;
    applyDragTransform(dragId);
  }, [applyDragTransform, dragId, drop]);

  function liveMetrics() {
    return metrics;
  }


  function dropFromPointer(id: string, dx: number, dy: number): GridBox | null {
    const widget = useAppStore.getState().dashboard.widgets.find((w) => w.id === id);
    if (!widget) return null;
    const origin = dragOrigin.current;
    // Keep the point that was grabbed under the pointer. Without this offset,
    // grabbing a chart in the middle of a tile makes its top-left corner jump
    // to the pointer before collision snapping is applied.
    const local = screenToBoard(
      origin.left + dx - origin.grabX,
      origin.top + dy - origin.grabY
    );
    if (!local) return null;
    const box = asBox(widget);
    const m = liveMetrics();
    const desired: GridBox = {
      ...box,
      // Infinite canvas keeps the released pixel position, in any direction
      // (negative col/row included — the board's origin sits at the stage's
      // center, not its edge). The grid editor still uses its normal
      // column/row snapping and non-negative clamp outside this mode.
      col: infiniteMode ? local.x / m.step : xToCol(local.x, box.colSpan, m),
      row: infiniteMode ? local.y : yToRow(local.y),
    };
    const others = othersOf(id);
    if (infiniteMode) {
      // A tile should stay exactly where it's released; only when it truly
      // overlaps another tile do we hunt for the nearest open spot, in any
      // direction — not just cascade straight down past every blocker below it.
      const colStep = 96 / m.step;
      const slot = nearestFreeUnbounded(desired, others, colStep);
      return { ...desired, ...slot };
    }
    const slot = nearestFree(desired, others);
    return { ...box, ...slot };
  }

  function autoScrollCanvas(clientY: number) {
    const scroller = canvasRef.current;
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    const zone = 56;
    if (clientY > r.bottom - zone) {
      scroller.scrollTop += Math.ceil((clientY - (r.bottom - zone)) * 0.4);
    } else if (clientY < r.top + zone) {
      scroller.scrollTop -= Math.ceil((r.top + zone - clientY) * 0.4);
    }
  }

  function liftTile(id: string, pointerX: number, pointerY: number) {
    const el = tileEls.current.get(id);
    if (!el) return;
    suppressChartTooltips(true);
    const r = el.getBoundingClientRect();
    const local = screenToBoard(r.left, r.top);
    const scroller = canvasRef.current;
    dragOrigin.current = {
      left: r.left,
      top: r.top,
      pointerX,
      pointerY,
      width: r.width,
      height: r.height,
      boardX: local?.x ?? 0,
      boardY: local?.y ?? 0,
      scrollLeft: scroller?.scrollLeft ?? 0,
      scrollTop: scroller?.scrollTop ?? 0,
      grabX: pointerX - r.left,
      grabY: pointerY - r.top,
    };
    dragLive.current = { dx: 0, dy: 0 };
    applyDragTransform(id);
    document.body.classList.add("is-tile-dragging");
  }

  function clearLiftStyles(id: string) {
    const el = tileEls.current.get(id);
    if (!el) return;
    el.style.zIndex = "";
    el.style.pointerEvents = "";
    el.style.willChange = "";
    el.style.transform = "";
    document.body.classList.remove("is-tile-dragging");
    suppressChartTooltips(false);
  }

  function startCanvasPan(e: React.PointerEvent<HTMLDivElement>) {
    if (!infiniteMode || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".dashboard-tile, button, input, textarea, select, a")) return;
    const scroller = canvasRef.current;
    if (!scroller) return;
    e.preventDefault();
    panLive.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const pan = panLive.current;
      if (!pan || !canvasRef.current) return;
      const dx = ev.clientX - pan.x;
      const dy = ev.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        pan.moved = true;
        ignoreClick.current = true;
      }
      canvasRef.current.scrollLeft = pan.scrollLeft - dx;
      canvasRef.current.scrollTop = pan.scrollTop - dy;
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      panLive.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  function startTileDrag(id: string) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("button, textarea, input, select, .dashboard-resize-hit")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      pendingPtr.current = { id, x: e.clientX, y: e.clientY };
      select(id);
      suppressChartTooltips(true);
      velocity.current.reset();
      velocity.current.add(e.clientX, e.clientY);

      const move = (ev: PointerEvent) => {
        const pending = pendingPtr.current;
        if (!pending || pending.id !== id) return;
        velocity.current.add(ev.clientX, ev.clientY);
        const dist = Math.hypot(ev.clientX - pending.x, ev.clientY - pending.y);
        const lifting = document.body.classList.contains("is-tile-dragging");
        if (!lifting && dist < DRAG_THRESHOLD) return;
        if (!lifting) {
          liftTile(id, pending.x, pending.y);
          const widget = useAppStore.getState().dashboard.widgets.find((w) => w.id === id);
          const start = asBox(widget ?? { id, col: 0, row: 0, colSpan: 4, height: 160 });
          dropRef.current = start;
          setDragId(id);
          setDrop(start);
        }
        const origin = dragOrigin.current;
        dragLive.current = { dx: ev.clientX - origin.pointerX, dy: ev.clientY - origin.pointerY };
        autoScrollCanvas(ev.clientY);
        applyDragTransform(id);
        // Compute the candidate immediately. The tile itself is transformed
        // outside React, so waiting for a render frame here could leave the
        // release handler with a stale slot.
        const next = dropFromPointer(id, dragLive.current.dx, dragLive.current.dy);
        if (!next) return;
        const prev = dropRef.current;
        if (prev && prev.col === next.col && prev.row === next.row) return;
        dropRef.current = next;
        setDrop(next);
      };

      // Scrolling the canvas (wheel, scrollbar, or the auto-scroll edge zone)
      // moves content under the tile without firing a pointermove. Without
      // this, the transform only gets recomputed on the next pointer
      // movement, so the tile visibly lags behind the scroll until the
      // cursor moves again — resync it on every scroll tick too.
      const onCanvasScroll = () => {
        if (document.body.classList.contains("is-tile-dragging")) applyDragTransform(id);
      };
      const scroller = canvasRef.current;
      scroller?.addEventListener("scroll", onCanvasScroll, { passive: true });

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        scroller?.removeEventListener("scroll", onCanvasScroll);
        pendingPtr.current = null;
        finishDrag(id);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    };
  }

  function finishDrag(id: string) {
    const el = tileEls.current.get(id);
    const lifted = document.body.classList.contains("is-tile-dragging");
    if (!lifted || !el) {
      dropRef.current = null;
      setDragId(null);
      setDrop(null);
      suppressChartTooltips(false);
      return;
    }
    ignoreClick.current = true;
    // Pointerup can arrive before the last pointermove has painted. Resolve
    // the final slot from the latest pointer delta so release never commits
    // the previous snap position.
    const latest = dropFromPointer(id, dragLive.current.dx, dragLive.current.dy);
    if (latest) {
      dropRef.current = latest;
    }
    const destBox = dropRef.current;
    const m = liveMetrics();

    const settle = () => {
      if (destBox) {
        const finalLeft = colToX(destBox.col, m);
        const finalTop = destBox.row;
        // Fold the live drag offset into left/top (the element's visual
        // position doesn't change) so we can spring left/top alone from here
        // — animating from the presentation value, never the logical one.
        const { x: liveX, y: liveY } = dragTranslate();
        const visualLeft = parseFloat(el.style.left || "0") + liveX;
        const visualTop = parseFloat(el.style.top || "0") + liveY;
        el.style.transform = "";
        el.style.left = `${visualLeft}px`;
        el.style.top = `${visualTop}px`;

        // The store commit — and with it dragId/drop clearing — is deferred
        // until the spring finishes. Committing early would hand this tile a
        // new left/top *and* a lifting:false zIndex mid-flight, and React
        // would overwrite whatever frame Motion had just painted underneath it.
        const commit = () => {
          updateWidget(id, { col: destBox.col, row: destBox.row });
          clearLiftStyles(id);
          dropRef.current = null;
          setDragId(null);
          setDrop(null);
        };

        if (prefersReducedMotion() || (visualLeft === finalLeft && visualTop === finalTop)) {
          el.style.left = `${finalLeft}px`;
          el.style.top = `${finalTop}px`;
          commit();
        } else {
          animate(el, { left: `${finalLeft}px`, top: `${finalTop}px` }, SPRING_MOVE).then(commit);
        }
      } else {
        clearLiftStyles(id);
        dropRef.current = null;
        setDragId(null);
        setDrop(null);
      }
    };

    settle();
  }

  /**
   * corner "br" (the original handle) grows right/down with col/row fixed.
   * corner "tl" mirrors it: the bottom-right corner stays anchored and col/row
   * shift left/up as the tile grows. In either direction, the tile being
   * resized keeps its intended slot and any overlapping neighbours reflow
   * beneath it when the resize commits.
   */
  function startResize(id: string, corner: "br" | "tl" = "br") {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button !== 0) return;
      const el = tileEls.current.get(id);
      if (!el) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect();
      const widget = useAppStore.getState().dashboard.widgets.find((w) => w.id === id);
      if (!widget) return;
      const box = asBox(widget);
      const liveMetricsNow = liveMetrics();
      const startLeftPx = parseFloat(el.style.left || "0") || colToX(box.col, liveMetricsNow);
      const startTopPx = parseFloat(el.style.top || "0") || box.row;
      suppressChartTooltips(true);
      el.style.width = `${r.width}px`;
      el.style.maxWidth = "none";
      el.style.height = `${box.height}px`;
      resizeLive.current = {
        id,
        corner,
        startX: e.clientX,
        startY: e.clientY,
        startW: r.width,
        startH: box.height,
        startSpan: box.colSpan,
        startHeight: box.height,
        startLeftPx,
        startTopPx,
        colW: liveMetricsNow.step,
        span: box.colSpan,
        height: box.height,
        leftPx: startLeftPx,
        topPx: startTopPx,
        // Neighbours are not a resize limit: committing uses the layout
        // reflow to make room for this tile. The only hard boundaries are the
        // board edges and the minimum/maximum tile size — except in infinite
        // mode, where there are no board edges (col/row can go negative) and
        // GRID_COLS is just the reference width for column math, not an
        // actual boundary, so a tile placed past column 12 must not have its
        // resize capped by "GRID_COLS - box.col" going negative.
        maxSpan: infiniteMode
          ? INFINITE_MAX_SPAN
          : corner === "tl"
            ? Math.max(MIN_SPAN, Math.floor(box.col + box.colSpan))
            : GRID_COLS - box.col,
        maxHeight: infiniteMode
          ? MAX_HEIGHT
          : corner === "tl"
            ? Math.max(120, Math.floor((box.row + box.height) / ROW_SNAP) * ROW_SNAP)
            : MAX_HEIGHT,
      };
      setResizeId(id);
      select(id);
      document.body.classList.add("is-tile-resizing");
      velocity.current.reset();
      velocity.current.add(e.clientX, e.clientY);

      const move = (ev: PointerEvent) => {
        const live = resizeLive.current;
        if (!live || live.id !== id) return;
        velocity.current.add(ev.clientX, ev.clientY);
        const node = tileEls.current.get(id);
        if (!node) return;
        const sign = corner === "tl" ? -1 : 1;
        // Raw pointer deltas are visual (post-zoom) pixels; width/height/left
        // styles set below are logical board units re-scaled by the zoomed
        // stage ancestor, so they must be normalized the same way drag is.
        const z = zoomRef.current || 1;
        const dxLogical = (ev.clientX - live.startX) / z;
        const dyLogical = (ev.clientY - live.startY) / z;
        const rawW = live.startW + sign * dxLogical;
        const rawH = live.startH + sign * dyLogical;
        const maxW = spanToWidth(live.maxSpan, liveMetrics());
        const visualW = rubberClamp(rawW, spanToWidth(2, liveMetrics()), maxW, live.startW);
        const visualH = rubberClamp(rawH, 120, live.maxHeight, live.startH);
        const span = clampSpan(live.startSpan + sign * dxLogical / live.colW);
        node.style.width = `${visualW}px`;
        node.style.height = `${visualH}px`;
        live.span = Math.min(live.maxSpan, span);
        live.height = Math.min(live.maxHeight, clampHeight(visualH));
        if (corner === "tl") {
          const newLeft = live.startLeftPx - (visualW - live.startW);
          const newTop = live.startTopPx - (visualH - live.startH);
          node.style.left = `${newLeft}px`;
          node.style.top = `${newTop}px`;
          live.leftPx = newLeft;
          live.topPx = newTop;
        }
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        const live = resizeLive.current;
        const node = tileEls.current.get(id);
        document.body.classList.remove("is-tile-resizing");
        suppressChartTooltips(false);
        if (!live || !node) {
          setResizeId(null);
          return;
        }
        const span = live.span;
        const height = live.height;
        const finalWidth = spanToWidth(span, liveMetrics());
        // Derived from the same column-index arithmetic maxGrowTopLeft used to
        // bound this drag — NOT from live pixel tracking divided back by the
        // column step. spanToWidth bakes an inter-column gap into every span
        // that a naive px/step round-trip doesn't reproduce, and that small
        // mismatch is enough to register as a false collision against the
        // neighbour this resize is snug against, teleporting the tile via
        // the store's constrainBox fallback instead of landing where dragged.
        const finalCol = corner === "tl" ? box.col + box.colSpan - span : box.col;
        const finalRow = corner === "tl" ? box.row + box.height - height : box.row;
        const finalLeft = colToX(finalCol, liveMetrics());
        const finalTop = finalRow;
        const currentW = parseFloat(node.style.width || String(live.startW));
        const currentH = parseFloat(node.style.height || String(live.startH));
        const currentLeft = parseFloat(node.style.left || String(live.startLeftPx));
        const currentTop = parseFloat(node.style.top || String(live.startTopPx));
        resizeLive.current = null;

        // Deferred until the spring settles, same reasoning as the drag
        // settle above: committing early hands React a resizing:false prop
        // that would drop this tile's zIndex mid-animation.
        const commit = () => {
          node.style.width = "";
          node.style.maxWidth = "";
          node.style.height = "";
          if (corner === "tl") {
            node.style.left = "";
            node.style.top = "";
            resizeWidget(id, { colSpan: span, height, col: finalCol, row: finalRow });
          } else {
            resizeWidget(id, { colSpan: span, height });
          }
          setResizeId(null);
        };

        // A resize that hit a rubber-banded boundary needs to spring back
        // from the overshoot to the true clamped size instead of snapping.
        const settled =
          currentW === finalWidth && currentH === height && (corner !== "tl" || (currentLeft === finalLeft && currentTop === finalTop));

        if (prefersReducedMotion() || settled) {
          node.style.width = `${finalWidth}px`;
          node.style.height = `${height}px`;
          if (corner === "tl") {
            node.style.left = `${finalLeft}px`;
            node.style.top = `${finalTop}px`;
          }
          commit();
        } else {
          const targets: Record<string, string> =
            corner === "tl"
              ? { width: `${finalWidth}px`, height: `${height}px`, left: `${finalLeft}px`, top: `${finalTop}px` }
              : { width: `${finalWidth}px`, height: `${height}px` };
          animate(node, targets, SPRING_MOVE).then(commit);
        }
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    };
  }

  /**
   * Zoom while keeping the board point under (anchorX, anchorY) fixed on
   * screen. Applied fully imperatively — direct style/scroll mutation, no
   * setState — the same reasoning as drag/resize elsewhere in this file: a
   * wheel/pinch gesture can fire many events per frame, and routing each one
   * through React would re-render the entire widget tree (every chart on the
   * board) just to repaint a CSS transform. The React `zoom` state is only
   * resynced on a short debounce once the gesture settles, so the zoom
   * control's displayed percentage and any other reader of `zoom` catch up
   * without driving the live gesture through reconciliation.
   *
   * The scroll compensation below must happen synchronously, not deferred to
   * a later frame: reading the stage's position at the top of the next call
   * has to see THIS call's result, or a fast run of wheel ticks compounds
   * stale reads into a scroll position nowhere near any tile.
   *
   * Positions are measured directly via getBoundingClientRect rather than
   * hand-derived from scrollLeft/padding/layout math — scrollLeft's effect on
   * visual position is 1:1 in screen pixels (confirmed empirically), which is
   * all this needs; deriving the stage's absolute screen position from it
   * otherwise requires knowing the exact padding/layout offset, which is
   * fragile to get precisely right and was the source of an earlier version
   * of this function scrolling tiles out of view when zooming out.
   */
  function zoomBy(factor: number, anchorX?: number, anchorY?: number) {
    const scroller = canvasRef.current;
    const stage = stageRef.current;
    if (!scroller || !stage) return;
    const r = scroller.getBoundingClientRect();
    const ax = anchorX ?? r.left + r.width / 2;
    const ay = anchorY ?? r.top + r.height / 2;
    const oldZoom = zoomRef.current || 1;
    const newZoom = clampZoom(oldZoom * factor);
    if (newZoom === oldZoom) return;

    const stageRectBefore = stage.getBoundingClientRect();
    const logicalX = (ax - stageRectBefore.left) / oldZoom;
    const logicalY = (ay - stageRectBefore.top) / oldZoom;

    zoomRef.current = newZoom;
    stage.style.transform = `scale(${newZoom})`;
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(newZoom * 100)}%`;

    // Re-measure now that the transform changed (scroll hasn't moved yet),
    // then correct scroll by exactly the resulting screen-space error.
    const stageRectAfter = stage.getBoundingClientRect();
    const newScreenX = stageRectAfter.left + logicalX * newZoom;
    const newScreenY = stageRectAfter.top + logicalY * newZoom;
    scroller.scrollLeft += newScreenX - ax;
    scroller.scrollTop += newScreenY - ay;
    updateMinimapViewport();

    if (zoomCommitTimer.current) clearTimeout(zoomCommitTimer.current);
    zoomCommitTimer.current = setTimeout(() => setZoom(zoomRef.current), 150);
  }

  useEffect(() => {
    return () => {
      if (zoomCommitTimer.current) clearTimeout(zoomCommitTimer.current);
    };
  }, []);

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (!infiniteMode) return;
    // Plain wheel/trackpad scroll pans natively via overflow:auto. Only
    // Ctrl/Cmd+wheel (and trackpad pinch, which browsers report as wheel with
    // ctrlKey set) zooms — matching Figma's convention and leaving normal
    // scroll-to-pan alone.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    // A trackpad pinch can report a large deltaY in a single event; keeping
    // the exponent small makes each tick a gentle step instead of a jump
    // that's hard to visually follow.
    const factor = Math.exp(-e.deltaY * 0.003);
    zoomBy(factor, e.clientX, e.clientY);
  }

  function minimapPointToBoard(clientX: number, clientY: number): { x: number; y: number } | null {
    const panel = minimapPanelRef.current;
    const b = minimapBoundsRef.current;
    if (!panel || !b) return null;
    const rect = panel.getBoundingClientRect();
    return { x: (clientX - rect.left) / b.scale + b.minX, y: (clientY - rect.top) / b.scale + b.minY };
  }

  function startMinimapPan(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const jump = minimapPointToBoard(e.clientX, e.clientY);
    if (jump) centerOn(jump.x, jump.y);
    const move = (ev: PointerEvent) => {
      const p = minimapPointToBoard(ev.clientX, ev.clientY);
      if (p) centerOn(p.x, p.y);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  /** Zoom to 100% and recenter on the board's content — not just the origin,
   * so it still finds the tiles after they've been panned/dragged far away. */
  function resetView() {
    zoomRef.current = 1;
    setZoom(1);
    if (stageRef.current) stageRef.current.style.transform = "scale(1)";
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = "100%";
    if (zoomCommitTimer.current) clearTimeout(zoomCommitTimer.current);
    const b = minimapBoundsRef.current;
    if (b) {
      centerOn((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    } else {
      const scroller = canvasRef.current;
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        scroller.scrollLeft = INFINITE_EXTENT - r.width / 2;
        scroller.scrollTop = INFINITE_EXTENT - r.height / 2;
      }
    }
  }

  const dragHint = dragId
    ? "Drop in empty space — tiles won't overlap"
    : resizeId
      ? "Resizing…"
      : "Drag a tile into empty space · corner to resize";

  const boardMin = boardHeight(
    [
      ...boxes.filter((b) => b.id !== dragId),
      ...(drop ? [drop] : []),
    ],
    dragId ? 320 : 160
  );

  async function exportAsPdf() {
    if (exporting) return;
    const previousSelectedId = selectedId;
    setExporting(true);
    select(null);
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const node = canvasRef.current;
      if (!node) throw new Error("Dashboard canvas element not found");
      await exportDashboardAsPdf(node, {
        title: dashboard.boardTitle,
        meta: `${dataset?.fileName ?? "Sample data"} · ${datasets.reduce((sum, d) => sum + (d.rows?.length ?? 0), 0)} rows`,
        fileName: dashboard.boardTitle,
      });
    } catch (err) {
      console.error("Failed to export dashboard as PDF", err);
    } finally {
      setExporting(false);
      select(previousSelectedId);
    }
  }

  return (
    <section
      className={`min-w-0 min-h-0 flex flex-col ${exporting ? "is-exporting" : ""} ${infiniteMode ? "dashboard-infinite-mode fixed inset-x-0 bottom-0 top-[62px] z-50" : ""}`}
    >
      <div className="flex items-center gap-3 px-[22px] py-3 border-b border-[rgba(23,22,26,0.08)]">
        <input
          value={dashboard.boardTitle}
          onChange={(e) => setBoardTitle(e.target.value)}
          className="dashboard-title-input border-0 bg-transparent font-display font-semibold text-xl tracking-[-0.025em] px-1.5 py-1 rounded-[7px] outline-none min-w-0 max-w-[320px] flex-1 focus:bg-[rgba(23,22,26,0.05)]"
          style={{ flexBasis: 140 }}
        />
        <div className="export-hide text-[12.5px] text-[#8a8990] flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis text-right">{dragHint}</div>
        <button
          type="button"
          onClick={() => {
            setInfiniteMode((value) => !value);
            zoomRef.current = 1;
            setZoom(1);
            if (stageRef.current) stageRef.current.style.transform = "";
          }}
          aria-pressed={infiniteMode}
          title={infiniteMode ? "Exit infinite canvas" : "Open infinite canvas"}
          className="flex-none whitespace-nowrap border px-3 py-2.5 rounded-[9px] text-[13px] font-medium cursor-pointer transition-colors"
          style={{
            borderColor: infiniteMode ? "#2b4bff" : "rgba(23,22,26,0.14)",
            background: infiniteMode ? "#e5e9ff" : "#fdfcfa",
            color: infiniteMode ? "#1a2fb8" : "#17161a",
          }}
        >
          {infiniteMode ? "Exit canvas" : "Infinite canvas"}
        </button>
        {onToggleChat && (
          <button
            onClick={onToggleChat}
            aria-pressed={chatOpen}
            className="flex-none whitespace-nowrap border rounded-[9px] px-3 py-2.5 text-[13px] font-medium cursor-pointer transition-transform active:scale-[0.97]"
            style={{
              borderColor: chatOpen ? "#2b4bff" : "rgba(23,22,26,0.14)",
              background: chatOpen ? "#e5e9ff" : "#fdfcfa",
              color: chatOpen ? "#1a2fb8" : "#17161a",
            }}
          >
            💬 Ask the data
          </button>
        )}
        <button
          onClick={exportAsPdf}
          disabled={exporting}
          className="flex-none whitespace-nowrap border-0 bg-[#2b4bff] text-white px-[17px] py-2.5 rounded-[9px] text-[13.5px] font-semibold cursor-pointer transition-transform active:scale-[0.97] disabled:opacity-60 disabled:cursor-default"
        >
          {exporting ? "Exporting…" : "Export as PDF"}
        </button>
      </div>

      {dataset?.sourceUrl && (
        <div className="px-[22px] py-2 border-b border-[rgba(23,22,26,0.08)] bg-[#f7f5f1]">
          <SyncStatus />
        </div>
      )}

      <div
        ref={canvasRef}
        id="dashboard-export-area"
        onPointerDown={startCanvasPan}
        onWheel={handleWheel}
        onClick={() => {
          if (ignoreClick.current) {
            ignoreClick.current = false;
            return;
          }
          select(null);
        }}
        className={`flex-1 overflow-auto p-[22px] relative ${infiniteMode ? "dashboard-infinite-scroll" : ""}`}
      >
        <div
          ref={stageRef}
          className={infiniteMode ? "dashboard-infinite-stage" : undefined}
          style={infiniteMode ? { transform: `scale(${zoom})`, transformOrigin: "0 0" } : undefined}
        >
        <div
          ref={boardRef}
          className="relative"
          style={{
            minHeight: boardMin,
            height: boardMin,
            // The stage is much larger than the board itself; anchoring the
            // board at the stage's center (rather than its edge) is what lets
            // a tile's col/row go negative and still land on positive,
            // scrollable DOM coordinates in every direction.
            ...(infiniteMode ? { position: "absolute", left: INFINITE_EXTENT, top: INFINITE_EXTENT, width: 1180 } : {}),
          }}
        >
          {widgets.map((w) => {
            const selected = selectedId === w.id;
            const data = resolveWidget(w);
            const lifting = dragId === w.id;
            const sheet = datasets.find((d) => d.id === (w.datasetId ?? dataset?.id));
            const box = asBox(w);
            return (
              <DashboardTile
                key={w.id}
                widget={w}
                selected={selected}
                lifting={lifting}
                resizing={resizeId === w.id}
                showSheet={datasets.length > 1}
                sheetLabel={sheet?.label}
                rows={data.rows}
                columns={data.columns}
                placement={absolutePlacementStyle(box, metrics)}
                tileRef={bindTile(w.id)}
                onSelect={() => select(w.id)}
                onRemove={() => removeWidget(w.id)}
                onTilePointerDown={startTileDrag(w.id)}
                onResizePointerDown={(corner) => startResize(w.id, corner)}
                onTextChange={(text) => updateWidget(w.id, { text })}
              />
            );
          })}

          {dashboard.widgets.length === 0 && (
            <div className="py-20 text-center text-[#8a8990]">
              <div className="font-display text-lg font-semibold text-[#17161a] mb-2">Nothing on the board yet</div>
              <div className="text-sm">Describe a tile below, or pick a type and add one.</div>
            </div>
          )}
        </div>
        </div>
      </div>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2">
        {tileNote && (
          <div className="max-w-[420px] rounded-[10px] border border-[rgba(23,22,26,0.12)] bg-[#fdfcfa] px-3 py-2 text-[12px] leading-[1.5] text-[#6b6a71] shadow-[0_6px_18px_rgba(23,22,26,0.12)]">
            {tileNote}
          </div>
        )}
        <div
          className="flex items-center gap-1 rounded-full border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] p-1.5 shadow-[0_10px_28px_rgba(23,22,26,0.16)]"
          style={{ width: 560 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <select
            value={tileType}
            onChange={(e) => setTileType(e.target.value as "auto" | WidgetType)}
            title="Chart type"
            className="flex-none h-9 rounded-full border-0 bg-[#f0eee8] pl-3 pr-2 text-[12.5px] font-medium text-[#3d3c44] outline-none cursor-pointer"
          >
            <option value="auto">Auto</option>
            {TILE_GROUPS.flat().map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <input
            value={tilePrompt}
            onChange={(e) => setTilePrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitTilePrompt();
              }
            }}
            placeholder={selectedWidget ? `Describe a change — e.g. "make this a bar chart"` : `Describe a tile — e.g. "revenue by region"`}
            className="flex-1 min-w-0 border-0 bg-transparent px-2 text-[13px] outline-none"
          />
          <button
            type="button"
            onClick={submitTilePrompt}
            disabled={tileLoading || (!tilePrompt.trim() && tileType === "auto")}
            className="flex-none whitespace-nowrap border-0 bg-[#2b4bff] text-white rounded-full px-4 h-9 text-[12.5px] font-semibold cursor-pointer transition-transform active:scale-95 disabled:opacity-45 disabled:cursor-default"
          >
            {tileLoading ? "Thinking…" : tilePrompt.trim() ? "✨ Generate" : "Add"}
          </button>
        </div>
      </div>

      {infiniteMode && (
        <div
          className="fixed bottom-6 right-6 z-[60] flex items-center gap-0.5 rounded-[11px] border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] p-1 shadow-[0_6px_20px_rgba(23,22,26,0.14)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            title="Zoom out"
            onClick={() => zoomBy(1 / 1.2)}
            className="h-8 w-8 rounded-[8px] text-[15px] font-medium cursor-pointer hover:bg-[rgba(23,22,26,0.06)]"
          >
            −
          </button>
          <button
            ref={zoomLabelRef}
            type="button"
            title="Reset zoom to 100%"
            onClick={() => zoomBy(1 / (zoomRef.current || 1))}
            className="min-w-[52px] px-1.5 h-8 rounded-[8px] text-[12.5px] font-medium tabular-nums cursor-pointer hover:bg-[rgba(23,22,26,0.06)]"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            title="Zoom in"
            onClick={() => zoomBy(1.2)}
            className="h-8 w-8 rounded-[8px] text-[15px] font-medium cursor-pointer hover:bg-[rgba(23,22,26,0.06)]"
          >
            +
          </button>
          <div className="mx-0.5 h-5 w-px bg-[rgba(23,22,26,0.12)]" />
          <button
            type="button"
            title="Reset view — 100% zoom, recentered on your tiles"
            onClick={resetView}
            className="h-8 w-8 rounded-[8px] text-[13px] font-medium cursor-pointer hover:bg-[rgba(23,22,26,0.06)]"
          >
            ⤾
          </button>
        </div>
      )}

      {infiniteMode && (
        <div
          ref={minimapPanelRef}
          onPointerDown={startMinimapPan}
          title="Drag to pan"
          className="fixed bottom-6 left-6 z-[60] cursor-crosshair overflow-hidden rounded-[11px] border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] shadow-[0_6px_20px_rgba(23,22,26,0.14)]"
          style={{ width: MINIMAP_W, height: MINIMAP_H }}
        >
          {boxes.map((b) => (
            <div
              key={b.id}
              className="absolute rounded-[2px] bg-[#2b4bff]/25 border border-[#2b4bff]/40"
              style={{
                left: (colToX(b.col, metrics) - minimapBounds.minX) * minimapBounds.scale,
                top: (b.row - minimapBounds.minY) * minimapBounds.scale,
                width: Math.max(2, spanToWidth(b.colSpan, metrics) * minimapBounds.scale),
                height: Math.max(2, b.height * minimapBounds.scale),
              }}
            />
          ))}
          <div
            ref={minimapViewportRef}
            className="absolute rounded-[3px] border-2 border-[#2b4bff] pointer-events-none"
            style={{ background: "rgba(43,75,255,0.08)" }}
          />
        </div>
      )}
    </section>
  );
}
