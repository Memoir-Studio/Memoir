import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { colors } from "../../styles/tokens.stylex";
import { getCachedMermaidSvg, renderMermaidDiagram } from "./mermaid-runtime";

export default function MermaidBlock({ code }: { code: string }) {
  const cached = getCachedMermaidSvg(code);
  const [svg, setSvg] = useState(cached || "");
  const [error, setError] = useState("");

  useEffect(() => {
    const hit = getCachedMermaidSvg(code);
    if (hit) {
      setSvg(hit);
      setError("");
      return;
    }
    let cancelled = false;
    void renderMermaidDiagram(code)
      .then((next) => {
        if (!cancelled) {
          setSvg(next);
          setError("");
        }
      })
      .catch((renderError: unknown) => {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : String(renderError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return <pre {...stylex.props(styles.error)}>{error}</pre>;
  }
  return (
    <div
      data-mermaid-block=""
      data-mermaid-pending={svg ? undefined : ""}
      dangerouslySetInnerHTML={{ __html: svg || "Rendering diagram..." }}
      {...stylex.props(styles.diagram)}
    />
  );
}

const styles = stylex.create({
  error: {
    whiteSpace: "pre-wrap",
    color: colors.danger,
    borderColor: `color-mix(in srgb, ${colors.danger} 30%, transparent)`,
    backgroundColor: `color-mix(in srgb, ${colors.danger} 5%, transparent)`,
  },
  diagram: {
    overflow: "auto",
    marginBlock: 16,
    padding: 16,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.elevated,
  },
});
