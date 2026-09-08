import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/app-store";
import { AttachmentLibrary } from "./AttachmentLibrary";

afterEach(() => {
  cleanup();
  useAppStore.setState({
    workspaceRoot: null,
    activePath: null,
    attachments: [],
    error: "",
  });
});

describe("AttachmentLibrary", () => {
  it("inserts a note-relative markdown image on click", async () => {
    const onInsert = vi.fn();
    useAppStore.setState({
      workspaceRoot: "/notes",
      activePath: "日记/today.md",
      attachments: [
        {
          relativePath: "attachments/paste-1.png",
          fileName: "paste-1.png",
          extension: "png",
          mimeType: "image/png",
          modifiedMs: Date.now(),
          size: 2048,
        },
      ],
    });
    const user = userEvent.setup();
    const view = render(<AttachmentLibrary onInsert={onInsert} />);

    expect(view.getByText("paste-1.png")).toBeInTheDocument();
    await user.click(view.getByRole("button", { name: "paste-1.png" }));
    expect(onInsert).toHaveBeenCalledWith("![paste-1](../attachments/paste-1.png)");
  });

  it("asks for an open note before inserting", async () => {
    useAppStore.setState({
      workspaceRoot: "/notes",
      activePath: null,
      attachments: [
        {
          relativePath: "attachments/paste-1.png",
          fileName: "paste-1.png",
          extension: "png",
          mimeType: "image/png",
          modifiedMs: 1,
          size: 12,
        },
      ],
    });
    const user = userEvent.setup();
    const view = render(<AttachmentLibrary onInsert={vi.fn()} />);
    await user.click(view.getByRole("button", { name: "paste-1.png" }));
    expect(useAppStore.getState().error).toContain("笔记");
  });

  it("opens a delete confirmation from the context menu", async () => {
    useAppStore.setState({
      workspaceRoot: "/notes",
      activePath: "welcome.md",
      attachments: [
        {
          relativePath: "attachments/paste-1.png",
          fileName: "paste-1.png",
          extension: "png",
          mimeType: "image/png",
          modifiedMs: 1,
          size: 12,
        },
      ],
    });
    const view = render(<AttachmentLibrary />);
    fireEvent.contextMenu(view.getByRole("button", { name: "paste-1.png" }), {
      clientX: 24,
      clientY: 48,
    });
    expect(view.getByRole("menu", { name: "paste-1.png 的操作" })).toBeInTheDocument();
  });
});
