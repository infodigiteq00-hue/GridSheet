"use client";

import { memo, type CSSProperties } from "react";
import { TYPE_LABEL, Widget } from "@/lib/types";
import WidgetBody from "@/components/widgets/WidgetBody";
import { ColumnMeta, Row } from "@/lib/types";

interface Props {
  widget: Widget;
  selected: boolean;
  lifting: boolean;
  resizing: boolean;
  sheetLabel?: string;
  showSheet: boolean;
  rows: Row[];
  columns: ColumnMeta[];
  placement: CSSProperties;
  onSelect: () => void;
  onRemove: () => void;
  onTilePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (corner: "br" | "tl") => (e: React.PointerEvent<HTMLDivElement>) => void;
  onTextChange: (text: string) => void;
  tileRef: (el: HTMLDivElement | null) => void;
}

function DashboardTile({
  widget,
  selected,
  lifting,
  resizing,
  sheetLabel,
  showSheet,
  rows,
  columns,
  placement,
  onSelect,
  onRemove,
  onTilePointerDown,
  onResizePointerDown,
  onTextChange,
  tileRef,
}: Props) {
  return (
    <div
      ref={tileRef}
      data-tile-id={widget.id}
      onPointerDown={onTilePointerDown}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={`dashboard-tile relative bg-[#fdfcfa] rounded-[14px] overflow-hidden flex flex-col touch-none ${lifting ? "is-lifting" : ""} ${resizing ? "is-resizing" : ""}`}
      style={{
        ...placement,
        border: `1px solid ${selected || lifting || resizing ? "#2b4bff" : "rgba(23,22,26,0.1)"}`,
        boxShadow: "0 8px 20px -20px rgba(23,22,26,0.55)",
        zIndex: lifting || resizing ? 40 : selected ? 2 : 1,
        willChange: lifting || resizing ? "transform, width, height" : undefined,
      }}
    >
      <div className="flex items-center gap-2 px-[13px] pt-2.5 pb-1.5 select-none">
        <div
          className="flex-1 min-w-0 font-display font-semibold tracking-[-0.015em] text-[#17161a] truncate"
          title={widget.title || TYPE_LABEL[widget.type]}
          style={{ fontSize: 13.5 * (widget.fontScale || 1) }}
        >
          {widget.title || TYPE_LABEL[widget.type]}
        </div>
        {showSheet && widget.colSpan > 3 && (
          <div
            className="font-mono-plex text-[10px] text-[#6b6a71] bg-[#f0eee8] px-1.5 py-[1px] rounded-[4px] flex-none max-w-[110px] truncate"
            title={sheetLabel ? `Reads ${sheetLabel}` : undefined}
          >
            {sheetLabel ?? "—"}
            {widget.dimRef ? " + 🔗" : ""}
          </div>
        )}
        <div className="font-mono-plex text-[10.5px] text-[#a3a2a9] uppercase flex-none">{TYPE_LABEL[widget.type]}
        </div>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="export-hide border-0 bg-transparent text-[#a3a2a9] cursor-pointer text-[15px] leading-none px-1 py-0.5 rounded-[5px] hover:bg-[rgba(255,92,70,0.14)] hover:text-[#d93a20] flex-none"
        >
          ×
        </button>
      </div>
      <div className="flex-1 min-h-0 px-[13px] pb-[13px] pt-0.5">
        <WidgetBody
          widget={widget}
          rows={rows}
          columns={columns}
          editable={widget.type === "text"}
          onTextChange={onTextChange}
        />
      </div>
      <div
        onPointerDown={onResizePointerDown("br")}
        className="export-hide dashboard-resize-hit absolute right-0 bottom-0 cursor-nwse-resize touch-none"
        style={{ opacity: selected || resizing ? 1 : 0.34 }}
      >
        <div className="absolute right-[7px] bottom-[7px] w-2 h-2 border-r-2 border-b-2 border-[#2b4bff] rounded-br-[3px] pointer-events-none" />
      </div>
      <div
        onPointerDown={onResizePointerDown("tl")}
        className="export-hide dashboard-resize-hit absolute left-0 top-0 cursor-nwse-resize touch-none"
        style={{ opacity: selected || resizing ? 1 : 0.34 }}
      >
        <div className="absolute left-[7px] top-[7px] w-2 h-2 border-l-2 border-t-2 border-[#2b4bff] rounded-tl-[3px] pointer-events-none" />
      </div>
    </div>
  );
}

export default memo(DashboardTile);
