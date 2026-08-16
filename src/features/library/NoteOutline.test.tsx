import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteOutline } from "./NoteOutline";

const headings = [
  { id: "welcome", depth: 1, text: "欢迎使用 Inkstone" },
  { id: "try-now", depth: 2, text: "现在就试试" },
  { id: "markdown", depth: 2, text: "Markdown 速查" },
  { id: "links", depth: 3, text: "链接、图片与笔记关系" },
  { id: "formula", depth: 3, text: "公式与图表" },
];

afterEach(cleanup);

describe("NoteOutline", () => {
  beforeEach(() => {
    if (typeof Element !== "undefined") {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  it("renders a quiet typographic outline with hierarchy", () => {
    const view = render(<NoteOutline documentKey="welcome.md" headings={headings} />);

    expect(view.getByRole("navigation", { name: "大纲" })).toBeInTheDocument();
    expect(view.getByText("大纲")).toBeInTheDocument();

    const items = view.getAllByRole("button");
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveAttribute("data-depth", "1");
    expect(items[3]).toHaveAttribute("data-depth", "3");
    expect(items[0]).toHaveAttribute("aria-current", "location");
    expect(items[0]).toHaveClass("is-active");
    expect(items[3]).not.toHaveAttribute("aria-current");
  });

  it("moves the active marker to the clicked heading", async () => {
    const heading = document.createElement("h3");
    heading.id = "links";
    document.body.append(heading);
    const view = render(<NoteOutline documentKey="welcome.md" headings={headings} />);
    const user = userEvent.setup();
    const target = view.getByRole("button", { name: "链接、图片与笔记关系" });

    await user.click(target);

    expect(target).toHaveAttribute("aria-current", "location");
    expect(target).toHaveClass("is-active");
    expect(view.getByRole("button", { name: "欢迎使用 Inkstone" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(heading.scrollIntoView).toHaveBeenCalled();
    heading.remove();
  });

  it("keeps the current heading when the document is edited", () => {
    const view = render(<NoteOutline documentKey="welcome.md" headings={headings} />);

    view.rerender(
      <NoteOutline
        documentKey="welcome.md"
        headings={[...headings, { id: "last", depth: 2, text: "最后" }]}
      />,
    );

    expect(view.getByRole("button", { name: "欢迎使用 Inkstone" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    expect(view.getByRole("button", { name: "最后" })).toBeInTheDocument();
  });

  it("pins the shallowest heading to the left when the note starts at h3", () => {
    const view = render(
      <NoteOutline
        documentKey="tasks.md"
        headings={[
          { id: "p0", depth: 3, text: "最高优先级" },
          { id: "p1", depth: 3, text: "很高优先级" },
          { id: "p2", depth: 4, text: "细节" },
        ]}
      />,
    );
    const items = view.getAllByRole("button");
    expect(items[0]).toHaveAttribute("data-depth", "1");
    expect(items[1]).toHaveAttribute("data-depth", "1");
    expect(items[2]).toHaveAttribute("data-depth", "2");
    expect(items[0]).toHaveStyle({ "--outline-inset": "14px" });
    expect(items[2]).toHaveStyle({ "--outline-inset": "32px" });
  });

  it("shows an empty state when the note has no headings", () => {
    const view = render(<NoteOutline documentKey="empty.md" headings={[]} />);

    expect(view.getByText("当前笔记没有标题。")).toBeInTheDocument();
    expect(view.queryAllByRole("button")).toHaveLength(0);
  });
});
