mod aurowork_server;
mod bun_env;
mod commands;
mod config;
mod dev_mode;
mod diagnostic_flag;
mod launch_log;
mod engine;
mod fs;
mod opkg;
mod orchestrator;
mod paths;
mod platform;
mod types;
mod updater;
mod utils;
mod workspace;

pub use types::*;

use aurowork_server::manager::AuroworkServerManager;
use commands::aurowork_server::{aurowork_server_info, aurowork_server_restart};
use commands::command_files::{auro_command_delete, auro_command_list, auro_command_write};
use commands::config::{read_auro_config, write_auro_config};
use commands::debug_log::{debug_log_append, debug_log_clear};
use commands::launch_log::{
    arm_launch_diagnostic, dev_mode_info, launch_diagnostic_status, launch_log_append,
    launch_log_append_batch, launch_log_path, launch_log_summary, open_launch_log_folder,
};
use commands::engine::{
    engine_doctor, engine_info, engine_install, engine_restart, engine_start, engine_stop,
};
use commands::fs::{fs_close_file, fs_read_dir, fs_read_file, fs_write_file};
use commands::misc::{
    app_build_info, auro_db_migrate, auro_mcp_auth, nuke_aurowork_and_auro_config_and_exit,
    reset_auro_cache, reset_aurowork_state,
};
use commands::opkg::{import_skill, opkg_install};
use commands::orchestrator::{
    orchestrator_instance_dispose, orchestrator_start_detached, orchestrator_status,
    orchestrator_workspace_activate,
};
use commands::skills::{list_local_skills, read_local_skill, uninstall_skill, write_local_skill};
use commands::spreadsheet::WorkbookCache;
use commands::updater::updater_environment;
use commands::window::set_window_decorations;
use commands::workspace::{
    workspace_add_authorized_root, workspace_aurowork_read, workspace_aurowork_write,
    workspace_bootstrap, workspace_check_folder, workspace_create, workspace_create_remote,
    workspace_export_config, workspace_forget, workspace_import_config, workspace_register,
    workspace_set_active, workspace_set_runtime_active, workspace_set_selected,
    workspace_update_display_name, workspace_update_remote,
};
use engine::manager::EngineManager;
use launch_log::format::Level;
use launch_log::LaunchLogAggregator;
use orchestrator::manager::OrchestratorManager;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use workspace::watch::WorkspaceWatchState;

const NATIVE_DEEP_LINK_EVENT: &str = "aurowork:deep-link-native";

#[cfg(target_os = "macos")]
fn set_dev_app_name() {
    if !crate::dev_mode::is_enabled() {
        return;
    }

    let Some(_mtm) = objc2::MainThreadMarker::new() else {
        return;
    };

    objc2_foundation::NSProcessInfo::processInfo()
        .setProcessName(&objc2_foundation::NSString::from_str("AuroWork - Dev"));
}

#[cfg(not(target_os = "macos"))]
fn set_dev_app_name() {}

fn forwarded_deep_links(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter_map(|arg| {
            let trimmed = arg.trim();
            if trimmed.starts_with("aurowork://")
                || trimmed.starts_with("aurowork-dev://")
                || trimmed.starts_with("https://")
                || trimmed.starts_with("http://")
            {
                Some(trimmed.to_string())
            } else {
                None
            }
        })
        .collect()
}

fn emit_native_deep_links(app_handle: &AppHandle, urls: Vec<String>) {
    if urls.is_empty() {
        return;
    }

    let _ = app_handle.emit(NATIVE_DEEP_LINK_EVENT, urls);
}

fn emit_forwarded_deep_links(app_handle: &AppHandle, args: &[String]) {
    let urls = forwarded_deep_links(args);
    emit_native_deep_links(app_handle, urls);
}

fn show_main_window(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[allow(unused)]
fn hide_main_window(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn stop_managed_services(app_handle: &tauri::AppHandle) {
    if let Some(agg) = app_handle.try_state::<LaunchLogAggregator>() {
        agg.append(
            Level::Info,
            "launch:shell",
            Some(std::process::id()),
            "shutdown requested, stopping managed services",
            None,
        );
    }
    if let Ok(mut engine) = app_handle.state::<EngineManager>().inner.lock() {
        EngineManager::stop_locked(&mut engine);
    }
    if let Ok(mut orchestrator) = app_handle.state::<OrchestratorManager>().inner.lock() {
        OrchestratorManager::stop_locked(&mut orchestrator);
    }
    if let Ok(mut aurowork_server) = app_handle.state::<AuroworkServerManager>().inner.lock() {
        AuroworkServerManager::stop_locked(&mut aurowork_server);
    }
}

pub fn run() {
    // Dev mode: ensure backtraces are captured by default + capture panics into launch log.
    if dev_mode::is_enabled() {
        if std::env::var_os("RUST_BACKTRACE").is_none() {
            std::env::set_var("RUST_BACKTRACE", "1");
        }
    }
    launch_log::install_panic_hook();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main_window(app);
            emit_forwarded_deep_links(app, &args);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    let app = builder
        .setup(|app| {
            set_dev_app_name();

            // One-shot diagnostic flag: take + delete it so the NEXT launch
            // is back to normal. The launch log is enabled if either
            // dev mode is on, OR a diagnostic was armed before restart.
            let diagnostic_armed = app
                .path()
                .app_data_dir()
                .ok()
                .map(|dir| crate::diagnostic_flag::take(&dir))
                .unwrap_or(false);
            let log_enabled = dev_mode::is_enabled() || diagnostic_armed;

            let aggregator = LaunchLogAggregator::default();
            if let Ok(log_dir) = app.path().app_log_dir() {
                let app_version = env!("CARGO_PKG_VERSION");
                let auro_version = option_env!("AUROWORK_AURO_VERSION").unwrap_or("unknown");
                let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
                aggregator.init(&log_dir, app_version, auro_version, &platform, log_enabled);
            }
            aggregator.append(
                Level::Info,
                "launch:shell",
                Some(std::process::id()),
                &format!(
                    "aurowork desktop starting, version={}, dev_mode={}, diagnostic_armed={}",
                    env!("CARGO_PKG_VERSION"),
                    dev_mode::is_enabled(),
                    diagnostic_armed,
                ),
                None,
            );
            app.manage(aggregator.clone());
            app.manage(commands::launch_log::LaunchDiagnosticStatus {
                armed_on_startup: diagnostic_armed,
            });
            launch_log::install_global(aggregator);
            if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
                agg.append(
                    Level::Info,
                    "launch:shell",
                    Some(std::process::id()),
                    "tauri setup complete, awaiting first webview event",
                    None,
                );
            }
            Ok(())
        })
        .manage(EngineManager::default())
        .manage(OrchestratorManager::default())
        .manage(AuroworkServerManager::default())
        .manage(WorkspaceWatchState::default())
        .manage(WorkbookCache::default())
        .invoke_handler(tauri::generate_handler![
            engine_start,
            engine_stop,
            engine_info,
            engine_doctor,
            engine_install,
            engine_restart,
            orchestrator_status,
            orchestrator_workspace_activate,
            orchestrator_instance_dispose,
            orchestrator_start_detached,
            aurowork_server_info,
            aurowork_server_restart,
            workspace_bootstrap,
            workspace_set_selected,
            workspace_set_runtime_active,
            workspace_set_active,
            workspace_check_folder,
            workspace_create,
            workspace_create_remote,
            workspace_register,
            workspace_update_display_name,
            workspace_update_remote,
            workspace_forget,
            workspace_add_authorized_root,
            workspace_export_config,
            workspace_import_config,
            auro_command_list,
            auro_command_write,
            auro_command_delete,
            workspace_aurowork_read,
            workspace_aurowork_write,
            opkg_install,
            import_skill,
            list_local_skills,
            read_local_skill,
            uninstall_skill,
            write_local_skill,
            read_auro_config,
            write_auro_config,
            updater_environment,
            app_build_info,
            nuke_aurowork_and_auro_config_and_exit,
            reset_aurowork_state,
            reset_auro_cache,
            auro_db_migrate,
            auro_mcp_auth,
            set_window_decorations,
            debug_log_append,
            debug_log_clear,
            fs_read_dir,
            fs_read_file,
            fs_write_file,
            fs_close_file,
            launch_log_append,
            launch_log_append_batch,
            launch_log_path,
            launch_log_summary,
            dev_mode_info,
            open_launch_log_folder,
            arm_launch_diagnostic,
            launch_diagnostic_status
        ])
        .build(tauri::generate_context!())
        .expect("error while building AuroWork");

    // Best-effort cleanup on app exit. Without this, background sidecars can keep
    // running after the UI quits (especially during dev), leading to multiple
    // orchestrator/auro/aurowork-server processes and stale ports.
    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => stop_managed_services(app_handle),
        #[cfg(target_os = "macos")]
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            api.prevent_close();
            hide_main_window(&app_handle);
        }
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            let urls = urls
                .into_iter()
                .map(|url| url.to_string())
                .collect::<Vec<_>>();
            show_main_window(&app_handle);
            emit_native_deep_links(&app_handle, urls);
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                show_main_window(&app_handle);
            }
        }
        _ => {}
    });
}
