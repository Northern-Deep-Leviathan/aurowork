use tauri::{AppHandle, State};

use crate::aurowork_server::manager::AuroworkServerManager;
use crate::aurowork_server::start_aurowork_server;
use crate::engine::manager::EngineManager;
use crate::types::{AuroworkServerInfo, WorkspaceType};
use crate::workspace::state::load_workspace_state;

#[tauri::command]
pub fn aurowork_server_info(manager: State<AuroworkServerManager>) -> AuroworkServerInfo {
    let mut state = manager
        .inner
        .lock()
        .expect("aurowork server mutex poisoned");
    AuroworkServerManager::snapshot_locked(&mut state)
}

#[tauri::command]
pub fn aurowork_server_restart(
    app: AppHandle,
    manager: State<AuroworkServerManager>,
    engine_manager: State<EngineManager>,
    remote_access_enabled: Option<bool>,
) -> Result<AuroworkServerInfo, String> {
    let (workspace_paths, opencode_url, opencode_username, opencode_password) = {
        let engine = engine_manager
            .inner
            .lock()
            .map_err(|_| "engine mutex poisoned".to_string())?;
        let mut workspace_paths = Vec::new();
        if let Some(project_dir) = engine.project_dir.clone() {
            let trimmed = project_dir.trim().to_string();
            if !trimmed.is_empty() {
                workspace_paths.push(trimmed);
            }
        }
        (
            workspace_paths,
            engine.base_url.clone(),
            engine.opencode_username.clone(),
            engine.opencode_password.clone(),
        )
    };

    let mut workspace_paths = workspace_paths;
    if workspace_paths.is_empty() {
        let state = load_workspace_state(&app)?;
        for workspace in state.workspaces {
            if workspace.workspace_type != WorkspaceType::Local {
                continue;
            }
            let trimmed = workspace.path.trim().to_string();
            if trimmed.is_empty() || workspace_paths.iter().any(|path| path == &trimmed) {
                continue;
            }
            workspace_paths.push(trimmed);
        }
    }

    start_aurowork_server(
        &app,
        &manager,
        &workspace_paths,
        opencode_url.as_deref(),
        opencode_username.as_deref(),
        opencode_password.as_deref(),
        remote_access_enabled.unwrap_or(false),
    )
}
