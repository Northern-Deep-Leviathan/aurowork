use std::fs;
use std::path::PathBuf;

use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::paths::home_dir;
use crate::types::{WorkspaceState, WORKSPACE_STATE_VERSION};

pub fn stable_workspace_id(path: &str) -> String {
    let digest = Sha256::digest(path.as_bytes());
    let hex = format!("{:x}", digest);
    format!("ws_{}", &hex[..12])
}

pub fn normalize_local_workspace_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let expanded = if trimmed == "~" {
        home_dir().unwrap_or_else(|| PathBuf::from(trimmed))
    } else if trimmed.starts_with("~/") || trimmed.starts_with("~\\") {
        if let Some(home) = home_dir() {
            let suffix = trimmed[2..].trim_start_matches(['/', '\\']);
            home.join(suffix)
        } else {
            PathBuf::from(trimmed)
        }
    } else {
        PathBuf::from(trimmed)
    };

    let normalized = dunce::canonicalize(&expanded).unwrap_or(expanded);
    normalized.to_string_lossy().to_string()
}

pub fn aurowork_state_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let file_path = data_dir.join("aurowork-workspaces.json");
    Ok((data_dir, file_path))
}

pub fn repair_workspace_state(state: &mut WorkspaceState) {
    let mut changed_ids = false;
    let old_selected_workspace_id = state.selected_workspace_id.clone();
    let old_watched_workspace_id = state.watched_workspace_id.clone();
    for workspace in state.workspaces.iter_mut() {
        let normalized = normalize_local_workspace_path(&workspace.path);
        if !normalized.is_empty() {
            workspace.path = normalized;
        }
        let next_id = stable_workspace_id(&workspace.path);

        if workspace.id != next_id {
            if old_selected_workspace_id == workspace.id {
                state.selected_workspace_id = next_id.clone();
            }
            if old_watched_workspace_id == workspace.id {
                state.watched_workspace_id = next_id.clone();
            }
            workspace.id = next_id;
            changed_ids = true;
        }
    }

    if state.version < WORKSPACE_STATE_VERSION {
        state.version = WORKSPACE_STATE_VERSION;
    }

    if changed_ids && state.selected_workspace_id.is_empty() {
        state.selected_workspace_id = state
            .workspaces
            .first()
            .map(|workspace| workspace.id.clone())
            .unwrap_or_default();
    }

    if !state.watched_workspace_id.is_empty()
        && !state
            .workspaces
            .iter()
            .any(|workspace| workspace.id == state.watched_workspace_id)
    {
        state.watched_workspace_id.clear();
    }

    if state.watched_workspace_id.is_empty() {
        state.watched_workspace_id = state.selected_workspace_id.clone();
    }
}

pub fn load_workspace_state(app: &tauri::AppHandle) -> Result<WorkspaceState, String> {
    let (_, path) = aurowork_state_paths(app)?;
    if !path.exists() {
        return Ok(WorkspaceState::default());
    }

    let raw =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let sanitized = drop_legacy_remote_workspaces(&raw)?;
    let mut state: WorkspaceState = serde_json::from_str(&sanitized)
        .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;
    repair_workspace_state(&mut state);

    Ok(state)
}

/// Legacy `aurowork-workspaces.json` files may contain workspace entries with
/// `"workspaceType":"remote"`. The remote workspace model has been removed, so
/// those entries can no longer be deserialized into `WorkspaceInfo`. Drop them
/// at the `serde_json::Value` level before typed deserialization so upgrading
/// over an old state file loads cleanly instead of failing outright.
fn drop_legacy_remote_workspaces(raw: &str) -> Result<String, String> {
    let mut value: serde_json::Value = match serde_json::from_str(raw) {
        Ok(value) => value,
        // Not valid JSON at all: hand the original text to the typed parser so
        // it produces the canonical parse error.
        Err(_) => return Ok(raw.to_string()),
    };

    if let Some(workspaces) = value
        .get_mut("workspaces")
        .and_then(|entry| entry.as_array_mut())
    {
        workspaces.retain(|workspace| {
            workspace
                .get("workspaceType")
                .and_then(|kind| kind.as_str())
                .map(|kind| kind != "remote")
                .unwrap_or(true)
        });
    }

    serde_json::to_string(&value).map_err(|e| e.to_string())
}

pub fn save_workspace_state(app: &tauri::AppHandle, state: &WorkspaceState) -> Result<(), String> {
    let (dir, path) = aurowork_state_paths(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    fs::write(
        &path,
        serde_json::to_string_pretty(state).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        drop_legacy_remote_workspaces, normalize_local_workspace_path, repair_workspace_state,
        stable_workspace_id,
    };
    use crate::types::{WorkspaceInfo, WorkspaceState, WorkspaceType};
    use std::fs;

    #[test]
    fn drop_legacy_remote_workspaces_removes_remote_entries_and_loads() {
        let raw = r#"{
            "version": 4,
            "selectedWorkspaceId": "ws_local",
            "watchedWorkspaceId": "ws_local",
            "workspaces": [
                { "id": "ws_local", "name": "Local", "path": "/tmp/local", "preset": "starter", "workspaceType": "local" },
                { "id": "ws_remote", "name": "Remote", "path": "", "preset": "remote", "workspaceType": "remote", "baseUrl": "http://example.com" }
            ]
        }"#;

        let sanitized = drop_legacy_remote_workspaces(raw).expect("sanitize");
        let state: WorkspaceState = serde_json::from_str(&sanitized).expect("deserialize");

        assert_eq!(state.workspaces.len(), 1);
        assert_eq!(state.workspaces[0].id, "ws_local");
        assert!(state
            .workspaces
            .iter()
            .all(|workspace| workspace.workspace_type == WorkspaceType::Local));
    }

    #[test]
    fn drop_legacy_remote_workspaces_passes_through_non_json() {
        let raw = "not json";
        assert_eq!(drop_legacy_remote_workspaces(raw).expect("passthrough"), raw);
    }

    #[test]
    fn normalize_local_workspace_path_expands_home_prefix() {
        let home = crate::paths::home_dir().expect("home dir");
        let expected = home.join("AuroWork").join("aurowork-state-test-expand");
        let actual = normalize_local_workspace_path("~/AuroWork/aurowork-state-test-expand");
        assert_eq!(actual, expected.to_string_lossy());
    }

    #[test]
    fn normalize_local_workspace_path_keeps_canonical_id_stable() {
        let temp = std::env::temp_dir().join(format!(
            "aurowork-workspace-state-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let nested = temp.join("starter");
        fs::create_dir_all(&nested).expect("create temp workspace");

        let raw = format!("{}/../starter", nested.display());
        let normalized = normalize_local_workspace_path(&raw);

        let canonical = fs::canonicalize(&nested).expect("canonical starter workspace");
        assert_eq!(normalized, canonical.to_string_lossy());
        assert_eq!(
            stable_workspace_id(&normalized),
            stable_workspace_id(&canonical.to_string_lossy())
        );

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn repair_workspace_state_preserves_selected_and_watched_ids_independently() {
        let temp = std::env::temp_dir().join(format!(
            "aurowork-workspace-state-selected-watched-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let first = temp.join("first");
        let second = temp.join("second");
        fs::create_dir_all(&first).expect("create first workspace");
        fs::create_dir_all(&second).expect("create second workspace");

        let mut state = WorkspaceState {
            version: 1,
            selected_workspace_id: "selected-legacy".to_string(),
            watched_workspace_id: "watched-legacy".to_string(),
            workspaces: vec![
                WorkspaceInfo {
                    id: "selected-legacy".to_string(),
                    name: "First".to_string(),
                    path: first.to_string_lossy().to_string(),
                    preset: "starter".to_string(),
                    workspace_type: WorkspaceType::Local,
                    display_name: None,
                },
                WorkspaceInfo {
                    id: "watched-legacy".to_string(),
                    name: "Second".to_string(),
                    path: second.to_string_lossy().to_string(),
                    preset: "starter".to_string(),
                    workspace_type: WorkspaceType::Local,
                    display_name: None,
                },
            ],
        };

        repair_workspace_state(&mut state);

        assert_ne!(state.selected_workspace_id, state.watched_workspace_id);
        assert_eq!(state.selected_workspace_id, state.workspaces[0].id);
        assert_eq!(state.watched_workspace_id, state.workspaces[1].id);

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn repair_workspace_state_defaults_watched_id_to_selected_when_missing() {
        let temp = std::env::temp_dir().join(format!(
            "aurowork-workspace-state-default-watch-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let first = temp.join("first");
        fs::create_dir_all(&first).expect("create workspace");

        let mut state = WorkspaceState {
            version: 1,
            selected_workspace_id: "selected-legacy".to_string(),
            watched_workspace_id: "missing-legacy".to_string(),
            workspaces: vec![WorkspaceInfo {
                id: "selected-legacy".to_string(),
                name: "First".to_string(),
                path: first.to_string_lossy().to_string(),
                preset: "starter".to_string(),
                workspace_type: WorkspaceType::Local,
                display_name: None,
            }],
        };

        repair_workspace_state(&mut state);

        assert_eq!(state.watched_workspace_id, state.selected_workspace_id);

        let _ = fs::remove_dir_all(&temp);
    }
}
