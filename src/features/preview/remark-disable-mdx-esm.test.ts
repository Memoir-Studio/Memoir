import { compile } from "@mdx-js/mdx";
import { describe, expect, it } from "vitest";
import { MDX_IMPORT_EXPORT_DISABLED, remarkDisableMdxEsm } from "./remark-disable-mdx-esm";

function compilePreview(source: string) {
  return compile(source, {
    outputFormat: "function-body",
    remarkPlugins: [remarkDisableMdxEsm],
  });
}

describe("MDX module restrictions", () => {
  it.each([
    "```python\nimport sys\nfrom collections import Counter\n```",
    "~~~js\nimport value from './example.js';\nexport default value;\n~~~",
    "> ```js\n> import './example.js';\n> export const value = 1;\n> ```",
    "`import value from './example.js'` and `export default value`",
  ])("allows import/export in code examples: %s", async (source) => {
    await expect(compilePreview(source)).resolves.toBeDefined();
  });

  it.each([
    "import value from './example.js';",
    "import './example.js';",
    "import {\n  value\n} from './example.js';",
    "export const value = 1;",
    "export { value } from './example.js';",
    "export default function Example() { return null; }",
    "```js\nimport './example.js';\n```\n\nexport const value = 1;",
  ])("rejects actual MDX module statements: %s", async (source) => {
    await expect(compilePreview(source)).rejects.toThrow(MDX_IMPORT_EXPORT_DISABLED);
  });
});
