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
- Store IO goes through `WorkspaceGateway` / `PersistenceGateway` / `CloudSyncGateway` only.
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
tray.rs         system tray and close-to-tray
```

- `domain` — structured errors, note and app-state models, path rules.
- `services` — workspace CRUD, index reconcile / write-through, preferences, favorites, folder appearance, drafts, and legacy migration.
- `infrastructure` — local filesystem, disposable workspace SQLite index, app-data JSON, drafts, atomic writes.
- `commands` — accept camelCase DTOs, call a service, return a serialized result.
- `lib.rs` — resolve the Tauri app-data path, inject services, register plugins and commands, restore the window frame, install the tray.
- `window_frame.rs` is not a command. On setup it restores size from `app-state.json`; on resize (debounced) and close it writes back through `AppStateService`.
- `tray.rs` is not a command. It owns the tray icon and intercepts `CloseRequested` so the default close hides to the tray. `preferences.general.closeBehavior` (`tray` | `quit`) is read from `app-state.json` and refreshed on `save_preferences`. Tray Quit calls `app.exit(0)`.

## Frontend layout

| Path | Role |
| --- | --- |
| `src/app` | Shell: init, theme, composition |
| `src/features/*` | UI and feature-local helpers (`sync` is the cloud-sync panel in the library drawer; `update` is the GitHub release notice) |
| `src/store` | Zustand store and selectors |
| `src/gateways` | Tauri and in-memory browser adapters |
| `src/domain` | Shared TS models and settings merge |
| `src/platform` | Runtime detect, DPI, native window, context-menu block |
| `src/i18n` | `zh` / `en` catalogs and locale resolution |
| `src/migrations` | One-shot `localStorage` → app-data move |
| `src/components/ui` | Shared primitives |

`getGateways()` in `src/gateways/index.ts` picks Tauri or browser from `isTauriRuntime()`. Tests inject mocks with `setGatewaysForTests`.

The store is five slices: `workspace`, `document`, `library`, `settings`, `ui`. Preferences persist on a short debounce; unsaved edits write a draft; a longer interval autosaves the file. Optional cloud sync is a third gateway (`CloudSyncGateway`): the planner is provider-agnostic, and WebDAV is the first `CloudProvider`.

## Tauri contract

Workspace commands:

- `scan_workspace` — walks identity (`path` / `mtime` / `size`), reconciles `<workspace>/.memoir/index.sqlite`, and returns cached `title` / `tags` / `excerpt`
- `get_index_info` — returns the current workspace SQLite index snapshot (path, size, counts, schema)
- `rebuild_index` — deletes the disposable index files, reopens an empty cache, rescans, and returns fresh `get_index_info`
- `read_note`
- `write_note`
- `create_note`
- `rename_note`
- `delete_note`
- `scan_attachments`
- `save_attachment`
- `import_attachment`
- `delete_attachment`

Persistence commands:

- `load_app_state`
- `save_preferences`
- `set_favorite`
- `set_folder_appearance`
- `read_draft`
- `write_draft`
- `delete_draft`
- `drafts_exist`
- `migrate_legacy_state`
- `check_app_update` — GitHub Releases latest tag; skip-aware, notify-only
- `skip_app_update`

Cloud sync commands:

- `get_cloud_sync_profile`
- `save_cloud_sync_profile`
- `test_cloud_sync`
- `run_cloud_sync`

These are not commands. They go through plugins or Tauri helpers, still behind `WorkspaceGateway`:

| Method | Backend |
| --- | --- |
| `chooseWorkspace` | `tauri-plugin-dialog` |
| `openPath` / `revealPath` / `openExternal` | `tauri-plugin-opener` (`openPath` / `revealItemInDir` / `openUrl`) |
| `resolveMediaPath` | `convertFileSrc` via the enabled `asset` protocol, scoped to the open workspace and `attachments/` |

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

- `preferences` — appearance, editor, and general settings (close-to-tray)
- `recentWorkspaces` — last 10 roots, most recent first
- `lastWorkspace`
- `sidebarCollapsed`
- `favorites` — relative paths keyed by canonical workspace root
- `folderAppearances` — emoji/color keyed by workspace, then folder
- `cloudSync` — per-workspace provider settings (WebDAV URL and credentials stay here, not in the vault)
- `window` — logical width, height, maximized
- `skippedUpdateVersion` — last GitHub release the user chose to skip; a newer tag prompts again

A last-sync snapshot lives at `sync/<workspace sha256>/snapshot.json` so two-way sync can detect local/remote edits and deletes. It also stores attachment directory stats so a repeat sync can skip `read_dir` when those folders have not changed. Notes and image attachments are replicated; `.memoir/`, trash, and drafts are not. Attachments sync before notes. Conflicts keep the newer mtime (local wins ties); the losing attachment is kept as a local `*.conflict-*` file. Enabled workspaces also sync after open and after save. A run that did not change local files does not walk the library again.

Drafts are separate files so typing does not rewrite the whole state file. State and draft writes create a sibling temp file, `sync`, then `rename`.

Each desktop workspace also has a disposable library cache at `<workspace>/.memoir/index.sqlite` (plus WAL sidecars). It stores note identity and derived library fields (`title`, `tags`, `excerpt`) so opening the library does not read every file. Notes on disk remain the only source of truth: delete the directory and Memoir rebuilds it. A missing, corrupt, hostile, or unwritable cache never fails a scan — Memoir rebuilds the file or uses an in-memory index for the session. Drafts, favorites, and settings stay in app-data, not in this file.

Add `.memoir/` to the vault’s root `.gitignore`. If the folder lives in iCloud, Dropbox, or OneDrive, exclude `.memoir/` from sync. Memoir writes an inner `.memoir/.gitignore` containing `*` so a force-added folder still ignores the database.

Pasted, dropped, and imported images are ordinary files in workspace `attachments/YYYY-MM/`. They are not stored in app-data. The browser demo keeps them in memory as data URLs. Desktop file drops use the native window drag-drop event because the webview does not expose OS files on `dataTransfer`.

The browser build is an in-memory demo. It does not read or write real files, does not open SQLite, it does not persist settings, and it does not call GitHub for updates.

## Path safety

- Reject empty paths, absolute paths, `.`, `..`, and any non-normal path component.
- Only `.md` / `.mdx` for notes.
- Attachments live in workspace `attachments/YYYY-MM/`. Writes accept only image extensions (`png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `avif`, `svg`), stay inside that folder, and are capped at 20 MB. Deletes go to `.memoir-trash/` like notes. Conflicts keep the losing image as a local `*.conflict-*` sibling.
- Canonicalize before read, write-of-existing, rename, and delete; the result must still be inside the workspace.
- Before creating a new file, canonicalize the nearest existing parent so a symlink cannot escape.
- Scan skips symbolic link **entries**, any directory whose name starts with `.`, and `node_modules`, `dist`, `build`, `target`, `.next`, `.turbo`. `.git`, `.memoir`, `.memoir-trash`, and `attachments` are skipped as note folders (and listed in `IGNORED_DIRS`).
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

A new cloud provider is a `CloudProvider` impl plus a profile variant. Do not add a second persistence path or telemetry without an issue first.
