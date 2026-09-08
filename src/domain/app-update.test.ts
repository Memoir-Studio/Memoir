import { describe, expect, it } from "vitest";
import { GITHUB_REPO_URL, isAllowedReleaseUrl } from "./app-update";

describe("app update urls", () => {
  it("allows only this GitHub repository", () => {
    expect(isAllowedReleaseUrl(`${GITHUB_REPO_URL}/releases/tag/v0.1.7`)).toBe(true);
    expect(isAllowedReleaseUrl(GITHUB_REPO_URL)).toBe(true);
    expect(isAllowedReleaseUrl("https://github.com/Memoir-Studio/Memoir-evil")).toBe(false);
    expect(isAllowedReleaseUrl("https://evil.example/releases")).toBe(false);
    expect(isAllowedReleaseUrl("http://github.com/Memoir-Studio/Memoir")).toBe(false);
  });
});
