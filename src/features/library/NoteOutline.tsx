import { AlignLeft } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "../../components/ui";
import type { HeadingItem } from "../../domain/notes";
import { useI18n } from "../../i18n/react";

const MAX_INDENT_LEVEL = 4;
const BASE_INSET = 14;
const INSET_STEP = 18;

function headingInset(depth: number) {
  return BASE_INSET + Math.min(Math.max(depth, 1) - 1, MAX_INDENT_LEVEL) * INSET_STEP;
}

function minHeadingDepth(headings: HeadingItem[]) {
  return headings.reduce((min, heading) => Math.min(min, heading.depth), 6);
}

function outlineLevel(depth: number, minDepth: number) {
  return Math.max(1, depth - minDepth + 1);
}

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
  const ignoreObserverRef = useRef(false);
  const ignoreTimerRef = useRef<number | null>(null);

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

  const activate = (id: string) => {
    setActiveId(id);
    ignoreObserverRef.current = true;
    document.getElementById(id)?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
    if (ignoreTimerRef.current !== null) window.clearTimeout(ignoreTimerRef.current);
    ignoreTimerRef.current = window.setTimeout(() => {
      ignoreObserverRef.current = false;
      ignoreTimerRef.current = null;
    }, 480);
  };

  const rootDepth = minHeadingDepth(headings);

  return (
    <nav
      aria-label={t("outline.label")}
      className="outline-list memoir-fade-in flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-auto"
    >
      <div className="outline-caption">
        <AlignLeft aria-hidden className="outline-caption-icon" strokeWidth={1.75} />
        <span>{t("outline.label")}</span>
      </div>
      <div className="outline-items">
        {headings.map((heading) => {
          const current = heading.id === activeId;
          const level = outlineLevel(heading.depth, rootDepth);
          return (
            <button
              aria-current={current ? "location" : undefined}
              className={cn("outline-item", current && "is-active")}
              data-depth={level}
              key={heading.id}
              onClick={() => activate(heading.id)}
              style={{ "--outline-inset": `${headingInset(level)}px` } as CSSProperties}
              title={heading.text}
              type="button"
            >
              <span aria-hidden className="outline-item-mark" />
              <span className="outline-item-text">{heading.text}</span>
            </button>
          );
        })}
        {!headings.length && (
          <p className="outline-empty">{t("outline.empty")}</p>
        )}
      </div>
    </nav>
  );
}
