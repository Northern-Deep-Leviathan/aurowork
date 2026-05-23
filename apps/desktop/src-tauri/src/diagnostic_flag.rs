//! One-shot flag persisted between app launches to signal
//! "the next launch should write a launch log file even if dev mode is off".
//!
//! The flag is a tiny file under the Tauri app_data_dir. The lifecycle is:
//!   1. UI calls `arm_launch_diagnostic` → backend calls [`set`] → file created.
//!   2. UI calls `plugin:process|restart` → app exits and relaunches.
//!   3. On startup, `lib::run().setup()` calls [`take`] → returns true and
//!      deletes the file.
//!   4. If the file is absent, [`take`] returns false (the common case).

use std::fs;
use std::path::{Path, PathBuf};

const FLAG_FILENAME: &str = "launch-diagnostic.flag";

/// Resolve the path to the flag file inside the given app data dir.
pub fn flag_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(FLAG_FILENAME)
}

/// Create (or overwrite) the flag. Creates the parent dir if missing.
pub fn set(app_data_dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(app_data_dir)?;
    fs::write(flag_path(app_data_dir), b"1")
}

/// Consume the flag: returns true if it existed (and deletes it),
/// false otherwise. This is the read-and-clear operation called once
/// per app launch in `setup`.
pub fn take(app_data_dir: &Path) -> bool {
    let path = flag_path(app_data_dir);
    if !path.exists() {
        return false;
    }
    // Best-effort delete: even if removal fails (e.g. permission flap),
    // we still return true so the launch IS captured. Next launch will
    // try again — at worst we capture one extra diagnostic log, never
    // miss one.
    let _ = fs::remove_file(&path);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use uuid::Uuid;

    fn tmp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aurowork-diag-flag-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn set_then_take_returns_true_and_deletes() {
        let dir = tmp_dir();
        set(&dir).unwrap();
        assert!(flag_path(&dir).exists(), "set() must create the file");
        let consumed = take(&dir);
        assert!(consumed, "take() must return true when flag is set");
        assert!(!flag_path(&dir).exists(), "take() must delete the file");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn take_on_missing_returns_false() {
        let dir = tmp_dir();
        let consumed = take(&dir);
        assert!(!consumed, "take() must return false when flag is absent");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn take_twice_in_a_row_second_returns_false() {
        let dir = tmp_dir();
        set(&dir).unwrap();
        assert!(take(&dir), "first take should consume");
        assert!(!take(&dir), "second take should report missing");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn set_creates_parent_dir_if_missing() {
        let base = std::env::temp_dir().join(format!("aurowork-diag-flag-parent-{}", Uuid::new_v4()));
        let nested = base.join("subdir");
        assert!(!nested.exists());
        set(&nested).unwrap();
        assert!(flag_path(&nested).exists());
        let _ = fs::remove_dir_all(&base);
    }
}
