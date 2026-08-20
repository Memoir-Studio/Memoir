use crate::{
    domain::{
        path::{resolve_existing_note, resolve_new_note, validate_relative_path},
        AppSettings, ErrorCode, FolderAppearance, LegacyDraft, LegacyStatePayload,
        WindowFrameState, DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH, MIN_WINDOW_HEIGHT,
        MIN_WINDOW_WIDTH,
    },
    infrastructure::{
        app_data::AppDataRepository,
        filesystem::{slugify, LocalFileSystem},
    },
    services::{AppStateService, WorkspaceService},
};
use std::fs;
use std::time::Duration;
use tempfile::tempdir;

#[test]
fn rejects_path_traversal_absolute_paths_and_unsupported_extensions() {
    assert_eq!(
        validate_relative_path("../outside.md").unwrap_err().code,
        ErrorCode::InvalidPath
    );
    assert_eq!(
        validate_relative_path("/tmp/outside.md").unwrap_err().code,
        ErrorCode::InvalidPath
    );
    let workspace = tempdir().unwrap();
    assert_eq!(
        resolve_new_note(workspace.path().to_str().unwrap(), "note.txt")
            .unwrap_err()
            .code,
        ErrorCode::UnsupportedExtension
    );
}

#[cfg(unix)]
#[test]
fn rejects_symlink_escape_for_existing_and_new_notes() {
    use std::os::unix::fs::symlink;

    let workspace = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("outside.md"), "# Outside").unwrap();
    symlink(outside.path(), workspace.path().join("linked")).unwrap();

    assert_eq!(
        resolve_existing_note(workspace.path().to_str().unwrap(), "linked/outside.md")
            .unwrap_err()
            .code,
        ErrorCode::InvalidPath
    );
    assert_eq!(
        resolve_new_note(workspace.path().to_str().unwrap(), "linked/new.md")
            .unwrap_err()
            .code,
        ErrorCode::InvalidPath
    );

    fs::write(workspace.path().join("note.md"), "# Note").unwrap();
    assert_eq!(
        LocalFileSystem::new()
            .rename_note(
                workspace.path().to_str().unwrap(),
                "note.md",
                "linked/renamed.md",
            )
            .unwrap_err()
            .code,
        ErrorCode::InvalidPath
    );
    assert!(!outside.path().join("renamed.md").exists());

    symlink(outside.path(), workspace.path().join(".memoir-trash")).unwrap();
    assert_eq!(
        LocalFileSystem::new()
            .delete_note(workspace.path().to_str().unwrap(), "note.md")
            .unwrap_err()
            .code,
        ErrorCode::InvalidPath
    );
}

#[test]
fn sync_file_writes_stay_inside_the_workspace() {
    let workspace = tempdir().unwrap();
    let root = workspace.path().to_str().unwrap();
    let filesystem = LocalFileSystem::new();
    filesystem
        .write_sync_file(root, "inbox.md", b"# Inbox")
        .unwrap();
    assert_eq!(
        fs::read_to_string(workspace.path().join("inbox.md")).unwrap(),
        "# Inbox"
    );
    filesystem
        .write_sync_file(root, "attachments/2026-08/photo.png", b"png-bytes")
        .unwrap();
    assert!(workspace
        .path()
        .join("attachments/2026-08/photo.png")
        .exists());
    assert_eq!(
        filesystem
            .write_sync_file(root, "../escape.md", b"nope")
            .unwrap_err()
            .code,
        ErrorCode::InvalidPath
    );
    assert_eq!(
        filesystem
            .write_sync_file(root, ".memoir/index.md", b"nope")
            .unwrap_err()
            .code,
        ErrorCode::InvalidPath
    );
}

#[test]
fn scans_notes_sorted_and_ignores_hidden_directories() {
    let workspace = tempdir().unwrap();
    fs::write(workspace.path().join("a.md"), "# A").unwrap();
    fs::create_dir(workspace.path().join(".hidden")).unwrap();
    fs::write(workspace.path().join(".hidden/secret.md"), "# Secret").unwrap();
    fs::create_dir(workspace.path().join("notes")).unwrap();
    std::thread::sleep(Duration::from_millis(20));
    fs::write(workspace.path().join("notes/b.mdx"), "# B").unwrap();
    fs::create_dir(workspace.path().join(".memoir")).unwrap();
    fs::write(workspace.path().join(".memoir/note.md"), "# Cache").unwrap();

    let filesystem = LocalFileSystem::new();
    let notes = filesystem
        .scan_workspace(workspace.path().to_str().unwrap())
        .unwrap();
    let paths = notes
        .iter()
        .map(|note| note.relative_path.as_str())
        .collect::<Vec<_>>();
    assert_eq!(paths, vec!["notes/b.mdx", "a.md"]);
    assert!(!paths.iter().any(|path| path.contains(".hidden")));
    assert!(!paths.iter().any(|path| path.contains(".memoir")));
}

#[test]
fn creates_unique_slug_reads_atomically_renames_and_trashes() {
    let workspace = tempdir().unwrap();
    let root = workspace.path().to_str().unwrap();
    let filesystem = LocalFileSystem::new();

    assert_eq!(slugify("  Hello, World  "), "hello-world");
    let first = filesystem
        .create_note(root, "Hello World", "md", None, None)
        .unwrap();
    let second = filesystem
        .create_note(root, "Hello World", "md", None, None)
        .unwrap();
    assert_eq!(first, "hello-world.md");
    assert_eq!(second, "hello-world-1.md");

    filesystem
        .write_note(root, &first, "# Changed atomically")
        .unwrap();
    assert_eq!(
        filesystem.read_note(root, &first).unwrap(),
        "# Changed atomically"
    );
    assert!(!fs::read_dir(workspace.path())
        .unwrap()
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().ends_with(".tmp")));

    let renamed = filesystem
        .rename_note(root, &first, "archive/renamed.mdx")
        .unwrap();
    assert_eq!(renamed, "archive/renamed.mdx");
    let trashed = filesystem.delete_note(root, &renamed).unwrap();
    assert!(trashed.starts_with(".memoir-trash/"));
    assert!(!workspace.path().join(&renamed).exists());
}

#[test]
fn app_state_defaults_version_compatibility_and_favorites_are_isolated() {
    let app_data = tempdir().unwrap();
    let workspace_a = tempdir().unwrap();
    let workspace_b = tempdir().unwrap();
    let workspace_a_key = workspace_a
        .path()
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let workspace_b_key = workspace_b
        .path()
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let repository = AppDataRepository::new(app_data.path().to_path_buf());
    assert_eq!(repository.root(), app_data.path());
    let service = AppStateService::new(repository.clone());
    let default = service.load().unwrap();
    assert_eq!(default.version, 1);
    assert!(default.favorites.is_empty());
    assert!(default.folder_appearances.is_empty());
    assert_eq!(default.window, WindowFrameState::default());

    let state = service
        .set_favorite(workspace_a_key.clone(), "one.md".into(), true)
        .unwrap();
    assert_eq!(
        state.favorites.get(&workspace_a_key),
        Some(&vec!["one.md".to_string()])
    );
    let state = service
        .set_favorite(workspace_b_key, "one.md".into(), true)
        .unwrap();
    assert_eq!(state.favorites.len(), 2);

    let legacy_state = serde_json::json!({
        "version": 0,
        "preferences": AppSettings::default(),
        "favorites": {}
    });
    fs::write(
        app_data.path().join("app-state.json"),
        serde_json::to_vec(&legacy_state).unwrap(),
    )
    .unwrap();
    assert_eq!(repository.load_state().unwrap().version, 1);

    let without_ui_scale = serde_json::json!({
        "version": 1,
        "preferences": {
            "appearance": {
                "theme": "dark",
                "accent": "coral",
                "background": "paper",
                "density": "comfortable",
                "bodyFont": "sans",
                "bodyFontSize": 15,
                "lineHeight": 1.8,
                "contentWidth": "standard"
            },
            "editor": {
                "fontSize": 14,
                "lineWrapping": true,
                "lineNumbers": true,
                "defaultView": "split"
            }
        }
    });
    fs::write(
        app_data.path().join("app-state.json"),
        serde_json::to_vec(&without_ui_scale).unwrap(),
    )
    .unwrap();
    let upgraded = repository.load_state().unwrap();
    assert_eq!(upgraded.preferences.appearance.ui_scale, 1.0);
    assert_eq!(upgraded.preferences.appearance.theme, "dark");
    assert_eq!(upgraded.preferences.appearance.locale, "system");
    assert_eq!(upgraded.preferences.general.close_behavior, "tray");
    assert!(upgraded.preferences.closes_to_tray());
    assert_eq!(upgraded.window, WindowFrameState::default());
    assert_eq!(upgraded.layout, crate::domain::WorkspaceLayout::default());
    assert!(upgraded.folder_appearances.is_empty());
    assert_eq!(upgraded.skipped_update_version, None);
}

#[test]
fn skipped_update_version_persists_across_preference_saves() {
    let app_data = tempdir().unwrap();
    let service = AppStateService::new(AppDataRepository::new(app_data.path().to_path_buf()));

    let skipped = service.skip_update_version("v0.1.7".into()).unwrap();
    assert_eq!(skipped.skipped_update_version.as_deref(), Some("0.1.7"));

    let again = service.skip_update_version("0.1.7".into()).unwrap();
    assert_eq!(again.skipped_update_version.as_deref(), Some("0.1.7"));

    let after_prefs = service
        .save_preferences(AppSettings::default(), Some("/notes".into()), true, None)
        .unwrap();
    assert_eq!(after_prefs.skipped_update_version.as_deref(), Some("0.1.7"));
    assert_eq!(after_prefs.last_workspace.as_deref(), Some("/notes"));

    assert_eq!(
        service
            .skip_update_version("not-a-version".into())
            .unwrap_err()
            .code,
        ErrorCode::Io
    );
}

#[test]
fn layout_widths_persist_and_clamp() {
    let app_data = tempdir().unwrap();
    let service = AppStateService::new(AppDataRepository::new(app_data.path().to_path_buf()));
    let saved = service
        .save_preferences(
            AppSettings::default(),
            Some("/notes".into()),
            false,
            Some(crate::domain::WorkspaceLayout {
                sidebar_width: 220,
                library_width: 360,
                editor_split: 0.4,
            }),
        )
        .unwrap();
    assert_eq!(saved.layout.sidebar_width, 220);
    assert_eq!(saved.layout.library_width, 360);
    assert!((saved.layout.editor_split - 0.4).abs() < f32::EPSILON);

    let clamped = service
        .save_preferences(
            AppSettings::default(),
            Some("/notes".into()),
            false,
            Some(crate::domain::WorkspaceLayout {
                sidebar_width: 12,
                library_width: 9_000,
                editor_split: 8.0,
            }),
        )
        .unwrap();
    assert_eq!(clamped.layout.sidebar_width, 148);
    assert_eq!(clamped.layout.library_width, 520);
    assert!((clamped.layout.editor_split - 0.72).abs() < f32::EPSILON);

    let kept = service
        .save_preferences(AppSettings::default(), Some("/notes".into()), true, None)
        .unwrap();
    assert_eq!(kept.layout.sidebar_width, 148);
    assert_eq!(kept.layout.library_width, 520);
}

#[test]
fn close_behavior_quit_disables_tray_hide() {
    let mut settings = AppSettings::default();
    assert!(settings.closes_to_tray());
    settings.general.close_behavior = "quit".into();
    assert!(!settings.closes_to_tray());
    settings.general.close_behavior = "unknown".into();
    assert!(settings.closes_to_tray());
}

#[test]
fn folder_appearances_are_isolated_sanitized_and_cleared() {
    let app_data = tempdir().unwrap();
    let workspace_a = tempdir().unwrap();
    let workspace_b = tempdir().unwrap();
    let workspace_a_key = workspace_a
        .path()
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let workspace_b_key = workspace_b
        .path()
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let service = AppStateService::new(AppDataRepository::new(app_data.path().to_path_buf()));

    let state = service
        .set_folder_appearance(
            workspace_a_key.clone(),
            "日记".into(),
            Some(FolderAppearance {
                emoji: Some("📔".into()),
                color: Some("coral".into()),
            }),
        )
        .unwrap();
    assert_eq!(
        state
            .folder_appearances
            .get(&workspace_a_key)
            .and_then(|folders| folders.get("日记")),
        Some(&FolderAppearance {
            emoji: Some("📔".into()),
            color: Some("coral".into()),
        })
    );

    let state = service
        .set_folder_appearance(
            workspace_b_key.clone(),
            "/思考/".into(),
            Some(FolderAppearance {
                emoji: Some("  💭  ".into()),
                color: Some("pink".into()),
            }),
        )
        .unwrap();
    assert_eq!(
        state
            .folder_appearances
            .get(&workspace_b_key)
            .and_then(|folders| folders.get("思考")),
        Some(&FolderAppearance {
            emoji: Some("💭".into()),
            color: None,
        })
    );
    assert_eq!(state.folder_appearances.len(), 2);

    let cleared = service
        .set_folder_appearance(workspace_a_key.clone(), "日记".into(), None)
        .unwrap();
    assert!(!cleared.folder_appearances.contains_key(&workspace_a_key));

    assert_eq!(
        service
            .set_folder_appearance(workspace_a_key, "../escape".into(), None)
            .unwrap_err()
            .code,
        ErrorCode::InvalidPath
    );
}

#[test]
fn window_frame_is_remembered_without_storing_maximized_size() {
    let app_data = tempdir().unwrap();
    let service = AppStateService::new(AppDataRepository::new(app_data.path().to_path_buf()));

    let state = service.save_window_frame(1440.0, 900.0, false).unwrap();
    assert_eq!(state.window.width, 1440.0);
    assert_eq!(state.window.height, 900.0);
    assert!(!state.window.maximized);

    let maximized = service.save_window_frame(1920.0, 1080.0, true).unwrap();
    assert_eq!(maximized.window.width, 1440.0);
    assert_eq!(maximized.window.height, 900.0);
    assert!(maximized.window.maximized);

    let after_prefs = service
        .save_preferences(AppSettings::default(), Some("/notes".into()), true, None)
        .unwrap();
    assert_eq!(after_prefs.window.width, 1440.0);
    assert_eq!(after_prefs.window.height, 900.0);
    assert!(after_prefs.window.maximized);
    assert_eq!(after_prefs.last_workspace.as_deref(), Some("/notes"));

    let clamped = service.save_window_frame(80.0, f64::NAN, false).unwrap();
    assert_eq!(clamped.window.width, MIN_WINDOW_WIDTH);
    assert_eq!(clamped.window.height, DEFAULT_WINDOW_HEIGHT);
    assert!(!clamped.window.maximized);

    assert_eq!(
        WindowFrameState {
            width: f64::INFINITY,
            height: 40.0,
            maximized: false,
        }
        .sanitized(),
        WindowFrameState {
            width: DEFAULT_WINDOW_WIDTH,
            height: MIN_WINDOW_HEIGHT,
            maximized: false,
        }
    );
}

#[test]
fn drafts_round_trip_delete_and_support_legacy_keys_with_colons() {
    let app_data = tempdir().unwrap();
    let repository = AppDataRepository::new(app_data.path().to_path_buf());
    repository
        .write_draft("C:\\Users\\writer", "notes/today.md", "draft")
        .unwrap();
    assert_eq!(
        repository
            .read_draft("C:\\Users\\writer", "notes/today.md")
            .unwrap(),
        Some("draft".into())
    );
    repository
        .delete_draft("C:\\Users\\writer", "notes/today.md")
        .unwrap();
    assert_eq!(
        repository
            .read_draft("C:\\Users\\writer", "notes/today.md")
            .unwrap(),
        None
    );

    repository
        .write_legacy_draft(&LegacyDraft {
            legacy_key: "memoir:draft:C:\\Users\\writer:notes/today.md".into(),
            workspace_root: None,
            relative_path: None,
            content: "legacy".into(),
        })
        .unwrap();
    assert_eq!(
        repository
            .read_draft("C:\\Users\\writer", "notes/today.md")
            .unwrap(),
        Some("legacy".into())
    );
}

#[test]
fn legacy_migration_writes_state_and_only_reports_persisted_keys() {
    let app_data = tempdir().unwrap();
    let service = AppStateService::new(AppDataRepository::new(app_data.path().to_path_buf()));
    let result = service
        .migrate_legacy_state(LegacyStatePayload {
            settings: Some(AppSettings::default()),
            last_workspace: Some("/notes".into()),
            sidebar_collapsed: Some(true),
            favorites: Some(vec!["favorite.md".into()]),
            drafts: vec![LegacyDraft {
                legacy_key: "memoir:draft:/notes:draft.md".into(),
                workspace_root: None,
                relative_path: None,
                content: "draft".into(),
            }],
        })
        .unwrap();
    assert!(result.migrated_keys.contains(&"memoir:settings".into()));
    assert!(result
        .migrated_keys
        .contains(&"memoir:draft:/notes:draft.md".into()));
    let state = service.load().unwrap();
    assert_eq!(state.last_workspace.as_deref(), Some("/notes"));
    assert!(state.sidebar_collapsed);
    assert_eq!(
        state.favorites.get("/notes"),
        Some(&vec!["favorite.md".to_string()])
    );
    assert_eq!(
        service.read_draft("/notes", "draft.md").unwrap(),
        Some("draft".into())
    );
}

#[test]
fn attachment_month_dir_uses_utc_year_month() {
    use std::time::{Duration, UNIX_EPOCH};
    assert_eq!(
        crate::domain::attachment::attachment_month_dir_at(UNIX_EPOCH),
        "1970-01"
    );
    assert_eq!(
        crate::domain::attachment::attachment_month_dir_at(
            UNIX_EPOCH + Duration::from_secs(1_709_164_800)
        ),
        "2024-02"
    );
    assert_eq!(
        crate::domain::attachment::attachment_month_dir_at(
            UNIX_EPOCH + Duration::from_secs(1_786_752_000)
        ),
        "2026-08"
    );
}

fn sample_png() -> Vec<u8> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    STANDARD
        .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        .unwrap()
}

#[test]
fn saves_lists_and_trashes_attachments_inside_the_library() {
    let workspace = tempdir().unwrap();
    let root = workspace.path().to_str().unwrap();
    let filesystem = LocalFileSystem::new();

    assert!(filesystem.scan_attachments(root).unwrap().is_empty());

    let month = crate::domain::attachment::attachment_month_dir();
    let saved = filesystem
        .save_attachment(
            root,
            &sample_png(),
            Some("../escape/photo.png"),
            Some("image/png"),
        )
        .unwrap();
    assert_eq!(
        saved.relative_path,
        format!("attachments/{month}/photo.png")
    );
    assert_eq!(saved.extension, "png");
    assert!(workspace
        .path()
        .join(format!("attachments/{month}/photo.png"))
        .exists());

    let duplicate = filesystem
        .save_attachment(root, &sample_png(), Some("photo.png"), None)
        .unwrap();
    assert_eq!(
        duplicate.relative_path,
        format!("attachments/{month}/photo-1.png")
    );

    let listed = filesystem.scan_attachments(root).unwrap();
    assert_eq!(listed.len(), 2);
    assert!(listed
        .iter()
        .all(|item| item.relative_path.starts_with("attachments/")));

    let outside = tempdir().unwrap();
    let source = outside.path().join("diagram.webp");
    fs::write(&source, sample_png()).unwrap();
    let imported = filesystem
        .import_attachment(root, source.to_str().unwrap())
        .unwrap();
    assert_eq!(
        imported.relative_path,
        format!("attachments/{month}/diagram.png")
    );

    let trashed = filesystem
        .delete_attachment(root, &format!("attachments/{month}/photo.png"))
        .unwrap();
    assert!(trashed.starts_with(".memoir-trash/"));
    assert!(!workspace
        .path()
        .join(format!("attachments/{month}/photo.png"))
        .exists());
}

#[test]
fn rejects_non_image_and_escaping_attachment_paths() {
    let workspace = tempdir().unwrap();
    let root = workspace.path().to_str().unwrap();
    let filesystem = LocalFileSystem::new();

    assert_eq!(
        filesystem
            .save_attachment(
                root,
                b"not-an-image",
                Some("notes.md"),
                Some("text/markdown")
            )
            .unwrap_err()
            .code,
        ErrorCode::UnsupportedExtension
    );
    assert_eq!(
        filesystem
            .delete_attachment(root, "../outside.png")
            .unwrap_err()
            .code,
        ErrorCode::InvalidPath
    );
    assert_eq!(
        filesystem
            .delete_attachment(root, "notes/photo.png")
            .unwrap_err()
            .code,
        ErrorCode::InvalidPath
    );

    let huge = vec![0_u8; crate::domain::attachment::MAX_ATTACHMENT_BYTES + 1];
    assert_eq!(
        filesystem
            .save_attachment(root, &huge, Some("huge.png"), Some("image/png"))
            .unwrap_err()
            .code,
        ErrorCode::Io
    );
}

#[test]
fn writes_absolute_pdf_export_files_and_rejects_invalid_paths() {
    let dir = tempdir().unwrap();
    let dest = dir.path().join("note.pdf");
    let filesystem = LocalFileSystem::new();
    filesystem
        .write_export_file(dest.to_str().unwrap(), b"%PDF-1.4 test")
        .unwrap();
    assert_eq!(fs::read(&dest).unwrap(), b"%PDF-1.4 test");

    assert_eq!(
        filesystem
            .write_export_file("note.pdf", b"x")
            .unwrap_err()
            .code,
        ErrorCode::InvalidPath
    );
    assert_eq!(
        filesystem
            .write_export_file(dir.path().join("note.txt").to_str().unwrap(), b"x")
            .unwrap_err()
            .code,
        ErrorCode::UnsupportedExtension
    );
}

#[test]
fn workspace_scan_returns_cached_metadata_and_skips_unchanged_reads() {
    let workspace = tempdir().unwrap();
    let root = workspace.path().to_str().unwrap();
    fs::write(
        workspace.path().join("one.md"),
        "---\ntitle: One\ntags: [a]\n---\n\n# One\n\nHello.",
    )
    .unwrap();
    fs::write(workspace.path().join("two.md"), "# Two\n\nSecond").unwrap();

    let service = WorkspaceService::new(LocalFileSystem::new());
    let first = service.scan(root).unwrap();
    assert_eq!(first.len(), 2);
    let one = first
        .iter()
        .find(|note| note.relative_path == "one.md")
        .unwrap();
    assert_eq!(one.title, "One");
    assert_eq!(one.tags, vec!["a"]);
    assert!(one.excerpt.contains("Hello"));
    let reads_after_first = service
        .content_reads
        .load(std::sync::atomic::Ordering::Relaxed);
    assert!(reads_after_first >= 2);

    let second = service.scan(root).unwrap();
    assert_eq!(second.len(), 2);
    assert_eq!(
        service
            .content_reads
            .load(std::sync::atomic::Ordering::Relaxed),
        reads_after_first
    );
    assert!(workspace.path().join(".memoir/index.sqlite").exists());

    let info = service.index_info(root).unwrap();
    assert!(info.persistent);
    assert_eq!(info.note_count, 2);
    assert_eq!(info.tag_count, 1);
    assert!(info.file_size > 0);
    assert!(info.last_reconcile_ms > 0);
}

#[test]
fn rebuild_index_drops_cache_and_reparses() {
    let workspace = tempdir().unwrap();
    let root = workspace.path().to_str().unwrap();
    fs::write(
        workspace.path().join("one.md"),
        "---\ntitle: One\ntags: [a]\n---\n\n# One\n\nHello.",
    )
    .unwrap();
    let service = WorkspaceService::new(LocalFileSystem::new());
    service.scan(root).unwrap();
    let reads = service
        .content_reads
        .load(std::sync::atomic::Ordering::Relaxed);
    let first_created = service.index_info(root).unwrap().created_ms;

    let rebuilt = service
        .rebuild_index(root, &crate::domain::LibraryQuery::default())
        .unwrap();
    assert_eq!(rebuilt.stats.total, 1);
    assert_eq!(rebuilt.notes.len(), 1);
    let info = service.index_info(root).unwrap();
    assert_eq!(info.note_count, 1);
    assert_eq!(info.tag_count, 1);
    assert!(info.created_ms >= first_created);
    assert!(
        service
            .content_reads
            .load(std::sync::atomic::Ordering::Relaxed)
            > reads
    );
    assert!(workspace.path().join(".memoir/index.sqlite").exists());
}

#[test]
fn second_reconcile_sees_inplace_edit_and_new_subdir() {
    let workspace = tempdir().unwrap();
    let root = workspace.path();
    let root_str = root.to_str().unwrap();
    fs::write(root.join("a.md"), "# Old\n\nbody").unwrap();
    let service = WorkspaceService::new(LocalFileSystem::new());
    let first = service
        .reconcile(root_str, &crate::domain::LibraryQuery::default())
        .unwrap();
    assert_eq!(first.notes.len(), 1);
    assert_eq!(first.notes[0].title, "Old");

    fs::write(root.join("a.md"), "# New Title\n\nchanged").unwrap();
    fs::create_dir_all(root.join("sub")).unwrap();
    fs::write(root.join("sub/b.md"), "# Nested\n").unwrap();

    let second = service
        .reconcile(root_str, &crate::domain::LibraryQuery::default())
        .unwrap();
    let rewritten = second
        .notes
        .iter()
        .find(|note| note.relative_path == "a.md")
        .expect("rewritten note");
    assert_eq!(rewritten.title, "New Title");
    let nested = second
        .notes
        .iter()
        .find(|note| note.relative_path == "sub/b.md")
        .expect("new subdirectory note");
    assert_eq!(nested.title, "Nested");
}

#[test]
fn second_reconcile_sees_inplace_edit_when_parent_dir_stat_is_unchanged() {
    let workspace = tempdir().unwrap();
    let root = workspace.path();
    let root_str = root.to_str().unwrap();
    fs::write(root.join("a.md"), "# Old\n\nbody").unwrap();
    let service = WorkspaceService::new(LocalFileSystem::new());
    service
        .reconcile(root_str, &crate::domain::LibraryQuery::default())
        .unwrap();

    fs::write(root.join("a.md"), "# Edited In Place\n\nxx").unwrap();
    let page = service
        .reconcile(root_str, &crate::domain::LibraryQuery::default())
        .unwrap();
    let note = page
        .notes
        .iter()
        .find(|item| item.relative_path == "a.md")
        .expect("note");
    assert_eq!(note.title, "Edited In Place");
}

#[test]
fn write_then_scan_does_not_reread_and_rename_updates_path() {
    let workspace = tempdir().unwrap();
    let root = workspace.path().to_str().unwrap();
    fs::write(workspace.path().join("old.md"), "# Old").unwrap();
    let service = WorkspaceService::new(LocalFileSystem::new());
    service.scan(root).unwrap();
    let reads = service
        .content_reads
        .load(std::sync::atomic::Ordering::Relaxed);

    service.write(root, "old.md", "# Updated\n\nBody").unwrap();
    let after_write = service.scan(root).unwrap();
    assert_eq!(
        service
            .content_reads
            .load(std::sync::atomic::Ordering::Relaxed),
        reads
    );
    assert_eq!(after_write[0].title, "Updated");

    let renamed = service.rename(root, "old.md", "new.md").unwrap();
    assert_eq!(renamed.note.relative_path, "new.md");
    let after_rename = service.scan(root).unwrap();
    assert_eq!(after_rename.len(), 1);
    assert_eq!(after_rename[0].relative_path, "new.md");
    assert_eq!(after_rename[0].title, "Updated");

    service.delete(root, "new.md").unwrap();
    assert!(service.scan(root).unwrap().is_empty());
}

#[test]
fn garbage_index_and_vanished_new_file_do_not_fail_scan() {
    let workspace = tempdir().unwrap();
    let root = workspace.path().to_str().unwrap();
    fs::write(workspace.path().join("keep.md"), "# Keep").unwrap();
    fs::create_dir_all(workspace.path().join(".memoir")).unwrap();
    fs::write(workspace.path().join(".memoir/index.sqlite"), b"garbage").unwrap();

    let service = WorkspaceService::new(LocalFileSystem::new());
    let notes = service.scan(root).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].title, "Keep");

    fs::write(workspace.path().join("ghost.md"), "# Ghost").unwrap();
    // A vanished new path must not persist: scan after delete is empty of it.
    fs::remove_file(workspace.path().join("ghost.md")).unwrap();
    let again = service.scan(root).unwrap();
    assert_eq!(again.len(), 1);
    assert_eq!(again[0].relative_path, "keep.md");
}

#[cfg(unix)]
#[test]
fn unreadable_new_file_does_not_insert_a_ghost_row() {
    use std::os::unix::fs::PermissionsExt;

    let workspace = tempdir().unwrap();
    let root = workspace.path().to_str().unwrap();
    fs::write(workspace.path().join("keep.md"), "# Keep").unwrap();
    let service = WorkspaceService::new(LocalFileSystem::new());
    service.scan(root).unwrap();

    fs::write(workspace.path().join("secret.md"), "# Secret").unwrap();
    fs::set_permissions(
        workspace.path().join("secret.md"),
        fs::Permissions::from_mode(0o000),
    )
    .unwrap();
    let notes = service.scan(root).unwrap();
    let _ = fs::set_permissions(
        workspace.path().join("secret.md"),
        fs::Permissions::from_mode(0o644),
    );
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].relative_path, "keep.md");
}

#[test]
fn drafts_exist_fast_path_and_legacy_listing() {
    let app_data = tempdir().unwrap();
    let service = AppStateService::new(AppDataRepository::new(app_data.path().to_path_buf()));
    let paths = vec!["one.md".into(), "two.md".into()];
    assert!(service.drafts_exist("/notes", &paths).unwrap().is_empty());

    service.write_draft("/notes", "one.md", "draft").unwrap();
    assert_eq!(
        service.drafts_exist("/notes", &paths).unwrap(),
        vec!["one.md"]
    );

    service
        .migrate_legacy_state(LegacyStatePayload {
            drafts: vec![LegacyDraft {
                legacy_key: "memoir:draft:/notes:two.md".into(),
                workspace_root: None,
                relative_path: None,
                content: "legacy".into(),
            }],
            ..Default::default()
        })
        .unwrap();
    let found = service.drafts_exist("/notes", &paths).unwrap();
    assert_eq!(found, vec!["one.md", "two.md"]);
}

#[test]
fn create_then_query_without_second_walk() {
    let workspace = tempdir().unwrap();
    let root = workspace.path().to_str().unwrap();
    fs::write(workspace.path().join("keep.md"), "# Keep").unwrap();
    let service = WorkspaceService::new(LocalFileSystem::new());
    let first = service
        .reconcile(root, &crate::domain::LibraryQuery::default())
        .unwrap();
    assert_eq!(first.notes.len(), 1);
    let walks = service.walk_dirs.load(std::sync::atomic::Ordering::Relaxed);
    assert!(walks >= 1);

    let created = service
        .create(root, "Fresh Note", "md", None, Some(&["lab".into()]))
        .unwrap();
    assert_eq!(created.title, "Fresh Note");
    assert_eq!(created.tags, vec!["lab"]);
    let after_create_walks = service.walk_dirs.load(std::sync::atomic::Ordering::Relaxed);
    assert_eq!(
        after_create_walks, walks,
        "create must not walk the workspace"
    );

    let page = service
        .query_library(root, &crate::domain::LibraryQuery::default())
        .unwrap();
    assert!(page
        .notes
        .iter()
        .any(|note| note.relative_path == created.relative_path && note.title == "Fresh Note"));
    assert_eq!(
        service.walk_dirs.load(std::sync::atomic::Ordering::Relaxed),
        walks,
        "query_library must not walk"
    );
    println!(
        "launch-query create_then_query_without_second_walk walks_before={} walks_after={} path={} title={}",
        walks,
        after_create_walks,
        created.relative_path,
        created.title
    );
}

#[test]
fn create_then_query_without_second_walk_repeats() {
    create_then_query_without_second_walk();
}

#[test]
fn v1_index_file_is_rebuilt_as_v2_and_notes_return() {
    let workspace = tempdir().unwrap();
    let root = workspace.path().to_str().unwrap();
    fs::write(
        workspace.path().join("keep.md"),
        "---\ntitle: Keep\ntags: [a]\n---\n\n# Keep\n",
    )
    .unwrap();
    let dir = workspace.path().join(".memoir");
    fs::create_dir_all(&dir).unwrap();
    let db = dir.join("index.sqlite");
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch(
        "
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE notes (
            relative_path TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            extension TEXT NOT NULL,
            modified_ms INTEGER NOT NULL,
            size INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            parse_truncated INTEGER NOT NULL DEFAULT 0,
            title TEXT NOT NULL,
            excerpt TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            indexed_at_ms INTEGER NOT NULL
        );
        ",
    )
    .unwrap();
    conn.pragma_update(None, "user_version", 1).unwrap();
    drop(conn);

    let service = WorkspaceService::new(LocalFileSystem::new());
    let page = service
        .reconcile(root, &crate::domain::LibraryQuery::default())
        .unwrap();
    assert_eq!(page.notes.len(), 1);
    assert_eq!(page.notes[0].title, "Keep");
    let info = service.index_info(root).unwrap();
    assert_eq!(info.schema_version, 2);
}

#[test]
fn rebuild_walks_once_and_hot_reconcile_skips_bodies() {
    let workspace = tempdir().unwrap();
    let root = workspace.path().to_str().unwrap();
    fs::write(workspace.path().join("one.md"), "# One\n\nHello").unwrap();
    let service = WorkspaceService::new(LocalFileSystem::new());
    service
        .reconcile(root, &crate::domain::LibraryQuery::default())
        .unwrap();
    let walks_after_open = service.walk_dirs.load(std::sync::atomic::Ordering::Relaxed);
    let reads_after_open = service
        .content_reads
        .load(std::sync::atomic::Ordering::Relaxed);

    service
        .reconcile(root, &crate::domain::LibraryQuery::default())
        .unwrap();
    assert_eq!(
        service
            .content_reads
            .load(std::sync::atomic::Ordering::Relaxed),
        reads_after_open
    );

    let walks_before_rebuild = service.walk_dirs.load(std::sync::atomic::Ordering::Relaxed);
    service
        .rebuild_index(root, &crate::domain::LibraryQuery::default())
        .unwrap();
    let walks_after_rebuild = service.walk_dirs.load(std::sync::atomic::Ordering::Relaxed);
    assert!(
        walks_after_rebuild > walks_before_rebuild,
        "rebuild must walk once"
    );
    service
        .query_library(root, &crate::domain::LibraryQuery::default())
        .unwrap();
    assert_eq!(
        service.walk_dirs.load(std::sync::atomic::Ordering::Relaxed),
        walks_after_rebuild,
        "query after rebuild must not walk again"
    );
    assert!(walks_after_open >= 1);
}

#[ignore]
#[test]
fn bench_open_vs_create_walk_counts() {
    let workspace = tempdir().unwrap();
    let root = workspace.path();
    for index in 0..1_200 {
        let folder = if index % 20 == 0 {
            format!("pack{index}")
        } else {
            format!("pack{}", index / 20)
        };
        let dir = root.join(&folder);
        let _ = fs::create_dir_all(&dir);
        fs::write(
            dir.join(format!("n{index}.md")),
            format!("# Note {index}\n\nbody"),
        )
        .unwrap();
    }
    fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
    fs::write(root.join("node_modules/pkg/ignore.md"), "# ignored").unwrap();

    let service = WorkspaceService::new(LocalFileSystem::new());
    let start = std::time::Instant::now();
    let page = service
        .reconcile(
            root.to_str().unwrap(),
            &crate::domain::LibraryQuery::default(),
        )
        .unwrap();
    let open_ms = start.elapsed().as_millis();
    let open_walks = service.walk_dirs.load(std::sync::atomic::Ordering::Relaxed);
    assert!(page.notes.len() >= 1_200);

    let start = std::time::Instant::now();
    service
        .create(root.to_str().unwrap(), "Extra", "md", None, None)
        .unwrap();
    let q = service
        .query_library(
            root.to_str().unwrap(),
            &crate::domain::LibraryQuery::default(),
        )
        .unwrap();
    let create_ms = start.elapsed().as_millis();
    let create_walks = service.walk_dirs.load(std::sync::atomic::Ordering::Relaxed) - open_walks;
    println!(
        "bench open_ms={open_ms} open_walks={open_walks} create_ms={create_ms} create_walks={create_walks} notes={}",
        q.notes.len()
    );
    assert_eq!(create_walks, 0);
}
