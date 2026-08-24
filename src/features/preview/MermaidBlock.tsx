import { useEffect, useState } from "react";
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
    return <pre className="border-danger/30 bg-danger/5 text-danger">{error}</pre>;
  }
  return (
    <div
      className="my-4 overflow-auto rounded-lg border border-border bg-elevated p-4"
      data-mermaid-pending={svg ? undefined : ""}
      dangerouslySetInnerHTML={{ __html: svg || "Rendering diagram..." }}
    />
  );
}
