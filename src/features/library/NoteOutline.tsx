import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { cn } from "../../components/ui";
import type { HeadingItem } from "../../domain/notes";
import { useI18n } from "../../i18n/react";
import {
  buildOutlineTree,
  flattenVisibleOutline,
  headingInset,
  pruneCollapsedHeadingIds,
  visibleOutlineHighlightId,
  writeCollapsedHeadingIds,
} from "./outline-tree";
import { scrollHeadingInPreview } from "./scroll-heading";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function NoteOutline({
  documentKey,
  headings,
}: {
  documentKey: string | null;
  headings: HeadingItem[];
}) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState<string | null>(headings[0]?.id ?? null);
  const [collapsedIds, setCollapsedIds] = useState(() =>
    pruneCollapsedHeadingIds(documentKey, headings),
  );
  const ignoreObserverRef = useRef(false);
  const ignoreTimerRef = useRef<number | null>(null);
  const tree = useMemo(() => buildOutlineTree(headings), [headings]);
  const visibleNodes = useMemo(
    () => flattenVisibleOutline(tree, collapsedIds),
    [collapsedIds, tree],
  );
  const highlightId = useMemo(
    () => visibleOutlineHighlightId(tree, collapsedIds, activeId),
    [activeId, collapsedIds, tree],
  );

  useEffect(() => {
    setActiveId(headings[0]?.id ?? null);
  }, [documentKey]);

  useEffect(() => {
    setActiveId((current) =>
      current && headings.some((heading) => heading.id === current)
        ? current
        : (headings[0]?.id ?? null),
    );
  }, [headings]);

  useEffect(() => {
    setCollapsedIds(pruneCollapsedHeadingIds(documentKey, headings));
  }, [documentKey, headings]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const elements = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!elements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (ignoreObserverRef.current) return;
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
        const nextId = visible[0]?.target.id;
        if (nextId) setActiveId(nextId);
      },
      { rootMargin: "-18% 0px -68% 0px", threshold: [0, 1] },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [headings]);

  useEffect(() => {
    return () => {
      if (ignoreTimerRef.current !== null) window.clearTimeout(ignoreTimerRef.current);
    };
  }, []);

  const preventFocusScroll = (event: { preventDefault(): void }) => {
    event.preventDefault();
  };

  const activate = (id: string) => {
    setActiveId(id);
    ignoreObserverRef.current = true;
    scrollHeadingInPreview(id, {
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    if (ignoreTimerRef.current !== null) window.clearTimeout(ignoreTimerRef.current);
    ignoreTimerRef.current = window.setTimeout(() => {
      ignoreObserverRef.current = false;
      ignoreTimerRef.current = null;
    }, 480);
  };

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeCollapsedHeadingIds(documentKey, next);
      return next;
    });
  };

  return (
    <nav
      aria-label={t("outline.label")}
      className="outline-list memoir-fade-in flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-auto"
    >
      <div className="outline-items">
        {visibleNodes.map((node) => {
          const current = node.heading.id === highlightId;
          const hasChildren = node.children.length > 0;
          const collapsed = hasChildren && collapsedIds.has(node.heading.id);
          return (
            <div
              className={cn("outline-item", current && "is-active")}
              data-depth={node.level}
              key={node.heading.id}
              style={{ "--outline-inset": `${headingInset(node.level)}px` } as CSSProperties}
            >
              {hasChildren ? (
                <button
                  aria-expanded={!collapsed}
                  aria-label={
                    collapsed
                      ? t("outline.expand", { title: node.heading.text })
                      : t("outline.collapse", { title: node.heading.text })
                  }
                  className="outline-item-toggle"
                  onClick={() => toggleCollapsed(node.heading.id)}
                  onMouseDown={preventFocusScroll}
                  type="button"
                >
                  <ChevronRight
                    aria-hidden
                    className={cn("outline-item-chevron", !collapsed && "is-open")}
                    strokeWidth={2}
                  />
                </button>
              ) : (
                <span aria-hidden className="outline-item-toggle-spacer" />
              )}
              <button
                aria-current={current ? "location" : undefined}
                className={cn("outline-item-label", current && "is-active")}
                data-depth={node.level}
                onClick={() => activate(node.heading.id)}
                onMouseDown={preventFocusScroll}
                title={node.heading.text}
                type="button"
              >
                <span aria-hidden className="outline-item-mark" />
                <span className="outline-item-text">{node.heading.text}</span>
              </button>
            </div>
          );
        })}
        {!headings.length && (
          <p className="outline-empty">{t("outline.empty")}</p>
        )}
      </div>
    </nav>
  );
}
