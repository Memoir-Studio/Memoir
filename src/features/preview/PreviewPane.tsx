import { useI18n } from "../../i18n/react";
import type { NoteMeta } from "../../domain/notes";
import { NotePreviewArticle } from "./NotePreviewArticle";

export function PreviewPane({
  root,
  activePath,
  note,
  content,
  articleRef,
  paneRef,
  onScroll,
  onContentChange,
}: {
  root: string | null;
  activePath: string | null;
  note: NoteMeta | null;
  content: string;
  articleRef?: React.Ref<HTMLElement | null>;
  paneRef?: React.RefObject<HTMLElement | null>;
  onScroll?: () => void;
  onContentChange: (content: string) => void;
}) {
  const { t } = useI18n();

  return (
    <section
      ref={paneRef}
      aria-label={t("preview.label")}
      className="preview-pane min-h-0 min-w-0 overflow-auto bg-canvas max-[760px]:min-h-[calc(100vh-138px)] max-[760px]:border-r-0"
      onScroll={onScroll}
    >
      <NotePreviewArticle
        articleRef={articleRef}
        content={content}
        note={note}
        onContentChange={onContentChange}
        relativePath={activePath}
        root={root}
      />
    </section>
  );
}

export default PreviewPane;
