<p align="center">
  <img src="src/assets/logo.svg" width="80" height="80" alt="Memoir" />
</p>

<h1 align="center">Memoir</h1>

<p align="center">
  <strong>A memoir that stays on disk.</strong><br />
  Open a folder. Write. Preview. Save.<br />
  Markdown / MDX — still ordinary files, still yours.
</p>

<p align="center">
  English ·
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-d65f4d" /></a>
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" />
  <img alt="React 19" src="https://img.shields.io/badge/React-19-087EA4?logo=react&logoColor=white" />
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-111111" />
</p>

<p align="center">
  <img
    src="docs/assets/hero.webp"
    alt="Memoir desktop app: library, Markdown editor, and live preview"
    width="960"
  />
</p>

Memoir is a quiet desktop notebook. Point it at a folder of `.md` / `.mdx` files and you get a library, a CodeMirror editor, and a live preview — without an account, a sync service, or a proprietary vault.

Notes are ordinary files. You can open the same folder in git, VS Code, or any other editor.

## Features

- **Local-first** — the workspace is a folder you choose. Memoir never uploads your notes.
- **Markdown and MDX** — GitHub Flavored Markdown, KaTeX, Mermaid, task lists, and a small set of built-in MDX components.
- **Edit / split / preview** — write source, read the rendered page, or do both with synced scroll.
- **Library** — folders, frontmatter tags, favorites, recent notes, and a heading outline.
- **Safe by default** — atomic writes, crash-safe drafts, autosave, and deletes that go to `.memoir-trash/` instead of vanishing.
- **Fast library** — each workspace keeps a disposable SQLite cache at `.memoir/index.sqlite` so the sidebar does not re-read every note. The markdown files are still the source of truth; gitignore `.memoir/` and exclude it from iCloud / Dropbox / OneDrive.
- **Appearance** — light / dark / system theme, accent colors, density, type scale, and Chinese / English UI.
- **Sandboxed paths** — only `.md` / `.mdx` inside the workspace; `..`, symlinks, and hidden/build directories are rejected.

### Writing

````md
---
title: Two Sum
tags: [leetcode, rust]
---

# Two Sum

Inline math: $O(n)$. Display math:

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

- [x] Read the prompt
- [ ] Write a test

```mermaid
graph LR
  scan --> edit --> preview --> save
```
````

MDX files can use built-in components. `import` / `export` are disabled on purpose so a note cannot pull in arbitrary modules:

```mdx
<Callout type="tip" title="Local-first">
  The file on disk is the source of truth.
</Callout>

<Card title="Built-in">Callout, Badge, Card, Columns, Steps</Card>
```

## Getting started

Download an installer from [Releases](https://github.com/Memoir-Studio/Memoir/releases/latest):

- **Windows** — `memoir_*_x64-setup.exe`
- **macOS** — `memoir_*_aarch64.dmg` (Apple Silicon) or `memoir_*_x64.dmg` (Intel)
- **Linux** — `memoir_*_amd64.deb` or `memoir-*-1.x86_64.rpm`

Open the app, then choose a folder of Markdown / MDX files. That folder is the workspace.

## Development

### Requirements

- [Bun](https://bun.sh) 1.3+
- [Rust](https://www.rust-lang.org/tools/install) (desktop app only)
- Tauri 2 [system dependencies](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/Memoir-Studio/Memoir.git
cd Memoir
bun install
bun run dev          # Vite, browser demo
bun run tauri dev    # desktop shell
```

The browser build is an in-memory demo. It does not read or write real files, and it does not persist settings.

Verify a change before opening a PR:

```bash
bun test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml
```

### Layout

```text
src/            React app (features, store, gateways, domain)
src-tauri/      Tauri / Rust workspace IO and persistence
docs/           architecture notes and assets
```

The frontend is feature-first:

```text
app → features → store → gateways → platform
               → domain
```

Components do not call Tauri `invoke` or touch `localStorage`. Store actions go through `WorkspaceGateway` / `PersistenceGateway`. Rust stays a thin `commands → services → domain / infrastructure` stack.

See [`docs/architecture.md`](docs/architecture.md) for the Tauri command contract, app-data layout, path rules, and how to add a feature.

## Status

Memoir is in early development. The editor, library, preview, and desktop persistence are usable day to day; plugins and sync are not part of this release.

## Contributing

Issues and pull requests are welcome.

1. Read [`docs/architecture.md`](docs/architecture.md) so new code follows the existing boundaries.
2. Keep the change small and match the surrounding style.
3. Cover helpers, store actions, and Rust filesystem rules with tests.
4. Run the three commands in [Development](#development).

Please do not add cloud sync, telemetry, or a second persistence path without an issue first.
