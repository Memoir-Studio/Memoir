import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setGatewaysForTests } from "../../gateways";
import { useAppStore } from "../../store/app-store";
import { createMockGateways } from "../../test/mock-gateways";
import NoteGraphView from "./NoteGraphView";

function note(relativePath: string, title: string) {
  return {
    relativePath,
    fileName: relativePath,
    extension: "md" as const,
    modifiedMs: 1,
    size: 10,
    title,
    tags: [] as string[],
    excerpt: "",
    favorite: false,
  };
}

afterEach(() => {
  cleanup();
  setGatewaysForTests(null);
  useAppStore.setState({
    workspaceRoot: null,
    notes: [],
    activePath: null,
    content: "",
    savedContent: "",
  });
});

describe("NoteGraphView", () => {
  it("renders the full graph of linked notes", async () => {
    const gateways = createMockGateways();
    gateways.workspace.files.set("one.md", "# One\n\nSee [[Two]].\n");
    gateways.workspace.files.set("two.md", "# Two\n");
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [note("one.md", "One"), note("two.md", "Two")],
    });
    const view = render(<NoteGraphView />);
    await waitFor(() => {
      expect(view.getByRole("heading", { name: "笔记图谱" })).toBeInTheDocument();
      expect(view.getByText("One")).toBeInTheDocument();
      expect(view.getByText("Two")).toBeInTheDocument();
      expect(view.container.querySelectorAll("[data-graph-node]")).toHaveLength(2);
    });
    const full = view.getByRole("button", { name: "完整图谱" });
    const local = view.getByRole("button", { name: "只看相邻" });
    expect(full).toHaveAttribute("aria-pressed", "true");
    expect(local).toHaveAttribute("aria-pressed", "false");
    expect(full.closest(".view-switcher")).toBeTruthy();
    expect(view.getByText("当前笔记")).toBeInTheDocument();
    expect(view.getByText("相邻笔记")).toBeInTheDocument();
  });

  it("opens the selected note from the inspector card without a loud call to action", async () => {
    const gateways = createMockGateways();
    gateways.workspace.files.set("one.md", "# One\n\nSee [[Two]].\n");
    gateways.workspace.files.set("two.md", "# Two\n");
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      activePath: "one.md",
      libraryPanelMode: "graph",
      notes: [note("one.md", "One"), note("two.md", "Two")],
    });
    const view = render(<NoteGraphView />);
    await waitFor(() => {
      expect(view.getByRole("button", { name: "打开笔记" })).toBeInTheDocument();
    });
    expect(view.queryByText("打开笔记")).not.toBeInTheDocument();
    await userEvent.click(view.getByRole("button", { name: "打开笔记" }));
    expect(useAppStore.getState().libraryPanelMode).toBe("notes");
  });

  it("filters the scene to the active note and its neighbors", async () => {
    const gateways = createMockGateways();
    gateways.workspace.files.set("one.md", "# One\n\nSee [[Two]].\n");
    gateways.workspace.files.set("two.md", "# Two\n");
    gateways.workspace.files.set("three.md", "# Three\n");
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      activePath: "one.md",
      notes: [note("one.md", "One"), note("two.md", "Two"), note("three.md", "Three")],
    });
    const view = render(<NoteGraphView />);
    await waitFor(() => {
      expect(view.container.querySelectorAll("[data-graph-node]")).toHaveLength(3);
    });
    await userEvent.click(view.getByRole("button", { name: "只看相邻" }));
    expect(view.getByRole("button", { name: "只看相邻" })).toHaveAttribute("aria-pressed", "true");
    expect(view.getByRole("button", { name: "完整图谱" })).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => {
      const ids = [...view.container.querySelectorAll("[data-graph-node]")].map(
        (node) => (node as HTMLElement).dataset.graphNode,
      );
      expect(ids.sort()).toEqual(["one.md", "two.md"]);
    });
  });
});
