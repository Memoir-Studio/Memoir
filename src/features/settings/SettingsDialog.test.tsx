import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "../../domain/settings";
import { setGatewaysForTests } from "../../gateways";
import { resolveLocale } from "../../i18n";
import { I18nProvider } from "../../i18n/react";
import { createMockGateways } from "../../test/mock-gateways";
import SettingsDialog, { GITHUB_REPO_URL } from "./SettingsDialog";

afterEach(() => {
  cleanup();
  setGatewaysForTests(null);
});

describe("SettingsDialog", () => {
  it("switches sections and emits changed editor settings", async () => {
    const onSectionChange = vi.fn();
    const onSettingsChange = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <SettingsDialog
        onClose={() => undefined}
        onReset={() => undefined}
        onSectionChange={onSectionChange}
        onSettingsChange={onSettingsChange}
        open
        section="editor"
        settings={DEFAULT_SETTINGS}
      />,
    );

    await user.click(view.getByRole("button", { name: "外观" }));
    expect(onSectionChange).toHaveBeenCalledWith("appearance");

    await user.click(view.getByRole("switch", { name: "自动换行" }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      editor: {
        ...DEFAULT_SETTINGS.editor,
        lineWrapping: false,
      },
    });
  });

  it("emits interface scale from the appearance slider", () => {
    const onSettingsChange = vi.fn();
    const view = render(
      <SettingsDialog
        onClose={() => undefined}
        onReset={() => undefined}
        onSectionChange={() => undefined}
        onSettingsChange={onSettingsChange}
        open
        section="appearance"
        settings={DEFAULT_SETTINGS}
      />,
    );

    fireEvent.change(view.getByRole("slider", { name: "界面缩放" }), {
      target: { value: "1.25" },
    });
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      appearance: {
        ...DEFAULT_SETTINGS.appearance,
        uiScale: 1.25,
      },
    });
  });

  it("switches the settings chrome into English", async () => {
    function Harness() {
      const [settings, setSettings] = useState<AppSettings>({
        ...DEFAULT_SETTINGS,
        appearance: { ...DEFAULT_SETTINGS.appearance, locale: "zh" },
      });
      return (
        <I18nProvider locale={resolveLocale(settings.appearance.locale)}>
          <SettingsDialog
            onClose={() => undefined}
            onReset={() => undefined}
            onSectionChange={() => undefined}
            onSettingsChange={setSettings}
            open
            section="appearance"
            settings={settings}
          />
        </I18nProvider>
      );
    }

    const user = userEvent.setup();
    const view = render(<Harness />);
    expect(view.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    await user.click(view.getByRole("combobox", { name: "界面语言" }));
    await user.click(view.getByRole("option", { name: "English" }));
    expect(view.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Appearance" })).toBeInTheDocument();
    expect(view.getByRole("combobox", { name: "Language" })).toHaveTextContent("English");
  });

  it("opens the GitHub repository from the about section", async () => {
    const gateways = createMockGateways();
    const openExternal = vi.spyOn(gateways.workspace, "openExternal");
    setGatewaysForTests(gateways);
    const user = userEvent.setup();
    const view = render(
      <SettingsDialog
        onClose={() => undefined}
        onReset={() => undefined}
        onSectionChange={() => undefined}
        onSettingsChange={() => undefined}
        open
        section="about"
        settings={DEFAULT_SETTINGS}
      />,
    );

    const link = view.getByRole("link", { name: "GitHub" });
    expect(link).toHaveAttribute("href", GITHUB_REPO_URL);
    await user.click(link);
    expect(openExternal).toHaveBeenCalledWith(GITHUB_REPO_URL);
  });
});

