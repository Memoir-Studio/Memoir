import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setGatewaysForTests } from "../../gateways";
import { useAppStore } from "../../store/app-store";
import { createMockGateways } from "../../test/mock-gateways";
import { useNoteGraph } from "./useNoteGraph";

function GraphProbe() {
  const { graph } = useNoteGraph();
  return <span>{graph.nodes.length}</span>;
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

describe("useNoteGraph", () => {
  it("does not reload the workspace graph when only the selected content changes", async () => {
    const gateways = createMockGateways();
    const getNoteGraph = vi.spyOn(gateways.workspace, "getNoteGraph");
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [
        {
          relativePath: "one.md",
          fileName: "one.md",
          extension: "md",
          modifiedMs: 1,
          size: 5,
          title: "One",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      activePath: "one.md",
      content: "# One",
      savedContent: "# One",
    });

    const first = render(<GraphProbe />);
    await waitFor(() => expect(getNoteGraph).toHaveBeenCalledTimes(1));
    act(() => {
      useAppStore.setState({ content: "# Other", savedContent: "# Other" });
    });
    await Promise.resolve();

    expect(getNoteGraph).toHaveBeenCalledTimes(1);

    first.unmount();
    render(<GraphProbe />);
    await waitFor(() => expect(getNoteGraph).toHaveBeenCalledTimes(1));
  });
});
