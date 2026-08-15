mod commands;
mod domain;
mod infrastructure;
mod services;
#[cfg(test)]
mod tests;
mod window_frame;

use commands::{
    create_note, delete_attachment, delete_draft, delete_note, drafts_exist, import_attachment,
    load_app_state, migrate_legacy_state, read_draft, read_note, rename_note, save_attachment,
    save_preferences, scan_attachments, scan_workspace, set_favorite, set_folder_appearance,
    write_draft, write_note,
    AppServices,
};
use infrastructure::{app_data::AppDataRepository, filesystem::LocalFileSystem};
use services::{AppStateService, WorkspaceService};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let app_state = AppStateService::new(AppDataRepository::new(app_data_dir));
            if let Some(window) = app.get_webview_window("main") {
                let frame = app_state
                    .load()
                    .map(|state| state.window)
                    .unwrap_or_default();
                window_frame::restore(&window, &frame);
                window_frame::persist_on_changes(window.clone(), app_state.clone(), frame.clone());
                window_frame::reveal(&window, frame.maximized);
            }
            app.manage(AppServices {
                workspace: WorkspaceService::new(LocalFileSystem),
                app_state,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_workspace,
            read_note,
            write_note,
            create_note,
            rename_note,
            delete_note,
            scan_attachments,
            drafts_exist,
            save_attachment,
            import_attachment,
            delete_attachment,
            load_app_state,
            save_preferences,
            set_favorite,
            set_folder_appearance,
            read_draft,
            write_draft,
            delete_draft,
            migrate_legacy_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
