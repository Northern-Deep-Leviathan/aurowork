use std::path::PathBuf;

use crate::paths::{home_dir, resolve_in_path};

#[cfg(windows)]
const AURO_EXECUTABLE: &str = "auro.exe";

#[cfg(windows)]
const AURO_CMD: &str = "auro.cmd";

#[cfg(not(windows))]
const AURO_EXECUTABLE: &str = "auro";

pub fn auro_executable_name() -> &'static str {
    AURO_EXECUTABLE
}

pub fn candidate_auro_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(home) = home_dir() {
        candidates.push(home.join(".auro").join("bin").join(AURO_EXECUTABLE));
    }

    #[cfg(windows)]
    {
        if let Some(app_data) = std::env::var_os("APPDATA") {
            let base = PathBuf::from(app_data).join("npm");
            candidates.push(base.join(AURO_EXECUTABLE));
            candidates.push(base.join(AURO_CMD));
        }

        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            let base = PathBuf::from(&local_app_data);
            let npm = base.join("npm");
            candidates.push(npm.join(AURO_EXECUTABLE));
            candidates.push(npm.join(AURO_CMD));
            candidates.push(base.join("Auro").join(AURO_EXECUTABLE));
        }

        if let Some(home) = home_dir() {
            let scoop = home.join("scoop").join("shims");
            candidates.push(scoop.join(AURO_EXECUTABLE));
            candidates.push(scoop.join(AURO_CMD));
        }

        candidates
            .push(PathBuf::from("C:\\ProgramData\\chocolatey\\bin").join(AURO_EXECUTABLE));
        candidates.push(PathBuf::from("C:\\ProgramData\\chocolatey\\bin").join(AURO_CMD));
    }

    #[cfg(not(windows))]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin").join(AURO_EXECUTABLE));
        candidates.push(PathBuf::from("/usr/local/bin").join(AURO_EXECUTABLE));
        candidates.push(PathBuf::from("/usr/bin").join(AURO_EXECUTABLE));
        candidates.push(PathBuf::from("/usr/local/bin").join(AURO_EXECUTABLE));
    }

    candidates
}

pub(crate) fn resolve_auro_env_override() -> (Option<PathBuf>, Vec<String>) {
    let mut notes = Vec::new();

    if let Ok(custom) = std::env::var("AURO_BIN_PATH") {
        let custom = custom.trim();
        if !custom.is_empty() {
            let candidate = PathBuf::from(custom);
            if candidate.is_file() {
                notes.push(format!("Using AURO_BIN_PATH: {}", candidate.display()));
                return (Some(candidate), notes);
            }
            notes.push(format!(
                "AURO_BIN_PATH set but missing: {}",
                candidate.display()
            ));
        }
    }

    (None, notes)
}

fn resolve_auro_executable_impl(
    mut notes: Vec<String>,
) -> (Option<PathBuf>, bool, Vec<String>) {
    if let Some(path) = resolve_in_path(AURO_EXECUTABLE) {
        notes.push(format!("Found in PATH: {}", path.display()));
        return (Some(path), true, notes);
    }

    #[cfg(windows)]
    {
        if let Some(path) = resolve_in_path(AURO_CMD) {
            notes.push(format!("Found in PATH: {}", path.display()));
            return (Some(path), true, notes);
        }
    }

    notes.push("Not found on PATH".to_string());

    for candidate in candidate_auro_paths() {
        if candidate.is_file() {
            notes.push(format!("Found at {}", candidate.display()));
            return (Some(candidate), false, notes);
        }

        notes.push(format!("Missing: {}", candidate.display()));
    }

    (None, false, notes)
}

pub fn resolve_auro_executable() -> (Option<PathBuf>, bool, Vec<String>) {
    let (override_path, notes) = resolve_auro_env_override();
    if let Some(path) = override_path {
        return (Some(path), false, notes);
    }

    resolve_auro_executable_impl(notes)
}

pub(crate) fn resolve_auro_executable_without_override() -> (Option<PathBuf>, bool, Vec<String>)
{
    resolve_auro_executable_impl(Vec::new())
}
