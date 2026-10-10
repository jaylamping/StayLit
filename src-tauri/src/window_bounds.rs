use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

static LATEST: Mutex<Option<WindowBounds>> = Mutex::new(None);
static FILE: Mutex<Option<PathBuf>> = Mutex::new(None);
static FLUSH_ARMED: AtomicBool = AtomicBool::new(false);

pub fn usable_bounds(bounds: WindowBounds) -> Option<WindowBounds> {
    if bounds.width < 800 || bounds.height < 520 {
        return None;
    }
    if bounds.width > 16_000 || bounds.height > 16_000 {
        return None;
    }
    if bounds.x.abs() > 100_000 || bounds.y.abs() > 100_000 {
        return None;
    }
    Some(bounds)
}

pub fn load_bounds(path: &Path) -> Option<WindowBounds> {
    let text = std::fs::read_to_string(path).ok()?;
    let bounds = serde_json::from_str::<WindowBounds>(&text).ok()?;
    usable_bounds(bounds)
}

pub fn remember_path(path: PathBuf) {
    *FILE.lock().expect("window bounds path") = Some(path);
}

pub fn restore(window: &WebviewWindow, dir: &Path) {
    let path = dir.join("window-bounds.json");
    remember_path(path.clone());
    let Some(bounds) = load_bounds(&path) else {
        return;
    };
    let _ = window.set_position(Position::Physical(PhysicalPosition::new(bounds.x, bounds.y)));
    let _ = window.set_size(Size::Physical(PhysicalSize::new(bounds.width, bounds.height)));
}

pub fn note(window: &WebviewWindow) {
    let Ok(pos) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    note_size(pos, size);
}

pub fn note_size(pos: PhysicalPosition<i32>, size: PhysicalSize<u32>) {
    let Some(bounds) = usable_bounds(WindowBounds {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    }) else {
        return;
    };
    *LATEST.lock().expect("window bounds") = Some(bounds);
    if FLUSH_ARMED.swap(true, Ordering::AcqRel) {
        return;
    }
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(400));
        flush();
        FLUSH_ARMED.store(false, Ordering::Release);
    });
}

pub fn flush() {
    let path = FILE.lock().expect("window bounds path").clone();
    let bounds = LATEST.lock().expect("window bounds").clone();
    let (Some(path), Some(bounds)) = (path, bounds) else {
        return;
    };
    if let Ok(buf) = serde_json::to_vec_pretty(&bounds) {
        let _ = std::fs::write(path, buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_bounds_keep_a_real_window() {
        assert!(usable_bounds(WindowBounds {
            x: -20,
            y: 40,
            width: 960,
            height: 600,
        })
        .is_some());
        assert!(usable_bounds(WindowBounds {
            x: 0,
            y: 0,
            width: 100,
            height: 100,
        })
        .is_none());

        let dir = std::env::temp_dir().join(format!("staylit-bounds-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("window-bounds.json");
        std::fs::write(&path, r#"{"x":12,"y":-40,"width":960,"height":600}"#).expect("write");
        let bounds = load_bounds(&path).expect("bounds");
        assert_eq!(bounds.width, 960);
        assert_eq!(bounds.y, -40);
        std::fs::write(&path, r#"{"x":0,"y":0,"width":100,"height":100}"#).expect("write");
        assert!(load_bounds(&path).is_none());
        std::fs::write(&path, "not json").expect("write");
        assert!(load_bounds(&path).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
