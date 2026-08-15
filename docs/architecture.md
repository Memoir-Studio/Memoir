# Memoir architecture

Memoir is a local-first desktop notebook. The workspace is an ordinary folder of `.md` / `.mdx` files. The frontend never talks to Tauri or `localStorage` directly; Rust stays a thin sandbox around the filesystem and app-data.

## Dependency direction

Frontend:

```text
app  →  features  →  store  →  gateways  →  platform
                 ↘  domain
                 ↘  i18n
                 ↘  components/ui
```

- `src/app/AppShell.tsx` boots the app: theme, DPI zoom, i18n, window-frame CSS, legacy migration, then composes features.
- Features are grouped by area: `workspace`, `library`, `editor`, `preview`, `settings`, `window`.
- `src/store/app-store.ts` holds workspace, document, library, settings, and UI state, plus the async actions that mutate them.
- Store IO goes through `WorkspaceGateway` / `PersistenceGateway` only.
- Components and hooks must not call Tauri `invoke` or read/write `localStorage`.
- Features may call `WorkspaceGateway` for host-side actions that are not store mutations: `openPath`, `openExternal`, `resolveMediaPath`. Window chrome talks to `src/platform/window.ts`.
- `src/migrations/legacy-storage.ts` is the only module allowed to read old `localStorage` keys. Those keys are deleted only after the backend confirms the atomic write.
- CodeMirror instances, DOM refs, scroll/animation state, and the MDX compile cache stay in components. They do not belong in the global store.

Note frontmatter, title, and excerpt parsing lives in `src/features/library/note-utils.ts` and is reused by store hydration, the editor, and the preview.

Rust:

```text
commands  →  services  →  domain
                      ↘  infrastructure

lib.rs          dependency assembly only
window_frame.rs native window size / maximized persistence
```

- `domain` — structured errors, note and app-state models, path rules.
- `services` — workspace CRUD, preferences, favorites, folder appearance, drafts, and legacy migration.
- `infrastructure` — local filesystem, app-data JSON, drafts, atomic writes.
- `commands` — accept camelCase DTOs, call a service, return a serialized result.
- `lib.rs` — resolve the Tauri app-data path, inject services, register plugins and commands, restore the window frame.
- `window_frame.rs` is not a command. On setup it restores size from `app-state.json`; on resize (debounced) and close it writes back through `AppStateService`.

## Frontend layout

| Path | Role |
| --- | --- |
| `src/app` | Shell: init, theme, composition |
| `src/features/*` | UI and feature-local helpers |
| `src/store` | Zustand store and selectors |
| `src/gateways` | Tauri and in-memory browser adapters |
| `src/domain` | Shared TS models and settings merge |
| `src/platform` | Runtime detect, DPI, native window, context-menu block |
| `src/i18n` | `zh` / `en` catalogs and locale resolution |
| `src/migrations` | One-shot `localStorage` → app-data move |
| `src/components/ui` | Shared primitives |

`getGateways()` in `src/gateways/index.ts` picks Tauri or browser from `isTauriRuntime()`. Tests inject mocks with `setGatewaysForTests`.

The store is five slices: `workspace`, `document`, `library`, `settings`, `ui`. Preferences persist on a short debounce; unsaved edits write a draft; a longer interval autosaves the file.

## Tauri contract

Workspace commands:

- `scan_workspace`
- `read_note`
- `write_note`
- `create_note`
- `rename_note`
- `delete_note`

Persistence commands:

- `load_app_state`
- `save_preferences`
- `set_favorite`
- `set_folder_appearance`
- `read_draft`
- `write_draft`
- `delete_draft`
- `migrate_legacy_state`

These are not commands. They go through plugins or Tauri helpers, still behind `WorkspaceGateway`:

| Method | Backend |
| --- | --- |
| `chooseWorkspace` | `tauri-plugin-dialog` |
| `openPath` / `openExternal` | `tauri-plugin-opener` |
| `resolveMediaPath` | `convertFileSrc` |

Window size and maximized state never cross the webview as a command.

Frontend DTOs stay camelCase. Rust structs use Serde `rename_all = "camelCase"`.

Every command failure is:

```json
{
  "code": "invalid_path | unsupported_extension | not_found | conflict | io | serialization",
  "message": "user-facing summary",
  "details": "optional diagnostic"
}
```

The TypeScript mapper also accepts `unknown` for errors that are not this shape.

## Persistence

Desktop data lives in Tauri `app_data_dir`:

```text
app-data/
  app-state.json
  drafts/
    <workspace sha256>/
      <relative-path sha256>.mdraft
    legacy/
      <legacy-key sha256>.mdraft
```

`app-state.json` (version `1`) stores:

- `preferences` — appearance and editor settings
- `recentWorkspaces` — last 10 roots, most recent first
- `lastWorkspace`
- `sidebarCollapsed`
- `favorites` — relative paths keyed by canonical workspace root
- `folderAppearances` — emoji/color keyed by workspace, then folder
- `window` — logical width, height, maximized

Drafts are separate files so typing does not rewrite the whole state file. State and draft writes create a sibling temp file, `sync`, then `rename`.

The browser build is an in-memory demo. It does not read or write real files, and it does not persist settings.

## Path safety

- Reject empty paths, absolute paths, `.`, `..`, and any non-normal path component.
- Only `.md` / `.mdx`.
- Canonicalize before read, write-of-existing, rename, and delete; the result must still be inside the workspace.
- Before creating a new file, canonicalize the nearest existing parent so a symlink cannot escape.
- Scan skips symbolic links, any directory whose name starts with `.`, and `node_modules`, `dist`, `build`, `target`, `.next`, `.turbo`. `.git` and `.memoir-trash` are skipped as hidden names.
- Delete is a rename into `<workspace>/.memoir-trash/<unix-seconds>-<filename>`. A symlinked trash directory is rejected.

## Extending

New frontend feature:

1. Put shared models in `src/domain`.
2. If it needs IO, add a method on `src/gateways/contracts.ts` and implement Tauri plus browser.
3. Add a store action and a narrow selector. Do not grow the store with view-only state.
4. Build UI and hooks in `src/features/<name>`.
5. Test helpers, store actions, and the interactions that can lose data.
6. Compose last, in `AppShell`.

New Tauri command:

1. Models, errors, and validation in `domain`.
2. External IO in `infrastructure`.
3. Business rules in `services`.
4. A thin function in `commands`.
5. Register it in `lib.rs`.
6. Cover the filesystem rules with temp-dir tests in `src-tauri/src/tests.rs`, and the DTO / error mapping in the frontend gateway tests.

Do not add a second persistence path, cloud sync, or telemetry without an issue first.
