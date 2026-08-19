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
  try {
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
  const firstSlicePx = Math.min(canvas.height, Math.round(firstPageImgHeight * pxPerMm));

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
    const maxSlicePx = isFirstPage
      ? firstSlicePx
      : Math.min(canvas.height - offsetPx, Math.round(otherPageImgHeight * pxPerMm));
    const slicePx = Math.min(maxSlicePx, canvas.height - offsetPx);
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
