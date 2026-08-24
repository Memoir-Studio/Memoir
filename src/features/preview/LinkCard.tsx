import { useEffect, useMemo, useState } from "react";
import { fallbackLinkPreview } from "../../domain/link-preview";
import { getCachedLinkPreview, loadLinkPreview } from "./link-preview-cache";

export function LinkCard({
  url,
  label = "",
  onOpen,
}: {
  url: string;
  label?: string;
  onOpen: (href: string) => void;
}) {
  const fallback = useMemo(() => fallbackLinkPreview(url, label), [label, url]);
  const [preview, setPreview] = useState(() => getCachedLinkPreview(url) || fallback);
  const [pending, setPending] = useState(() => !getCachedLinkPreview(url));
  const [imageFailed, setImageFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);

  useEffect(() => {
    const cached = getCachedLinkPreview(url);
    if (cached) {
      setPreview(cached);
      setPending(false);
      setImageFailed(false);
      setFaviconFailed(false);
      return;
    }
    setPreview(fallback);
    setPending(true);
    setImageFailed(false);
    setFaviconFailed(false);
    let cancelled = false;
    void loadLinkPreview(url, label).then((next) => {
      if (cancelled) return;
      setPreview(next);
      setPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fallback, label, url]);

  const showImage = Boolean(preview.image) && !imageFailed;

  return (
    <a
      className="memoir-link-card"
      data-link-card-pending={pending ? "" : undefined}
      href={url}
      onClick={(event) => {
        event.preventDefault();
        onOpen(url);
      }}
      rel="noreferrer"
    >
      {showImage ? (
        <img
          alt=""
          className="memoir-link-card__image"
          onError={() => setImageFailed(true)}
          src={preview.image}
        />
      ) : null}
      <span className="memoir-link-card__body">
        <span className="memoir-link-card__title">{preview.title}</span>
        {preview.description ? (
          <span className="memoir-link-card__desc">{preview.description}</span>
        ) : null}
        <span className="memoir-link-card__site">
          {preview.favicon && !faviconFailed ? (
            <img
              alt=""
              className="memoir-link-card__favicon"
              onError={() => setFaviconFailed(true)}
              src={preview.favicon}
            />
          ) : (
            <span className="memoir-link-card__favicon-fallback" />
          )}
          <span className="memoir-link-card__host">{preview.siteName}</span>
        </span>
      </span>
    </a>
  );
}
