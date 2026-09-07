import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export interface ExportPdfOptions {
  title: string;
  meta?: string;
  fileName?: string;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "dashboard";
}

interface TileBounds {
  top: number;
  bottom: number;
}

/**
 * html2canvas clips text that overflows a `text-overflow: ellipsis` box but
 * does not paint the "…" glyph itself (a long-standing html2canvas
 * limitation) — so on-screen "Total Qty in unit o…" rasterizes as the
 * hard-cut "Total Qty in unit o". Bake a real ellipsis into the text content
 * of every overflowing node right before capture, then restore it after.
 *
 * html2canvas measures text with its own font metrics, which don't always
 * agree with the canvas 2D context's `measureText` used here. If we cut the
 * string to exactly fit, that mismatch can make html2canvas think our
 * already-shortened "…foo…" still overflows and clip it a second time —
 * eating the very ellipsis glyph we just added. So: (1) leave a few pixels
 * of slack when sizing the cut, and (2) turn off overflow/ellipsis on the
 * element for the capture, since the text is now short enough on its own.
 */
function bakeEllipsisTruncation(root: HTMLElement): () => void {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return () => {};

  const SAFETY_MARGIN_PX = 4;
  const restores: { node: Text; text: string; el: HTMLElement; overflow: string; textOverflow: string }[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    const onlyChild = el.firstChild;
    if (el.childNodes.length !== 1 || onlyChild?.nodeType !== Node.TEXT_NODE) continue;
    const text = onlyChild.textContent ?? "";
    if (!text.trim() || el.scrollWidth <= el.clientWidth + 1) continue;

    const computed = getComputedStyle(el);
    if (computed.textOverflow !== "ellipsis" || computed.whiteSpace !== "nowrap") continue;

    const available =
      el.clientWidth -
      (parseFloat(computed.paddingLeft) || 0) -
      (parseFloat(computed.paddingRight) || 0) -
      SAFETY_MARGIN_PX;
    ctx.font = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;

    let truncated = text;
    while (truncated.length > 1 && ctx.measureText(truncated + "…").width > available) {
      truncated = truncated.slice(0, -1);
    }
    if (truncated === text) continue;

    restores.push({ node: onlyChild as Text, text, el, overflow: el.style.overflow, textOverflow: el.style.textOverflow });
    onlyChild.textContent = `${truncated.trimEnd()}…`;
    el.style.overflow = "visible";
    el.style.textOverflow = "clip";
  }

  return () => {
    for (const { node, text, el, overflow, textOverflow } of restores) {
      node.textContent = text;
      el.style.overflow = overflow;
      el.style.textOverflow = textOverflow;
    }
  };
}

/** CSS-pixel bounds of dashboard tiles, relative to `element`'s top edge. */
function tileBoundsCss(element: HTMLElement): TileBounds[] {
  const root = element.getBoundingClientRect();
  const bounds: TileBounds[] = [];
  for (const tile of element.querySelectorAll<HTMLElement>(".dashboard-tile")) {
    const rect = tile.getBoundingClientRect();
    bounds.push({ top: rect.top - root.top, bottom: rect.bottom - root.top });
  }
  return bounds;
}

/**
 * End the slice at the latest tile edge that fits without crossing another
 * tile. Tile tops are candidates as well as bottoms: a short neighbouring
 * tile can end while a taller one continues beside it. If nothing fits (one
 * tile is taller than a page), fall back to the hard maximum.
 */
function snapSlicePx(offsetPx: number, maxSlicePx: number, boundsPx: TileBounds[], canvasHeight: number): number {
  const hardEnd = Math.min(offsetPx + maxSlicePx, canvasHeight);
  if (hardEnd <= offsetPx) return 0;

  const edges = new Set<number>([hardEnd]);
  for (const { top, bottom } of boundsPx) {
    if (top > offsetPx && top <= hardEnd) edges.add(top);
    if (bottom > offsetPx && bottom <= hardEnd) edges.add(bottom);
  }

  for (const end of [...edges].sort((a, b) => b - a)) {
    const cutsTile = boundsPx.some(({ top, bottom }) => top < end && end < bottom);
    if (!cutsTile) return end - offsetPx;
  }

  return Math.min(maxSlicePx, canvasHeight - offsetPx);
}

/**
 * Rasterizes `element` and assembles it into a multi-page PDF with a native
 * text header, then triggers a browser download. This never opens the
 * OS/browser print dialog — the only side effect is `doc.save(...)`.
 */
export async function exportDashboardAsPdf(element: HTMLElement, opts: ExportPdfOptions): Promise<void> {
  const { title, meta } = opts;

  // html2canvas rasterizes whatever is loaded at call time; if a custom
  // webfont is still in flight it silently falls back to a generic system
  // font for that capture, even though the live page looks correct.
  await document.fonts.ready;

  const prevOverflow = element.style.overflow;
  const prevHeight = element.style.height;
  const fullW = Math.max(element.scrollWidth, element.clientWidth);
  const fullH = Math.max(element.scrollHeight, element.clientHeight);
  element.style.overflow = "visible";
  element.style.height = `${fullH}px`;

  let canvas: HTMLCanvasElement;
  let tileBounds: TileBounds[] = [];
  const restoreEllipsis = bakeEllipsisTruncation(element);
  try {
    tileBounds = tileBoundsCss(element);
    canvas = await html2canvas(element, {
      scale: 2,
      backgroundColor: "#fdfcfa",
      useCORS: true,
      width: fullW,
      height: fullH,
      windowWidth: fullW,
      windowHeight: fullH,
      scrollX: 0,
      scrollY: 0,
    });
  } finally {
    restoreEllipsis();
    element.style.overflow = prevOverflow;
    element.style.height = prevHeight;
  }

  const pageWidth = 210; // mm, A4
  const pageHeight = 297; // mm, A4
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Native text header on the first page, sized/positioned so the image area
  // below never overlaps it.
  let headerHeight = margin;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(23, 22, 26);
  doc.text(title, margin, headerHeight + 6);
  headerHeight += 8;

  const exportedOn = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const metaLine = meta ? `${meta} · exported ${exportedOn}` : `exported ${exportedOn}`;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(122, 121, 129);
  doc.text(metaLine, margin, headerHeight + 4);
  headerHeight += 10;

  const imgWidth = contentWidth;

  const firstPageImgHeight = pageHeight - headerHeight - margin;
  const otherPageImgHeight = pageHeight - margin * 2;

  const pxPerMm = canvas.width / imgWidth;
  const cssToPx = fullH > 0 ? canvas.height / fullH : 1;
  const boundsPx = tileBounds.map(({ top, bottom }) => ({
    top: Math.round(top * cssToPx),
    bottom: Math.round(bottom * cssToPx),
  }));

  const sliceCanvas = document.createElement("canvas");
  const sliceCtx = sliceCanvas.getContext("2d");
  if (!sliceCtx) throw new Error("Could not create canvas 2D context for PDF export");

  function drawSlice(startPx: number, heightPx: number): string {
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = heightPx;
    // Fill with the dashboard background first — JPEG has no alpha channel.
    sliceCtx!.fillStyle = "#fdfcfa";
    sliceCtx!.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    sliceCtx!.drawImage(canvas, 0, startPx, canvas.width, heightPx, 0, 0, canvas.width, heightPx);
    return sliceCanvas.toDataURL("image/jpeg", 0.92);
  }

  let offsetPx = 0;
  let isFirstPage = true;

  while (offsetPx < canvas.height) {
    const pageImgHeightMm = isFirstPage ? firstPageImgHeight : otherPageImgHeight;
    const maxSlicePx = Math.min(canvas.height - offsetPx, Math.floor(pageImgHeightMm * pxPerMm));
    const slicePx = snapSlicePx(offsetPx, maxSlicePx, boundsPx, canvas.height);
    if (slicePx <= 0) break;

    const dataUrl = drawSlice(offsetPx, slicePx);
    const sliceHeightMm = slicePx / pxPerMm;
    const y = isFirstPage ? headerHeight : margin;
    doc.addImage(dataUrl, "JPEG", margin, y, imgWidth, sliceHeightMm);

    offsetPx += slicePx;
    isFirstPage = false;

    if (offsetPx < canvas.height) doc.addPage();
  }

  doc.save(`${slugify(opts.fileName ?? title)}.pdf`);
}
