use crate::domain::cloud_sync::CloudSyncProfile;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const APP_STATE_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteIdentity {
    pub relative_path: String,
    pub file_name: String,
    pub extension: String,
    pub modified_ms: u128,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    pub relative_path: String,
    pub file_name: String,
    pub extension: String,
    pub modified_ms: u128,
    pub size: u64,
    pub title: String,
    pub tags: Vec<String>,
    pub excerpt: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum LibraryNav {
    #[default]
    All,
    Recent,
    Favorites,
    Uncategorized,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryQuery {
    #[serde(default)]
    pub q: String,
    #[serde(default)]
    pub nav: LibraryNav,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub favorite_paths: Option<Vec<String>>,
    #[serde(default)]
    pub now_ms: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderStat {
    pub folder: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TagStat {
    pub tag: String,
    pub tag_norm: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub total: u64,
    pub recent: u64,
    pub favorites: u64,
    pub uncategorized: u64,
    pub folders: Vec<FolderStat>,
    pub tags: Vec<TagStat>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPage {
    pub notes: Vec<NoteFile>,
    pub stats: LibraryStats,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenamedNote {
    pub old_path: String,
    pub note: NoteFile,
}

pub fn folder_of(relative_path: &str) -> String {
    match relative_path.rfind('/') {
        Some(index) => relative_path[..index].to_string(),
        None => String::new(),
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentFile {
    pub relative_path: String,
    pub file_name: String,
    pub extension: String,
    pub mime_type: String,
    pub modified_ms: u128,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexInfo {
    pub persistent: bool,
    pub relative_path: String,
    pub file_size: u64,
    pub wal_size: u64,
    pub shm_size: u64,
    pub schema_version: i32,
    pub schema_name: String,
    pub parse_algo_version: u32,
    pub index_read_cap: u64,
    pub created_ms: u128,
    pub last_reconcile_ms: u128,
    pub note_count: u64,
    pub tag_count: u64,
    pub tag_link_count: u64,
    pub truncated_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    #[serde(default = "default_locale")]
    pub locale: String,
    pub theme: String,
    pub accent: String,
    pub background: String,
    pub density: String,
    #[serde(default = "default_ui_scale")]
    pub ui_scale: f32,
    pub body_font: String,
    pub body_font_size: u8,
    pub line_height: f32,
    pub content_width: String,
}

fn default_ui_scale() -> f32 {
    1.0
}

fn default_locale() -> String {
    "system".into()
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            locale: default_locale(),
            theme: "system".into(),
            accent: "ink".into(),
            background: "paper".into(),
            density: "comfortable".into(),
            ui_scale: default_ui_scale(),
            body_font: "sans".into(),
            body_font_size: 15,
            line_height: 1.8,
            content_width: "standard".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditorSettings {
    pub font_size: u8,
    pub line_wrapping: bool,
    pub line_numbers: bool,
    pub default_view: String,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            font_size: 14,
            line_wrapping: true,
            line_numbers: false,
            default_view: "split".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    #[serde(default = "default_close_behavior")]
    pub close_behavior: String,
    #[serde(default = "default_note_sort")]
    pub note_sort: String,
    #[serde(default = "default_note_sort_direction")]
    pub note_sort_direction: String,
}

fn default_close_behavior() -> String {
    "tray".into()
}

fn default_note_sort() -> String {
    "name".into()
}

fn default_note_sort_direction() -> String {
    "asc".into()
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            close_behavior: default_close_behavior(),
            note_sort: default_note_sort(),
            note_sort_direction: default_note_sort_direction(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct AppSettings {
    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub editor: EditorSettings,
    #[serde(default)]
    pub general: GeneralSettings,
}

impl AppSettings {
    pub fn closes_to_tray(&self) -> bool {
        self.general.close_behavior != "quit"
    }
}

pub const DEFAULT_WINDOW_WIDTH: f64 = 1200.0;
pub const DEFAULT_WINDOW_HEIGHT: f64 = 800.0;
pub const MIN_WINDOW_WIDTH: f64 = 720.0;
pub const MIN_WINDOW_HEIGHT: f64 = 480.0;
const MAX_WINDOW_DIMENSION: f64 = 10_000.0;

fn default_window_width() -> f64 {
    DEFAULT_WINDOW_WIDTH
}

fn default_window_height() -> f64 {
    DEFAULT_WINDOW_HEIGHT
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowFrameState {
    #[serde(default = "default_window_width")]
    pub width: f64,
    #[serde(default = "default_window_height")]
    pub height: f64,
    #[serde(default)]
    pub maximized: bool,
}

impl Default for WindowFrameState {
    fn default() -> Self {
        Self {
            width: DEFAULT_WINDOW_WIDTH,
            height: DEFAULT_WINDOW_HEIGHT,
            maximized: false,
        }
    }
}

impl WindowFrameState {
    pub fn sanitized(self) -> Self {
        Self {
            width: sanitize_dimension(self.width, DEFAULT_WINDOW_WIDTH, MIN_WINDOW_WIDTH),
            height: sanitize_dimension(self.height, DEFAULT_WINDOW_HEIGHT, MIN_WINDOW_HEIGHT),
            maximized: self.maximized,
        }
    }

    pub fn with_live_size(self, width: f64, height: f64, maximized: bool) -> Self {
        if maximized {
            Self {
                maximized: true,
                ..self.sanitized()
            }
        } else {
            Self {
                width,
                height,
                maximized: false,
            }
            .sanitized()
        }
    }
}

fn sanitize_dimension(value: f64, fallback: f64, min: f64) -> f64 {
    if !value.is_finite() {
        return fallback;
    }
    value.clamp(min, MAX_WINDOW_DIMENSION)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderAppearance {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLayout {
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    #[serde(default = "default_library_width")]
    pub library_width: u32,
    #[serde(default = "default_editor_split")]
    pub editor_split: f32,
}

fn default_sidebar_width() -> u32 {
    164
}

fn default_library_width() -> u32 {
    280
}

fn default_editor_split() -> f32 {
    0.5
}

const MIN_SIDEBAR_WIDTH: u32 = 148;
const MAX_SIDEBAR_WIDTH: u32 = 360;
const MIN_LIBRARY_WIDTH: u32 = 200;
const MAX_LIBRARY_WIDTH: u32 = 520;
const MIN_EDITOR_SPLIT: f32 = 0.28;
const MAX_EDITOR_SPLIT: f32 = 0.72;

impl Default for WorkspaceLayout {
    fn default() -> Self {
        Self {
            sidebar_width: default_sidebar_width(),
            library_width: default_library_width(),
            editor_split: default_editor_split(),
        }
    }
}

impl WorkspaceLayout {
    pub fn sanitized(self) -> Self {
        Self {
            sidebar_width: self
                .sidebar_width
                .clamp(MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH),
            library_width: self
                .library_width
                .clamp(MIN_LIBRARY_WIDTH, MAX_LIBRARY_WIDTH),
            editor_split: sanitize_editor_split(self.editor_split),
        }
    }
}

fn sanitize_editor_split(value: f32) -> f32 {
    if !value.is_finite() {
        return default_editor_split();
    }
    value.clamp(MIN_EDITOR_SPLIT, MAX_EDITOR_SPLIT)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub preferences: AppSettings,
    #[serde(default)]
    pub recent_workspaces: Vec<String>,
    #[serde(default)]
    pub last_workspace: Option<String>,
    #[serde(default)]
    pub sidebar_collapsed: bool,
    #[serde(default)]
    pub layout: WorkspaceLayout,
    #[serde(default)]
    pub favorites: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub folder_appearances: BTreeMap<String, BTreeMap<String, FolderAppearance>>,
    #[serde(default)]
    pub cloud_sync: BTreeMap<String, CloudSyncProfile>,
    #[serde(default)]
    pub window: WindowFrameState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skipped_update_version: Option<String>,
}

fn default_version() -> u32 {
    APP_STATE_VERSION
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            version: APP_STATE_VERSION,
            preferences: AppSettings::default(),
            recent_workspaces: Vec::new(),
            last_workspace: None,
            sidebar_collapsed: false,
            layout: WorkspaceLayout::default(),
            favorites: BTreeMap::new(),
            folder_appearances: BTreeMap::new(),
            cloud_sync: BTreeMap::new(),
            window: WindowFrameState::default(),
            skipped_update_version: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyDraft {
    pub legacy_key: String,
    pub workspace_root: Option<String>,
    pub relative_path: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LegacyStatePayload {
    pub settings: Option<AppSettings>,
    pub last_workspace: Option<String>,
    pub sidebar_collapsed: Option<bool>,
    pub favorites: Option<Vec<String>>,
    #[serde(default)]
    pub drafts: Vec<LegacyDraft>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    pub migrated_keys: Vec<String>,
}
