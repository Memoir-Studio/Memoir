import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Toggle } from "./Toggle";

function ToggleHarness() {
  const [checked, setChecked] = useState(true);
  return <Toggle checked={checked} label="自动换行" onChange={setChecked} />;
}

describe("Toggle", () => {
  it("keeps the thumb inside the track with a single translate", async () => {
    const user = userEvent.setup();
    const view = render(<ToggleHarness />);
    const control = view.getByRole("switch", { name: "自动换行" });
    const thumb = control.querySelector("span");

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(thumb).toHaveClass("translate-x-4");
    expect(thumb).not.toHaveStyle({ transform: "translateX(16px)" });

    await user.click(control);
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(thumb).not.toHaveClass("translate-x-4");
  });
});
