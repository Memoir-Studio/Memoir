import * as stylex from "@stylexjs/stylex";
import { createRoot } from "react-dom/client";
import type { NoteMeta } from "../../domain/notes";
import type { AccentColor, AppLocale, BodyFont } from "../../domain/settings";
import { I18nProvider } from "../../i18n/react";
import { applyElementTheme } from "../../styles/document-theme";
import { parseNote } from "../library/note-utils";
import { NotePreviewArticle } from "../preview/NotePreviewArticle";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const EXPORT_WIDTH_PX = 794;

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
}

async function elementToPdfBytes(element: HTMLElement, title: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);
  const canvas = await html2canvas(element, {
    backgroundColor: "#ffffff",
    logging: false,
    scale: 2,
    useCORS: true,
    windowHeight: element.scrollHeight,
    windowWidth: element.scrollWidth,
  });
  const image = canvas.toDataURL("image/jpeg", 0.95);
  const imgWidth = A4_WIDTH_MM;
  const imgHeight = (canvas.height * imgWidth) / Math.max(canvas.width, 1);
  const pdf = new jsPDF({ compress: true, format: "a4", orientation: "portrait", unit: "mm" });
  pdf.setProperties({ creator: "Memoir", title });

  let remaining = imgHeight;
  let offset = 0;
  pdf.addImage(image, "JPEG", 0, offset, imgWidth, imgHeight, undefined, "FAST");
  remaining -= A4_HEIGHT_MM;
  while (remaining > 0.5) {
    offset -= A4_HEIGHT_MM;
    pdf.addPage();
    pdf.addImage(image, "JPEG", 0, offset, imgWidth, imgHeight, undefined, "FAST");
    remaining -= A4_HEIGHT_MM;
  }
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
    position: "fixed",
    left: -12000,
    top: 0,
    zIndex: -1,
    width,
    overflow: "visible",
    color: "#222222",
    backgroundColor: "#ffffff",
    pointerEvents: "none",
  }),
});
