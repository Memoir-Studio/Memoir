import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

function SegmentedHarness() {
  const [value, setValue] = useState("light");
  return (
    <SegmentedControl
      label="主题"
      onChange={setValue}
      options={[
        { value: "light", label: "浅色" },
        { value: "dark", label: "深色" },
      ]}
      value={value}
    />
  );
}

describe("SegmentedControl", () => {
  it("marks the selected option and updates it when clicked", async () => {
    const user = userEvent.setup();
    const view = render(<SegmentedHarness />);
    const light = view.getByRole("button", { name: "浅色" });
    const dark = view.getByRole("button", { name: "深色" });

    expect(light).toHaveAttribute("aria-pressed", "true");
    expect(dark).toHaveAttribute("aria-pressed", "false");

    await user.click(dark);

    expect(light).toHaveAttribute("aria-pressed", "false");
    expect(dark).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps icon-only options accessible through their labels", () => {
    const onChange = vi.fn();
    const view = render(
      <SegmentedControl
        display="icon"
        label="视图"
        onChange={onChange}
        options={[
          { value: "edit", label: "编辑", icon: <span aria-hidden>e</span> },
          { value: "preview", label: "预览", icon: <span aria-hidden>p</span> },
        ]}
        value="edit"
      />,
    );

    expect(view.getByRole("button", { name: "编辑" })).toHaveAttribute("title", "编辑");
    expect(view.getByRole("button", { name: "预览" })).toHaveAttribute("title", "预览");
  });
});
