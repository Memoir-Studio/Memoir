import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Collapsible } from "./Collapsible";

describe("Collapsible", () => {
  it("toggles its content with accessible state and keeps the content mounted", async () => {
    const view = render(
      <Collapsible ariaLabel="Details" label="Details">
        <p>Content</p>
      </Collapsible>,
    );

    const trigger = view.getByRole("button", { name: "Details" });
    const content = view.container.querySelector("[data-collapsible-content]");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(content).toHaveAttribute("aria-hidden", "false");
    expect(view.getByText("Content")).toBeInTheDocument();

    await userEvent.setup().click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(content).toHaveAttribute("aria-hidden", "true");
    expect(content).toHaveAttribute("data-collapsible-expanded", "false");
    expect(view.getByText("Content")).toBeInTheDocument();
  });

  it("supports controlled state changes", async () => {
    const onOpenChange = vi.fn();
    const view = render(
      <Collapsible ariaLabel="Details" label="Details" open={false} onOpenChange={onOpenChange}>
        <p>Content</p>
      </Collapsible>,
    );

    await userEvent.setup().click(view.getByRole("button", { name: "Details" }));

    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(view.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");
  });
});
