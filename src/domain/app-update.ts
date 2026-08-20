export const GITHUB_REPO_URL = "https://github.com/Memoir-Studio/Memoir";

const GITHUB_HOST_PREFIX = "https://github.com/";
const GITHUB_REPO_PATH = "Memoir-Studio/Memoir";

export type AppUpdateStatus = "upToDate" | "available" | "skipped";

export type AppUpdateCheck = {
  status: AppUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
};

export function isAllowedReleaseUrl(url: string): boolean {
  if (!url.startsWith(GITHUB_HOST_PREFIX)) return false;
  const rest = url.slice(GITHUB_HOST_PREFIX.length);
  return (
    rest === GITHUB_REPO_PATH ||
    rest.startsWith(`${GITHUB_REPO_PATH}/`) ||
    rest.startsWith(`${GITHUB_REPO_PATH}?`) ||
    rest.startsWith(`${GITHUB_REPO_PATH}#`)
  );
}
