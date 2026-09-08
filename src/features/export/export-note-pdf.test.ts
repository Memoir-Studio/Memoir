import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGatewaysForTests } from "../../gateways";
import { createMockGateways } from "../../test/mock-gateways";
import { useAppStore } from "../../store/app-store";
import { exportNotePdf } from "./export-note-pdf";
import { renderNotePdf } from "./render-note-pdf";

vi.mock("./render-note-pdf", () => ({
  renderNotePdf: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));

describe("exportNotePdf", () => {
  beforeEach(() => {
    vi.mocked(renderNotePdf).mockReset();
    vi.mocked(renderNotePdf).mockResolvedValue(new Uint8Array([1, 2, 3]));
    const gateways = createMockGateways();
    gateways.workspace.files.set("two.mdx", "---\ntitle: two\n---\n\n# two\n");
    gateways.workspace.nextExportPath = "/tmp/two.pdf";
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [
        {
          relativePath: "two.mdx",
          fileName: "two.mdx",
          extension: "mdx",
          modifiedMs: 1,
          size: 10,
          title: "two",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      activePath: "two.mdx",
      loadedContentPath: "two.mdx",
      content: "# two\n\nunsaved",
      savedContent: "# two",
      status: "",
      error: "",
      settings: {
        ...useAppStore.getState().settings,
        appearance: { ...useAppStore.getState().settings.appearance, locale: "zh" },
      },
    });
  });

  afterEach(() => {
    setGatewaysForTests(null);
  });

  it("exports the open editor contents and writes the chosen PDF", async () => {
    const path = await exportNotePdf("two.mdx");
    expect(useAppStore.getState().error).toBe("");
    expect(path).toBe("/tmp/two.pdf");
    expect(renderNotePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "# two\n\nunsaved",
        relativePath: "two.mdx",
        root: "/workspace",
      }),
    );
    expect(useAppStore.getState().status).toBe("已导出 PDF");
  });

  it("does nothing when the save dialog is cancelled", async () => {
    const gateways = createMockGateways();
    gateways.workspace.nextExportPath = null;
    setGatewaysForTests(gateways);
    await expect(exportNotePdf("two.mdx")).resolves.toBeNull();
    expect(renderNotePdf).not.toHaveBeenCalled();
    expect(useAppStore.getState().error).toBe("");
  });
});
