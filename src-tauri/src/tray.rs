use crate::{domain::AppSettings, services::AppStateService};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Runtime, WebviewWindow, WindowEvent,
};

const TRAY_ID: &str = "main";

pub struct ClosePolicy {
    close_to_tray: AtomicBool,
}

impl ClosePolicy {
    pub fn new(close_to_tray: bool) -> Self {
        Self {
            close_to_tray: AtomicBool::new(close_to_tray),
        }
    }

    pub fn set_close_to_tray(&self, value: bool) {
        self.close_to_tray.store(value, Ordering::Relaxed);
    }

    pub fn close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::Relaxed)
    }
}

pub fn install(app: &App, app_state: &AppStateService) -> tauri::Result<Arc<ClosePolicy>> {
    let preferences = app_state
        .load()
        .map(|state| state.preferences)
        .unwrap_or_default();
    let policy = Arc::new(ClosePolicy::new(preferences.closes_to_tray()));
    setup_tray(app, &preferences)?;
    if let Some(window) = app.get_webview_window("main") {
        intercept_close(window, policy.clone());
    }
    Ok(policy)
}

pub fn sync_from_preferences(app: &AppHandle, preferences: &AppSettings, policy: &ClosePolicy) {
    policy.set_close_to_tray(preferences.closes_to_tray());
    let _ = set_tray_menu(app, preferences);
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn intercept_close(window: WebviewWindow, policy: Arc<ClosePolicy>) {
    let hidden = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if policy.close_to_tray() {
                api.prevent_close();
                let _ = hidden.hide();
            }
        }
    });
}

fn setup_tray(app: &App, preferences: &AppSettings) -> tauri::Result<()> {
    let Some(icon) = app.default_window_icon().cloned() else {
        return Ok(());
    };
    let locale = tray_locale(&preferences.appearance.locale);
    let (tooltip, show_label, quit_label) = labels(locale);
    let show = MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip(tooltip)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                show_main(tray.app_handle());
            }
        });
    builder = builder.show_menu_on_left_click(cfg!(target_os = "linux"));
    builder.build(app)?;
    Ok(())
}

fn set_tray_menu<R: Runtime>(app: &AppHandle<R>, preferences: &AppSettings) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let locale = tray_locale(&preferences.appearance.locale);
    let (_, show_label, quit_label) = labels(locale);
    let show = MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    tray.set_menu(Some(menu))?;
    Ok(())
}

fn tray_locale(preference: &str) -> &'static str {
    match preference {
        "zh" => "zh",
        "en" => "en",
        _ => system_locale(),
    }
}

fn system_locale() -> &'static str {
    for key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(value) = std::env::var(key) {
            let lower = value.to_lowercase();
            if lower.starts_with("zh") {
                return "zh";
            }
            if !lower.is_empty() && lower != "c" && lower != "posix" {
                return "en";
            }
        }
    }
    "en"
}

fn labels(locale: &str) -> (&'static str, &'static str, &'static str) {
    if locale == "zh" {
        ("Memoir", "显示窗口", "退出")
    } else {
        ("Memoir", "Show window", "Quit")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_locale_respects_explicit_preference() {
        assert_eq!(tray_locale("zh"), "zh");
        assert_eq!(tray_locale("en"), "en");
    }

    #[test]
    fn labels_follow_locale() {
        assert_eq!(labels("zh"), ("Memoir", "显示窗口", "退出"));
        assert_eq!(labels("en"), ("Memoir", "Show window", "Quit"));
    }

    #[test]
    fn close_policy_defaults_to_tray() {
        let policy = ClosePolicy::new(true);
        assert!(policy.close_to_tray());
        policy.set_close_to_tray(false);
        assert!(!policy.close_to_tray());
    }
}
