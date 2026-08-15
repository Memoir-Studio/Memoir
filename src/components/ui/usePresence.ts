import { useEffect, useState } from "react";

const MOTION_MS = 160;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function usePresence(open: boolean, durationMs = MOTION_MS) {
  const [lingering, setLingering] = useState(open);
  const [visible, setVisible] = useState(false);
  const present = open || lingering;

  useEffect(() => {
    if (prefersReducedMotion()) {
      setLingering(open);
      setVisible(open);
      return;
    }
    if (open) {
      setLingering(true);
      let inner = 0;
      const outer = window.requestAnimationFrame(() => {
        inner = window.requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        window.cancelAnimationFrame(outer);
        window.cancelAnimationFrame(inner);
      };
    }
    setVisible(false);
    const timer = window.setTimeout(() => setLingering(false), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, open]);

  return { present, visible };
}
