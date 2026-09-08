import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/app-store";
import { LibrarySidebar } from "../library/LibrarySidebar";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

afterEach(() => {
  cleanup();
  useAppStore.setState({
    workspaceRoot: null,
    recentWorkspaces: [],
    notes: [],
    folderAppearances: {},
    navFilter: "all",
    scopedFilter: null,
    isSidebarCollapsed: false,
  });
});

describe("WorkspaceSwitcher", () => {
  it("lists recent workspaces and switches to another one", async () => {
    const openWorkspace = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      workspaceRoot: "/home/me/日记",
      recentWorkspaces: ["/home/me/日记", "/home/me/工作"],
      notes: [],
      openWorkspace,
    });
    const user = userEvent.setup();
    const view = render(<WorkspaceSwitcher collapsed={false} noteCount={3} />);

    await user.click(view.getByRole("button", { name: "切换工作区" }));
    const menu = view.getByRole("menu", { name: "切换工作区" });
    expect(menu).toBeInTheDocument();
    expect(view.getByRole("menuitem", { name: /日记/ })).toHaveAttribute("aria-current", "true");
    expect(view.getByRole("menu", { name: "切换工作区" })).not.toHaveTextContent(/^M$/);

    await user.click(view.getByRole("menuitem", { name: /工作/ }));
    expect(openWorkspace).toHaveBeenCalledWith("/home/me/工作");
    expect(view.queryByRole("menu", { name: "切换工作区" })).not.toBeInTheDocument();
  });

  it("does not reload the current workspace and can open another folder", async () => {
    const openWorkspace = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      workspaceRoot: "/home/me/日记",
      recentWorkspaces: ["/home/me/日记"],
      notes: [],
      openWorkspace,
    });
    const user = userEvent.setup();
    const view = render(<WorkspaceSwitcher collapsed={false} noteCount={1} />);

    await user.click(view.getByRole("button", { name: "切换工作区" }));
    await user.click(view.getByRole("menuitem", { name: /日记/ }));
    expect(openWorkspace).not.toHaveBeenCalled();

    await user.click(view.getByRole("button", { name: "切换工作区" }));
    await user.click(view.getByRole("menuitem", { name: "打开另一个文件夹" }));
    expect(openWorkspace).toHaveBeenCalledWith();
  });

  it("is available from the sidebar footer", async () => {
    useAppStore.setState({
      workspaceRoot: "/home/me/日记",
      recentWorkspaces: ["/home/me/日记"],
      notes: [],
    });
    const view = render(
      <LibrarySidebar isDark={false} onCreateFolder={() => undefined} onCreateTag={() => undefined} />,
    );

    const switcher = view.getByRole("button", { name: "切换工作区" });
    expect(switcher).toBeInTheDocument();
    expect(switcher).toHaveTextContent("日记");
    expect(switcher).toHaveTextContent("0 篇笔记");
    expect(switcher).not.toHaveTextContent("M");
  });
});
