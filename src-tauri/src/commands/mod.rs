mod app_state;
mod sync;
mod system;
mod workspace;

pub use app_state::{
    delete_draft, drafts_exist, load_app_state, migrate_legacy_state, read_draft, save_preferences,
    set_favorite, set_folder_appearance, skip_app_update, write_draft,
};
pub use sync::{get_cloud_sync_profile, run_cloud_sync, save_cloud_sync_profile, test_cloud_sync};
pub use system::{check_app_update, fetch_link_preview_html};
pub use workspace::{
    create_note, delete_attachment, delete_note, get_index_info, get_note_graph, import_attachment,
    query_library, read_note, rebuild_index, reconcile_workspace, rename_note, save_attachment,
    scan_attachments, write_export_file, write_note,
};

use crate::{
    domain::attachment::ATTACHMENTS_DIR,
    services::{AppStateService, CloudSyncService, WorkspaceService},
};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub(crate) fn allow_workspace_media(app: &AppHandle, root: &str) {
    let path = PathBuf::from(root);
    let path = path.canonicalize().unwrap_or(path);
    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(&path, true);
    let _ = scope.allow_directory(path.join(ATTACHMENTS_DIR), true);
}

#[derive(Debug, Clone)]
pub struct AppServices {
    pub workspace: WorkspaceService,
    pub app_state: AppStateService,
    pub cloud_sync: CloudSyncService,
}
