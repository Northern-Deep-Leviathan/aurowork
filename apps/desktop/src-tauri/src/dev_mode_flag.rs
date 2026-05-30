//! Sticky flag persisted across app launches that signals
//! "developer mode is on; the next launch should write a launch log file".
//!
//! Read-only on read: [`is_set`] does NOT delete the file. The flag is
//! written by the frontend via `set_developer_mode_persistent` whenever
//! the user toggles Developer Mode in Settings, and read once during
//! `lib::run().setup()` to decide whether [`crate::launch_log`] should
//! actually open a file for this launch.
//!
//! Lifecycle:
//!   1. User toggles Developer Mode on → frontend invokes
//!      `set_developer_mode_persistent(true)` → [`enable`] creates the file.
//!   2. App restarts (or starts) → `setup` calls [`is_set`] → true →
//!      launch log file is opened for this launch.
//!   3. User toggles Developer Mode off → frontend invokes
//!      `set_developer_mode_persistent(false)` → [`disable`] removes the file.

use std::fs;
use std::path::{Path, PathBuf};

const FLAG_FILENAME: &str = "developer-mode.flag";

/// Resolve the path to the flag file inside the given app data dir.
pub fn flag_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(FLAG_FILENAME)
}

/// Create (or overwrite) the flag. Creates the parent dir if missing.
pub fn enable(app_data_dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(app_data_dir)?;
    fs::write(flag_path(app_data_dir), b"1")
}

/// Remove the flag. No-op when already absent. Returns Ok in both cases.
pub fn disable(app_data_dir: &Path) -> std::io::Result<()> {
    let path = flag_path(app_data_dir);
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(&path)
}

/// Read-only check. Does NOT delete the file.
pub fn is_set(app_data_dir: &Path) -> bool {
    flag_path(app_data_dir).exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn tmp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aurowork-devmode-flag-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn enable_creates_file_and_is_set_returns_true() {
        let dir = tmp_dir();
        assert!(!is_set(&dir));
        enable(&dir).unwrap();
        assert!(flag_path(&dir).exists());
        assert!(is_set(&dir));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn is_set_does_not_delete_file() {
        let dir = tmp_dir();
        enable(&dir).unwrap();
        assert!(is_set(&dir));
        assert!(is_set(&dir), "is_set must be idempotent");
        assert!(flag_path(&dir).exists(), "is_set must not delete");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn disable_removes_file_and_is_idempotent() {
        let dir = tmp_dir();
        enable(&dir).unwrap();
        disable(&dir).unwrap();
        assert!(!is_set(&dir));
        // calling disable again on a missing file must not error
        disable(&dir).unwrap();
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn enable_creates_parent_dir_if_missing() {
        let base = std::env::temp_dir().join(format!("aurowork-devmode-flag-parent-{}", Uuid::new_v4()));
        let nested = base.join("subdir");
        assert!(!nested.exists());
        enable(&nested).unwrap();
        assert!(flag_path(&nested).exists());
        let _ = fs::remove_dir_all(&base);
    }
}
