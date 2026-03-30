use serde::Deserialize;
use serde::Serialize;
use serde_json::{json, Value};
use std::net::TcpListener;
use std::time::{Duration, Instant};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::State;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

use crate::orchestrator::manager::OrchestratorManager;
use crate::orchestrator::{resolve_orchestrator_data_dir, resolve_orchestrator_status};
use crate::types::{OrchestratorStatus, OrchestratorWorkspace};

const SANDBOX_PROGRESS_EVENT: &str = "aurowork://sandbox-create-progress";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorDetachedHost {
    pub aurowork_url: String,
    pub token: String,
    pub owner_token: Option<String>,
    pub host_token: String,
    pub port: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrchestratorWorkspaceResponse {
    pub workspace: OrchestratorWorkspace,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrchestratorDisposeResponse {
    pub disposed: bool,
}

fn resolve_data_dir(manager: &OrchestratorManager) -> String {
    manager
        .inner
        .lock()
        .ok()
        .and_then(|state| state.data_dir.clone())
        .unwrap_or_else(resolve_orchestrator_data_dir)
}

fn resolve_base_url(manager: &OrchestratorManager) -> Result<String, String> {
    let data_dir = resolve_data_dir(manager);
    let status = resolve_orchestrator_status(&data_dir, None);
    status
        .daemon
        .map(|daemon| daemon.base_url)
        .ok_or_else(|| "orchestrator daemon is not running".to_string())
}

fn allocate_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to allocate free port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read allocated port: {e}"))?
        .port();
    Ok(port)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn emit_sandbox_progress(
    app: &AppHandle,
    run_id: &str,
    stage: &str,
    message: &str,
    payload: serde_json::Value,
) {
    let at = now_ms();
    let elapsed = payload
        .get("elapsedMs")
        .and_then(|value| value.as_u64())
        .map(|value| format!("{value}ms"))
        .unwrap_or_else(|| "n/a".to_string());
    eprintln!(
        "[orchestrator-start][at={at}][runId={run_id}][stage={stage}][elapsed={elapsed}] {message}"
    );
    let event_payload = json!({
        "runId": run_id,
        "stage": stage,
        "message": message,
        "at": at,
        "payload": payload,
    });
    let _ = app.emit(SANDBOX_PROGRESS_EVENT, event_payload);
}

fn issue_owner_token(aurowork_url: &str, host_token: &str) -> Result<String, String> {
    let response = ureq::post(&format!("{}/tokens", aurowork_url.trim_end_matches('/')))
        .set("X-AuroWork-Host-Token", host_token)
        .set("Content-Type", "application/json")
        .send_string(r#"{"scope":"owner","label":"AuroWork detached owner token"}"#)
        .map_err(|err| err.to_string())?;

    let payload: Value = response
        .into_json()
        .map_err(|err| format!("Failed to parse owner token response: {err}"))?;

    payload
        .get("token")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "AuroWork server did not return an owner token".to_string())
}

#[tauri::command]
pub fn orchestrator_status(manager: State<OrchestratorManager>) -> OrchestratorStatus {
    let data_dir = resolve_data_dir(&manager);
    let last_error = manager
        .inner
        .lock()
        .ok()
        .and_then(|state| state.last_stderr.clone());
    resolve_orchestrator_status(&data_dir, last_error)
}

#[tauri::command]
pub fn orchestrator_workspace_activate(
    manager: State<OrchestratorManager>,
    workspace_path: String,
    name: Option<String>,
) -> Result<OrchestratorWorkspace, String> {
    let base_url = resolve_base_url(&manager)?;
    let add_url = format!("{}/workspaces", base_url.trim_end_matches('/'));
    let payload = json!({
        "path": workspace_path,
        "name": name,
    });

    let add_response = ureq::post(&add_url)
        .set("Content-Type", "application/json")
        .send_json(payload)
        .map_err(|e| format!("Failed to add workspace: {e}"))?;
    let added: OrchestratorWorkspaceResponse = add_response
        .into_json()
        .map_err(|e| format!("Failed to parse orchestrator response: {e}"))?;

    let id = added.workspace.id.clone();
    let activate_url = format!(
        "{}/workspaces/{}/activate",
        base_url.trim_end_matches('/'),
        id
    );
    ureq::post(&activate_url)
        .set("Content-Type", "application/json")
        .send_string("")
        .map_err(|e| format!("Failed to activate workspace: {e}"))?;

    let path_url = format!("{}/workspaces/{}/path", base_url.trim_end_matches('/'), id);
    let _ = ureq::get(&path_url).call();

    Ok(added.workspace)
}

#[tauri::command]
pub fn orchestrator_instance_dispose(
    manager: State<OrchestratorManager>,
    workspace_path: String,
) -> Result<bool, String> {
    let base_url = resolve_base_url(&manager)?;
    let add_url = format!("{}/workspaces", base_url.trim_end_matches('/'));
    let payload = json!({
        "path": workspace_path,
    });

    let add_response = ureq::post(&add_url)
        .set("Content-Type", "application/json")
        .send_json(payload)
        .map_err(|e| format!("Failed to ensure workspace: {e}"))?;
    let added: OrchestratorWorkspaceResponse = add_response
        .into_json()
        .map_err(|e| format!("Failed to parse orchestrator response: {e}"))?;

    let id = added.workspace.id;
    let dispose_url = format!(
        "{}/instances/{}/dispose",
        base_url.trim_end_matches('/'),
        id
    );
    let response = ureq::post(&dispose_url)
        .set("Content-Type", "application/json")
        .send_string("")
        .map_err(|e| format!("Failed to dispose instance: {e}"))?;
    let result: OrchestratorDisposeResponse = response
        .into_json()
        .map_err(|e| format!("Failed to parse orchestrator response: {e}"))?;

    Ok(result.disposed)
}

#[tauri::command]
pub fn orchestrator_start_detached(
    app: AppHandle,
    workspace_path: String,
    run_id: Option<String>,
    aurowork_token: Option<String>,
    aurowork_host_token: Option<String>,
) -> Result<OrchestratorDetachedHost, String> {
    let start_ts = now_ms();
    let workspace_path = workspace_path.trim().to_string();
    if workspace_path.is_empty() {
        return Err("workspacePath is required".to_string());
    }

    let run_id_value = run_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    eprintln!(
        "[orchestrator-start][at={start_ts}][runId={}][stage=entry] workspacePath={}",
        run_id_value,
        workspace_path,
    );

    let port = allocate_free_port()?;
    let token = aurowork_token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let host_token = aurowork_host_token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let aurowork_url = format!("http://127.0.0.1:{port}");

    emit_sandbox_progress(
        &app,
        &run_id_value,
        "init",
        "Starting orchestrator...",
        json!({
            "workspacePath": workspace_path,
            "auroworkUrl": aurowork_url,
            "port": port,
        }),
    );

    let (command, command_label) = match app.shell().sidecar("aurowork-orchestrator") {
        Ok(command) => (command, "sidecar:aurowork-orchestrator".to_string()),
        Err(_) => (app.shell().command("aurowork"), "path:aurowork".to_string()),
    };

    // Start a dedicated host stack for this workspace.
    // We pass explicit tokens and a free port so the UI can connect deterministically.
    {
        let args: Vec<String> = vec![
            "start".to_string(),
            "--workspace".to_string(),
            workspace_path.clone(),
            "--approval".to_string(),
            "auto".to_string(),
            "--detach".to_string(),
            "--aurowork-port".to_string(),
            port.to_string(),
            "--aurowork-token".to_string(),
            token.clone(),
            "--aurowork-host-token".to_string(),
            host_token.clone(),
            "--run-id".to_string(),
            run_id_value.clone(),
        ];

        // Convert to &str for the shell command builder.
        let mut str_args: Vec<&str> = Vec::with_capacity(args.len());
        for arg in &args {
            str_args.push(arg.as_str());
        }

        emit_sandbox_progress(
            &app,
            &run_id_value,
            "spawn.config",
            "Launching orchestrator host...",
            json!({
                "command": command_label,
                "args": args,
            }),
        );

        if let Err(err) = command.args(str_args).spawn() {
            emit_sandbox_progress(
                &app,
                &run_id_value,
                "spawn.error",
                "Failed to launch orchestrator host.",
                json!({
                    "error": err.to_string(),
                    "command": command_label,
                }),
            );
            return Err(format!("Failed to start aurowork orchestrator: {err}"));
        }
        eprintln!(
            "[orchestrator-start][at={}][runId={}][stage=spawn] launched aurowork sidecar for detached host",
            now_ms(),
            run_id_value
        );
    }

    emit_sandbox_progress(
        &app,
        &run_id_value,
        "spawned",
        "Orchestrator process launched. Waiting for AuroWork server...",
        json!({
            "auroworkUrl": aurowork_url,
        }),
    );

    let health_timeout_ms: u64 = 12_000;
    let start = Instant::now();
    let mut last_tick = Instant::now() - Duration::from_secs(5);
    let mut last_error: Option<String> = None;

    while start.elapsed() < Duration::from_millis(health_timeout_ms) {
        let elapsed_ms = start.elapsed().as_millis() as u64;

        match ureq::get(&format!("{}/health", aurowork_url.trim_end_matches('/'))).call() {
            Ok(response) if response.status() >= 200 && response.status() < 300 => {
                emit_sandbox_progress(
                    &app,
                    &run_id_value,
                    "aurowork.healthy",
                    "AuroWork server is ready.",
                    json!({
                        "auroworkUrl": aurowork_url,
                        "elapsedMs": elapsed_ms,
                    }),
                );
                last_error = None;
                break;
            }
            Ok(response) => {
                last_error = Some(format!("HTTP {}", response.status()));
            }
            Err(err) => {
                last_error = Some(err.to_string());
            }
        }

        if last_tick.elapsed() > Duration::from_millis(850) {
            last_tick = Instant::now();
            emit_sandbox_progress(
                &app,
                &run_id_value,
                "aurowork.waiting",
                "Waiting for AuroWork server...",
                json!({
                    "auroworkUrl": aurowork_url,
                    "elapsedMs": elapsed_ms,
                    "lastError": last_error,
                }),
            );
        }

        std::thread::sleep(Duration::from_millis(200));
    }

    if start.elapsed() >= Duration::from_millis(health_timeout_ms) {
        let elapsed_ms = start.elapsed().as_millis() as u64;
        let message = format!(
            "Timed out waiting for AuroWork server (elapsed_ms={elapsed_ms}, url={aurowork_url}, last_error={})",
            last_error.as_deref().unwrap_or("none")
        );
        emit_sandbox_progress(
            &app,
            &run_id_value,
            "error",
            "Orchestrator failed to start.",
            json!({
                "error": message,
                "elapsedMs": elapsed_ms,
                "auroworkUrl": aurowork_url,
            }),
        );
        eprintln!(
            "[orchestrator-start][at={}][runId={}][stage=timeout] health wait timed out after {}ms error={}",
            now_ms(),
            run_id_value,
            elapsed_ms,
            message
        );
        return Err(message);
    }

    eprintln!(
        "[orchestrator-start][at={}][runId={}][stage=complete] detached host ready in {}ms url={}",
        now_ms(),
        run_id_value,
        start.elapsed().as_millis(),
        aurowork_url
    );

    let owner_token = issue_owner_token(&aurowork_url, &host_token).ok();

    Ok(OrchestratorDetachedHost {
        aurowork_url,
        token,
        owner_token,
        host_token,
        port,
    })
}
