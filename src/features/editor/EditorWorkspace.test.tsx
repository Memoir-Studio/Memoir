import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { useAppStore } from "../../store/app-store";
import { EditorWorkspace } from "./EditorWorkspace";

const PANE_READY_TIMEOUT_MS = 5000;

beforeAll(async () => {
  // Keep cold module transforms outside waitFor's DOM readiness timeout.
  await Promise.all([
    import("./EditorPane"),
    import("../preview/PreviewPane"),
  ]);
});

afterEach(() => {
  cleanup();
  useAppStore.setState({
    workspaceRoot: null,
    notes: [],
    activePath: null,
    loadedContentPath: null,
    content: "",
    savedContent: "",
    isLoading: false,
    settings: DEFAULT_SETTINGS,
    settingsOpen: false,
    settingsSection: "appearance",
    error: "",
    viewMode: "split",
  });
});

describe("EditorWorkspace document state", () => {
  it("syncs preview property edits into the source editor and dirty state", async () => {
    const content = "---\ntitle: Original\ntags: [入门]\naliases: [指南]\n---\n\n# Body";
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [{ relativePath: "alpha.md", fileName: "alpha.md", extension: "md",
        modifiedMs: 1, size: content.length, title: "Original", tags: ["入门"],
        excerpt: "", favorite: false }],
      activePath: "alpha.md",
      loadedContentPath: "alpha.md",
      content,
      savedContent: content,
      viewMode: "split",
    });
    const view = render(<EditorWorkspace isDark={false} onDelete={() => undefined} onRename={() => undefined} />);
    const user = userEvent.setup();
    await view.findByRole("region", { name: "实时预览" }, { timeout: PANE_READY_TIMEOUT_MS });
    await user.click(
      await view.findByRole("button", { name: "编辑 title" }, { timeout: PANE_READY_TIMEOUT_MS }),
    );
    const title = view.getByRole("textbox", { name: "title" });
    fireEvent.change(title, { target: { value: "新的标题" } });
    fireEvent.keyDown(title, { key: "Enter", isComposing: true });
    expect(useAppStore.getState().content).toBe(content);
    fireEvent.keyDown(title, { key: "Enter" });
    await waitFor(
      () => expect(view.container.querySelector(".cm-content")).toHaveTextContent('title: "新的标题"'),
      { timeout: PANE_READY_TIMEOUT_MS },
    );
    expect(useAppStore.getState().savedContent).toBe(content);
    expect(useAppStore.getState().content).toContain("# Body");

    await user.click(view.getByRole("button", { name: "编辑 tags" }));
    const tags = view.getByRole("textbox", { name: "tags" });
    fireEvent.change(tags, { target: { value: "Memoir，MDX" } });
    fireEvent.blur(tags);
    await waitFor(
      () => expect(view.container.querySelector(".cm-content")).toHaveTextContent('tags: ["Memoir","MDX"]'),
      { timeout: PANE_READY_TIMEOUT_MS },
    );

    await user.click(view.getByRole("button", { name: "编辑 tags" }));
    const clearedTags = view.getByRole("textbox", { name: "tags" });
    fireEvent.change(clearedTags, { target: { value: "" } });
    fireEvent.keyDown(clearedTags, { key: "Enter" });
    expect(view.container.querySelector('[data-property-key="tags"]')).toHaveTextContent("空");
    expect(useAppStore.getState().content).toContain("tags: []");

    await user.click(view.getByRole("button", { name: "编辑 aliases" }));
    const aliases = view.getByRole("textbox", { name: "aliases" });
    const beforeCancel = useAppStore.getState().content;
    fireEvent.change(aliases, { target: { value: "取消修改" } });
    fireEvent.keyDown(aliases, { key: "Escape" });
    expect(useAppStore.getState().content).toBe(beforeCancel);
  }, 15_000);

  it("keeps the previous document visible while the next note is loading", async () => {
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [
        {
          relativePath: "alpha.md",
          fileName: "alpha.md",
          extension: "md",
          modifiedMs: 1,
          size: 10,
          title: "Alpha",
          tags: [],
          excerpt: "",
          favorite: false,
        },
        {
          relativePath: "beta.md",
          fileName: "beta.md",
          extension: "md",
          modifiedMs: 2,
          size: 10,
          title: "Beta",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      activePath: "beta.md",
      loadedContentPath: "alpha.md",
      content: "# Alpha",
      savedContent: "# Alpha",
      isLoading: true,
      viewMode: "split",
    });
    const view = render(
      <EditorWorkspace isDark={false} onDelete={() => undefined} onRename={() => undefined} />,
    );

    await waitFor(() => expect(view.container.querySelector("[data-editor-pane]")).toBeTruthy());
    const content = view.container.querySelector("[data-switching-note]");
    expect(content?.querySelector('[role="status"]')).toHaveTextContent("正在打开笔记…");
    expect(content).toHaveAttribute("aria-busy", "true");
    expect(content?.querySelector("[data-editor-pane]")?.closest("[inert]")).toBeTruthy();
    expect(view.getByRole("button", { name: "保存" })).toBeDisabled();
  });
});
