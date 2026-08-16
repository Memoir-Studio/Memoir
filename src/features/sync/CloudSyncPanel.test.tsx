import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCloudSyncProfile } from "../../domain/cloud-sync";
import { useAppStore } from "../../store/app-store";
import { CloudSyncPanel } from "./CloudSyncPanel";

vi.mock("../../platform/runtime", () => ({
  isTauriRuntime: () => true,
}));

afterEach(() => {
  cleanup();
  useAppStore.setState({
    workspaceRoot: null,
    cloudSyncProfile: defaultCloudSyncProfile(),
    error: "",
  });
});

async function openSetup(user: ReturnType<typeof userEvent.setup>, view: ReturnType<typeof render>) {
  await user.click(view.getByRole("button", { name: "配置" }));
}

describe("CloudSyncPanel", () => {
  it("starts on the status tab and opens setup from the empty state", async () => {
    useAppStore.setState({
      workspaceRoot: "/workspace",
      cloudSyncProfile: defaultCloudSyncProfile(),
    });
    const user = userEvent.setup();
    const view = render(<CloudSyncPanel />);

    expect(view.getByRole("button", { name: "同步" })).toHaveAttribute("aria-pressed", "true");
    expect(view.getByText("还没有配置同步源")).toBeInTheDocument();
    expect(view.queryByText(/目前支持 WebDAV/)).not.toBeInTheDocument();

    await user.click(view.getByRole("button", { name: "去配置" }));
    expect(view.getByRole("button", { name: "配置" })).toHaveAttribute("aria-pressed", "true");
    expect(view.getByText(/目前支持 WebDAV/)).toBeInTheDocument();
  });

  it("collects WebDAV settings and saves through the store", async () => {
    const saveCloudSyncProfile = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      cloudSyncProfile: defaultCloudSyncProfile(),
      saveCloudSyncProfile,
    });
    const user = userEvent.setup();
    const view = render(<CloudSyncPanel />);
    await openSetup(user, view);

    expect(view.getByText(/目前支持 WebDAV/)).toBeInTheDocument();

    await user.type(
      view.getByPlaceholderText("https://dav.example.com/remote.php/dav/"),
      "https://dav.example/dav",
    );
    await user.type(view.getByLabelText("用户名"), "ada");
    await user.type(view.getByLabelText("密码"), "secret");
    await user.type(view.getByPlaceholderText("Memoir"), "Notes");
    await user.click(view.getByRole("switch", { name: "启用同步" }));
    await user.click(view.getByRole("button", { name: "保存" }));

    expect(saveCloudSyncProfile).toHaveBeenCalledWith({
      enabled: true,
      provider: "webdav",
      remotePrefix: "Notes",
      webdav: {
        url: "https://dav.example/dav",
        username: "ada",
        password: "secret",
        insecureTls: false,
      },
    });
  });

  it("tests the current form without requiring a prior save", async () => {
    const testCloudSync = vi.fn().mockResolvedValue({ ok: true, message: "Connected." });
    useAppStore.setState({
      workspaceRoot: "/workspace",
      cloudSyncProfile: defaultCloudSyncProfile(),
      testCloudSync,
    });
    const user = userEvent.setup();
    const view = render(<CloudSyncPanel />);
    await openSetup(user, view);

    await user.type(
      view.getByPlaceholderText("https://dav.example.com/remote.php/dav/"),
      "https://dav.example/dav",
    );
    await user.click(view.getByRole("button", { name: "测试连接" }));

    expect(testCloudSync).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "webdav",
        webdav: expect.objectContaining({ url: "https://dav.example/dav" }),
      }),
    );
    expect(await view.findByText("连接成功")).toBeInTheDocument();
  });

  it("shows saved sync status and runs a manual sync", async () => {
    const runCloudSync = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      cloudSyncProfile: {
        ...defaultCloudSyncProfile(),
        enabled: true,
        webdav: {
          url: "https://dav.example/dav",
          username: "ada",
          password: "secret",
          insecureTls: false,
        },
        lastSyncMs: Date.now(),
        lastStatus: "ok",
        lastReport: {
          uploaded: 1,
          downloaded: 2,
          deletedRemote: 0,
          deletedLocal: 0,
          skipped: 3,
          conflicts: 0,
          errors: [],
          completedMs: Date.now(),
        },
      },
      runCloudSync,
    });
    const user = userEvent.setup();
    const view = render(<CloudSyncPanel />);

    expect(view.getByText("已同步")).toBeInTheDocument();
    expect(view.getByText("上传")).toBeInTheDocument();
    expect(view.getByText("1")).toBeInTheDocument();
    expect(view.getByText(/dav\.example/)).toBeInTheDocument();
    const syncButtons = view.getAllByRole("button", { name: "立即同步" });
    await user.click(syncButtons[syncButtons.length - 1]);
    expect(runCloudSync).toHaveBeenCalledWith();
  });
});
