import { useEffect, useState } from "react";

export default function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
        const result = await mermaid.render(
          `memoir-${Math.random().toString(36).slice(2)}`,
          code,
        );
        if (!cancelled) {
          setSvg(result.svg);
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
      dangerouslySetInnerHTML={{ __html: svg || "Rendering diagram..." }}
    />
  );
}
