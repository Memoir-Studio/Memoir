import { describe, expect, it } from "vitest";
import { remarkLinkCards } from "./remark-link-cards";

type MdastNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    hChildren?: unknown[];
  };
};

function paragraphWith(children: MdastNode[]): MdastNode {
  return { type: "paragraph", children };
}

function httpLink(url: string, text = url): MdastNode {
  return { type: "link", url, children: [{ type: "text", value: text }] };
}

describe("remarkLinkCards", () => {
  it("marks a root paragraph that is only an http(s) link", () => {
    const url = "https://shiyu.dev/article/320";
    const tree: MdastNode = {
      type: "root",
      children: [paragraphWith([httpLink(url)])],
    };
    remarkLinkCards()(tree);
    const paragraph = tree.children?.[0];
    expect(paragraph?.data?.hName).toBe("div");
    expect(paragraph?.data?.hProperties).toMatchObject({
      className: ["memoir-link-card-host"],
      dataLinkCardUrl: url,
    });
    expect(paragraph?.data?.hChildren).toEqual([]);
  });

  it("keeps a markdown link label as fallback text", () => {
    const url = "https://shiyu.dev/article/320";
    const tree: MdastNode = {
      type: "root",
      children: [paragraphWith([httpLink(url, "面壁实习")])],
    };
    remarkLinkCards()(tree);
    expect(tree.children?.[0]?.data?.hProperties).toMatchObject({
      dataLinkCardUrl: url,
      dataLinkCardLabel: "面壁实习",
    });
  });

  it("does not mark inline links, lists, or wiki links", () => {
    const url = "https://example.com";
    const tree: MdastNode = {
      type: "root",
      children: [
        paragraphWith([{ type: "text", value: "see " }, httpLink(url)]),
        {
          type: "list",
          children: [
            { type: "listItem", children: [paragraphWith([httpLink(url)])] },
          ],
        },
        paragraphWith([
          {
            type: "link",
            url: "#memoir-note/todo",
            children: [{ type: "text", value: "todo" }],
          },
        ]),
      ],
    };
    remarkLinkCards()(tree);
    expect(tree.children?.[0]?.data?.hName).toBeUndefined();
    expect(tree.children?.[1]?.children?.[0]?.children?.[0]?.data?.hName).toBeUndefined();
    expect(tree.children?.[2]?.data?.hName).toBeUndefined();
  });
});
