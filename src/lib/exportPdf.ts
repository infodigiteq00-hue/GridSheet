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

  const prevOverflow = element.style.overflow;
  const prevHeight = element.style.height;
  const fullW = Math.max(element.scrollWidth, element.clientWidth);
  const fullH = Math.max(element.scrollHeight, element.clientHeight);
  element.style.overflow = "visible";
  element.style.height = `${fullH}px`;

  let canvas: HTMLCanvasElement;
  let tileBounds: TileBounds[] = [];
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
