export type HostOs = "macos" | "windows" | "linux" | "unknown";

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function navigatorPlatformHint() {
  if (typeof navigator === "undefined") return "";
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  return `${uaData ?? ""} ${navigator.platform} ${navigator.userAgent}`;
}

export function detectHostOs(hint = navigatorPlatformHint()): HostOs {
  const haystack = hint.toLowerCase();
  if (haystack.includes("win")) return "windows";
  if (haystack.includes("mac") || haystack.includes("darwin")) return "macos";
  if (haystack.includes("linux") || haystack.includes("x11")) return "linux";
  return "unknown";
}
