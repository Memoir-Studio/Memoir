import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setGatewaysForTests } from "../../gateways";
import { useAppStore } from "../../store/app-store";
import { createMockGateways } from "../../test/mock-gateways";
import { NoteLinksPanel } from "./NoteLinksPanel";

afterEach(() => {
  cleanup();
  setGatewaysForTests(null);
  useAppStore.setState({
    workspaceRoot: null,
    activePath: null,
    content: "",
    savedContent: "",
  });
});

describe("NoteLinksPanel", () => {
  it("shows backlinks and opens the source note", async () => {
    const gateways = createMockGateways();
    gateways.workspace.files.set("one.md", "# One\n\nSee [[Two]].\n");
    gateways.workspace.files.set("two.md", "# Two\n\nBody.\n");
    setGatewaysForTests(gateways);
    const selectNote = vi.fn(async () => undefined);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      activePath: "two.md",
      content: "# Two\n\nBody.\n",
      savedContent: "# Two\n\nBody.\n",
      selectNote,
    });
    const user = userEvent.setup();
    const view = render(<NoteLinksPanel />);

    await waitFor(() => {
      expect(view.getByText("One")).toBeInTheDocument();
    });
    expect(view.getByText(/反向引用/)).toBeInTheDocument();
    await user.click(view.getByRole("button", { name: /One/ }));
    expect(selectNote).toHaveBeenCalledWith("one.md");
  });
});
