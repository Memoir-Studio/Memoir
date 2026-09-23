import * as stylex from "@stylexjs/stylex";
import { createRoot } from "react-dom/client";
import type { NoteMeta } from "../../domain/notes";
import type { AccentColor, AppLocale, BodyFont } from "../../domain/settings";
import { I18nProvider } from "../../i18n/react";
import { applyElementTheme } from "../../styles/document-theme";
import { parseNote } from "../library/note-utils";
import { NotePreviewArticle } from "../preview/NotePreviewArticle";
import { planPdfPageSegments } from "./pdf-pagination";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const EXPORT_WIDTH_PX = 794;
const EXPORT_PAGE_HEIGHT_PX = (EXPORT_WIDTH_PX * A4_HEIGHT_MM) / A4_WIDTH_MM;
const EXPORT_MARGIN_TOP_PX = 48;
const EXPORT_MARGIN_BOTTOM_PX = 64;
const EXPORT_PAGE_CONTENT_HEIGHT_PX =
  EXPORT_PAGE_HEIGHT_PX - EXPORT_MARGIN_TOP_PX - EXPORT_MARGIN_BOTTOM_PX;

async function waitForPreviewReady(host: HTMLElement, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const article = host.querySelector("article");
    const pending =
      !article ||
      host.querySelector("[data-mdx-pending]") ||
      host.querySelector("[data-mermaid-pending]") ||
      host.querySelector("[data-link-card-pending]");
    const imagesPending = [...host.querySelectorAll("img")].some((image) => !image.complete);
    if (article && !pending && !imagesPending) {
      await document.fonts?.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
  throw new Error("Preview assets did not finish loading.");
}

async function elementToPdfBytes(element: HTMLElement, title: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);
  const originalInlineStyle = element.style.cssText;
  let canvas: HTMLCanvasElement;
  let pageBreakpoints: number[];
  let contentHeight: number;

  try {
    Object.assign(element.style, {
      boxSizing: "border-box",
      width: `${EXPORT_WIDTH_PX}px`,
      minWidth: `${EXPORT_WIDTH_PX}px`,
      maxWidth: `${EXPORT_WIDTH_PX}px`,
      paddingTop: "0px",
      paddingBottom: "0px",
      overflowX: "hidden",
    });
    const elementTop = element.getBoundingClientRect().top;
    pageBreakpoints = [...element.children].map(
      (child) => child.getBoundingClientRect().top - elementTop,
    );
    contentHeight = Math.max(element.scrollHeight, 1);
    canvas = await html2canvas(element, {
      backgroundColor: "#ffffff",
      height: contentHeight,
      logging: false,
      scale: 2,
      useCORS: true,
      width: EXPORT_WIDTH_PX,
      windowHeight: contentHeight,
      windowWidth: EXPORT_WIDTH_PX,
    });
  } finally {
    element.style.cssText = originalInlineStyle;
  }

  const segments = planPdfPageSegments(
    contentHeight,
    pageBreakpoints,
    EXPORT_PAGE_CONTENT_HEIGHT_PX,
  );
  if (segments.length === 0) throw new Error("Preview did not contain exportable content.");

  const renderScale = canvas.width / EXPORT_WIDTH_PX;
  const pageHeight = Math.round(EXPORT_PAGE_HEIGHT_PX * renderScale);
  const marginTop = Math.round(EXPORT_MARGIN_TOP_PX * renderScale);
  const marginBottom = Math.round(EXPORT_MARGIN_BOTTOM_PX * renderScale);
  const pdf = new jsPDF({ compress: true, format: "a4", orientation: "portrait", unit: "mm" });
  pdf.setProperties({ creator: "Memoir", title });

  for (const [index, segment] of segments.entries()) {
    const sourceStart = Math.round(segment.start * renderScale);
    const sourceEnd = Math.min(canvas.height, Math.round(segment.end * renderScale));
    const sourceHeight = Math.max(sourceEnd - sourceStart, 1);
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = pageHeight;
    const context = pageCanvas.getContext("2d");
    if (!context) throw new Error("Could not create a PDF page canvas.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    const availableHeight = pageHeight - marginTop - marginBottom;
    const destinationHeight = Math.min(sourceHeight, availableHeight);
    context.drawImage(
      canvas,
      0,
      sourceStart,
      canvas.width,
      sourceHeight,
      0,
      marginTop,
      pageCanvas.width,
      destinationHeight,
    );
    if (index > 0) pdf.addPage();
    pdf.addImage(
      pageCanvas.toDataURL("image/jpeg", 0.92),
      "JPEG",
      0,
      0,
      A4_WIDTH_MM,
      A4_HEIGHT_MM,
      undefined,
      "FAST",
    );
    pageCanvas.width = 0;
    pageCanvas.height = 0;
  }
  canvas.width = 0;
  canvas.height = 0;
  return new Uint8Array(pdf.output("arraybuffer"));
}

export async function renderNotePdf({
  root,
  relativePath,
  note,
  content,
  accent,
  bodyFont,
  bodyFontSize,
  lineHeight,
  locale,
}: {
  root: string | null;
  relativePath: string;
  note: NoteMeta;
  content: string;
  accent: AccentColor;
  bodyFont: BodyFont;
  bodyFontSize: number;
  lineHeight: number;
  locale: AppLocale;
}) {
  const host = document.createElement("div");
  host.dataset.bodyFont = bodyFont;
  host.dataset.theme = "light";
  const hostProps = stylex.props(styles.host(EXPORT_WIDTH_PX));
  if (hostProps.className) host.className = hostProps.className;
  Object.assign(host.style, hostProps.style);
  applyElementTheme(host, { accent, bodyFontSize, isDark: false, lineHeight });
  document.body.append(host);

  const reactRoot = createRoot(host);
  try {
    reactRoot.render(
      <I18nProvider locale={locale}>
        <NotePreviewArticle
          compileDelay={0}
          content={content}
          exportMode
          note={note}
          relativePath={relativePath}
          root={root}
        />
      </I18nProvider>,
    );
    await waitForPreviewReady(host);
    const article = host.querySelector("article");
    if (!(article instanceof HTMLElement) || article.scrollHeight < 2) {
      throw new Error("Preview did not render.");
    }
    const title = parseNote(content, note.fileName).title;
    return await elementToPdfBytes(article, title);
  } finally {
    reactRoot.unmount();
    host.remove();
  }
}

const styles = stylex.create({
  host: (width: number) => ({
    boxSizing: "border-box",
    position: "fixed",
    left: -12000,
    top: 0,
    zIndex: -1,
    width,
    overflow: "hidden",
    color: "#222222",
    backgroundColor: "#ffffff",
    pointerEvents: "none",
  }),
});
