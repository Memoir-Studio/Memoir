use crate::domain::{AppError, AppResult};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid_path("Storage file has no parent directory."))?;
    fs::create_dir_all(parent)
        .map_err(|error| AppError::io("Create storage directory", parent, error))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("memoir-data");
    let temp = parent.join(format!(".{file_name}.{nonce}.tmp"));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|error| AppError::io("Create temporary file", &temp, error))?;
        file.write_all(bytes)
            .map_err(|error| AppError::io("Write temporary file", &temp, error))?;
        file.sync_all()
            .map_err(|error| AppError::io("Sync temporary file", &temp, error))?;
        fs::rename(&temp, path)
            .map_err(|error| AppError::io("Replace destination file", path, error))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
