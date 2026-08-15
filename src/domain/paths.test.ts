import { describe, expect, it } from "vitest";
import {
  decodeMediaHref,
  noteDirectory,
  relativePathFromNote,
  resolveWorkspaceFilePath,
} from "./paths";

describe("workspace paths", () => {
  it("resolves parent segments without collapsing URL schemes", () => {
    expect(resolveWorkspaceFilePath("/notes", "日记", "../attachments/a.png")).toBe(
      "/notes/attachments/a.png",
    );
    expect(resolveWorkspaceFilePath("demo://memoir", "思考", "../attachments/a.png")).toBe(
      "demo://memoir/attachments/a.png",
    );
    expect(resolveWorkspaceFilePath("C:/Users/writer/notes", "attachments/a.png")).toBe(
      "C:/Users/writer/notes/attachments/a.png",
    );
  });

  it("builds markdown-relative paths from the note directory", () => {
    expect(noteDirectory("welcome.md")).toBe("");
    expect(noteDirectory("日记/today.md")).toBe("日记");
    expect(relativePathFromNote("welcome.md", "attachments/a.png")).toBe("attachments/a.png");
    expect(relativePathFromNote("日记/today.md", "attachments/a.png")).toBe(
      "../attachments/a.png",
    );
    expect(relativePathFromNote("a/b/c.md", "attachments/x.png")).toBe(
      "../../attachments/x.png",
    );
  });

  it("decodes percent-encoded markdown image hrefs", () => {
    expect(decodeMediaHref("attachments/%E6%88%AA%E5%9B%BE-1.png")).toBe(
      "attachments/截图-1.png",
    );
    expect(decodeMediaHref("attachments/plain.png")).toBe("attachments/plain.png");
    expect(decodeMediaHref("attachments/100%.png")).toBe("attachments/100%.png");
  });
});
