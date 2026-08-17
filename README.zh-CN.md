<p align="center">
  <img src="src/assets/logo.svg" width="80" height="80" alt="Memoir" />
</p>

<h1 align="center">Memoir</h1>

<p align="center">
  <strong>把记忆写在本地</strong><br />
  打开一个文件夹，写作、预览、保存。<br />
  Markdown / MDX，始终是你磁盘上的普通文件。
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  简体中文
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
    alt="Memoir 桌面端：资料库、Markdown 编辑器与实时预览"
    width="960"
  />
</p>

Memoir 是一款安静的桌面笔记本。把一个装满 `.md` / `.mdx` 的文件夹交给它，就能得到资料库、CodeMirror 编辑器和实时预览——不需要账号，没有同步服务，也不会把笔记锁进专有仓库。

笔记就是普通文件。同一个文件夹可以继续用 git、VS Code 或任何编辑器打开。

## 功能

- **本地优先** — 工作区就是你选的文件夹。Memoir 不会上传笔记。
- **Markdown 与 MDX** — GFM、KaTeX、Mermaid、任务列表，以及一组内置 MDX 组件。
- **编辑 / 分栏 / 预览** — 写源码、看渲染，或两边同时打开并同步滚动。
- **资料库** — 文件夹、frontmatter 标签、收藏、最近编辑、标题大纲。
- **默认安全** — 原子写入、可恢复草稿、自动保存；删除进入工作区的 `.memoir-trash/`，而不是直接消失。
- **资料库加速** — 每个工作区在 `.memoir/index.sqlite` 里放一份可丢弃的索引，打开列表时不必重读每一篇笔记。磁盘上的 Markdown 仍是唯一真相；请把 `.memoir/` 加入 gitignore，并在 iCloud / Dropbox / OneDrive 中排除它。
- **外观** — 浅色 / 深色 / 跟随系统、强调色、界面密度、字号，以及中英界面。
- **路径沙箱** — 只允许工作区内的 `.md` / `.mdx`；拒绝 `..`、符号链接，以及隐藏目录和构建目录。

### 写作

````md
---
title: Two Sum
tags: [leetcode, rust]
---

# Two Sum

行内公式：$O(n)$。独立公式：

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

- [x] 读题
- [ ] 写测试

```mermaid
graph LR
  扫描 --> 编辑 --> 预览 --> 保存
```
````

MDX 可以使用内置组件。`import` / `export` 被有意禁用，避免一篇笔记拉取任意模块：

```mdx
<Callout type="tip" title="本地优先">
  磁盘上的文件才是唯一真相。
</Callout>

<Card title="内置组件">Callout、Badge、Card、Columns、Steps</Card>
```

## 开始使用

到 [Releases](https://github.com/Memoir-Studio/Memoir/releases/latest) 下载对应平台的安装包：

- **Windows** — `memoir_*_x64-setup.exe`
- **macOS** — `memoir_*_aarch64.dmg`（Apple Silicon）或 `memoir_*_x64.dmg`（Intel）
- **Linux** — `memoir_*_amd64.deb` 或 `memoir-*-1.x86_64.rpm`

打开应用，选择一个包含 Markdown / MDX 的文件夹，它就是工作区。

## 开发

### 环境

- [Bun](https://bun.sh) 1.3+
- [Rust](https://www.rust-lang.org/tools/install)（仅桌面端需要）
- Tauri 2 的[系统依赖](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/Memoir-Studio/Memoir.git
cd Memoir
bun install
bun run dev          # Vite，浏览器演示
bun run tauri dev    # 桌面壳
```

浏览器模式是内存中的演示：不读写真实文件，也不持久化设置。

提交 PR 前请跑完验证：

```bash
bun test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml
```

### 目录

```text
src/            React 应用（features、store、gateways、domain）
src-tauri/      Tauri / Rust 工作区 IO 与持久化
docs/           架构说明与资源
```

前端按 feature 分层：

```text
app → features → store → gateways → platform
               → domain
```

组件禁止直接 `invoke` Tauri，也禁止读写 `localStorage`。store 的异步操作只走 `WorkspaceGateway` / `PersistenceGateway`。Rust 保持 `commands → services → domain / infrastructure` 的薄分层。

Tauri 命令契约、app-data 布局、路径规则和扩展步骤见 [`docs/architecture.md`](docs/architecture.md)。

## 现状

Memoir 目前处于早期开发阶段。编辑器、资料库、预览和桌面持久化已经可以日常使用；插件市场和同步还不在这个阶段。

## 参与贡献

欢迎提 issue 和 pull request。

1. 先读 [`docs/architecture.md`](docs/architecture.md)，让新代码落在现有边界里。
2. 改动尽量小，风格跟周围代码一致。
3. 给 helper、store action 和 Rust 文件系统规则补测试。
4. 跑通[开发](#开发)里的三条验证命令。

请不要在没有 issue 讨论的情况下加入云同步、遥测，或第二条持久化路径。

## 友情链接

- [Linux.do](https://linux.do/)
