import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GITHUB_REPO_URL } from "../../domain/app-update";
import { setGatewaysForTests } from "../../gateways";
import { createMockGateways } from "../../test/mock-gateways";
import { AppUpdateNotice } from "./AppUpdateNotice";
import { UpdateNotice } from "./UpdateNotice";
import { resetAppUpdateCheckForTests } from "./useAppUpdateCheck";

afterEach(() => {
  cleanup();
  setGatewaysForTests(null);
  resetAppUpdateCheckForTests();
});

describe("UpdateNotice", () => {
  it("skips, dismisses, and opens the release page", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSkip = vi.fn();
    const onDownload = vi.fn();
    const view = render(
      <UpdateNotice
        latestVersion="0.1.7"
        onClose={onClose}
        onDownload={onDownload}
        onSkip={onSkip}
        open
        releaseNotes="Fixes a crash."
      />,
    );

    expect(view.getByRole("dialog", { name: "发现新版本" })).toBeInTheDocument();
    expect(view.getByText("Fixes a crash.")).toBeInTheDocument();

    await user.click(view.getByRole("button", { name: "跳过此版本" }));
    expect(onSkip).toHaveBeenCalledOnce();

    await user.click(view.getByRole("button", { name: "稍后" }));
    expect(onClose).toHaveBeenCalledOnce();

    await user.click(view.getByRole("button", { name: "前往下载" }));
    expect(onDownload).toHaveBeenCalledOnce();
  });
});

describe("AppUpdateNotice", () => {
  it("prompts when a newer version is available and skip persists it", async () => {
    const gateways = createMockGateways();
    gateways.persistence.nextUpdateCheck = {
      status: "available",
      currentVersion: "0.1.6",
      latestVersion: "0.1.7",
      releaseUrl: `${GITHUB_REPO_URL}/releases/tag/v0.1.7`,
      releaseNotes: "Fixes a crash.",
    };
    const openExternal = vi.spyOn(gateways.workspace, "openExternal");
    setGatewaysForTests(gateways);
    resetAppUpdateCheckForTests();
    const user = userEvent.setup();
    const view = render(<AppUpdateNotice />);

    await waitFor(() => {
      expect(view.getByRole("dialog", { name: "发现新版本" })).toBeInTheDocument();
    });
    expect(view.getByText("Memoir 0.1.7 已经发布。")).toBeInTheDocument();

    await user.click(view.getByRole("button", { name: "跳过此版本" }));
    await waitFor(() => {
      expect(gateways.persistence.skipAppUpdateCalls).toEqual(["0.1.7"]);
    });
    await waitFor(() => {
      expect(view.queryByRole("dialog", { name: "发现新版本" })).not.toBeInTheDocument();
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("opens the GitHub release from the download action", async () => {
    const gateways = createMockGateways();
    const releaseUrl = `${GITHUB_REPO_URL}/releases/tag/v0.1.7`;
    gateways.persistence.nextUpdateCheck = {
      status: "available",
      currentVersion: "0.1.6",
      latestVersion: "0.1.7",
      releaseUrl,
      releaseNotes: null,
    };
    const openExternal = vi.spyOn(gateways.workspace, "openExternal");
    setGatewaysForTests(gateways);
    resetAppUpdateCheckForTests();
    const user = userEvent.setup();
    const view = render(<AppUpdateNotice />);

    await waitFor(() => {
      expect(view.getByRole("button", { name: "前往下载" })).toBeInTheDocument();
    });
    await user.click(view.getByRole("button", { name: "前往下载" }));
    expect(openExternal).toHaveBeenCalledWith(releaseUrl);
  });

  it("stays quiet when the app is already up to date", async () => {
    const gateways = createMockGateways();
    setGatewaysForTests(gateways);
    resetAppUpdateCheckForTests();
    const view = render(<AppUpdateNotice />);
    await waitFor(() => {
      expect(gateways.persistence.checkAppUpdateCalls).toBe(1);
    });
    expect(view.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
