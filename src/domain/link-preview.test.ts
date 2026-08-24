import { describe, expect, it } from "vitest";
import {
  fallbackLinkPreview,
  hostnameOf,
  isPreviewableHttpUrl,
  parseLinkPreviewHtml,
} from "./link-preview";

describe("link preview helpers", () => {
  it("accepts only http(s) URLs", () => {
    expect(isPreviewableHttpUrl("https://shiyu.dev/article/320")).toBe(true);
    expect(isPreviewableHttpUrl("http://example.com")).toBe(true);
    expect(isPreviewableHttpUrl("file:///tmp/note.md")).toBe(false);
    expect(isPreviewableHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isPreviewableHttpUrl("not a url")).toBe(false);
  });

  it("strips www from the hostname fallback", () => {
    expect(hostnameOf("https://www.shiyu.dev/article/320")).toBe("shiyu.dev");
    expect(fallbackLinkPreview("https://www.shiyu.dev/article/320").title).toBe("shiyu.dev");
    expect(fallbackLinkPreview("https://shiyu.dev/article/320", "面壁实习").title).toBe("面壁实习");
  });

  it("reads Open Graph tags and resolves relative URLs", () => {
    const html = `
      <html>
        <head>
          <title>Ignored</title>
          <meta property="og:title" content="面壁实习" />
          <meta name="description" content="fallback description" />
          <meta content="十月假期后我开始找实习，面试顺利并选择了面壁智能。" property="og:description" />
          <meta property="og:image" content="/cover.png" />
          <meta property="og:site_name" content="shiyu.dev" />
          <link rel="shortcut icon" href="/favicon.ico" />
        </head>
      </html>
    `;
    expect(parseLinkPreviewHtml(html, "https://shiyu.dev/article/320")).toEqual({
      url: "https://shiyu.dev/article/320",
      title: "面壁实习",
      description: "十月假期后我开始找实习，面试顺利并选择了面壁智能。",
      image: "https://shiyu.dev/cover.png",
      siteName: "shiyu.dev",
      favicon: "https://shiyu.dev/favicon.ico",
    });
  });

  it("decodes entities and prefers twitter tags when og is missing", () => {
    const html = `
      <head>
        <title>Page &amp; Title</title>
        <meta name="twitter:title" content="Hello &quot;world&quot;" />
        <meta name="twitter:image" content="https://cdn.example/og.jpg" />
        <link rel="apple-touch-icon" href="https://cdn.example/touch.png" />
      </head>
    `;
    const preview = parseLinkPreviewHtml(html, "https://example.com/post");
    expect(preview.title).toBe('Hello "world"');
    expect(preview.image).toBe("https://cdn.example/og.jpg");
    expect(preview.favicon).toBe("https://cdn.example/touch.png");
  });
});
