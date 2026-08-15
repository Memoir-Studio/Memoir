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
    services::AppStateService,
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
        LocalFileSystem
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
        LocalFileSystem
            .delete_note(workspace.path().to_str().unwrap(), "note.md")
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

    let filesystem = LocalFileSystem;
    let notes = filesystem
        .scan_workspace(workspace.path().to_str().unwrap())
        .unwrap();
    let paths = notes
        .iter()
        .map(|note| note.relative_path.as_str())
        .collect::<Vec<_>>();
    assert_eq!(paths, vec!["notes/b.mdx", "a.md"]);
    assert!(!paths.iter().any(|path| path.contains(".hidden")));
}

#[test]
fn creates_unique_slug_reads_atomically_renames_and_trashes() {
    let workspace = tempdir().unwrap();
    let root = workspace.path().to_str().unwrap();
    let filesystem = LocalFileSystem;

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
    assert_eq!(upgraded.window, WindowFrameState::default());
    assert!(upgraded.folder_appearances.is_empty());
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
        .save_preferences(AppSettings::default(), Some("/notes".into()), true)
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
