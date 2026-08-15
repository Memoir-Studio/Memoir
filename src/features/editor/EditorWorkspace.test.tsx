import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/app-store";
import { exportNotePdf } from "../export/export-note-pdf";
import { EditorWorkspace } from "./EditorWorkspace";

vi.mock("../export/export-note-pdf", () => ({
  exportNotePdf: vi.fn(),
}));

afterEach(() => {
  cleanup();
  useAppStore.setState({
    workspaceRoot: null,
    notes: [],
    activePath: null,
    loadedContentPath: null,
    content: "",
    savedContent: "",
  });
});

describe("EditorWorkspace PDF export", () => {
  it("exports the open note from the header button", async () => {
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [
        {
          relativePath: "alpha.md",
          fileName: "alpha.md",
          extension: "md",
          modifiedMs: 1,
          size: 10,
          title: "Alpha Guide",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      activePath: "alpha.md",
      loadedContentPath: "alpha.md",
      content: "# Alpha Guide",
      savedContent: "# Alpha Guide",
    });
    const user = userEvent.setup();
    const view = render(
      <EditorWorkspace isDark={false} onDelete={() => undefined} onRename={() => undefined} />,
    );

    await user.click(view.getByRole("button", { name: "导出 PDF" }));
    expect(exportNotePdf).toHaveBeenCalledWith("alpha.md");
  });
});
