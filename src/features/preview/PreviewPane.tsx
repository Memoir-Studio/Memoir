import * as stylex from "@stylexjs/stylex";
import { useI18n } from "../../i18n/react";
import type { NoteMeta } from "../../domain/notes";
import { colors, commonStyles, media } from "../../styles/tokens.stylex";
import { NotePreviewArticle } from "./NotePreviewArticle";

export function PreviewPane({
  root,
  activePath,
  note,
  content,
  articleRef,
  paneRef,
  onScroll,
  onScrollIntent,
  onContentChange,
}: {
  root: string | null;
  activePath: string | null;
  note: NoteMeta | null;
  content: string;
  articleRef?: React.Ref<HTMLElement | null>;
  paneRef?: React.RefObject<HTMLElement | null>;
  onScroll?: () => void;
  onScrollIntent?: () => void;
  onContentChange: (content: string) => void;
}) {
  const { t } = useI18n();

  return (
    <section
      ref={paneRef}
      aria-label={t("preview.label")}
      data-preview-pane=""
      onKeyDownCapture={onScrollIntent}
      onPointerDownCapture={onScrollIntent}
      onScroll={onScroll}
      onTouchStartCapture={onScrollIntent}
      onWheelCapture={onScrollIntent}
      {...stylex.props(styles.pane, commonStyles.fadeIn)}
    >
      <NotePreviewArticle
        articleRef={articleRef}
        content={content}
        key={activePath || "empty"}
        note={note}
        onContentChange={onContentChange}
        relativePath={activePath}
        root={root}
      />
    </section>
  );
}

export default PreviewPane;

const styles = stylex.create({
  pane: {
    minWidth: 0,
    minHeight: {
      default: 0,
      [media.mobile]: "calc(100vh - 138px)",
    },
    overflow: "auto",
    overflowAnchor: "none",
    overscrollBehavior: "contain",
    borderRightWidth: {
      [media.mobile]: 0,
    },
    backgroundColor: colors.canvas,
  },
});
