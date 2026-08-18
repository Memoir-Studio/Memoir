import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteOutline } from "./NoteOutline";
import { resetCollapsedHeadingIds } from "./outline-tree";

const headings = [
  { id: "welcome", depth: 1, text: "欢迎使用 Inkstone" },
  { id: "try-now", depth: 2, text: "现在就试试" },
  { id: "markdown", depth: 2, text: "Markdown 速查" },
  { id: "links", depth: 3, text: "链接、图片与笔记关系" },
  { id: "formula", depth: 3, text: "公式与图表" },
];

function headingButtons(view: ReturnType<typeof render>) {
  return view.getAllByRole("button").filter((button) => button.hasAttribute("data-depth"));
}

function mountPreviewHeading(id: string) {
  const pane = document.createElement("section");
  pane.className = "preview-pane";
  pane.scrollTo = vi.fn() as HTMLElement["scrollTo"];
  const heading = document.createElement("h3");
  heading.id = id;
  heading.scrollIntoView = vi.fn();
  pane.append(heading);
  document.body.append(pane);
  return { pane, heading };
}

afterEach(() => {
  cleanup();
  resetCollapsedHeadingIds();
});

describe("NoteOutline", () => {
  beforeEach(() => {
    if (typeof Element !== "undefined") {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  it("renders a quiet typographic outline with hierarchy", () => {
    const view = render(<NoteOutline documentKey="welcome.md" headings={headings} />);

    expect(view.getByRole("navigation", { name: "大纲" })).toBeInTheDocument();

    const items = headingButtons(view);
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveAttribute("data-depth", "1");
    expect(items[3]).toHaveAttribute("data-depth", "3");
    expect(items[0]).toHaveAttribute("aria-current", "location");
    expect(items[0]).toHaveClass("is-active");
    expect(items[3]).not.toHaveAttribute("aria-current");
    expect(view.getByRole("button", { name: "折叠“欢迎使用 Inkstone”" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(view.queryByRole("button", { name: "折叠“现在就试试”" })).not.toBeInTheDocument();
  });

  it("collapses a parent heading and hides its descendants", async () => {
    const view = render(<NoteOutline documentKey="welcome.md" headings={headings} />);
    const user = userEvent.setup();

    await user.click(view.getByRole("button", { name: "折叠“Markdown 速查”" }));

    expect(view.queryByRole("button", { name: /^链接、图片与笔记关系$/ })).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: /^公式与图表$/ })).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: /^现在就试试$/ })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "展开“Markdown 速查”" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await user.click(view.getByRole("button", { name: "展开“Markdown 速查”" }));

    expect(view.getByRole("button", { name: /^链接、图片与笔记关系$/ })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "折叠“Markdown 速查”" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps collapsed nodes after switching documents or remounting the outline", async () => {
    const view = render(<NoteOutline documentKey="welcome.md" headings={headings} />);
    const user = userEvent.setup();

    await user.click(view.getByRole("button", { name: "折叠“Markdown 速查”" }));

    view.rerender(
      <NoteOutline
        documentKey="other.md"
        headings={[{ id: "other", depth: 1, text: "另一篇" }]}
      />,
    );
    expect(view.getByRole("button", { name: /^另一篇$/ })).toBeInTheDocument();
    expect(view.queryByRole("button", { name: /^Markdown 速查$/ })).not.toBeInTheDocument();

    view.rerender(<NoteOutline documentKey="welcome.md" headings={headings} />);
    expect(view.queryByRole("button", { name: /^链接、图片与笔记关系$/ })).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "展开“Markdown 速查”" })).toBeInTheDocument();

    view.unmount();
    const remounted = render(<NoteOutline documentKey="welcome.md" headings={headings} />);
    expect(remounted.queryByRole("button", { name: /^公式与图表$/ })).not.toBeInTheDocument();
    expect(remounted.getByRole("button", { name: "展开“Markdown 速查”" })).toBeInTheDocument();
  });

  it("keeps collapsed nodes when the outline refreshes with new headings", async () => {
    const view = render(<NoteOutline documentKey="welcome.md" headings={headings} />);
    const user = userEvent.setup();

    await user.click(view.getByRole("button", { name: "折叠“Markdown 速查”" }));

    view.rerender(
      <NoteOutline
        documentKey="welcome.md"
        headings={[...headings, { id: "last", depth: 2, text: "最后" }]}
      />,
    );

    expect(view.getByRole("button", { name: /^最后$/ })).toBeInTheDocument();
    expect(view.queryByRole("button", { name: /^链接、图片与笔记关系$/ })).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "展开“Markdown 速查”" })).toBeInTheDocument();
  });

  it("highlights the visible ancestor when the active heading is collapsed away", async () => {
    const view = render(<NoteOutline documentKey="welcome.md" headings={headings} />);
    const user = userEvent.setup();
    const { pane } = mountPreviewHeading("links");

    await user.click(view.getByRole("button", { name: /^链接、图片与笔记关系$/ }));
    await user.click(view.getByRole("button", { name: "折叠“Markdown 速查”" }));

    const parent = view.getByRole("button", { name: /^Markdown 速查$/ });
    expect(parent).toHaveAttribute("aria-current", "location");
    expect(parent).toHaveClass("is-active");
    expect(view.queryByRole("button", { name: /^链接、图片与笔记关系$/ })).not.toBeInTheDocument();

    pane.remove();
  });

  it("moves the active marker to the clicked heading", async () => {
    const { pane, heading } = mountPreviewHeading("links");
    const view = render(<NoteOutline documentKey="welcome.md" headings={headings} />);
    const user = userEvent.setup();
    const target = view.getByRole("button", { name: /^链接、图片与笔记关系$/ });

    await user.click(target);

    expect(target).toHaveAttribute("aria-current", "location");
    expect(target).toHaveClass("is-active");
    expect(view.getByRole("button", { name: /^欢迎使用 Inkstone$/ })).not.toHaveAttribute(
      "aria-current",
    );
    expect(pane.scrollTo).toHaveBeenCalled();
    expect(heading.scrollIntoView).not.toHaveBeenCalled();
    pane.remove();
  });

  it("keeps the current heading when the document is edited", () => {
    const view = render(<NoteOutline documentKey="welcome.md" headings={headings} />);

    view.rerender(
      <NoteOutline
        documentKey="welcome.md"
        headings={[...headings, { id: "last", depth: 2, text: "最后" }]}
      />,
    );

    expect(view.getByRole("button", { name: /^欢迎使用 Inkstone$/ })).toHaveAttribute(
      "aria-current",
      "location",
    );
    expect(view.getByRole("button", { name: /^最后$/ })).toBeInTheDocument();
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
    const items = headingButtons(view);
    expect(items[0]).toHaveAttribute("data-depth", "1");
    expect(items[1]).toHaveAttribute("data-depth", "1");
    expect(items[2]).toHaveAttribute("data-depth", "2");
    const rows = view.container.querySelectorAll(".outline-item");
    expect(rows[0]).toHaveStyle({ "--outline-inset": "14px" });
    expect(rows[2]).toHaveStyle({ "--outline-inset": "32px" });
  });

  it("shows an empty state when the note has no headings", () => {
    const view = render(<NoteOutline documentKey="empty.md" headings={[]} />);

    expect(view.getByText("当前笔记没有标题。")).toBeInTheDocument();
    expect(view.queryAllByRole("button")).toHaveLength(0);
  });
});
