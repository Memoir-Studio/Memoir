import { createRoot } from "react-dom/client";
import type { NoteMeta } from "../../domain/notes";
import type { AppLocale, BodyFont } from "../../domain/settings";
import { I18nProvider } from "../../i18n/react";
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
      host.querySelector("[data-mermaid-pending]");
    const imagesPending = [...host.querySelectorAll("img")].some((image) => !image.complete);
    if (article && !pending && !imagesPending) {
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
  bodyFont,
  locale,
}: {
  root: string | null;
  relativePath: string;
  note: NoteMeta;
  content: string;
  bodyFont: BodyFont;
  locale: AppLocale;
}) {
  const host = document.createElement("div");
  host.className = "memoir-pdf-export";
  host.dataset.bodyFont = bodyFont;
  host.dataset.theme = "light";
  host.style.width = `${EXPORT_WIDTH_PX}px`;
  document.body.append(host);

  const reactRoot = createRoot(host);
  try {
    reactRoot.render(
      <I18nProvider locale={locale}>
        <NotePreviewArticle
          className="memoir-preview memoir-pdf-preview prose prose-neutral"
          compileDelay={0}
          content={content}
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
