import { fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { TagInput } from "./TagInput";

const options = [
  { value: "diary", label: "diary" },
  { value: "leetcode", label: "leetcode" },
  { value: "rust", label: "rust" },
];

function TagInputHarness({ initial = [] as string[] }) {
  const [value, setValue] = useState(initial);
  const [query, setQuery] = useState("");
  return (
    <TagInput
      createLabel={(name) => `新建 “${name}”`}
      emptyLabel="没有匹配的标签"
      label="标签（可选）"
      onChange={setValue}
      onQueryChange={setQuery}
      options={options}
      placeholder="选择或输入标签"
      query={query}
      removeLabel={(tag) => `移除 ${tag}`}
      value={value}
    />
  );
}

describe("TagInput", () => {
  it("adds multiple tags from commas and Enter", async () => {
    const user = userEvent.setup();
    const view = render(<TagInputHarness />);
    const control = view.getByRole("combobox", { name: "标签（可选）" });

    await user.type(control, "leetcode, rust{Enter}");

    expect(view.getByText("leetcode")).toBeInTheDocument();
    expect(view.getByText("rust")).toBeInTheDocument();
    expect(control).toHaveValue("");
  });

  it("picks an existing tag from the dropdown", async () => {
    const user = userEvent.setup();
    const view = render(<TagInputHarness />);

    await user.click(view.getByRole("combobox", { name: "标签（可选）" }));
    await user.click(view.getByRole("option", { name: "diary" }));

    expect(view.getByText("diary")).toBeInTheDocument();
    expect(view.queryByRole("option", { name: "diary" })).not.toBeInTheDocument();
  });

  it("removes a tag from the chip or with Backspace", async () => {
    const user = userEvent.setup();
    const view = render(<TagInputHarness initial={["diary", "rust"]} />);

    await user.click(view.getByRole("button", { name: "移除 diary" }));
    expect(view.queryByText("diary")).not.toBeInTheDocument();
    expect(view.getByText("rust")).toBeInTheDocument();

    await user.click(view.getByRole("combobox", { name: "标签（可选）" }));
    await user.keyboard("{Backspace}");
    expect(view.queryByRole("button", { name: "移除 rust" })).not.toBeInTheDocument();
  });

  it("ignores a duplicate tag regardless of case", async () => {
    const user = userEvent.setup();
    const view = render(<TagInputHarness initial={["Rust"]} />);
    const control = view.getByRole("combobox", { name: "标签（可选）" });

    await user.type(control, "rust{Enter}");

    expect(view.getAllByText("Rust")).toHaveLength(1);
    expect(view.queryByText("rust")).not.toBeInTheDocument();
    expect(control).toHaveValue("");
  });

  it("closes the list on outside click", async () => {
    const user = userEvent.setup();
    const view = render(<TagInputHarness />);

    await user.click(view.getByRole("combobox", { name: "标签（可选）" }));
    expect(view.getByRole("listbox")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(view.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
