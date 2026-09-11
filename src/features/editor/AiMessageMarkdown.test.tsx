import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AiMessageMarkdown } from "./AiMessageMarkdown";

afterEach(cleanup);
it("renders Markdown tables, lists and code while excluding active HTML", () => {
  const view = render(<AiMessageMarkdown content={'# Heading\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n\n[safe](https://example.com) [unsafe](javascript:alert(1))\n\n<script>alert(1)</script>\n\n![remote](https://example.com/pixel.png)'} />);
  expect(view.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
  expect(view.getAllByRole("listitem")).toHaveLength(2);
  expect(view.getByRole("table")).toHaveTextContent("A");
  expect(view.getByText("const x = 1;").closest("pre")).not.toBeNull();
  expect(view.getByRole("link", { name: "safe" })).toHaveAttribute("rel", "noopener noreferrer");
  expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(view.container.querySelector("script, img")).toBeNull();
});
