use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use sysinfo::{ProcessesToUpdate, System};
use crate::system;

pub static KILLSWITCH_ENABLED: AtomicBool = AtomicBool::new(true);
pub static NETWORK_IS_SAFE: AtomicBool = AtomicBool::new(false);
pub static BLOCKED_ATTEMPTS: AtomicU32 = AtomicU32::new(0);

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KillSwitchEvent {
    pub process_name: String,
    pub pid: u32,
    pub timestamp: String,
    pub reason: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KillSwitchStatus {
    pub enabled: bool,
    pub network_safe: bool,
    pub status: String, // "blocked", "armed_safe", "disabled"
    pub status_text: String,
    pub blocked_count: u32,
    pub last_event: Option<KillSwitchEvent>,
    pub egress_ip: String,
    pub egress_country: String,
    pub claude_desktop_installed: bool,
    pub claude_desktop_path: Option<String>,
    pub is_admin: bool,
    pub allowed_ips: Vec<String>,
    pub ip_matches_whitelist: bool,
    pub priority_autostart_active: bool,
    pub strict_mode: bool,
    pub anti_ban_score: u32,
    pub split_tunnel_detected: bool,
    pub persistent_firewall: bool,
    pub ifeo_guard: bool,
}

fn default_strict() -> bool {
    true
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KillSwitchConfig {
    pub enabled: bool,
    pub allowed_ips: Vec<String>,
    #[serde(default = "default_strict")]
    pub strict_mode: bool,
    #[serde(default = "default_true")]
    pub persistent_firewall: bool,
    #[serde(default = "default_true")]
    pub ifeo_guard: bool,
}

impl Default for KillSwitchConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            allowed_ips: Vec::new(),
            strict_mode: true,
            persistent_firewall: true,
            ifeo_guard: false,
        }
    }
}

pub static STRICT_MODE: AtomicBool = AtomicBool::new(true);
pub static LAST_ANTI_BAN_SCORE: AtomicU32 = AtomicU32::new(0);
pub static LAST_SPLIT_TUNNEL: AtomicBool = AtomicBool::new(false);
pub static PERSISTENT_FIREWALL: AtomicBool = AtomicBool::new(true);
pub static IFEO_GUARD_ACTIVE: AtomicBool = AtomicBool::new(false);

static LAST_ALERT_PID: AtomicU32 = AtomicU32::new(0);
static LAST_ALERT_TIME: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

static LAST_EVENT: Mutex<Option<KillSwitchEvent>> = Mutex::new(None);
static LAST_EGRESS_IP: Mutex<String> = Mutex::new(String::new());
static LAST_EGRESS_COUNTRY: Mutex<String> = Mutex::new(String::new());
static ALLOWED_IPS: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn get_config_path() -> PathBuf {
    crate::claude::get_user_home().join(".toolhub").join("killswitch_config.json")
}

pub fn load_killswitch_config() {
    let path = get_config_path();
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<KillSwitchConfig>(&content) {
                KILLSWITCH_ENABLED.store(cfg.enabled, Ordering::SeqCst);
                STRICT_MODE.store(cfg.strict_mode, Ordering::SeqCst);
                PERSISTENT_FIREWALL.store(cfg.persistent_firewall, Ordering::SeqCst);
                IFEO_GUARD_ACTIVE.store(cfg.ifeo_guard, Ordering::SeqCst);
                if let Ok(mut lock) = ALLOWED_IPS.lock() {
                    *lock = cfg.allowed_ips;
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if IFEO_GUARD_ACTIVE.load(Ordering::SeqCst) {
            let result = if is_ifeo_guard_active() {
                set_packaged_claude_startup_block(true).and_then(|_| set_packaged_claude_execute_block("1"))
            } else {
                set_ifeo_guard(true).map(|_| ())
            };
            if let Err(error) = result {
                use std::io::Write;
                let path = crate::local_log_path("frontend_errors.log");
                if let Ok(mut log) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
                    let _ = writeln!(log, "[KILLSWITCH STARTUP] {error}");
                }
            }
        }
    }
}

pub fn save_killswitch_config(enabled: bool, allowed_ips: &[String], strict_mode: bool) {
    let pf = PERSISTENT_FIREWALL.load(Ordering::SeqCst);
    let ifeo = is_ifeo_guard_active();
    save_killswitch_config_full(enabled, allowed_ips, strict_mode, pf, ifeo);
}

pub fn save_killswitch_config_full(enabled: bool, allowed_ips: &[String], strict_mode: bool, persistent_firewall: bool, ifeo_guard: bool) {
    let path = get_config_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let cfg = KillSwitchConfig {
        enabled,
        allowed_ips: allowed_ips.to_vec(),
        strict_mode,
        persistent_firewall,
        ifeo_guard,
    };
    if let Ok(json) = serde_json::to_string_pretty(&cfg) {
        let _ = std::fs::write(&path, json);
    }
}

// Check if running with Administrator privileges on Windows
pub fn is_running_as_admin() -> bool {
    #[cfg(target_os = "windows")]
    {
        #[link(name = "shell32")]
        extern "system" {
            fn IsUserAnAdmin() -> i32;
        }
        unsafe { IsUserAnAdmin() != 0 }
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

// Request Windows UAC elevation and restart ToolHub as Administrator
pub fn restart_as_admin() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let current_exe = std::env::current_exe()
            .map_err(|e| format!("Не удалось определить путь к toolhub.exe: {}", e))?;
        let exe_str = current_exe.to_string_lossy().to_string();

        let ps_script = format!(
            "Start-Process -FilePath '{}' -Verb RunAs",
            exe_str.replace("'", "''")
        );

        let status = Command::new("powershell")
            .args(&["-WindowStyle", "Hidden", "-Command", &ps_script])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| format!("Не удалось запросить повышение привилегий: {}", e))?;

        if status.success() {
            Ok(())
        } else {
            Err("Запрос прав Администратора был отклонён пользователем или системой.".to_string())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Повышение прав доступно только в Windows".to_string())
    }
}

// Check if country is in restricted/sanctioned zone (Russia, Belarus, China, Iran, etc.)
pub fn is_country_restricted(country: &str) -> bool {
    let s = country.trim().to_lowercase();
    if s.is_empty() || s == "неизвестно" || s == "unknown" {
        return true;
    }
    s == "ru" || s == "russia" || s.contains("russian")
        || s == "by" || s == "belarus" || s.contains("belarus")
        || s == "cn" || s == "china" || s.contains("china")
        || s == "ir" || s == "iran" || s.contains("iran")
        || s == "kp" || s == "north korea" || s.contains("korea, democratic")
        || s == "sy" || s == "syria" || s.contains("syrian")
        || s == "cu" || s == "cuba"
        || s == "ve" || s == "venezuela"
        || s == "hk" || s == "hong kong"
        || s == "mo" || s == "macau" || s == "macao"
}

// Set allowed egress IP addresses (whitelist)
pub fn set_allowed_ips(ips: Vec<String>) -> KillSwitchStatus {
    let cleaned: Vec<String> = ips
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if let Ok(mut lock) = ALLOWED_IPS.lock() {
        *lock = cleaned.clone();
    }

    let enabled = KILLSWITCH_ENABLED.load(Ordering::SeqCst);
    let strict = STRICT_MODE.load(Ordering::SeqCst);
    save_killswitch_config(enabled, &cleaned, strict);

    if NETWORK_IS_SAFE.load(Ordering::SeqCst) {
        revoke_network_trust("Список доверенных IP изменился. Повторите аудит.");
    }

    get_killswitch_status()
}

// Toggle Strict Anti-Ban Matrix enforcement (block Claude if anti_ban_score < 80 or split tunnel detected)
pub fn set_strict_mode(strict: bool) -> KillSwitchStatus {
    STRICT_MODE.store(strict, Ordering::SeqCst);
    let enabled = KILLSWITCH_ENABLED.load(Ordering::SeqCst);
    let allowed_ips = ALLOWED_IPS.lock().map(|l| l.clone()).unwrap_or_default();
    save_killswitch_config(enabled, &allowed_ips, strict);

    if NETWORK_IS_SAFE.load(Ordering::SeqCst) {
        revoke_network_trust("Строгий режим изменился. Повторите аудит.");
    }

    get_killswitch_status()
}

// Detect if process is Claude Desktop, Claude CLI, or Anthropic helper (including cowork-svc)
pub fn is_claude_process(name: &str, cmd: &[std::ffi::OsString]) -> bool {
    let lower_name = name.to_lowercase();
    if lower_name.contains("toolhub") {
        return false;
    }
    if lower_name.contains("claude")
        || lower_name.contains("anthropic")
        || lower_name.contains("cowork")
        || lower_name == "cowork-svc.exe"
        || lower_name == "cowork-svc"
    {
        return true;
    }
    // Detect node.exe, electron.exe, or cmd.exe running Claude Code CLI / Claude Desktop helper
    if lower_name.starts_with("node") || lower_name.contains("electron") || lower_name == "cmd.exe" {
        let is_claude = cmd.iter().any(|arg| {
            let s = arg.to_string_lossy().to_lowercase();
            s.contains("claude")
                || s.contains("@anthropic-ai")
                || s.contains("cowork")
                || (s.contains("run_") && s.contains(".bat"))
        });
        if is_claude {
            return true;
        }
    }
    false
}

// Locate Claude Desktop executable on Windows (supports MSIX / Windows Store, AppModel, and ProgramFiles)
pub fn find_claude_desktop_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut candidates = Vec::new();

        // 1. Query HKCU AppModel for WindowsApps / MSIX package (e.g. Claude_4.29.0.0_x64__pzs8sxrjxfjjc)
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(packages_key) = hkcu.open_subkey("Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages") {
            for subkey_name in packages_key.enum_keys().flatten() {
                if subkey_name.to_lowercase().starts_with("claude_") {
                    if let Ok(pkg) = packages_key.open_subkey(&subkey_name) {
                        if let Ok(root_folder) = pkg.get_value::<String, _>("PackageRootFolder") {
                            let candidate = PathBuf::from(&root_folder).join("app").join("claude.exe");
                            if candidate.exists() {
                                candidates.push(candidate);
                            }
                        }
                    }
                }
            }
        }

        // 2. Check execution aliases in LOCALAPPDATA\Microsoft\WindowsApps
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let base = PathBuf::from(&local_app_data);
            candidates.push(base.join("Microsoft").join("WindowsApps").join("claude-desktop.exe"));
            candidates.push(base.join("Microsoft").join("WindowsApps").join("Claude_pzs8sxrjxfjjc").join("claude-desktop.exe"));
            candidates.push(base.join("Programs").join("Claude").join("Claude.exe"));
            candidates.push(base.join("AnthropicClaude").join("Claude.exe"));
            candidates.push(base.join("Claude").join("Claude.exe"));
        }
        if let Ok(app_data) = std::env::var("APPDATA") {
            let base = PathBuf::from(&app_data);
            candidates.push(base.join("Claude").join("Claude.exe"));
            candidates.push(base.join("Programs").join("Claude").join("Claude.exe"));
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            let base = PathBuf::from(&pf);
            candidates.push(base.join("Claude").join("Claude.exe"));
            candidates.push(base.join("AnthropicClaude").join("Claude.exe"));
        }
        for p in &candidates {
            if p.exists() {
                return Some(p.clone());
            }
        }
    }
    None
}

// Locate Claude Cowork background service executable on Windows
pub fn find_cowork_svc_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        if let Some(claude_exe) = find_claude_desktop_path() {
            if let Some(parent) = claude_exe.parent() {
                let cowork_candidate = parent.join("resources").join("cowork-svc.exe");
                if cowork_candidate.exists() {
                    return Some(cowork_candidate);
                }
            }
        }
    }
    None
}

// Atomic Kernel-Level Process Suspension & Immediate Obliteration (NtSuspendProcess + TerminateProcess)
// Prevents Claude from executing even a single instruction or TCP reconnect upon VPN collapse.
pub fn atomic_freeze_and_terminate(pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::c_void;

        #[link(name = "ntdll")]
        extern "system" {
            fn NtSuspendProcess(process_handle: *mut c_void) -> i32;
        }

        #[link(name = "kernel32")]
        extern "system" {
            fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> *mut c_void;
            fn TerminateProcess(handle: *mut c_void, exit_code: u32) -> i32;
            fn CloseHandle(handle: *mut c_void) -> i32;
        }

        const PROCESS_ALL_ACCESS: u32 = 0x001F0FFF;
        const PROCESS_SUSPEND_RESUME: u32 = 0x0800;
        const PROCESS_TERMINATE: u32 = 0x0001;

        if pid <= 4 {
            return false;
        }

        let handle = unsafe { OpenProcess(PROCESS_SUSPEND_RESUME | PROCESS_TERMINATE, 0, pid) };
        let handle = if handle.is_null() {
            unsafe { OpenProcess(PROCESS_ALL_ACCESS, 0, pid) }
        } else {
            handle
        };

        let mut success = false;
        if !handle.is_null() {
            unsafe {
                // 1. FREEZE PROCESS INSTANTLY IN RAM (sub-millisecond)
                // Claude's V8 engine and Chromium network loops are frozen mid-execution.
                // It CANNOT detect socket disconnect, cannot send error telemetry, cannot attempt reconnect.
                NtSuspendProcess(handle);

                // 2. OBLITERATE PROCESS
                let term = TerminateProcess(handle, 1);
                CloseHandle(handle);
                success = term != 0;
            }
        }

        if !success {
            // If process is a background service (like CoworkVMService), attempt graceful stop via SCM
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _ = Command::new("sc.exe")
                .args(&["stop", "CoworkVMService"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();

            success = system::kill_process_by_pid(pid).is_ok();
        }
        success
    }

    #[cfg(not(target_os = "windows"))]
    {
        system::kill_process_by_pid(pid).is_ok()
    }
}

// Windows Firewall Zero-Leak Armor management (covers both Claude and cowork-svc)
pub fn setup_firewall_armor() {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Clean up duplicate rules first
        let _ = Command::new("netsh")
            .args(&["advfirewall", "firewall", "delete", "rule", "name=ToolHub_Claude_ZeroLeak"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let _ = Command::new("netsh")
            .args(&["advfirewall", "firewall", "delete", "rule", "name=ToolHub_Claude_Cowork_ZeroLeak"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let initial_enable = if PERSISTENT_FIREWALL.load(Ordering::SeqCst) && !NETWORK_IS_SAFE.load(Ordering::SeqCst) {
            "enable=yes"
        } else {
            "enable=no"
        };

        if let Some(claude_path) = find_claude_desktop_path() {
            let path_str = claude_path.to_string_lossy().to_string();
            let _ = Command::new("netsh")
                .args(&[
                    "advfirewall", "firewall", "add", "rule",
                    "name=ToolHub_Claude_ZeroLeak",
                    "dir=out",
                    "action=block",
                    &format!("program={}", path_str),
                    initial_enable
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }

        if let Some(cowork_path) = find_cowork_svc_path() {
            let path_str = cowork_path.to_string_lossy().to_string();
            let _ = Command::new("netsh")
                .args(&[
                    "advfirewall", "firewall", "add", "rule",
                    "name=ToolHub_Claude_Cowork_ZeroLeak",
                    "dir=out",
                    "action=block",
                    &format!("program={}", path_str),
                    initial_enable
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
    }
}

pub fn enable_firewall_block_rule() {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("netsh")
            .args(&["advfirewall", "firewall", "set", "rule", "name=ToolHub_Claude_ZeroLeak", "new", "enable=yes"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let _ = Command::new("netsh")
            .args(&["advfirewall", "firewall", "set", "rule", "name=ToolHub_Claude_Cowork_ZeroLeak", "new", "enable=yes"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

pub fn disable_firewall_block_rule() {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("netsh")
            .args(&["advfirewall", "firewall", "set", "rule", "name=ToolHub_Claude_ZeroLeak", "new", "enable=no"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let _ = Command::new("netsh")
            .args(&["advfirewall", "firewall", "set", "rule", "name=ToolHub_Claude_Cowork_ZeroLeak", "new", "enable=no"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

pub fn set_persistent_firewall(enabled: bool) -> Result<KillSwitchStatus, String> {
    PERSISTENT_FIREWALL.store(enabled, Ordering::SeqCst);
    if enabled {
        setup_firewall_armor();
        if !NETWORK_IS_SAFE.load(Ordering::SeqCst) {
            enable_firewall_block_rule();
        }
    } else {
        disable_firewall_block_rule();
    }
    let ks_enabled = KILLSWITCH_ENABLED.load(Ordering::SeqCst);
    let allowed_ips = ALLOWED_IPS.lock().map(|l| l.clone()).unwrap_or_default();
    let strict = STRICT_MODE.load(Ordering::SeqCst);
    let ifeo = is_ifeo_guard_active();
    save_killswitch_config_full(ks_enabled, &allowed_ips, strict, enabled, ifeo);
    Ok(get_killswitch_status())
}

#[cfg(target_os = "windows")]
const IFEO_TARGETS: [&str; 3] = ["claude.exe", "claude-desktop.exe", "cowork-svc.exe"];

pub fn is_ifeo_guard_active() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let Ok(exe) = std::env::current_exe() else {
            return false;
        };
        let expected = format!("\"{}\" --blocked-by-ifeo", exe.display());
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        IFEO_TARGETS.iter().all(|target| {
            let path = format!(
                r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\{}",
                target
            );
            hklm.open_subkey_with_flags(path, KEY_READ | KEY_WOW64_64KEY)
                .and_then(|key| key.get_value::<String, _>("Debugger"))
                .is_ok_and(|value| value.eq_ignore_ascii_case(&expected))
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[cfg(target_os = "windows")]
fn set_packaged_claude_execute_block(mode: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", include_str!("claude_execute_guard.ps1")])
        .env("TOOLHUB_EXECUTE_BLOCK", mode)
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("Не удалось настроить разрешения Claude: {e}"))?;
    if !output.status.success() {
        return Err(format!("Не удалось настроить разрешения Claude: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn set_packaged_claude_startup_block(blocked: bool) -> Result<(), String> {
    use std::io::ErrorKind;
    use std::os::windows::process::CommandExt;
    use winreg::{enums::*, RegKey};

    const SAVED_START: &str = "ToolHubPreviousStart";
    let user = RegKey::predef(HKEY_CURRENT_USER);
    let startup = r"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData\Claude_pzs8sxrjxfjjc\ClaudeStartup";
    match user.open_subkey_with_flags(startup, KEY_READ | KEY_SET_VALUE) {
        Ok(key) => {
            let saved = key.get_value::<u32, _>("ToolHubPreviousState");
            if blocked {
                let state = key.get_value::<u32, _>("State")
                    .map_err(|e| format!("Не удалось прочитать автозапуск Claude: {e}"))?;
                if state == 2 || state == 4 {
                    if let Err(e) = saved {
                        if e.kind() != ErrorKind::NotFound {
                            return Err(format!("Не удалось прочитать сохранённый режим Claude: {e}"));
                        }
                        key.set_value("ToolHubPreviousState", &state)
                            .map_err(|e| format!("Не удалось сохранить режим Claude: {e}"))?;
                    }
                    key.set_value("State", &3u32)
                        .map_err(|e| format!("Не удалось отключить автозапуск Claude: {e}"))?;
                }
            } else {
                match saved {
                    Ok(state) => {
                        key.set_value("State", &state)
                            .and_then(|_| key.delete_value("ToolHubPreviousState"))
                            .map_err(|e| format!("Не удалось восстановить автозапуск Claude: {e}"))?;
                    }
                    Err(e) if e.kind() == ErrorKind::NotFound => {},
                    Err(e) => return Err(format!("Не удалось прочитать сохранённый режим Claude: {e}")),
                }
            }
        }
        Err(e) if e.kind() == ErrorKind::NotFound => {},
        Err(e) => return Err(format!("Не удалось открыть настройки автозапуска Claude: {e}")),
    }

    let machine = RegKey::predef(HKEY_LOCAL_MACHINE);
    let service = match machine.open_subkey_with_flags(
        r"SYSTEM\CurrentControlSet\Services\CoworkVMService",
        KEY_READ | KEY_SET_VALUE,
    ) {
        Ok(key) => key,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("Не удалось открыть настройки службы Cowork: {e}")),
    };
    let previous = match service.get_value::<u32, _>(SAVED_START) {
        Ok(value) => Some(value),
        Err(e) if e.kind() == ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Не удалось прочитать исходный режим службы Cowork: {e}")),
    };
    let current = service.get_value::<u32, _>("Start")
        .map_err(|e| format!("Не удалось прочитать режим службы Cowork: {e}"))?;
    let (mode, expected) = if blocked {
        if current == 4 {
            return Ok(());
        }
        if previous.is_none() {
            service.set_value(SAVED_START, &current)
                .map_err(|e| format!("Не удалось сохранить режим службы Cowork: {e}"))?;
        }
        ("disabled", 4u32)
    } else {
        match previous {
            Some(2) => ("auto", 2),
            Some(3) => ("demand", 3),
            Some(4) => ("disabled", 4),
            None => return Ok(()),
            _ => return Err("Неизвестный исходный режим службы Cowork".to_string()),
        }
    };

    let output = Command::new("sc.exe")
        .args(["config", "CoworkVMService", "start=", mode])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("Не удалось настроить службу Cowork: {e}"))?;
    if !output.status.success() {
        if output.status.code() != Some(5) {
            return Err(format!("Не удалось настроить службу Cowork: {}", output.status));
        }
        // Packaged services may deny SERVICE_CHANGE_CONFIG even when their
        // persistent startup settings are writable. SCM may cache the old mode
        // until Windows restarts.
        service.set_value("Start", &expected)
            .map_err(|e| format!("Не удалось сохранить режим запуска Cowork: {e}"))?;
        use std::io::Write;
        if let Ok(mut log) = std::fs::OpenOptions::new().create(true).append(true)
            .open(crate::local_log_path("frontend_debug.log"))
        {
            let _ = writeln!(log, "[KILLSWITCH STARTUP] Cowork startup mode saved in registry; Windows restart may be required");
        }
    }
    let saved = service.get_value::<u32, _>("Start")
        .map_err(|e| format!("Не удалось проверить режим службы Cowork: {e}"))?;
    if saved != expected {
        return Err(format!("Windows сохранила режим Cowork {saved} вместо {expected}"));
    }
    if !blocked {
        service.delete_value(SAVED_START)
            .map_err(|e| format!("Не удалось удалить сохранённый режим службы Cowork: {e}"))?;
    }
    Ok(())
}

pub fn set_ifeo_guard(enabled: bool) -> Result<KillSwitchStatus, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let base_path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options";
        let hklm = hklm.open_subkey_with_flags(base_path, KEY_READ | KEY_WRITE | KEY_WOW64_64KEY)
            .map_err(|e| format!("Не удалось открыть IFEO: {}", e))?;

        set_packaged_claude_startup_block(enabled)?;
        set_packaged_claude_execute_block(if enabled { "1" } else { "0" })?;

        if enabled {
            let current_exe = std::env::current_exe()
                .map_err(|e| format!("Не удалось определить путь к ToolHub: {}", e))?;
            let debugger_val = format!("\"{}\" --blocked-by-ifeo", current_exe.to_string_lossy());

            for target in IFEO_TARGETS {
                let key_path = target;
                let (key, _) = hklm.create_subkey(&key_path)
                    .map_err(|e| format!("Ошибка создания ключа IFEO для {}: {}. Нужны права администратора.", target, e))?;
                key.set_value("Debugger", &debugger_val)
                    .map_err(|e| format!("Ошибка установки Debugger для {}: {}", target, e))?;
            }
            IFEO_GUARD_ACTIVE.store(true, Ordering::SeqCst);
        } else {
            for target in IFEO_TARGETS {
                let key_path = target;
                if let Ok(key) = hklm.open_subkey_with_flags(&key_path, KEY_SET_VALUE) {
                    let _ = key.delete_value("Debugger");
                }
                let _ = hklm.delete_subkey(&key_path);
            }
            IFEO_GUARD_ACTIVE.store(false, Ordering::SeqCst);
        }

        let ks_enabled = KILLSWITCH_ENABLED.load(Ordering::SeqCst);
        let allowed_ips = ALLOWED_IPS.lock().map(|l| l.clone()).unwrap_or_default();
        let strict = STRICT_MODE.load(Ordering::SeqCst);
        let pf = PERSISTENT_FIREWALL.load(Ordering::SeqCst);
        save_killswitch_config_full(ks_enabled, &allowed_ips, strict, pf, enabled);

        Ok(get_killswitch_status())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("IFEO доступен только в Windows".to_string())
    }
}

pub fn pause_ifeo_guard_temporary() {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let base_path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options";
        for target in IFEO_TARGETS {
            let key_path = format!("{}\\{}", base_path, target);
            if let Ok(key) = hklm.open_subkey_with_flags(key_path, KEY_SET_VALUE | KEY_WOW64_64KEY) {
                let _ = key.delete_value("Debugger");
            }
        }
    }
}

pub fn resume_ifeo_guard_temporary() {
    #[cfg(target_os = "windows")]
    {
        if IFEO_GUARD_ACTIVE.load(Ordering::SeqCst) || is_ifeo_guard_active() {
            let _ = set_ifeo_guard(true);
        }
    }
}

#[cfg(target_os = "windows")]
pub fn show_ifeo_blocked_dialog() {
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: isize, text: *const u16, caption: *const u16, utype: u32) -> i32;
    }

    let msg = "⚠️ ToolHub Sentinel: Прямой запуск Claude перехвачен!\n\n\
Запуск Claude заблокирован на аппаратном уровне (IFEO Safe Guard).\n\
Это предотвращает случайную утечку реального IP и перманентный бан аккаунта Anthropic.\n\n\
Как безопасно запустить Claude:\n\
1. Включите проверенный VPN.\n\
2. Откройте ToolHub -> «Claude Code & AI Sentinel».\n\
3. Нажмите «Безопасный запуск Claude».";

    let title = "ToolHub IFEO Guard — Безопасный периметр";

    let text_wide: Vec<u16> = OsStr::new(msg).encode_wide().chain(once(0)).collect();
    let caption_wide: Vec<u16> = OsStr::new(title).encode_wide().chain(once(0)).collect();
    const MB_OK: u32 = 0x00000000;
    const MB_ICONWARNING: u32 = 0x00000030;
    const MB_TOPMOST: u32 = 0x00040000;

    unsafe {
        MessageBoxW(0, text_wide.as_ptr(), caption_wide.as_ptr(), MB_OK | MB_ICONWARNING | MB_TOPMOST);
    }
}

// Asynchronous Kernel Route Watcher (iphlpapi!NotifyRouteChange)
// Wakes up in sub-millisecond kernel time the exact microsecond any route or adapter drops!
pub fn start_kernel_route_watcher() {
    #[cfg(target_os = "windows")]
    {
        thread::spawn(|| {
            use std::ffi::c_void;

            #[link(name = "iphlpapi")]
            extern "system" {
                fn NotifyRouteChange(handle: *mut *mut c_void, overlapped: *mut c_void) -> u32;
            }

            loop {
                let mut handle: *mut c_void = std::ptr::null_mut();
                // Synchronous kernel wait for route/interface change
                let res = unsafe { NotifyRouteChange(&mut handle, std::ptr::null_mut()) };
                if res == 0 {
                    // Route table changed (VPN tunnel dropped, interface flapped, or default gateway changed)
                    if KILLSWITCH_ENABLED.load(Ordering::SeqCst) {
                        let stopped = revoke_network_trust("Сетевой маршрут изменился");
                        log_claude_guard_event("route_changed", Some(stopped));
                    }
                    thread::sleep(Duration::from_millis(500));
                } else {
                    thread::sleep(Duration::from_millis(200));
                }
            }
        });
    }
}

// Terminate all running Claude processes immediately (with atomic suspension)
pub fn kill_all_claude_processes(reason: &str) -> u32 {
    let mut killed = 0;

    #[cfg(target_os = "windows")]
    {
        // FAST-PATH: Sub-millisecond Win32 Toolhelp snapshot to freeze any claude binary instantly in RAM
        use std::ffi::c_void;
        #[repr(C)]
        struct ProcessEntry32W {
            dw_size: u32,
            cnt_usage: u32,
            th32_process_id: u32,
            th32_default_heap_id: usize,
            th32_module_id: u32,
            cnt_threads: u32,
            th32_parent_process_id: u32,
            pc_pri_class_base: i32,
            dw_flags: u32,
            sz_exe_file: [u16; 260],
        }

        #[link(name = "kernel32")]
        extern "system" {
            fn CreateToolhelp32Snapshot(dw_flags: u32, th32_process_id: u32) -> *mut c_void;
            fn Process32FirstW(h_snapshot: *mut c_void, lppe: *mut ProcessEntry32W) -> i32;
            fn Process32NextW(h_snapshot: *mut c_void, lppe: *mut ProcessEntry32W) -> i32;
            fn CloseHandle(handle: *mut c_void) -> i32;
        }

        const TH32CS_SNAPPROCESS: u32 = 0x00000002;
        let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if !snap.is_null() && snap as isize != -1 {
            let mut entry = ProcessEntry32W {
                dw_size: std::mem::size_of::<ProcessEntry32W>() as u32,
                cnt_usage: 0,
                th32_process_id: 0,
                th32_default_heap_id: 0,
                th32_module_id: 0,
                cnt_threads: 0,
                th32_parent_process_id: 0,
                pc_pri_class_base: 0,
                dw_flags: 0,
                sz_exe_file: [0; 260],
            };

            if unsafe { Process32FirstW(snap, &mut entry) } != 0 {
                loop {
                    let len = entry.sz_exe_file.iter().position(|&c| c == 0).unwrap_or(260);
                    let name = String::from_utf16_lossy(&entry.sz_exe_file[..len]).to_lowercase();
                    let is_target = (name.contains("claude")
                        || name.contains("anthropic")
                        || name.contains("cowork"))
                        && !name.contains("toolhub");

                    if is_target {
                        let pid = entry.th32_process_id;
                        if atomic_freeze_and_terminate(pid) {
                            killed += 1;
                            BLOCKED_ATTEMPTS.fetch_add(1, Ordering::SeqCst);

                            let time_now = chrono::Local::now().format("%H:%M:%S").to_string();
                            let event = KillSwitchEvent {
                                process_name: name.clone(),
                                pid,
                                timestamp: time_now,
                                reason: reason.to_string(),
                            };
                            if let Ok(mut lock) = LAST_EVENT.lock() {
                                *lock = Some(event);
                            }
                        }
                    }
                    if unsafe { Process32NextW(snap, &mut entry) } == 0 {
                        break;
                    }
                }
            }
            unsafe { CloseHandle(snap); }
        }
    }

    // DEEP SCAN: Inspect node.exe, electron.exe, cmd.exe, and process exe paths
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All);

    for (pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_string();
        let cmd = process.cmd().to_vec();
        let exe_path_str = process.exe().map(|p| p.to_string_lossy().to_lowercase()).unwrap_or_default();

        let is_claude = is_claude_process(&name, &cmd)
            || ((exe_path_str.contains("claude") || exe_path_str.contains("anthropic") || exe_path_str.contains("cowork")) && !exe_path_str.contains("toolhub"));

        if is_claude {
            let pid_num = pid.as_u32();
            if atomic_freeze_and_terminate(pid_num) {
                killed += 1;
                BLOCKED_ATTEMPTS.fetch_add(1, Ordering::SeqCst);

                let time_now = chrono::Local::now().format("%H:%M:%S").to_string();
                let event = KillSwitchEvent {
                    process_name: name.clone(),
                    pid: pid_num,
                    timestamp: time_now,
                    reason: reason.to_string(),
                };

                if let Ok(mut lock) = LAST_EVENT.lock() {
                    *lock = Some(event);
                }

                let log_path = crate::local_log_path("frontend_debug.log");
                if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
                    use std::io::Write;
                    let _ = writeln!(f, "[KILLSWITCH ATOMIC FREEZE] Froze and terminated Claude/Cowork: {} (PID: {}) - {}", name, pid_num, reason);
                }
            }
        }
    }
    killed
}

// Background Guardian loop (50ms reaction time + Kernel Route Watcher - 100% OFFLINE STEALTH)
pub fn start_killswitch_guardian() {
    load_killswitch_config();

    thread::spawn(|| {
        let mut sys = System::new();

        loop {
            let enabled = KILLSWITCH_ENABLED.load(Ordering::SeqCst);
            let safe = NETWORK_IS_SAFE.load(Ordering::SeqCst);

            // Process Gatekeeper: if KillSwitch is enabled and network is unsafe, freeze & kill instantly!
            if enabled && !safe {
                sys.refresh_processes(ProcessesToUpdate::All);
                for (pid, process) in sys.processes() {
                    let name = process.name().to_string_lossy().to_string();
                    let cmd = process.cmd().to_vec();
                    let exe_path_str = process.exe().map(|p| p.to_string_lossy().to_lowercase()).unwrap_or_default();

                    let is_claude = is_claude_process(&name, &cmd)
                        || ((exe_path_str.contains("claude") || exe_path_str.contains("anthropic") || exe_path_str.contains("cowork")) && !exe_path_str.contains("toolhub"));

                    if is_claude {
                        let pid_num = pid.as_u32();
                        if !atomic_freeze_and_terminate(pid_num) {
                            continue;
                        }

                        let now = chrono::Local::now().timestamp();
                        let last_pid = LAST_ALERT_PID.load(Ordering::SeqCst);
                        let last_time = LAST_ALERT_TIME.load(Ordering::SeqCst);
                        let is_new_event = (pid_num != last_pid) || ((now - last_time).abs() >= 3);

                        if is_new_event {
                            LAST_ALERT_PID.store(pid_num, Ordering::SeqCst);
                            LAST_ALERT_TIME.store(now, Ordering::SeqCst);
                            BLOCKED_ATTEMPTS.fetch_add(1, Ordering::SeqCst);

                            let time_now = chrono::Local::now().format("%H:%M:%S").to_string();
                            let ip = LAST_EGRESS_IP.lock().map(|s| s.clone()).unwrap_or_else(|_| "Не проверен".to_string());
                            let country = LAST_EGRESS_COUNTRY.lock().map(|s| s.clone()).unwrap_or_else(|_| "Неизвестно".to_string());
                            let allowed_ips = ALLOWED_IPS.lock().map(|l| l.clone()).unwrap_or_default();
                            let is_strict = STRICT_MODE.load(Ordering::SeqCst);
                            let last_score = LAST_ANTI_BAN_SCORE.load(Ordering::SeqCst);
                            let split_tunnel = LAST_SPLIT_TUNNEL.load(Ordering::SeqCst);

                            let reason = if !allowed_ips.is_empty() && !allowed_ips.iter().any(|a| a.trim() == ip.trim()) {
                                format!("Запуск Claude заблокирован: исходящий IP ({}) не совпадает с разрешённым ({})", ip, allowed_ips.join(", "))
                            } else if is_strict && split_tunnel {
                                "Запуск Claude заблокирован: обнаружен Split-Tunneling (утечка трафика)".to_string()
                            } else if is_strict && last_score > 0 && last_score < 80 {
                                format!("Запуск Claude заблокирован: Антибан-индекс ({} / 100) ниже безопасного порога (80+)", last_score)
                            } else if country.trim().is_empty() && ip.trim().is_empty() {
                                "Запуск Claude заблокирован: шлюз не проверен / прямое соединение без VPN".to_string()
                            } else if country.trim().is_empty() {
                                format!("Запуск Claude заблокирован: IP в зоне риска ({})", ip)
                            } else {
                                format!("Запуск Claude заблокирован: VPN не активен / IP в зоне риска ({}: {})", country, ip)
                            };

                            let event = KillSwitchEvent {
                                process_name: name.clone(),
                                pid: pid_num,
                                timestamp: time_now,
                                reason,
                            };

                            if let Ok(mut lock) = LAST_EVENT.lock() {
                                *lock = Some(event);
                            }

                            let log_path = crate::local_log_path("frontend_debug.log");
                            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
                                use std::io::Write;
                                let _ = writeln!(f, "[KILLSWITCH INTERCEPT] Preemptively froze & terminated {} (PID: {}) | Reason: Unsafe network", name, pid_num);
                            }
                        }
                    }
                }
                if !NETWORK_IS_SAFE.load(Ordering::SeqCst) {
                    enable_firewall_block_rule();
                }
            }
            thread::sleep(Duration::from_millis(50));
        }
    });

    setup_firewall_armor();
    start_kernel_route_watcher();
}

// Update the safety state from network audit
static GUARD_LOG_APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

pub fn connect_guard_log(app: &tauri::AppHandle) {
    let _ = GUARD_LOG_APP.set(app.clone());
}

fn log_claude_guard_event(event: &'static str, stopped: Option<u32>) {
    use std::io::Write;

    use tauri::Emitter;
    let message = match event {
        "audit_passed" => "Сетевой аудит пройден",
        "audit_blocked" => "Сетевой аудит не пройден",
        "egress_changed" => "Внешний IP изменился, доверие сброшено",
        "route_changed" => "Сетевой маршрут изменился, доверие сброшено",
        "desktop_started" => "Claude Desktop запущен",
        "desktop_launch_denied_or_failed" => "Запуск Claude Desktop заблокирован или завершился ошибкой",
        "cli_launch_requested" => "Запрошен запуск Claude Code",
        "cli_launch_denied_or_failed" => "Запуск Claude Code заблокирован или завершился ошибкой",
        "cowork_service_start_accepted" => "Windows приняла команду запуска Cowork",
        _ => "Неизвестная команда запуска",
    };
    if let Some(app) = GUARD_LOG_APP.get() {
        let count = stopped.map(|count| format!(". Завершено процессов: {count}")).unwrap_or_default();
        let time = chrono::Local::now().format("%H:%M:%S");
        let _ = app.emit("claude-guard-log", format!("[CLAUDE] {time} {message}{count}"));
    }

    let path = crate::local_log_path("claude-guard.log");
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let time = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let count = stopped.map(|count| format!(" stopped={count}")).unwrap_or_default();
        let _ = writeln!(file, "{time} {event}{count}");
    }
}

pub(crate) fn revoke_network_trust(reason: &str) -> u32 {
    NETWORK_IS_SAFE.store(false, Ordering::SeqCst);
    if !KILLSWITCH_ENABLED.load(Ordering::SeqCst) {
        return 0;
    }

    enable_firewall_block_rule();
    let stopped = kill_all_claude_processes(reason);
    resume_ifeo_guard_temporary();
    stopped
}

pub fn update_network_safety(safe: bool, ip: &str, country: &str, anti_ban_score: u32, split_tunnel: bool) {
    let ip_changed = NETWORK_IS_SAFE.load(Ordering::SeqCst)
        && LAST_EGRESS_IP.lock().is_ok_and(|previous| previous.as_str() != ip);
    if let Ok(mut l_ip) = LAST_EGRESS_IP.lock() {
        *l_ip = ip.to_string();
    }
    if let Ok(mut l_country) = LAST_EGRESS_COUNTRY.lock() {
        *l_country = country.to_string();
    }
    LAST_ANTI_BAN_SCORE.store(anti_ban_score, Ordering::SeqCst);
    LAST_SPLIT_TUNNEL.store(split_tunnel, Ordering::SeqCst);

    let country_restricted = is_country_restricted(country);
    let allowed_ips = ALLOWED_IPS.lock().map(|l| l.clone()).unwrap_or_default();
    let ip_matches = if allowed_ips.is_empty() {
        true
    } else {
        !ip.is_empty() && allowed_ips.iter().any(|allowed| allowed.trim() == ip.trim())
    };

    let is_strict = STRICT_MODE.load(Ordering::SeqCst);
    let score_ok = if is_strict {
        anti_ban_score >= 80 && !split_tunnel
    } else {
        anti_ban_score >= 40
    };

    let effective_safe = !ip_changed && !country_restricted && safe && ip_matches && score_ok && !ip.is_empty();
    NETWORK_IS_SAFE.store(effective_safe, Ordering::SeqCst);

    // If transitioned to unsafe, kill any active Claude immediately
    if !effective_safe && KILLSWITCH_ENABLED.load(Ordering::SeqCst) {
        let reason = if ip_changed {
            format!("Исходящий IP изменился на {ip}. Требуется повторная проверка сети.")
        } else if country_restricted {
            format!("Сетевой аудит: обнаружен выход из санкционной юрисдикции ({}: {}). Claude заблокирован.", country, ip)
        } else if !ip_matches {
            format!("Сетевой аудит: IP {} не входит в белый список разрешённых IP ({})", ip, allowed_ips.join(", "))
        } else if !safe {
            "Сетевой аудит: обнаружен незащищенный IP / прямое подключение без VPN".to_string()
        } else if split_tunnel {
            "Сетевой аудит: обнаружен Split-Tunneling (утечка прямого DNS)".to_string()
        } else {
            format!("Сетевой аудит: Антибан-индекс ({} / 100) ниже допустимого порога. Запуск Claude заблокирован.", anti_ban_score)
        };
        let stopped = revoke_network_trust(&reason);
        log_claude_guard_event(if ip_changed { "egress_changed" } else { "audit_blocked" }, Some(stopped));
    } else if effective_safe {
        log_claude_guard_event("audit_passed", None);
    }
}

// Get current state for UI
pub fn get_killswitch_status() -> KillSwitchStatus {
    let enabled = KILLSWITCH_ENABLED.load(Ordering::SeqCst);
    let safe = NETWORK_IS_SAFE.load(Ordering::SeqCst);
    let count = BLOCKED_ATTEMPTS.load(Ordering::SeqCst);
    let last = LAST_EVENT.lock().ok().and_then(|l| l.clone());
    let ip = LAST_EGRESS_IP.lock().map(|s| s.clone()).unwrap_or_default();
    let country = LAST_EGRESS_COUNTRY.lock().map(|s| s.clone()).unwrap_or_default();

    let desktop_path = find_claude_desktop_path();
    let desktop_installed = desktop_path.is_some();
    let desktop_path_str = desktop_path.map(|p| p.to_string_lossy().to_string());

    let is_admin = is_running_as_admin();
    let allowed_ips = ALLOWED_IPS.lock().map(|l| l.clone()).unwrap_or_default();
    let ip_matches_whitelist = allowed_ips.is_empty() || (!ip.is_empty() && allowed_ips.iter().any(|a| a.trim() == ip.trim()));
    let priority_autostart_active = system::is_priority_autostart_active();
    let strict = STRICT_MODE.load(Ordering::SeqCst);
    let last_score = LAST_ANTI_BAN_SCORE.load(Ordering::SeqCst);
    let split_tunnel = LAST_SPLIT_TUNNEL.load(Ordering::SeqCst);

    let country_restricted = is_country_restricted(&country);

    let (status, status_text) = if !enabled {
        ("disabled".to_string(), "Защитный фильтр выключен (Claude не контролируется)".to_string())
    } else if country_restricted {
        let name = if country.is_empty() { "Не определена".to_string() } else { country.clone() };
        ("blocked".to_string(), format!("БАРЬЕР АКТИВЕН: Запуск Claude заблокирован (шлюз в зоне риска: {})", name))
    } else if !allowed_ips.is_empty() && !ip_matches_whitelist {
        ("blocked".to_string(), format!("БАРЬЕР АКТИВЕН: Текущий IP ({}) не совпадает с закреплённым ({})", ip, allowed_ips.join(", ")))
    } else if strict && split_tunnel {
        ("blocked".to_string(), "БАРЬЕР АКТИВЕН: Обнаружен Split-Tunneling (трафик разделяется). Запуск Claude заблокирован.".to_string())
    } else if strict && last_score < 80 {
        ("blocked".to_string(), format!("БАРЬЕР АКТИВЕН: Антибан-индекс ({} / 100) ниже безопасного (80+). Запуск Claude заблокирован.", last_score))
    } else if last_score < 40 {
        ("blocked".to_string(), format!("БАРЬЕР АКТИВЕН: Критический антибан-индекс ({} / 100). Запуск Claude заблокирован.", last_score))
    } else if safe {
        let text = if allowed_ips.is_empty() {
            format!("Защита активна: VPN подтверждён ({}, {}). Запуск разрешён.", country, ip)
        } else {
            format!("Защита активна: IP {} подтверждён в белом списке ({}). Запуск разрешён.", ip, country)
        };
        ("armed_safe".to_string(), text)
    } else {
        ("blocked".to_string(), "БАРЬЕР АКТИВЕН: Запуск Claude заблокирован до включения чистого VPN".to_string())
    };

    KillSwitchStatus {
        enabled,
        network_safe: safe,
        status,
        status_text,
        blocked_count: count,
        last_event: last,
        egress_ip: ip,
        egress_country: country,
        claude_desktop_installed: desktop_installed,
        claude_desktop_path: desktop_path_str,
        is_admin,
        allowed_ips,
        ip_matches_whitelist,
        priority_autostart_active,
        strict_mode: strict,
        anti_ban_score: last_score,
        split_tunnel_detected: split_tunnel,
        persistent_firewall: PERSISTENT_FIREWALL.load(Ordering::SeqCst),
        ifeo_guard: is_ifeo_guard_active(),
    }
}

pub fn set_killswitch_enabled(enabled: bool) -> KillSwitchStatus {
    KILLSWITCH_ENABLED.store(enabled, Ordering::SeqCst);
    let allowed_ips = ALLOWED_IPS.lock().map(|l| l.clone()).unwrap_or_default();
    let strict = STRICT_MODE.load(Ordering::SeqCst);
    save_killswitch_config(enabled, &allowed_ips, strict);

    if enabled && !NETWORK_IS_SAFE.load(Ordering::SeqCst) {
        kill_all_claude_processes("Активирован Kill-Switch при незащищенном сетевом периметре");
    }
    get_killswitch_status()
}

// Safe launcher for Claude Desktop or Claude CLI
#[cfg(target_os = "windows")]
fn wait_for_claude_process(names: &[&str]) -> Result<(), String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    let mut processes = System::new();
    loop {
        if KILLSWITCH_ENABLED.load(Ordering::SeqCst) && !NETWORK_IS_SAFE.load(Ordering::SeqCst) {
            return Err("Сеть изменилась во время запуска. Повторите аудит.".to_string());
        }
        processes.refresh_processes(ProcessesToUpdate::All);
        if processes.processes().values().any(|process| {
            let name = process.name().to_string_lossy();
            names.iter().any(|expected| name.eq_ignore_ascii_case(expected))
        }) {
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            return Err(format!("Windows не запустила {} за 15 секунд.", names.join(" / ")));
        }
        thread::sleep(Duration::from_millis(200));
    }
}

pub fn safe_launch_claude(launch_type: &str, profile_name: Option<String>) -> Result<String, String> {
    let result = launch_claude(launch_type, profile_name);
    let event = match (launch_type, result.is_ok()) {
        ("desktop", true) => "desktop_started",
        ("desktop", false) => "desktop_launch_denied_or_failed",
        ("cli", true) => "cli_launch_requested",
        ("cli", false) => "cli_launch_denied_or_failed",
        _ => "unknown_launch_request",
    };
    log_claude_guard_event(event, None);
    result
}

fn launch_claude(launch_type: &str, profile_name: Option<String>) -> Result<String, String> {
    let enabled = KILLSWITCH_ENABLED.load(Ordering::SeqCst);
    let safe = NETWORK_IS_SAFE.load(Ordering::SeqCst);
    let allowed_ips = ALLOWED_IPS.lock().map(|l| l.clone()).unwrap_or_default();
    let current_ip = LAST_EGRESS_IP.lock().map(|s| s.clone()).unwrap_or_default();
    let strict = STRICT_MODE.load(Ordering::SeqCst);
    let score = LAST_ANTI_BAN_SCORE.load(Ordering::SeqCst);
    let split_tunnel = LAST_SPLIT_TUNNEL.load(Ordering::SeqCst);

    if enabled && !allowed_ips.is_empty() {
        let ip_matches = allowed_ips.iter().any(|a| a.trim() == current_ip.trim());
        if !ip_matches {
            return Err(format!(
                "Запуск Claude заблокирован Kill-Switch! Текущий IP ({}) не входит в список разрешённых IP ({})! Переключите VPN/прокси на ваш доверенный IP адрес.",
                current_ip, allowed_ips.join(", ")
            ));
        }
    }

    if enabled && strict && split_tunnel {
        return Err("Запуск Claude заблокирован Kill-Switch: обнаружен Split-Tunneling (трафик разделяется). Настройте Global TUN VPN.".to_string());
    }

    if enabled && strict && score > 0 && score < 80 {
        return Err(format!(
            "Запуск Claude заблокирован Kill-Switch! Антибан-индекс составляет всего {} / 100 (требуется 80+). Устраните рассинхрон перед запуском.",
            score
        ));
    }

    if enabled && !safe {
        return Err("Запуск заблокирован Kill-Switch! Ваше текущее сетевое подключение не верифицировано как безопасное (VPN выключен или IP находится в санкционной зоне). Сначала включите VPN и запустите проверку сети.".to_string());
    }

    // Temporarily pause IFEO guard so our authorized launch won't be trapped
    let was_ifeo = is_ifeo_guard_active();
    if was_ifeo {
        pause_ifeo_guard_temporary();
    }

    #[cfg(target_os = "windows")]
    if was_ifeo && matches!(launch_type, "desktop" | "cli") {
        let mode = if launch_type == "desktop" { "desktop-launch" } else { "cli-launch" };
        if let Err(error) = set_packaged_claude_execute_block(mode) {
            resume_ifeo_guard_temporary();
            return Err(error);
        }
    }

    #[cfg(target_os = "windows")]
    if was_ifeo && launch_type == "desktop" && find_cowork_svc_path().is_some() {
        use std::os::windows::process::CommandExt;

        disable_firewall_block_rule();
        let cowork = set_packaged_claude_startup_block(false).and_then(|_| {
            let output = Command::new("sc.exe")
                .args(["start", "CoworkVMService"])
                .creation_flags(0x08000000)
                .output()
                .map_err(|e| format!("Не удалось запустить Cowork: {e}"))?;
            if output.status.success() || output.status.code() == Some(1056) {
                log_claude_guard_event("cowork_service_start_accepted", None);
                wait_for_claude_process(&["cowork-svc.exe"])
            } else {
                Err(format!("Служба Cowork не запустилась: {}", output.status))
            }
        });
        if let Err(error) = cowork {
            enable_firewall_block_rule();
            resume_ifeo_guard_temporary();
            kill_all_claude_processes("Разрешённый запуск Cowork не удался");
            return Err(error);
        }
    }

    if enabled && !NETWORK_IS_SAFE.load(Ordering::SeqCst) {
        revoke_network_trust("Сеть изменилась во время разрешённого запуска");
        return Err("Сеть изменилась. Повторите аудит перед запуском Claude.".to_string());
    }

    // Network is verified safe: momentarily open firewall armor for sanctioned launch
    disable_firewall_block_rule();

    let launch_res = (|| match launch_type {
        "desktop" => {
            if let Some(path) = find_claude_desktop_path() {
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    const DETACHED_PROCESS: u32 = 0x00000008;
                    let mut cmd = Command::new(&path);
                    cmd.creation_flags(DETACHED_PROCESS);
                    let spawn_res = cmd.spawn();
                    if spawn_res.is_err() {
                        // MSIX fallback: launch via explorer shell:AppsFolder
                        Command::new("explorer")
                            .arg("shell:AppsFolder\\Claude_pzs8sxrjxfjjc!Claude")
                            .spawn()
                            .map_err(|e| format!("Не удалось запросить запуск Claude Desktop: {e}"))?;
                        wait_for_claude_process(&["claude.exe", "claude-desktop.exe"])?;
                        return Ok("Claude Desktop запущен.".to_string());
                    }
                    wait_for_claude_process(&["claude.exe", "claude-desktop.exe"])?;
                    Ok("Claude Desktop запущен.".to_string())
                }
                #[cfg(not(target_os = "windows"))]
                {
                    Command::new(&path).spawn().map_err(|e| format!("Ошибка запуска: {}", e))?;
                    Ok("Claude Desktop запущен.".to_string())
                }
            } else {
                #[cfg(target_os = "windows")]
                {
                    // Fallback attempt via explorer AppUserModelId
                    let shell_res = Command::new("explorer")
                        .arg("shell:AppsFolder\\Claude_pzs8sxrjxfjjc!Claude")
                        .spawn();
                    if shell_res.is_ok() {
                        wait_for_claude_process(&["claude.exe", "claude-desktop.exe"])?;
                        return Ok("Claude Desktop запущен.".to_string());
                    }
                }
                Err("Приложение Claude Desktop не найдено по стандартным путям. Убедитесь, что официальный десктопный клиент установлен.".to_string())
            }
        }
        "cli" => {
            let name = profile_name.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "default".to_string());
            let home = crate::claude::get_user_home();
            if !crate::claude::valid_profile_name(&name) {
                return Err("Недопустимое имя профиля.".to_string());
            }
            let profile_dir = home.join(".claude-profiles").join(&name);
            let bat_path = profile_dir.join(format!("run_{}.bat", name));

            if !bat_path.exists() {
                let _ = crate::claude::generate_claude_profile(name.clone(), None);
            }

            if bat_path.exists() {
                #[cfg(target_os = "windows")]
                {
                    Command::new("cmd")
                        .args(&["/c", "start", "cmd", "/k", bat_path.to_str().unwrap_or("")])
                        .spawn()
                        .map_err(|e| format!("Не удалось открыть окно консоли: {}", e))?;
                    Ok(format!("Терминал Claude Code с изолированным профилем '{}' успешно запущен.", name))
                }
                #[cfg(not(target_os = "windows"))]
                {
                    Ok("Запуск консольного профиля поддерживается на Windows".to_string())
                }
            } else {
                Err(format!("Не удалось найти или создать файл профиля '{}'.", name))
            }
        }
        _ => Err("Неизвестный тип запуска. Используйте 'desktop' или 'cli'.".to_string())
    })();

    if was_ifeo {
        if launch_res.is_ok() {
            schedule_guard_restore();
        } else {
            enable_firewall_block_rule();
            resume_ifeo_guard_temporary();
            kill_all_claude_processes("Разрешённый запуск Claude не удался");
        }
    }

    launch_res
}

fn schedule_guard_restore() {
    thread::spawn(|| {
        thread::sleep(Duration::from_millis(1500));
        resume_ifeo_guard_temporary();
    });
}
