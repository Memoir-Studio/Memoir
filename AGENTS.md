# Repository Guidelines

## Project Structure & Module Organization

Memoir is a Markdown/MDX desktop notebook built with React 19, TypeScript, and Tauri 2.

- `src/features/` and `src/components/ui/`: feature and shared UI.
- `src/domain/`, `src/application/`, `src/store/`: rules, use cases, and Zustand state.
- `src/gateways/` and `src/platform/`: browser/native adapters.
- `src-tauri/src/`: Rust `commands`, `services`, `domain`, and `infrastructure`.
- Tests sit beside frontend sources; Rust tests are module-local or in `src-tauri/src/tests.rs`. Assets are in `src/assets/` and `src-tauri/icons/`.
- Read `docs/architecture.md` before changing boundaries.

## Build, Test, and Development Commands

Install Bun 1.3+; desktop development also requires Rust and Tauri system dependencies.

- `bun install`: install dependencies; CI uses `--frozen-lockfile`.
- `bun run dev`: start the browser demo on port 1420; storage is in-memory.
- `bun run tauri dev`: launch the desktop app.
- `bun run style:check`: enforce StyleX and architecture boundaries.
- `bun run test`: run Vitest; `bun run test:watch` enables watch mode.
- `bun run build`: type-check TypeScript and build the frontend.
- `bun run tauri build`: build desktop bundles.
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`: run Rust tests.

## Coding Style & Naming Conventions

Follow surrounding code: TypeScript uses two-space indentation, double quotes, and semicolons; Rust uses four spaces and rustfmt. Use PascalCase components, camelCase functions, kebab-case TypeScript helpers, and snake_case Rust modules.

Use StyleX for component styles and shared tokens in `src/styles/`. Keep business rules in domain/use-case modules. Access native APIs through gateways/platform adapters. Domain code must remain independent of UI and Tauri. Add UI strings to both `src/i18n/en.ts` and `zh.ts`.

## Testing Guidelines

Use Vitest with jsdom and React Testing Library; name tests `*.test.ts` or `*.test.tsx`. Protect concrete business rules and regression-prone behavior, not coverage or test counts. Before adding a test, name the failure it prevents and check existing coverage. Simple, low-risk changes need no new tests; use type checks, builds, or interaction checks. Complex changes and high-risk fixes need minimal regression cases.

Prefer domain/application/store tests; add component tests only for app-specific coordination such as draft recovery, editor/preview sync, retry state, focus restoration, input-method behavior, or stale-response rejection. Assert content, state, or user outcomes rather than internal call counts/order, except necessary boundary contracts. Do not test styling, markup, labels, icons, callback calls alone, third-party behavior, constants, getters, defaults, or trivial pass-throughs. Avoid duplicate layers, broad snapshots, repetitive fixtures, and oversized mocks. Preserve coverage for saves, workspace isolation, async races, safe editor replacement/undo, AI concurrency, parsing/path rules, filesystem/persistence, sync conflicts, indexing, and retrieval.

Run `bun run test` (not `bun test`, which bypasses Vite transforms). Rust changes use `cargo test --manifest-path src-tauri/Cargo.toml --locked`. Remove obsolete test imports, mocks, fixtures, helpers, setup, and test-only dependencies. Reuse existing infrastructure; do not introduce another runner or restore low-value tests without a concrete uncovered risk. Investigate failures; never weaken key assertions, skip, swallow errors, or delete valid tests to pass.

## Validation

Run relevant tests according to scope: frontend/dependency changes require `bun run build` and `bun run style:check`; shared behavior or test-infrastructure changes also require the full `bun run test`; Rust code/test changes require the Rust command above. Update `bun.lock` for dependencies and verify `bun install --frozen-lockfile`, avoiding unrelated upgrades. Documentation-only changes need content and diff review; report unrun checks or pre-existing failures and avoid unrelated refactoring.

## Commit & Pull Request Guidelines

History follows Conventional Commits, such as `feat(workspace): persist favorites` and `fix(export): paginate PDFs`. Keep commits focused. PRs should describe resulting behavior, link relevant issues, report validation, and include screenshots for UI changes. Complete applicable validation before submitting. Discuss telemetry or additional persistence paths in an issue first.
