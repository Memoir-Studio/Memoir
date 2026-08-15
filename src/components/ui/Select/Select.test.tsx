import { fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Select } from "./Select";

function SelectHarness({ initial = "system" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <Select
      label="界面语言"
      onChange={setValue}
      options={[
        { value: "system", label: "跟随系统" },
        { value: "zh", label: "中文" },
        { value: "en", label: "English" },
      ]}
      value={value}
    />
  );
}

describe("Select", () => {
  it("emits the chosen option from a custom dropdown", async () => {
    const user = userEvent.setup();
    const view = render(<SelectHarness />);
    const control = view.getByRole("combobox", { name: "界面语言" });

    expect(control).toHaveTextContent("跟随系统");
    await user.click(control);
    await user.click(view.getByRole("option", { name: "English" }));
    expect(control).toHaveTextContent("English");
    expect(view.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("moves with the keyboard and closes on Escape", async () => {
    const user = userEvent.setup();
    const view = render(<SelectHarness />);
    const control = view.getByRole("combobox", { name: "界面语言" });

    control.focus();
    await user.keyboard("{ArrowDown}");
    expect(view.getByRole("listbox", { name: "界面语言" })).toBeInTheDocument();
    expect(view.getByRole("option", { name: "跟随系统" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(control).toHaveTextContent("中文");
    expect(view.queryByRole("listbox")).not.toBeInTheDocument();

    await user.keyboard("{ArrowDown}");
    expect(view.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(view.queryByRole("listbox")).not.toBeInTheDocument();
    expect(control).toHaveFocus();
  });

  it("closes when clicking outside", async () => {
    const user = userEvent.setup();
    const view = render(<SelectHarness />);

    await user.click(view.getByRole("combobox", { name: "界面语言" }));
    expect(view.getByRole("listbox")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(view.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
