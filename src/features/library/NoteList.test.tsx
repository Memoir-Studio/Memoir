import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { setGatewaysForTests } from "../../gateways";
import { useAppStore } from "../../store/app-store";
import { createMockGateways } from "../../test/mock-gateways";
import { NoteList } from "./NoteList";

afterEach(() => {
  cleanup();
  setGatewaysForTests(null);
  useAppStore.setState({
    workspaceRoot: null,
    notes: [],
    libraryStats: {
      total: 0,
      recent: 0,
      favorites: 0,
      folders: [],
      tags: [],
      truncated: false,
    },
    activePath: null,
    loadedContentPath: null,
    content: "",
    savedContent: "",
    query: "",
    navFilter: "all",
    scopedFilter: null,
    libraryPanelMode: "notes",
    attachments: [],
    isLoading: false,
    settings: DEFAULT_SETTINGS,
  });
});

describe("NoteList", () => {
  it("appends deduplicated semantic matches after keyword results", async () => {
    const gateways = createMockGateways();
    gateways.workspace.semanticResults = [
      {
        relativePath: "beta.mdx",
        title: "Duplicate keyword result",
        excerpt: "",
        content: "Already matched by keyword search",
        score: 0.98,
        chunkIndex: 0,
      },
      {
        relativePath: "related.md",
        title: "Related note",
        excerpt: "",
        content: "A semantic match that does not contain the keyword.",
        score: 0.83,
        chunkIndex: 1,
      },
    ];
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [
        {
          relativePath: "beta.mdx",
          fileName: "beta.mdx",
          extension: "mdx",
          modifiedMs: 2,
          size: 20,
          title: "Beta Notes",
          tags: ["ideas"],
          excerpt: "Keyword match",
          favorite: false,
        },
      ],
      query: "beta",
      settings: {
        ...DEFAULT_SETTINGS,
        ai: { ...DEFAULT_SETTINGS.ai, enabled: true },
      },
    });
    const view = render(
      <NoteList
        onMove={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
        onRename={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(view.getByText("Related note")).toBeInTheDocument();
    });
    expect(view.getByText("语义相关")).toBeInTheDocument();
    expect(view.getByText("2 篇")).toBeInTheDocument();
    expect(view.queryByText("Duplicate keyword result")).not.toBeInTheDocument();
  });

  it("mounts only the virtual window when the page is long", () => {
    useAppStore.setState({
      notes: Array.from({ length: 120 }, (_, index) => ({
        relativePath: `n${index}.md`,
        fileName: `n${index}.md`,
        extension: "md" as const,
        modifiedMs: index,
        size: 10,
        title: `Note ${index}`,
        tags: [],
        excerpt: "",
        favorite: false,
      })),
    });
    const view = render(
      <NoteList
        onMove={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
        onRename={() => undefined}
      />,
    );
    const cards = view.container.querySelectorAll("[data-note-card]");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThan(120);
    expect(view.queryByText("n0")).toBeInTheDocument();
    expect(view.queryByText("n119")).not.toBeInTheDocument();
  });
});
