import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "./app-version";

describe("app version", () => {
  it("matches the Cargo package version", () => {
    const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
    const version = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    expect(version).toBeTruthy();
    expect(APP_VERSION).toBe(version);
  });
});
