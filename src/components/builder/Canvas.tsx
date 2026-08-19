"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate } from "motion";
import { suppressChartTooltips } from "@/components/ChartTooltip";
import { useActiveDataset, useAppStore } from "@/lib/store";
import { useWidgetDataResolver } from "@/lib/useWidgetData";
import DashboardTile from "@/components/builder/DashboardTile";
import SyncStatus from "@/components/SyncStatus";
import { exportDashboardAsPdf } from "@/lib/exportPdf";
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
  MAX_HEIGHT,
  maxGrow,
  maxGrowTopLeft,
  metricsFromInner,
  MIN_SPAN,
  nearestFree,
  nearestFreeUnbounded,
  ROW_SNAP,
  spanToWidth,
  xToCol,
  yToRow,
  type GridBox,
} from "@/lib/gridLayout";

interface Props {
  chatOpen?: boolean;
  onToggleChat?: () => void;
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
  const removeWidget = useAppStore((s) => s.removeWidget);
  const updateWidget = useAppStore((s) => s.updateWidget);
  const resizeWidget = useAppStore((s) => s.resizeWidget);
  const setBoardTitle = useAppStore((s) => s.setBoardTitle);

  const canvasRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
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

  const rows = dataset?.rows ?? [];
  const widgets = dashboard.widgets;
  const boxes = useMemo(() => widgets.map(asBox), [widgets]);
  // A tile's pixel geometry must be based on one stable board width. Scaling
  // it from the currently occupied columns makes charts resize themselves
  // after every move and is what caused clipped/tiny widget bodies.
  const metrics = useMemo(() => metricsFromInner(innerW), [innerW]);

  useLayoutEffect(() => {
    if (!infiniteMode) return;
    const id = requestAnimationFrame(() => {
      const el = canvasRef.current;
      if (!el) return;
      el.scrollLeft = 120;
      el.scrollTop = 110;
    });
    return () => cancelAnimationFrame(id);
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

  const bindTile = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) tileEls.current.set(id, el);
    else tileEls.current.delete(id);
  }, []);

  function dragTranslate(): { x: number; y: number } {
    const o = dragOrigin.current;
    const d = dragLive.current;
    const scroller = canvasRef.current;
    const dsl = scroller ? scroller.scrollLeft - o.scrollLeft : 0;
    const dst = scroller ? scroller.scrollTop - o.scrollTop : 0;
    return { x: d.dx + dsl, y: d.dy + dst };
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

  /** Viewport point → board-local px. Scroll lives on canvasRef, not boardRef. */
  function screenToBoard(screenX: number, screenY: number): { x: number; y: number } | null {
    const scroller = canvasRef.current;
    const board = boardRef.current;
    if (!scroller || !board) return null;
    const sRect = scroller.getBoundingClientRect();
    const bRect = board.getBoundingClientRect();
    const contentX = screenX - sRect.left + scroller.scrollLeft;
    const contentY = screenY - sRect.top + scroller.scrollTop;
    const boardX = bRect.left - sRect.left + scroller.scrollLeft;
    const boardY = bRect.top - sRect.top + scroller.scrollTop;
    return { x: contentX - boardX, y: contentY - boardY };
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
      // Infinite canvas keeps the released pixel position. The grid editor
      // still uses its normal column/row snapping outside this mode.
      col: infiniteMode
        ? Math.max(0, local.x / m.step)
        : xToCol(local.x, box.colSpan, m),
      row: infiniteMode ? Math.max(0, local.y) : yToRow(local.y),
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
   * shift left/up as the tile grows, since there's no "push left/up" layout
   * equivalent to lean on the way resizeWidget's pushDownLayout covers height.
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
      const others = othersOf(id);
      const grow = corner === "tl" ? maxGrowTopLeft(box, others) : maxGrow(box, others);
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
        // Floored, not rounded: the store re-snaps colSpan/height to a whole
        // column / ROW_SNAP multiple on commit (asBox, inside constrainBox),
        // and box.col can be a fractional, continuous value after any
        // infinite-canvas drag. Rounding grow's bound up here would let this
        // resize claim more room than actually exists — the store would
        // silently re-snap it, and the animated target and the committed
        // result would drift apart, undoing the point of animating at all.
        maxSpan: Math.max(MIN_SPAN, Math.floor(grow.colSpan)),
        // Height growth is unbounded toward the bottom (resizeWidget pushes
        // anything in the way down); toward the top there's nothing to push,
        // so it has to stay within the real gap above.
        maxHeight: corner === "tl" ? Math.max(120, Math.floor(grow.height / ROW_SNAP) * ROW_SNAP) : MAX_HEIGHT,
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
        const rawW = live.startW + sign * (ev.clientX - live.startX);
        const rawH = live.startH + sign * (ev.clientY - live.startY);
        const maxW = spanToWidth(live.maxSpan, liveMetrics());
        const visualW = rubberClamp(rawW, spanToWidth(2, liveMetrics()), maxW, live.startW);
        const visualH = rubberClamp(rawH, 120, live.maxHeight, live.startH);
        const span = clampSpan(live.startSpan + sign * (ev.clientX - live.startX) / live.colW);
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
            updateWidget(id, { colSpan: span, height, col: finalCol, row: finalRow });
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
        meta: `${dataset?.fileName ?? "Sample data"} · ${rows.length} rows`,
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
      className={`min-w-0 flex flex-col ${exporting ? "is-exporting" : ""} ${infiniteMode ? "dashboard-infinite-mode fixed inset-x-0 bottom-0 top-[62px] z-50" : ""}`}
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
          onClick={() => setInfiniteMode((value) => !value)}
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
        onClick={() => {
          if (ignoreClick.current) {
            ignoreClick.current = false;
            return;
          }
          select(null);
        }}
        className={`flex-1 overflow-auto p-[22px] ${infiniteMode ? "dashboard-infinite-scroll" : ""}`}
      >
        <div className={infiniteMode ? "dashboard-infinite-stage" : undefined}>
        <div
          ref={boardRef}
          className="relative"
          style={{
            minHeight: boardMin,
            height: boardMin,
            ...(infiniteMode ? { width: 1180, margin: 260 } : {}),
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
              <div className="text-sm">Add a tile from the left, or start from a template.</div>
            </div>
          )}
        </div>
        </div>
      </div>
    </section>
  );
}
