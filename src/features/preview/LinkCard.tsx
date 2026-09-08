import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useState } from "react";
import { fallbackLinkPreview } from "../../domain/link-preview";
import { colors, media, motion } from "../../styles/tokens.stylex";
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
      data-link-card=""
      data-link-card-pending={pending ? "" : undefined}
      href={url}
      onClick={(event) => {
        event.preventDefault();
        onOpen(url);
      }}
      rel="noreferrer"
      {...stylex.props(styles.card)}
    >
      {showImage ? (
        <img
          alt=""
          data-link-card-part="image"
          onError={() => setImageFailed(true)}
          src={preview.image}
          {...stylex.props(styles.image)}
        />
      ) : null}
      <span data-link-card-part="body" {...stylex.props(styles.body)}>
        <span data-link-card-part="title" {...stylex.props(styles.title)}>{preview.title}</span>
        {preview.description ? (
          <span data-link-card-part="description" {...stylex.props(styles.description)}>
            {preview.description}
          </span>
        ) : null}
        <span data-link-card-part="site" {...stylex.props(styles.site)}>
          {preview.favicon && !faviconFailed ? (
            <img
              alt=""
              data-link-card-part="favicon"
              onError={() => setFaviconFailed(true)}
              src={preview.favicon}
              {...stylex.props(styles.favicon)}
            />
          ) : (
            <span
              data-link-card-part="favicon-fallback"
              {...stylex.props(styles.favicon, styles.faviconFallback)}
            />
          )}
          <span data-link-card-part="host" {...stylex.props(styles.host)}>{preview.siteName}</span>
        </span>
      </span>
    </a>
  );
}

const styles = stylex.create({
  card: {
    display: "flex",
    alignItems: "stretch",
    overflow: "hidden",
    minHeight: 96,
    color: "inherit",
    textDecoration: "none",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: `color-mix(in srgb, ${colors.border} 88%, ${colors.muted})`,
      ":hover": `color-mix(in srgb, ${colors.muted} 42%, ${colors.border})`,
    },
    borderRadius: 14,
    backgroundColor: `light-dark(${colors.elevated}, color-mix(in srgb, ${colors.elevated} 82%, ${colors.panel}))`,
    boxShadow: {
      default: "light-dark(0 1px 2px rgb(46 40 31 / 4%), none)",
      ":hover":
        "light-dark(0 8px 24px rgb(46 40 31 / 7%), 0 10px 24px rgb(0 0 0 / 22%))",
    },
    transitionProperty: "border-color, box-shadow",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.ease,
  },
  image: {
    display: "block",
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: {
      default: 136,
      [media.narrow]: 104,
    },
    alignSelf: "stretch",
    width: {
      default: 136,
      [media.narrow]: 104,
    },
    minHeight: {
      default: 96,
      [media.narrow]: 88,
    },
    height: "auto",
    margin: 0,
    objectFit: "cover",
    backgroundColor: colors.panel,
    borderWidth: 0,
    borderRadius: 0,
    boxShadow: "none",
  },
  body: {
    display: "flex",
    minWidth: 0,
    flex: 1,
    flexDirection: "column",
    justifyContent: "center",
    gap: "0.18em",
    paddingTop: 10,
    paddingRight: 14,
    paddingBottom: 11,
    paddingLeft: 14,
  },
  title: {
    overflow: "hidden",
    color: colors.text,
    fontSize: "0.98em",
    fontWeight: 650,
    lineHeight: 1.35,
    letterSpacing: 0,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  description: {
    display: "-webkit-box",
    overflow: "hidden",
    color: colors.muted,
    fontSize: "0.78em",
    lineHeight: 1.5,
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  site: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    color: colors.muted,
    fontSize: "0.74em",
    lineHeight: 1,
  },
  favicon: {
    display: "block",
    width: 14,
    height: 14,
    margin: 0,
    borderWidth: 0,
    borderRadius: 3,
    objectFit: "cover",
    boxShadow: "none",
  },
  faviconFallback: {
    backgroundColor: `color-mix(in srgb, ${colors.muted} 28%, ${colors.panel})`,
  },
  host: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});
