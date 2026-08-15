import { fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Combobox, filterComboboxOptions, suggestAutocomplete } from "./Combobox";

const options = [
  { value: "日记", label: "📔 日记" },
  { value: "工作", label: "工作" },
  { value: "工作/项目", label: "工作/项目" },
];

function ComboboxHarness({
  initial = "",
  allowCreate = true,
}: {
  initial?: string;
  allowCreate?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Combobox
      allowCreate={allowCreate}
      createLabel={(name) => `新建 “${name}”`}
      emptyLabel="没有匹配的目录"
      label="目录（可选）"
      onChange={setValue}
      options={options}
      placeholder="选择或输入目录"
      value={value}
    />
  );
}

describe("Combobox helpers", () => {
  it("ranks exact and prefix matches ahead of substring matches", () => {
    expect(filterComboboxOptions(options, "工").map((option) => option.value)).toEqual([
      "工作",
      "工作/项目",
    ]);
    expect(filterComboboxOptions(options, "项目").map((option) => option.value)).toEqual([
      "工作/项目",
    ]);
    expect(filterComboboxOptions(options, "xyz")).toEqual([]);
  });

  it("completes the shortest prefix match", () => {
    expect(suggestAutocomplete(["工作", "工作/项目", "日记"], "工")).toBe("工作");
    expect(suggestAutocomplete(["工作", "工作/项目"], "工作/")).toBe("工作/项目");
    expect(suggestAutocomplete(["工作"], "工作")).toBeNull();
    expect(suggestAutocomplete(["工作"], "")).toBeNull();
  });
});

describe("Combobox", () => {
  it("opens a dropdown and selects an existing option", async () => {
    const user = userEvent.setup();
    const view = render(<ComboboxHarness />);
    const control = view.getByRole("combobox", { name: "目录（可选）" });

    await user.click(control);
    expect(view.getByRole("listbox", { name: "目录（可选）" })).toBeInTheDocument();
    await user.click(view.getByRole("option", { name: "工作" }));
    expect(control).toHaveValue("工作");
    expect(view.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("autocompletes the typed prefix and keeps a new name", async () => {
    const user = userEvent.setup();
    const view = render(<ComboboxHarness />);
    const control = view.getByRole("combobox", { name: "目录（可选）" });

    await user.type(control, "工");
    expect(control).toHaveValue("工作");

    await user.clear(control);
    await user.type(control, "旅行");
    expect(control).toHaveValue("旅行");
    expect(view.getByRole("option", { name: "新建 “旅行”" })).toBeInTheDocument();
  });

  it("moves with the keyboard and closes on Escape without losing the typed value", async () => {
    const user = userEvent.setup();
    const view = render(<ComboboxHarness />);
    const control = view.getByRole("combobox", { name: "目录（可选）" });

    control.focus();
    await user.keyboard("{ArrowDown}");
    expect(view.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(control).toHaveValue("工作");
    expect(view.queryByRole("listbox")).not.toBeInTheDocument();

    await user.keyboard("{ArrowDown}");
    expect(view.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(view.queryByRole("listbox")).not.toBeInTheDocument();
    expect(control).toHaveValue("工作");
    expect(control).toHaveFocus();
  });

  it("closes when clicking outside", async () => {
    const user = userEvent.setup();
    const view = render(<ComboboxHarness />);

    await user.click(view.getByRole("combobox", { name: "目录（可选）" }));
    expect(view.getByRole("listbox")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(view.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
