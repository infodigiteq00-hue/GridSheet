import { WidgetBodyProps } from "./types";

export default function TextBlock({
  widget,
  scale = 1,
  editable = false,
  onTextChange,
}: WidgetBodyProps & { editable?: boolean; onTextChange?: (text: string) => void }) {
  const s = (widget.fontScale || 1) * scale;
  const placeholder = "Click to write a short insight or summary for this tile…";

  if (editable) {
    return (
      <textarea
        value={widget.text}
        onChange={(e) => onTextChange?.(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        placeholder={placeholder}
        style={{
          height: "100%",
          width: "100%",
          resize: "none",
          border: "none",
          outline: "none",
          background: "transparent",
          fontSize: 14.5 * s,
          lineHeight: 1.6,
          color: "#3d3c44",
          fontFamily: "inherit",
          touchAction: "auto",
        }}
      />
    );
  }

  return (
    <div style={{ height: "100%", overflow: "auto", fontSize: 14.5 * s, lineHeight: 1.6, color: "#3d3c44" }}>
      {widget.text || <span style={{ color: "#a3a2a9" }}>{placeholder}</span>}
    </div>
  );
}
