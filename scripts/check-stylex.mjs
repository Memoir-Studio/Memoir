import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "src");
const allowedCss = new Set([
  "src/features/preview/preview-generated.css",
  "src/styles.css",
  "src/styles/global.css",
]);
const generatedClassHost = "src/features/preview/NotePreviewArticle.tsx";
const runtimeStyleHosts = new Set([
  "src/features/export/render-note-pdf.tsx",
  "src/features/graph/graph-scene.ts",
  "src/platform/dpi.ts",
  "src/styles/document-theme.ts",
]);
const failures = [];

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function repoPath(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function countJsxClassNames(path, source) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let count = 0;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.text === "className") count += 1;
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return count;
}

for (const path of walk(sourceRoot)) {
  const file = repoPath(path);
  if (file.endsWith(".css") && !allowedCss.has(file)) {
    failures.push(`${file}: first-party component styles must use StyleX`);
  }

  if (!/\.(?:ts|tsx)$/.test(file)) continue;
  const source = readFileSync(path, "utf8");
  const classAssignments = countJsxClassNames(path, source);
  if (file === generatedClassHost) {
    if (classAssignments !== 3) {
      failures.push(
        `${file}: expected exactly three generated-markup className pass-throughs; found ${classAssignments}`,
      );
    }
  } else if (classAssignments > 0) {
    failures.push(`${file}: JSX className is reserved for externally generated preview markup`);
  }

  if (/\bcn\s*\(/.test(source)) {
    failures.push(`${file}: cn() utility usage is not allowed`);
  }
  if (/from\s+["'](?:clsx|class-variance-authority|tailwind-merge)["']/.test(source)) {
    failures.push(`${file}: legacy class composition dependency imported`);
  }
  if (/import\s+["'][^"']+\.css["']/.test(source) && file !== "src/main.tsx") {
    failures.push(`${file}: CSS may only enter through src/styles.css`);
  }
  if (
    !runtimeStyleHosts.has(file) &&
    /(?:\.style\.(?:setProperty|removeProperty|[A-Za-z]+\s*=)|Object\.assign\([^\n]*\.style)/.test(
      source,
    )
  ) {
    failures.push(`${file}: direct DOM styles require an explicit runtime-geometry exception`);
  }
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const declaredPackages = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};
for (const dependency of [
  "@tailwindcss/typography",
  "@tailwindcss/vite",
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
  "tailwindcss",
]) {
  if (dependency in declaredPackages) {
    failures.push(`package.json: remove legacy styling dependency ${dependency}`);
  }
}

const cssEntry = readFileSync(join(root, "src/styles.css"), "utf8");
for (const requiredImport of [
  '@import "katex/dist/katex.min.css";',
  '@import "./styles/global.css" layer(reset);',
  '@import "./features/preview/preview-generated.css" layer(preview-compat);',
]) {
  if (!cssEntry.includes(requiredImport)) {
    failures.push(`src/styles.css: missing ${requiredImport}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("StyleX boundary check passed");
}
