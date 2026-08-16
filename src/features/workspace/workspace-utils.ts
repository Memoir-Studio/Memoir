import { resolveWorkspaceFilePath } from "../../domain/paths";
import { getGateways } from "../../gateways";

export async function revealWorkspaceItem(root: string, ...relativeParts: string[]) {
  await getGateways().workspace.revealPath(resolveWorkspaceFilePath(root, ...relativeParts));
}

export function workspaceDisplayName(root: string | null | undefined, fallback = "") {
  if (!root) return fallback;
  const name = root.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return name?.trim() || fallback;
}

export function workspaceInitial(name: string) {
  const char = [...name.trim()][0];
  if (!char) return "M";
  return /[a-z]/i.test(char) ? char.toUpperCase() : char;
}

export function mergeRecentWorkspaces(current: string | null, recent: string[]) {
  const items: string[] = [];
  const seen = new Set<string>();
  for (const root of [current, ...recent]) {
    if (!root || seen.has(root)) continue;
    seen.add(root);
    items.push(root);
  }
  return items;
}
