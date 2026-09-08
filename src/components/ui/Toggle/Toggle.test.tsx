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
  it("exposes and toggles its checked state", async () => {
    const user = userEvent.setup();
    const view = render(<ToggleHarness />);
    const control = view.getByRole("switch", { name: "自动换行" });

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(control).toHaveAttribute("data-state", "checked");

    await user.click(control);
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toHaveAttribute("data-state", "unchecked");
  });
});
