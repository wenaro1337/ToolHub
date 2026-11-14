use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::chatgpt::{self, ChatGptInfo, ChatGptResetResult};
use crate::claude::{self, ClaudeCodeInfo, ClaudeNetworkAudit, ClaudeProfileResult, ClaudeResetResult};
use crate::media::{self, AppState, MediaTaskParams, RunTaskResponse, TaskStatus};
use crate::system::{self, HwidRegenResult, SystemSpecs};
use crate::uninstaller::{self, CleanLeftoversResult, InstalledApp, LeftoverItem, UninstallExecutionResult};

#[tauri::command]
pub async fn get_system_specs() -> Result<SystemSpecs, String> {
    Ok(system::get_system_specs())
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemSpecs, String> {
    Ok(system::get_system_specs())
}

#[tauri::command]
pub async fn open_win_tool(tool: String) -> Result<(), String> {
    system::open_win_tool(&tool)
}

#[tauri::command]
pub async fn regenerate_hwid() -> Result<HwidRegenResult, String> {
    Ok(system::regenerate_hwid())
}

#[tauri::command]
pub async fn get_claude_code_info() -> Result<ClaudeCodeInfo, String> {
    Ok(claude::get_claude_code_info())
}

#[tauri::command]
pub async fn get_claude_info() -> Result<ClaudeCodeInfo, String> {
    Ok(claude::get_claude_code_info())
}

#[tauri::command]
pub async fn reset_claude_code() -> Result<ClaudeResetResult, String> {
    Ok(claude::reset_claude_code())
}

#[tauri::command]
pub async fn open_claude_folder() -> Result<(), String> {
    claude::open_claude_folder()
}

#[tauri::command]
pub async fn audit_claude_network() -> Result<ClaudeNetworkAudit, String> {
    claude::audit_claude_network()
}

#[tauri::command]
pub async fn generate_claude_profile(profile_name: String, target_tz: Option<String>) -> Result<ClaudeProfileResult, String> {
    claude::generate_claude_profile(profile_name, target_tz)
}

#[tauri::command]
pub async fn sync_system_timezone(iana_tz: String) -> Result<String, String> {
    claude::sync_system_timezone(iana_tz)
}

#[tauri::command]
pub async fn restore_system_timezone() -> Result<String, String> {
    claude::restore_system_timezone()
}

#[tauri::command]
pub async fn get_current_system_timezone() -> Result<String, String> {
    Ok(claude::get_current_system_timezone())
}

#[tauri::command]
pub async fn test_custom_proxy(proxy_url: String) -> Result<ClaudeNetworkAudit, String> {
    claude::test_custom_proxy(proxy_url)
}

#[tauri::command]
pub async fn get_chatgpt_info() -> Result<ChatGptInfo, String> {
    Ok(chatgpt::get_chatgpt_info())
}

#[tauri::command]
pub async fn reset_chatgpt_session() -> Result<ChatGptResetResult, String> {
    Ok(chatgpt::reset_chatgpt_session())
}

#[tauri::command]
pub async fn open_chatgpt_folder() -> Result<(), String> {
    chatgpt::open_chatgpt_folder()
}

#[tauri::command]
pub async fn run_media_task(
    app: AppHandle,
    state: State<'_, AppState>,
    params: MediaTaskParams,
) -> Result<RunTaskResponse, String> {
    let job_id = format!("job_{}", &Uuid::new_v4().simple().to_string()[..8]);

    let initial_status = TaskStatus {
        job_id: job_id.clone(),
        tool: params.tool.clone(),
        status: "running".to_string(),
        logs: vec![format!("[*] Инициализирована задача #{} [{}]", job_id, params.tool)],
        result_path: None,
        scrubbed_manifests: 0,
    };

    if let Ok(mut map) = state.jobs.lock() {
        map.insert(job_id.clone(), initial_status);
    }

    media::spawn_media_task(Some(app), state.jobs.clone(), job_id.clone(), params);

    Ok(RunTaskResponse { job_id })
}

#[tauri::command]
pub async fn run_tool(
    app: AppHandle,
    state: State<'_, AppState>,
    params: MediaTaskParams,
) -> Result<RunTaskResponse, String> {
    run_media_task(app, state, params).await
}

#[tauri::command]
pub async fn get_task_status(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<Option<TaskStatus>, String> {
    if let Ok(map) = state.jobs.lock() {
        Ok(map.get(&job_id).cloned())
    } else {
        Err("Не удалось заблокировать хранилище задач".to_string())
    }
}

#[tauri::command]
pub async fn get_status(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<Option<TaskStatus>, String> {
    get_task_status(state, job_id).await
}

#[tauri::command]
pub async fn open_output_dir() -> Result<(), String> {
    media::open_output_dir()
}

#[tauri::command]
pub async fn open_output() -> Result<(), String> {
    media::open_output_dir()
}

#[tauri::command]
pub fn log_from_js(msg: String) {
    let log_path = crate::local_log_path("frontend_debug.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
        use std::io::Write;
        let _ = writeln!(f, "[{}] {}", chrono::Local::now().format("%H:%M:%S%.3f"), msg);
    }
}

#[tauri::command]
pub async fn get_autostart_status() -> Result<bool, String> {
    Ok(system::get_autostart_status())
}

#[tauri::command]
pub async fn set_autostart(enabled: bool) -> Result<bool, String> {
    system::set_autostart(enabled)
}

#[tauri::command]
pub async fn get_cache_size() -> Result<String, String> {
    Ok(system::get_cache_size())
}

#[tauri::command]
pub async fn clear_app_cache() -> Result<usize, String> {
    system::clear_app_cache()
}

#[tauri::command]
pub async fn set_always_on_top(window: tauri::Window, enabled: bool) -> Result<(), String> {
    window.set_always_on_top(enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_keep_awake_status() -> Result<system::KeepAwakeStatus, String> {
    Ok(system::get_keep_awake_status())
}

#[tauri::command]
pub async fn set_keep_awake(mode: String) -> Result<system::KeepAwakeStatus, String> {
    system::set_keep_awake(&mode)
}

#[tauri::command]
pub async fn get_listening_ports() -> Result<Vec<system::PortEntry>, String> {
    system::get_listening_ports()
}

#[tauri::command]
pub async fn kill_process_by_pid(pid: u32) -> Result<(), String> {
    system::kill_process_by_pid(pid)
}

#[tauri::command]
pub async fn pick_screen_color_at_cursor() -> Result<system::ScreenPixelColor, String> {
    system::pick_screen_color_at_cursor()
}

use tauri_plugin_updater::UpdaterExt;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct UpdateCheckInfo {
    pub available: bool,
    pub current_version: String,
    pub version: String,
    pub body: Option<String>,
    pub date: Option<String>,
}

#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<UpdateCheckInfo, String> {
    let updater = app.updater().map_err(|e| format!("Не удалось инициализировать апдейтер: {}", e))?;
    match updater.check().await {
        Ok(Some(update)) => {
            Ok(UpdateCheckInfo {
                available: true,
                current_version: update.current_version.clone(),
                version: update.version.clone(),
                body: update.body.clone(),
                date: update.date.map(|d| d.to_string()),
            })
        }
        Ok(None) => {
            Ok(UpdateCheckInfo {
                available: false,
                current_version: app.package_info().version.to_string(),
                version: String::new(),
                body: None,
                date: None,
            })
        }
        Err(e) => Err(format!("Ошибка проверки обновлений: {}", e)),
    }
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<String, String> {
    let updater = app.updater().map_err(|e| format!("Не удалось инициализировать апдейтер: {}", e))?;
    if let Some(update) = updater.check().await.map_err(|e| format!("Ошибка проверки: {}", e))? {
        let version = update.version.clone();
        update.download_and_install(|_chunk, _total| {}, || {}).await.map_err(|e| format!("Ошибка установки: {}", e))?;
        Ok(format!("Обновление до версии {} успешно загружено и установлено! Перезапустите ToolHub.", version))
    } else {
        Ok("У вас уже установлена самая актуальная версия.".to_string())
    }
}

use crate::killswitch::{self, KillSwitchStatus};

#[tauri::command]
pub async fn get_killswitch_status() -> Result<KillSwitchStatus, String> {
    Ok(killswitch::get_killswitch_status())
}

#[tauri::command]
pub async fn set_killswitch_enabled(enabled: bool) -> Result<KillSwitchStatus, String> {
    Ok(killswitch::set_killswitch_enabled(enabled))
}

#[tauri::command]
pub async fn set_allowed_ips(ips: Vec<String>) -> Result<KillSwitchStatus, String> {
    Ok(killswitch::set_allowed_ips(ips))
}

#[tauri::command]
pub async fn set_killswitch_strict_mode(strict: bool) -> Result<KillSwitchStatus, String> {
    Ok(killswitch::set_strict_mode(strict))
}

#[tauri::command]
pub async fn is_running_as_admin() -> Result<bool, String> {
    Ok(killswitch::is_running_as_admin())
}

#[tauri::command]
pub async fn restart_as_admin() -> Result<(), String> {
    killswitch::restart_as_admin()
}

#[tauri::command]
pub async fn set_priority_autostart(enabled: bool) -> Result<bool, String> {
    system::set_priority_autostart(enabled)
}

#[tauri::command]
pub async fn is_priority_autostart_active() -> Result<bool, String> {
    Ok(system::is_priority_autostart_active())
}

#[tauri::command]
pub async fn safe_launch_claude(launch_type: String, profile_name: Option<String>) -> Result<String, String> {
    killswitch::safe_launch_claude(&launch_type, profile_name)
}

#[tauri::command]
pub async fn set_persistent_firewall(enabled: bool) -> Result<KillSwitchStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        killswitch::set_persistent_firewall(enabled)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_ifeo_guard(enabled: bool) -> Result<KillSwitchStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        killswitch::set_ifeo_guard(enabled)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_installed_apps() -> Result<Vec<InstalledApp>, String> {
    tauri::async_runtime::spawn_blocking(uninstaller::get_installed_apps)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn uninstall_app(app_id: String, silent: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let all_apps = uninstaller::get_installed_apps();
        if let Some(app) = all_apps.into_iter().find(|a| a.id == app_id) {
            uninstaller::run_uninstall(&app, silent)
        } else {
            Err("Приложение не найдено в списке установленных".to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn batch_uninstall(app_ids: Vec<String>, silent: bool, clean_leftovers: bool) -> Result<Vec<UninstallExecutionResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        uninstaller::run_batch_uninstall(app_ids, silent, clean_leftovers)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scan_app_leftovers(app_name: String, install_location: String) -> Result<Vec<LeftoverItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        uninstaller::scan_leftovers(&app_name, &install_location)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clean_app_leftovers(paths: Vec<String>) -> Result<CleanLeftoversResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        uninstaller::clean_leftovers(paths)
    })
    .await
    .map_err(|e| e.to_string())
}





#[tauri::command]
pub fn list_claude_profiles() -> Result<Vec<String>, String> {
    claude::list_claude_profiles()
}

#[tauri::command]
pub fn reset_claude_profile(name: String) -> Result<(), String> {
    claude::reset_claude_profile(name)
}
