import * as stylex from "@stylexjs/stylex";
import {
  ArrowUp,
  Check,
  FileDiff,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Button, IconButton, PanelHeader } from "../../components/ui";
import type {
  AiChatMessage,
  AiChatProgress,
  AiEditorEdit,
  AiRewriteTarget,
  AiSettings,
} from "../../domain/ai";
import { mapGatewayError } from "../../domain/errors";
import { getGateways } from "../../gateways";
import { useI18n } from "../../i18n/react";
import { isTauriRuntime } from "../../platform/runtime";
import { accents, colors, motion, typography } from "../../styles/tokens.stylex";
import { compactDiffRows, createLineDiff, diffStats } from "./ai-diff";
import { handleWindowDragMouseDown } from "../window/window-drag";

export function AiRewritePanel({
  workspaceRoot,
  settings,
  target,
  onApply,
  onClose,
  onRefreshTarget,
  onSave,
}: {
  workspaceRoot: string | null;
  settings: AiSettings;
  target: AiRewriteTarget | null;
  onApply: (edit: AiEditorEdit) => boolean;
  onClose: () => void;
  onRefreshTarget: () => AiRewriteTarget | null;
  onSave: () => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [contextTarget, setContextTarget] = useState(target);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingEdit, setPendingEdit] = useState<AiEditorEdit | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<AiChatProgress | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [saving, setSaving] = useState(false);
  const requestIdRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestIdRef.current += 1;
    setContextTarget(target);
    setMessages([]);
    setDraft("");
    setPendingEdit(null);
    setError("");
    setNotice("");
    setLoading(false);
    setProgress(null);
    setElapsedMs(0);
    setSaving(false);
    return () => {
      requestIdRef.current += 1;
    };
  }, [target]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (typeof scroll.scrollTo === "function") scroll.scrollTo({ top: scroll.scrollHeight });
    else scroll.scrollTop = scroll.scrollHeight;
  }, [loading, messages, pendingEdit]);

  useEffect(() => {
    if (!loading || startedAtRef.current === null) return;
    const update = () => setElapsedMs(Date.now() - (startedAtRef.current ?? Date.now()));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const diffRows = useMemo(
    () => (pendingEdit ? createLineDiff(pendingEdit.source, pendingEdit.replacement) : []),
    [pendingEdit],
  );
  const visibleDiffRows = useMemo(() => compactDiffRows(diffRows), [diffRows]);
  const stats = useMemo(() => diffStats(diffRows), [diffRows]);
  const suggestions = [
    t("aiRewrite.polish"),
    t("aiRewrite.concise"),
    t("aiRewrite.expand"),
    t("aiRewrite.fix"),
  ];

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || loading || !contextTarget) return;
    const userMessage: AiChatMessage = { role: "user", content: prompt };
    const requestMessages = [...messages, userMessage];
    const requestTarget = pendingEdit
      ? {
          ...contextTarget,
          to: contextTarget.from + pendingEdit.replacement.length,
          source: pendingEdit.replacement,
        }
      : contextTarget;
    const requestId = ++requestIdRef.current;
    setMessages(requestMessages);
    setDraft("");
    setError("");
    setNotice("");
    setLoading(true);
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setProgress({ stage: "preparing" });
    try {
      if (!workspaceRoot) return;
      const response = await getGateways().workspace.chatWithNote(
        workspaceRoot,
        settings,
        requestMessages,
        requestTarget,
        (nextProgress) => {
          if (requestId === requestIdRef.current) setProgress(nextProgress);
        },
      );
      if (requestId !== requestIdRef.current) return;
      setMessages([
        ...requestMessages,
        { role: "assistant", content: response.message || t("aiRewrite.assistant") },
      ]);
      if (response.edit && response.edit.replacement !== contextTarget.source) {
        setPendingEdit({ ...contextTarget, replacement: response.edit.replacement });
      }
    } catch (requestError) {
      if (requestId === requestIdRef.current) {
        setError(t("aiRewrite.requestFailed", { message: mapGatewayError(requestError).message }));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        startedAtRef.current = null;
      }
    }
  };

  const handleDraftKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    void send();
  };

  const refreshContext = () => {
    const nextTarget = onRefreshTarget();
    if (!nextTarget) return;
    setContextTarget(nextTarget);
    setPendingEdit(null);
    setError("");
    setNotice(t("aiRewrite.contextRefreshed"));
  };

  const startNewConversation = () => {
    requestIdRef.current += 1;
    setMessages([]);
    setDraft("");
    setPendingEdit(null);
    setError("");
    setNotice("");
    setLoading(false);
    setProgress(null);
    setElapsedMs(0);
    startedAtRef.current = null;
    const nextTarget = onRefreshTarget();
    if (nextTarget) setContextTarget(nextTarget);
  };

  const applyPendingEdit = async (save: boolean) => {
    if (!pendingEdit || saving) return;
    setError("");
    setNotice("");
    if (!onApply(pendingEdit)) {
      setError(t("aiRewrite.sourceChanged"));
      return;
    }
    setContextTarget({
      path: pendingEdit.path,
      from: pendingEdit.from,
      to: pendingEdit.from + pendingEdit.replacement.length,
      source: pendingEdit.replacement,
      scope: pendingEdit.scope,
    });
    setPendingEdit(null);
    if (!save) {
      setNotice(t("aiRewrite.applied"));
      return;
    }
    setSaving(true);
    const saved = await onSave();
    setSaving(false);
    if (saved) setNotice(t("aiRewrite.appliedAndSaved"));
    else setError(t("aiRewrite.saveFailed"));
  };

  if (!contextTarget) {
    return (
      <aside
        aria-label={t("aiRewrite.title")}
        data-ai-rewrite-panel=""
        {...stylex.props(styles.panel)}
      >
        <AiPanelHeader
          onNewConversation={startNewConversation}
          onRefresh={refreshContext}
          subtitle={t("aiRewrite.documentDescription")}
        />
        <div {...stylex.props(styles.empty)}>
          <Sparkles {...stylex.props(styles.emptyIcon)} />
          <h3 {...stylex.props(styles.emptyTitle)}>{t("aiRewrite.emptyTitle")}</h3>
          <p {...stylex.props(styles.emptyDescription)}>{t("aiRewrite.emptyDescription")}</p>
        </div>
      </aside>
    );
  }

  const contextLabel =
    contextTarget.scope === "selection"
      ? t("aiRewrite.selectionDescription")
      : t("aiRewrite.documentDescription");

  return (
    <aside
      aria-label={t("aiRewrite.title")}
      data-ai-rewrite-panel=""
      {...stylex.props(styles.panel)}
    >
      <AiPanelHeader
        onNewConversation={startNewConversation}
        onRefresh={refreshContext}
        subtitle={contextLabel}
      />

      <div ref={scrollRef} {...stylex.props(styles.conversation)}>
        <div {...stylex.props(styles.contextBar)}>
          <span {...stylex.props(styles.contextScope)}>
            {contextTarget.scope === "selection"
              ? t("aiRewrite.selectionContext")
              : t("aiRewrite.documentContext")}
          </span>
          <span title={contextTarget.path} {...stylex.props(styles.contextPath)}>
            {contextTarget.path}
          </span>
        </div>

        {!messages.length && !loading && (
          <div {...stylex.props(styles.welcome)}>
            <Sparkles {...stylex.props(styles.welcomeIcon)} />
            <p {...stylex.props(styles.welcomeText)}>{t("aiRewrite.welcome")}</p>
            <div
              aria-label={t("aiRewrite.suggestions")}
              role="group"
              {...stylex.props(styles.suggestions)}
            >
              {suggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  onClick={() => setDraft(suggestion)}
                  size="sm"
                  style={styles.suggestionButton}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div aria-live="polite" role="log" {...stylex.props(styles.messageList)}>
          {messages.map((message, index) => (
            <article
              key={`${message.role}-${index}`}
              {...stylex.props(
                styles.message,
                message.role === "user" ? styles.userMessage : styles.assistantMessage,
              )}
            >
              <span {...stylex.props(styles.messageAuthor)}>
                {message.role === "user" ? t("aiRewrite.you") : t("aiRewrite.assistant")}
              </span>
              <p {...stylex.props(styles.messageContent)}>{message.content}</p>
            </article>
          ))}
          {loading && (
            <article {...stylex.props(styles.message, styles.assistantMessage)}>
              <span {...stylex.props(styles.messageAuthor)}>{t("aiRewrite.assistant")}</span>
              <AiProgressStatus elapsedMs={elapsedMs} progress={progress} />
            </article>
          )}
        </div>

        {notice && (
          <p role="status" {...stylex.props(styles.notice)}>
            <Check {...stylex.props(styles.noticeIcon)} />
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" {...stylex.props(styles.error)}>
            {error}
          </p>
        )}

        {pendingEdit && (
          <section aria-label={t("aiRewrite.proposedEdit")} {...stylex.props(styles.diffPanel)}>
            <header {...stylex.props(styles.diffHeader)}>
              <span {...stylex.props(styles.diffTitle)}>
                <FileDiff {...stylex.props(styles.diffTitleIcon)} />
                {t("aiRewrite.proposedEdit")}
              </span>
              <span {...stylex.props(styles.diffStats)}>
                {t("aiRewrite.diffSummary", { added: stats.added, removed: stats.removed })}
              </span>
            </header>
            <div {...stylex.props(styles.diffBody)}>
              {visibleDiffRows.map((row, index) =>
                row.kind === "skip" ? (
                  <div key={`skip-${index}`} {...stylex.props(styles.diffSkip)}>
                    {t("aiRewrite.skippedLines", { count: row.count ?? 0 })}
                  </div>
                ) : (
                  <div
                    key={`${row.kind}-${row.beforeLine}-${row.afterLine}-${index}`}
                    {...stylex.props(
                      styles.diffRow,
                      row.kind === "add" && styles.diffAdd,
                      row.kind === "remove" && styles.diffRemove,
                    )}
                  >
                    <span {...stylex.props(styles.lineNumber)}>{row.beforeLine ?? ""}</span>
                    <span {...stylex.props(styles.lineNumber)}>{row.afterLine ?? ""}</span>
                    <span {...stylex.props(styles.diffMarker)}>
                      {row.kind === "add" ? "+" : row.kind === "remove" ? "-" : " "}
                    </span>
                    <code {...stylex.props(styles.diffText)}>{row.text || " "}</code>
                  </div>
                ),
              )}
            </div>
            <footer {...stylex.props(styles.diffActions)}>
              <Button
                disabled={saving}
                onClick={() => setPendingEdit(null)}
                size="sm"
                style={styles.discardButton}
                variant="ghost"
              >
                <Trash2 {...stylex.props(styles.buttonIcon)} />
                {t("aiRewrite.discardEdit")}
              </Button>
              <span {...stylex.props(styles.diffActionGroup)}>
                <Button
                  disabled={saving}
                  onClick={() => void applyPendingEdit(false)}
                  size="sm"
                >
                  <Check {...stylex.props(styles.buttonIcon)} />
                  {t("aiRewrite.applyEdit")}
                </Button>
                <Button
                  disabled={saving}
                  onClick={() => void applyPendingEdit(true)}
                  size="sm"
                  variant="primary"
                >
                  {saving ? (
                    <LoaderCircle {...stylex.props(styles.loadingIcon)} />
                  ) : (
                    <Save {...stylex.props(styles.buttonIcon)} />
                  )}
                  {t("aiRewrite.applyAndSave")}
                </Button>
              </span>
            </footer>
          </section>
        )}
      </div>

      <footer {...stylex.props(styles.footer)}>
        <div {...stylex.props(styles.composer)}>
          <textarea
            autoFocus
            aria-label={t("aiRewrite.instruction")}
            disabled={loading}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleDraftKeyDown}
            placeholder={t("aiRewrite.placeholder")}
            rows={3}
            value={draft}
            {...stylex.props(styles.composerTextarea)}
          />
          <div {...stylex.props(styles.composerToolbar)}>
            <span title={settings.chatModel} {...stylex.props(styles.composerModel)}>
              <Sparkles aria-hidden="true" {...stylex.props(styles.composerModelIcon)} />
              <span {...stylex.props(styles.composerModelName)}>{settings.chatModel}</span>
            </span>
            <Button
              aria-label={loading ? t("aiRewrite.generating") : t("aiRewrite.generate")}
              disabled={loading || !draft.trim()}
              onClick={() => void send()}
              size="icon"
              style={styles.sendButton}
              title={t("aiRewrite.generate")}
              variant="primary"
            >
              {loading ? (
                <LoaderCircle {...stylex.props(styles.loadingIcon)} />
              ) : (
                <ArrowUp {...stylex.props(styles.sendIcon)} strokeWidth={2.2} />
              )}
            </Button>
          </div>
        </div>
      </footer>
    </aside>
  );
}

function AiProgressStatus({
  elapsedMs,
  progress,
}: {
  elapsedMs: number;
  progress: AiChatProgress | null;
}) {
  const { t } = useI18n();
  const model = progress?.model || "AI";
  let label = t("aiRewrite.thinkingReply");
  let detail = "";
  if (progress?.stage === "preparing") {
    label = t("aiRewrite.contextReady");
  } else if (progress?.stage === "callingModel") {
    label = t("aiRewrite.callingModel", { model });
  } else if (progress?.stage === "callingTool") {
    label = t("aiRewrite.callingTool", { tool: progress.tool || "search_notes" });
    detail = progress.query ? `“${progress.query}”` : "";
  } else if (progress?.stage === "toolCompleted") {
    label = t("aiRewrite.toolCompleted", { tool: progress.tool || "search_notes" });
    detail = t("aiRewrite.toolResultCount", { count: progress.resultCount ?? 0 });
  } else if (progress?.stage === "generating") {
    label = t("aiRewrite.working");
  }
  return (
    <div role="status" {...stylex.props(styles.progressStatus)}>
      <div {...stylex.props(styles.loadingMessage)}>
        <LoaderCircle {...stylex.props(styles.loadingIcon)} />
        <span>{label}</span>
        <span {...stylex.props(styles.elapsed)}>{t("aiRewrite.elapsed", { seconds: Math.floor(elapsedMs / 1000) })}</span>
      </div>
      {detail ? <span title={detail} {...stylex.props(styles.progressDetail)}>{detail}</span> : null}
    </div>
  );
}

function AiPanelHeader({
  subtitle,
  onNewConversation,
  onRefresh,
}: {
  subtitle: string;
  onNewConversation: () => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  return (
    <PanelHeader
      actionsStyle={styles.headerActions}
      dragRegion={isTauriRuntime()}
      onMouseDown={handleWindowDragMouseDown}
      style={styles.header}
      actions={
        <>
          <IconButton label={t("aiRewrite.refreshContext")} onClick={onRefresh} style={styles.headerButton}>
            <RefreshCw {...stylex.props(styles.headerIcon)} />
          </IconButton>
          <IconButton
            label={t("aiRewrite.newConversation")}
            onClick={onNewConversation}
            style={styles.headerButton}
          >
            <Plus {...stylex.props(styles.headerIcon)} />
          </IconButton>
        </>
      }
    >
      <div {...stylex.props(styles.headerText)}>
        <div {...stylex.props(styles.titleRow)}>
          <Sparkles {...stylex.props(styles.titleIcon)} />
          <h2 {...stylex.props(styles.title)}>{t("aiRewrite.title")}</h2>
        </div>
        <p {...stylex.props(styles.scope)}>{subtitle}</p>
      </div>
    </PanelHeader>
  );
}

const fadeIn = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });

const styles = stylex.create({
  panel: {
    position: "relative",
    display: "grid",
    width: "100%",
    height: "100%",
    minHeight: 0,
    minWidth: 0,
    gridTemplateRows: "auto minmax(0, 1fr) auto",
    backgroundColor: colors.elevated,
    animationName: { default: fadeIn, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: motion.standard,
    animationTimingFunction: motion.ease,
  },
  header: {
    backgroundColor: `color-mix(in srgb, ${colors.elevated} 94%, ${colors.panel})`,
  },
  headerText: { minWidth: 0 },
  titleRow: { display: "flex", alignItems: "center", gap: "8px" },
  titleIcon: { width: "15px", height: "15px", color: accents.primary },
  title: { margin: 0, color: colors.text, fontSize: "14px", fontWeight: 700, letterSpacing: 0 },
  scope: {
    overflow: "hidden",
    marginTop: "4px",
    color: colors.muted,
    fontSize: "11px",
    lineHeight: 1.45,
    letterSpacing: 0,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  headerActions: { display: "flex", flex: "none", gap: "1px" },
  headerButton: { width: "27px", height: "27px", borderRadius: "6px" },
  headerIcon: { width: "13px", height: "13px" },
  conversation: { minHeight: 0, overflowY: "auto", padding: "12px 14px 20px" },
  contextBar: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    gap: "8px",
    marginBottom: "18px",
    color: colors.muted,
    fontSize: "10px",
  },
  contextScope: {
    flex: "none",
    padding: "2px 6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: "4px",
    backgroundColor: colors.panel,
    color: `color-mix(in srgb, ${colors.text} 74%, ${colors.muted})`,
    fontWeight: 600,
  },
  contextPath: {
    overflow: "hidden",
    minWidth: 0,
    direction: "rtl",
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  welcome: {
    display: "grid",
    justifyItems: "center",
    gap: "9px",
    padding: "34px 0 18px",
    textAlign: "center",
  },
  welcomeIcon: { width: "21px", height: "21px", color: accents.primary },
  welcomeText: {
    maxWidth: "230px",
    margin: 0,
    color: colors.muted,
    fontSize: "12px",
    lineHeight: 1.6,
  },
  suggestions: {
    display: "grid",
    width: "100%",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "6px",
    marginTop: "8px",
  },
  suggestionButton: {
    width: "100%",
    height: "auto",
    minHeight: "32px",
    justifyContent: "flex-start",
    paddingBlock: "6px",
    textAlign: "left",
    lineHeight: 1.35,
    whiteSpace: "normal",
  },
  messageList: { display: "grid", gap: "18px" },
  message: { display: "grid", gap: "5px", minWidth: 0 },
  userMessage: {
    width: "fit-content",
    maxWidth: "88%",
    justifySelf: "end",
    padding: "8px 10px",
    borderRadius: "8px",
    backgroundColor: `color-mix(in srgb, ${colors.panel} 82%, ${colors.elevated})`,
  },
  assistantMessage: { width: "100%" },
  messageAuthor: { color: colors.muted, fontSize: "10px", fontWeight: 650, letterSpacing: 0 },
  messageContent: {
    margin: 0,
    color: colors.text,
    fontSize: "12px",
    lineHeight: 1.65,
    letterSpacing: 0,
    overflowWrap: "anywhere",
    userSelect: "text",
    whiteSpace: "pre-wrap",
  },
  loadingMessage: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    gap: "7px",
    margin: 0,
    color: colors.muted,
    fontSize: "12px",
  },
  progressStatus: {
    display: "grid",
    minWidth: 0,
    gap: "5px",
    padding: "8px 10px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: `color-mix(in srgb, ${accents.primary} 20%, ${colors.border})`,
    borderRadius: "6px",
    backgroundColor: `color-mix(in srgb, ${accents.primary} 5%, ${colors.canvas})`,
  },
  elapsed: {
    flex: "none",
    marginLeft: "auto",
    color: `color-mix(in srgb, ${colors.muted} 78%, transparent)`,
    fontSize: "10px",
    fontVariantNumeric: "tabular-nums",
  },
  progressDetail: {
    overflow: "hidden",
    paddingLeft: "20px",
    color: `color-mix(in srgb, ${colors.text} 68%, ${colors.muted})`,
    fontFamily: typography.monoFont,
    fontSize: "10px",
    lineHeight: 1.45,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: "7px",
    marginTop: "16px",
    padding: "8px 9px",
    borderRadius: "6px",
    backgroundColor: `color-mix(in srgb, ${accents.primary} 9%, transparent)`,
    color: colors.text,
    fontSize: "11px",
    lineHeight: 1.5,
  },
  noticeIcon: {
    width: "13px",
    height: "13px",
    flex: "none",
    marginTop: "2px",
    color: accents.primary,
  },
  error: {
    marginTop: "16px",
    padding: "8px 10px",
    borderRadius: "6px",
    backgroundColor: `color-mix(in srgb, ${colors.danger} 10%, transparent)`,
    color: colors.danger,
    fontSize: "11px",
    lineHeight: 1.5,
  },
  diffPanel: {
    overflow: "hidden",
    marginTop: "18px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: "8px",
    backgroundColor: colors.canvas,
  },
  diffHeader: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    minHeight: "36px",
    paddingInline: "10px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    backgroundColor: colors.panel,
  },
  diffTitle: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    gap: "7px",
    color: colors.text,
    fontSize: "11px",
    fontWeight: 650,
  },
  diffTitleIcon: { width: "14px", height: "14px", color: accents.primary },
  diffStats: { flex: "none", color: colors.muted, fontFamily: typography.monoFont, fontSize: "10px" },
  diffBody: { maxHeight: "330px", overflow: "auto", paddingBlock: "5px", userSelect: "text" },
  diffRow: {
    display: "grid",
    minWidth: "max-content",
    gridTemplateColumns: "34px 34px 16px minmax(240px, 1fr)",
    minHeight: "20px",
    alignItems: "start",
    color: `color-mix(in srgb, ${colors.text} 82%, ${colors.muted})`,
    fontFamily: typography.monoFont,
    fontSize: "10px",
    lineHeight: "20px",
  },
  diffAdd: {
    backgroundColor: "color-mix(in srgb, #2f9e63 13%, transparent)",
    color: `color-mix(in srgb, #2f9e63 58%, ${colors.text})`,
  },
  diffRemove: {
    backgroundColor: `color-mix(in srgb, ${colors.danger} 11%, transparent)`,
    color: `color-mix(in srgb, ${colors.danger} 62%, ${colors.text})`,
  },
  lineNumber: {
    paddingRight: "7px",
    color: `color-mix(in srgb, ${colors.muted} 72%, transparent)`,
    textAlign: "right",
    userSelect: "none",
  },
  diffMarker: { textAlign: "center", userSelect: "none" },
  diffText: { paddingRight: "12px", fontFamily: typography.monoFont, whiteSpace: "pre" },
  diffSkip: { paddingBlock: "5px", color: colors.muted, fontSize: "9px", textAlign: "center" },
  diffActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "7px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: colors.border,
    backgroundColor: colors.panel,
  },
  diffActionGroup: { display: "flex", gap: "6px" },
  discardButton: { color: colors.muted },
  footer: {
    padding: "10px 14px 13px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: colors.border,
    backgroundColor: `color-mix(in srgb, ${colors.elevated} 94%, ${colors.panel})`,
  },
  composer: {
    display: "grid",
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: `color-mix(in srgb, ${colors.border} 92%, transparent)`,
      ":hover": colors.border,
      ":focus-within": `color-mix(in srgb, ${accents.primary} 58%, ${colors.border})`,
    },
    borderRadius: "8px",
    backgroundColor: colors.canvas,
    boxShadow: {
      default: "inset 0 1px rgb(255 255 255 / 34%), 0 1px 2px rgb(0 0 0 / 3%)",
      ":focus-within": `0 0 0 3px color-mix(in srgb, ${accents.primary} 13%, transparent), inset 0 1px rgb(255 255 255 / 38%)`,
    },
    transitionProperty: "border-color, box-shadow",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.ease,
  },
  composerTextarea: {
    width: "100%",
    minHeight: "74px",
    maxHeight: "180px",
    resize: "none",
    padding: "12px 13px 5px",
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: colors.text,
    fontFamily: typography.uiFont,
    fontSize: "12px",
    lineHeight: 1.55,
    letterSpacing: 0,
    opacity: { default: 1, ":disabled": 0.65 },
    "::placeholder": { color: colors.muted },
  },
  composerToolbar: {
    display: "flex",
    minWidth: 0,
    minHeight: "38px",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "3px 5px 6px 10px",
  },
  composerModel: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    gap: "6px",
    color: `color-mix(in srgb, ${colors.text} 72%, ${colors.muted})`,
    fontSize: "10px",
    fontWeight: 550,
  },
  composerModelIcon: { width: "13px", height: "13px", flex: "none", color: accents.primary },
  composerModelName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  sendButton: { width: "30px", height: "30px", flex: "none", borderRadius: "7px" },
  sendIcon: { width: "15px", height: "15px" },
  buttonIcon: { width: "13px", height: "13px" },
  loadingIcon: {
    width: "13px",
    height: "13px",
    flex: "none",
    animationName: spin,
    animationDuration: "900ms",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
  empty: {
    display: "grid",
    alignContent: "center",
    justifyItems: "center",
    gap: "8px",
    padding: "28px 20px",
    textAlign: "center",
  },
  emptyIcon: { width: "22px", height: "22px", marginBottom: "4px", color: accents.primary },
  emptyTitle: { margin: 0, color: colors.text, fontSize: "14px", fontWeight: 650 },
  emptyDescription: {
    maxWidth: "240px",
    margin: 0,
    color: colors.muted,
    fontSize: "11px",
    lineHeight: 1.6,
  },
});
