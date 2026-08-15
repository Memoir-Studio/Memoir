use crate::{
    domain::{
        WindowFrameState, DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH, MIN_WINDOW_HEIGHT,
        MIN_WINDOW_WIDTH,
    },
    services::AppStateService,
};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{LogicalSize, WebviewWindow, WindowEvent};

const SAVE_DEBOUNCE: Duration = Duration::from_millis(300);

pub fn restore(window: &WebviewWindow, frame: &WindowFrameState) {
    let frame = frame.clone().sanitized();
    let (width, height) = clamp_to_monitor(window, frame.width, frame.height);
    let _ = window.set_size(LogicalSize::new(width, height));
}

pub fn persist_on_changes(
    window: WebviewWindow,
    app_state: AppStateService,
    initial: WindowFrameState,
) {
    let seed = if !initial.maximized {
        (initial.width, initial.height)
    } else {
        logical_inner_size(&window).unwrap_or((initial.width, initial.height))
    };
    let last_restored = Arc::new(Mutex::new(seed));
    let generation = Arc::new(AtomicU64::new(0));

    let save = {
        let window = window.clone();
        let last_restored = last_restored.clone();
        let app_state = app_state.clone();
        Arc::new(move || {
            let frame = capture_frame(&window, &last_restored);
            let _ = app_state.save_window_frame(frame.width, frame.height, frame.maximized);
        })
    };

    window.on_window_event(move |event| match event {
        WindowEvent::Resized(_) => {
            let current = generation.fetch_add(1, Ordering::Relaxed) + 1;
            let generation = generation.clone();
            let save = save.clone();
            thread::spawn(move || {
                thread::sleep(SAVE_DEBOUNCE);
                if generation.load(Ordering::Relaxed) == current {
                    save();
                }
            });
        }
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => save(),
        _ => {}
    });
}

pub fn reveal(window: &WebviewWindow, maximized: bool) {
    let _ = window.show();
    let _ = window.set_focus();
    if maximized {
        let _ = window.maximize();
    }
}

fn capture_frame(window: &WebviewWindow, last_restored: &Mutex<(f64, f64)>) -> WindowFrameState {
    let maximized = window.is_maximized().unwrap_or(false);
    if !window.is_minimized().unwrap_or(false) {
        if let Some(size) = logical_inner_size(window) {
            if !maximized {
                if let Ok(mut slot) = last_restored.lock() {
                    *slot = size;
                }
            }
        }
    }
    let (width, height) = last_restored
        .lock()
        .map(|slot| *slot)
        .unwrap_or((DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT));
    WindowFrameState {
        width,
        height,
        maximized,
    }
}

fn logical_inner_size(window: &WebviewWindow) -> Option<(f64, f64)> {
    let scale = window.scale_factor().ok()?;
    if scale <= 0.0 {
        return None;
    }
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    if !size.width.is_finite() || !size.height.is_finite() {
        return None;
    }
    Some((size.width, size.height))
}

fn clamp_to_monitor(window: &WebviewWindow, width: f64, height: f64) -> (f64, f64) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return (width, height);
    };
    let scale = monitor.scale_factor();
    if scale <= 0.0 {
        return (width, height);
    }
    let work = monitor.work_area().size.to_logical::<f64>(scale);
    (
        width.min(work.width.max(MIN_WINDOW_WIDTH)),
        height.min(work.height.max(MIN_WINDOW_HEIGHT)),
    )
}
