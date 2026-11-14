use std::process::Command;
use serde::{Deserialize, Serialize};
use sysinfo::{Disks, System};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveInfo {
    pub drive: String,
    pub total: String,
    pub used: String,
    pub free: String,
    pub percent: String,
    pub pct_num: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemSpecs {
    pub cpu: String,
    pub cpu_threads: u32,
    pub ram_total: String,
    pub ram_avail: String,
    pub ram_load: String,
    pub gpus: Vec<String>,
    pub os: String,
    pub platform: String,
    pub hwid: String,
    pub hw_accel: String,
    pub computer_name: String,
    pub user_name: String,
    pub drives: Vec<DriveInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HwidRegenResult {
    pub success: bool,
    pub hwid: Option<String>,
    pub error: Option<String>,
}

pub fn get_system_specs() -> SystemSpecs {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();

    // 1. CPU Brand and Threads
    let cpus = sys.cpus();
    let cpu_threads = if cpus.is_empty() {
        std::thread::available_parallelism().map(|p| p.get() as u32).unwrap_or(8)
    } else {
        cpus.len() as u32
    };

    #[cfg(target_os = "windows")]
    let cpu_brand = {
        let mut reg_cpu = None;
        if let Ok(key) = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
            .open_subkey(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        {
            if let Ok(val) = key.get_value::<String, _>("ProcessorNameString") {
                let trimmed = val.trim().to_string();
                if !trimmed.is_empty() {
                    reg_cpu = Some(trimmed);
                }
            }
        }
        reg_cpu.unwrap_or_else(|| {
            cpus.first()
                .map(|c| c.brand().trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "Unknown Windows CPU".to_string())
        })
    };

    #[cfg(not(target_os = "windows"))]
    let cpu_brand = cpus
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown CPU".to_string());

    // 2. RAM Information
    let total_bytes = sys.total_memory();
    let used_bytes = sys.used_memory();
    let avail_bytes = sys.available_memory();

    let total_gb = (total_bytes as f64) / (1024.0 * 1024.0 * 1024.0);
    let avail_gb = (avail_bytes as f64) / (1024.0 * 1024.0 * 1024.0);
    let ram_load_pct = if total_bytes > 0 {
        ((used_bytes as f64 / total_bytes as f64) * 100.0).round() as u32
    } else {
        0
    };

    let ram_total = format!("{:.1} ГБ", total_gb);
    let ram_avail = format!("{:.1} ГБ доступно", avail_gb);
    let ram_load = format!("{}%", ram_load_pct);

    // 3. GPU Detection
    let gpus = detect_gpus();

    // 4. Hardware Acceleration Profile
    let hw_accel = detect_hw_accel(&gpus);

    // 5. Operating System Info & Platform
    let os = get_os_info();
    let platform = std::env::consts::OS.to_string();

    // 6. Machine Identifier (HWID / MachineGuid on Windows, IOPlatformUUID on macOS)
    let hwid = get_machine_hwid();

    // 7. Computer Name & Username
    let computer_name = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| System::host_name().unwrap_or_else(|| "PC".into()));

    let user_name = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "User".into());

    // 8. Connected Drives via sysinfo::Disks
    let disks = Disks::new_with_refreshed_list();
    let mut drives = Vec::new();

    for disk in &disks {
        let total = disk.total_space();
        if total == 0 {
            continue;
        }
        let free = disk.available_space();
        let used = total.saturating_sub(free);

        let total_gb = (total as f64) / (1024.0 * 1024.0 * 1024.0);
        let used_gb = (used as f64) / (1024.0 * 1024.0 * 1024.0);
        let free_gb = (free as f64) / (1024.0 * 1024.0 * 1024.0);
        let pct = ((used as f64 / total as f64) * 100.0).round() as u32;

        let mount = disk.mount_point().to_string_lossy().to_string();
        let drive_label = if cfg!(target_os = "windows") {
            if mount.len() >= 2 && mount.as_bytes()[1] == b':' {
                mount[0..2].to_uppercase()
            } else {
                mount
            }
        } else {
            mount
        };

        drives.push(DriveInfo {
            drive: drive_label,
            total: format!("{:.1} ГБ", total_gb),
            used: format!("{:.1} ГБ", used_gb),
            free: format!("{:.1} ГБ свободно", free_gb),
            percent: format!("{}%", pct),
            pct_num: pct,
        });
    }

    // Sort drives by drive letter/mount
    drives.sort_by(|a, b| a.drive.cmp(&b.drive));

    SystemSpecs {
        cpu: cpu_brand,
        cpu_threads,
        ram_total,
        ram_avail,
        ram_load,
        gpus,
        os,
        platform,
        hwid,
        hw_accel,
        computer_name,
        user_name,
        drives,
    }
}

fn detect_gpus() -> Vec<String> {
    let mut gpus = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // 1. Direct registry lookup in Display Adapter class
        if let Ok(key) = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE).open_subkey(
            r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}",
        ) {
            for subkey_name in key.enum_keys().map_while(Result::ok) {
                if subkey_name.chars().all(|c| c.is_ascii_digit()) {
                    if let Ok(skey) = key.open_subkey(&subkey_name) {
                        if let Ok(desc) = skey.get_value::<String, _>("DriverDesc") {
                            let trimmed = desc.trim().to_string();
                            if !trimmed.is_empty() && !gpus.contains(&trimmed) {
                                gpus.push(trimmed);
                            }
                        }
                    }
                }
            }
        }

        // 2. PowerShell fallback if registry is restricted
        if gpus.is_empty() {
            if let Ok(output) = Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-Command",
                    "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
                ])
                .output()
            {
                if output.status.success() {
                    let text = String::from_utf8_lossy(&output.stdout);
                    for line in text.lines() {
                        let trimmed = line.trim().to_string();
                        if !trimmed.is_empty() && !gpus.contains(&trimmed) {
                            gpus.push(trimmed);
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("system_profiler")
            .args(["SPDisplaysDataType"])
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("Chipset Model:") {
                        let name = trimmed.trim_start_matches("Chipset Model:").trim().to_string();
                        if !name.is_empty() && !gpus.contains(&name) {
                            gpus.push(name);
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = Command::new("lspci").output() {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    if line.contains("VGA compatible controller") || line.contains("3D controller") {
                        if let Some(pos) = line.find(": ") {
                            let name = line[pos + 2..].trim().to_string();
                            if !name.is_empty() && !gpus.contains(&name) {
                                gpus.push(name);
                            }
                        }
                    }
                }
            }
        }
    }

    if gpus.is_empty() {
        gpus.push("Видеоадаптер системы".to_string());
    }

    gpus
}

fn detect_hw_accel(gpus: &[String]) -> String {
    let gpu_string = gpus.join(" ").to_lowercase();
    if gpu_string.contains("nvidia") || gpu_string.contains("geforce") || gpu_string.contains("rtx") || gpu_string.contains("quadro") {
        "NVIDIA NVENC / CUDA (Аппаратное ускорение включено)".to_string()
    } else if gpu_string.contains("apple") || gpu_string.contains("m1") || gpu_string.contains("m2") || gpu_string.contains("m3") || gpu_string.contains("m4") {
        "Apple VideoToolbox / Metal (Аппаратное ускорение включено)".to_string()
    } else if gpu_string.contains("intel") || gpu_string.contains("iris") || gpu_string.contains("arc") {
        "Intel QuickSync Video / QSV (Аппаратное ускорение)".to_string()
    } else if gpu_string.contains("amd") || gpu_string.contains("radeon") {
        "AMD AMF / Video Core Next (Аппаратное ускорение)".to_string()
    } else {
        "Стандартное декодирование (CPU Multithreading)".to_string()
    }
}

fn get_os_info() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(key) = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
            .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
        {
            let pname: String = key.get_value("ProductName").unwrap_or_default();
            let disp: String = key.get_value("DisplayVersion").unwrap_or_default();
            let build: String = key.get_value("CurrentBuild").unwrap_or_default();
            if !pname.is_empty() {
                return format!("{} {} (Сборка {})", pname, disp, build).trim().to_string();
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let product_name = Command::new("sw_vers")
            .args(["-productName"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "macOS".to_string());

        let product_version = Command::new("sw_vers")
            .args(["-productVersion"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        let build_version = Command::new("sw_vers")
            .args(["-buildVersion"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        if !product_version.is_empty() {
            return format!("{} {} (Build {})", product_name, product_version, build_version);
        }
    }

    System::long_os_version()
        .or_else(System::name)
        .unwrap_or_else(|| "Desktop Operating System".to_string())
}

pub fn get_machine_hwid() -> String {
    #[cfg(target_os = "windows")]
    {
        // 1. In-process registry read
        if let Ok(key) = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
            .open_subkey(r"SOFTWARE\Microsoft\Cryptography")
        {
            if let Ok(guid) = key.get_value::<String, _>("MachineGuid") {
                let trimmed = guid.trim().to_string();
                if !trimmed.is_empty() {
                    return trimmed;
                }
            }
        }

        // 2. Command fallback via reg query
        if let Ok(output) = Command::new("reg")
            .args(["query", r"HKLM\SOFTWARE\Microsoft\Cryptography", "/v", "MachineGuid"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.contains("MachineGuid") {
                    if let Some(val) = line.split_whitespace().last() {
                        return val.to_string();
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Query macOS IOPlatformUUID via ioreg
        if let Ok(output) = Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.contains("IOPlatformUUID") {
                    if let Some(start) = line.find('"') {
                        if let Some(uuid_part) = line.split('"').nth(3) {
                            return uuid_part.trim().to_string();
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        for path in &["/etc/machine-id", "/var/lib/dbus/machine-id"] {
            if let Ok(contents) = std::fs::read_to_string(path) {
                let trimmed = contents.trim().to_string();
                if !trimmed.is_empty() {
                    return trimmed;
                }
            }
        }
    }

    "HWID-NOT-FOUND".to_string()
}

pub fn open_win_tool(tool: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let target = match tool {
            "regedit" => "regedit.exe",
            "taskmgr" => "taskmgr.exe",
            "devmgmt" => "devmgmt.msc",
            "settings" => "ms-settings:about",
            "diskmgmt" => "diskmgmt.msc",
            "ncpa" => "ncpa.cpl",
            other => return Err(format!("Неизвестный системный инструмент: {}", other)),
        };

        // Use cmd /c start "" <target> to detach and execute .msc, .cpl, and protocols cleanly
        Command::new("cmd")
            .args(["/c", "start", "", target])
            .spawn()
            .map_err(|e| format!("Ошибка запуска утилиты {}: {}", target, e))?;

        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let (prog, args): (&str, Vec<&str>) = match tool {
            "taskmgr" => ("open", vec!["-a", "Activity Monitor"]),
            "settings" => ("open", vec!["x-apple.systempreferences:"]),
            "diskmgmt" => ("open", vec!["-a", "Disk Utility"]),
            "devmgmt" => ("open", vec!["-a", "System Information"]),
            "ncpa" => ("open", vec!["x-apple.systempreferences:com.apple.Network-Settings.extension"]),
            "regedit" => ("open", vec!["-a", "Terminal"]),
            other => return Err(format!("Неизвестный системный инструмент для macOS: {}", other)),
        };

        Command::new(prog)
            .args(args)
            .spawn()
            .map_err(|e| format!("Ошибка запуска macOS утилиты: {}", e))?;

        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let target = match tool {
            "taskmgr" => "gnome-system-monitor",
            "settings" => "gnome-control-center",
            "diskmgmt" => "gnome-disks",
            "devmgmt" => "hardinfo",
            "ncpa" => "nm-connection-editor",
            "regedit" => "dconf-editor",
            other => return Err(format!("Неизвестный инструмент для Linux: {}", other)),
        };

        Command::new(target)
            .spawn()
            .map_err(|e| format!("Ошибка запуска Linux утилиты {}: {}", target, e))?;

        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Операционная система не поддерживается".into())
}

pub fn regenerate_hwid() -> HwidRegenResult {
    #[cfg(target_os = "windows")]
    {
        let new_guid = uuid::Uuid::new_v4().to_string();
        let hk = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE);
        match hk.open_subkey_with_flags(
            r"SOFTWARE\Microsoft\Cryptography",
            winreg::enums::KEY_SET_VALUE,
        ) {
            Ok(key) => {
                if let Err(e) = key.set_value("MachineGuid", &new_guid) {
                    return HwidRegenResult {
                        success: false,
                        hwid: None,
                        error: Some(format!("Ошибка записи в реестр: {}", e)),
                    };
                }
                HwidRegenResult {
                    success: true,
                    hwid: Some(new_guid),
                    error: None,
                }
            }
            Err(e) => HwidRegenResult {
                success: false,
                hwid: None,
                error: Some(format!(
                    "Требуются права Администратора для изменения MachineGuid в реестре Windows: {}",
                    e
                )),
            },
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        HwidRegenResult {
            success: false,
            hwid: None,
            error: Some("Смена системного аппаратного GUID поддерживается только в Windows".to_string()),
        }
    }
}

fn get_startup_shortcut_path() -> Option<std::path::PathBuf> {
    dirs::data_dir().map(|p| {
        p.join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join("Startup")
            .join("ToolHub.cmd")
    })
}

pub fn get_autostart_status() -> bool {
    is_priority_autostart_active()
}

pub fn is_priority_autostart_active() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let output = Command::new("cmd")
            .args(&["/C", "schtasks /query /tn \"ToolHub_PriorityGuardian\""])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if let Ok(out) = output {
            return out.status.success();
        }
    }
    false
}

pub fn set_priority_autostart(enabled: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let current_exe = std::env::current_exe()
            .map_err(|e| format!("Не удалось определить путь к toolhub.exe: {}", e))?;
        if enabled {
            let script = r#"
$ErrorActionPreference = 'Stop'
$exe = $env:TOOLHUB_AUTOSTART_EXE
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $exe -Argument '--minimized' -WorkingDirectory (Split-Path -Parent $exe)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -Priority 1 -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName ToolHub_PriorityGuardian -Action $action -Trigger $trigger -Settings $settings -User $user -RunLevel Highest -Force | Out-Null
"#;
            let command = if crate::killswitch::is_running_as_admin() {
                script.to_string()
            } else {
                format!(
                    "$ErrorActionPreference = 'Stop'; $child = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-Command',{}; exit $child.ExitCode",
                    format!("'{}'", script.trim().replace("'", "''").replace('\n', "; "))
                )
            };
            let output = Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", &command])
                .env("TOOLHUB_AUTOSTART_EXE", &current_exe)
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("Не удалось запустить Планировщик задач: {}", e))?;
            if !output.status.success() {
                return Err(format!(
                    "Не удалось создать задачу автозапуска: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
            if !is_priority_autostart_active() {
                return Err("Не удалось подтвердить создание задачи автозапуска Windows.".to_string());
            }
            Ok(true)
        } else {
            let is_admin = crate::killswitch::is_running_as_admin();
            if is_admin {
                let _ = Command::new("schtasks")
                    .args(&["/delete", "/tn", "ToolHub_PriorityGuardian", "/f"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();

                if let Ok(hklm) = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
                    .open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Run", winreg::enums::KEY_SET_VALUE)
                {
                    let _ = hklm.delete_value("ToolHub");
                }
            } else {
                let ps_script = "Start-Process cmd.exe -Verb RunAs -Wait -ArgumentList '/c', 'schtasks /delete /tn \"ToolHub_PriorityGuardian\" /f'";
                let _ = Command::new("powershell")
                    .args(&["-WindowStyle", "Hidden", "-Command", ps_script])
                    .creation_flags(CREATE_NO_WINDOW)
                    .status();
            }
            if is_priority_autostart_active() {
                return Err("Не удалось удалить задачу автозапуска Windows.".to_string());
            }
            Ok(false)
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(enabled)
    }
}

pub fn set_autostart(enabled: bool) -> Result<bool, String> {
    let result = set_priority_autostart(enabled)?;
    #[cfg(target_os = "windows")]
    {
        let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            winreg::enums::KEY_SET_VALUE,
        ) {
            let _ = key.delete_value("ToolHub");
        }
    }
    cleanup_legacy_startup_cmd();
    Ok(result)
}

pub fn cleanup_legacy_startup_cmd() {
    #[cfg(target_os = "windows")]
    {
        if let Some(cmd_path) = get_startup_shortcut_path() {
            let _ = std::fs::remove_file(&cmd_path);
        }
        let hk = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        if let Ok(approved_folder) = hk.open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder",
            winreg::enums::KEY_SET_VALUE,
        ) {
            let _ = approved_folder.delete_value("ToolHub.cmd");
        }
    }
}

pub fn get_cache_size() -> String {
    let mut total_bytes: u64 = 0;
    let cache_dir = std::path::Path::new("cache");
    if cache_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(cache_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    total_bytes += meta.len();
                }
            }
        }
    }
    if total_bytes < 1024 * 1024 {
        format!("{:.1} KB", total_bytes as f64 / 1024.0)
    } else {
        format!("{:.2} MB", total_bytes as f64 / (1024.0 * 1024.0))
    }
}

pub fn clear_app_cache() -> Result<usize, String> {
    let mut removed = 0;
    let cache_dir = std::path::Path::new("cache");
    if cache_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(cache_dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    if std::fs::remove_file(entry.path()).is_ok() {
                        removed += 1;
                    }
                }
            }
        }
    }
    Ok(removed)
}

// ---------------------------------------------------------------------------
// Keep-Awake Sentinel (Предотвращение сна системы и дисплея через Win32 API)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KeepAwakeStatus {
    pub is_active: bool,
    pub mode: String,
    pub expires_at: Option<u64>,
    pub remaining_secs: u64,
}

#[cfg(target_os = "windows")]
mod win_awake {
    #[link(name = "kernel32")]
    extern "system" {
        pub fn SetThreadExecutionState(esFlags: u32) -> u32;
    }
    pub const ES_CONTINUOUS: u32 = 0x80000000;
    pub const ES_SYSTEM_REQUIRED: u32 = 0x00000001;
    pub const ES_DISPLAY_REQUIRED: u32 = 0x00000002;
}

static KEEP_AWAKE_INNER: std::sync::Mutex<(bool, String, Option<u64>)> =
    std::sync::Mutex::new((false, String::new(), None));

pub fn get_keep_awake_status() -> KeepAwakeStatus {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    if let Ok(mut lock) = KEEP_AWAKE_INNER.lock() {
        if lock.0 {
            if let Some(exp) = lock.2 {
                if now >= exp {
                    #[cfg(target_os = "windows")]
                    unsafe {
                        win_awake::SetThreadExecutionState(win_awake::ES_CONTINUOUS);
                    }
                    lock.0 = false;
                    lock.1 = "off".to_string();
                    lock.2 = None;
                    return KeepAwakeStatus {
                        is_active: false,
                        mode: "off".to_string(),
                        expires_at: None,
                        remaining_secs: 0,
                    };
                } else {
                    return KeepAwakeStatus {
                        is_active: true,
                        mode: lock.1.clone(),
                        expires_at: lock.2,
                        remaining_secs: exp - now,
                    };
                }
            } else {
                return KeepAwakeStatus {
                    is_active: true,
                    mode: lock.1.clone(),
                    expires_at: None,
                    remaining_secs: 0,
                };
            }
        }
    }

    KeepAwakeStatus {
        is_active: false,
        mode: "off".to_string(),
        expires_at: None,
        remaining_secs: 0,
    }
}

pub fn set_keep_awake(mode: &str) -> Result<KeepAwakeStatus, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let (active, exp) = match mode {
        "30m" => (true, Some(now + 30 * 60)),
        "1h" => (true, Some(now + 60 * 60)),
        "2h" => (true, Some(now + 120 * 60)),
        "infinite" => (true, None),
        _ => (false, None),
    };

    #[cfg(target_os = "windows")]
    unsafe {
        if active {
            win_awake::SetThreadExecutionState(
                win_awake::ES_CONTINUOUS | win_awake::ES_SYSTEM_REQUIRED | win_awake::ES_DISPLAY_REQUIRED,
            );
        } else {
            win_awake::SetThreadExecutionState(win_awake::ES_CONTINUOUS);
        }
    }

    #[cfg(target_os = "macos")]
    {
        use std::sync::Mutex;
        static MAC_AWAKE_CHILD: Mutex<Option<std::process::Child>> = Mutex::new(None);
        if let Ok(mut guard) = MAC_AWAKE_CHILD.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
            if active {
                if let Ok(child) = std::process::Command::new("caffeinate")
                    .args(&["-d", "-i", "-m"])
                    .spawn()
                {
                    *guard = Some(child);
                }
            }
        }
    }

    if let Ok(mut lock) = KEEP_AWAKE_INNER.lock() {
        lock.0 = active;
        lock.1 = if active { mode.to_string() } else { "off".to_string() };
        lock.2 = exp;
    }

    Ok(get_keep_awake_status())
}

// ---------------------------------------------------------------------------
// Helpers: Безопасное декодирование строк OEM консоли Windows (CP866 / CP1251)
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
pub fn decode_oem_string(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    // 1. Проверяем, является ли строка уже валидным UTF-8
    if let Ok(utf8_str) = std::str::from_utf8(bytes) {
        return utf8_str.to_string();
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn MultiByteToWideChar(
            CodePage: u32,
            dwFlags: u32,
            lpMultiByteStr: *const u8,
            cbMultiByte: i32,
            lpWideCharStr: *mut u16,
            cchWideChar: i32,
        ) -> i32;
    }

    // 2. Пробуем CP_OEMCP = 1 (в русскоязычной Windows это консольная CP866)
    let needed = unsafe {
        MultiByteToWideChar(
            1,
            0,
            bytes.as_ptr(),
            bytes.len() as i32,
            std::ptr::null_mut(),
            0,
        )
    };

    if needed > 0 {
        let mut buf = vec![0u16; needed as usize];
        let written = unsafe {
            MultiByteToWideChar(
                1,
                0,
                bytes.as_ptr(),
                bytes.len() as i32,
                buf.as_mut_ptr(),
                needed,
            )
        };
        if written > 0 {
            let res = String::from_utf16_lossy(&buf);
            if !res.contains('\u{FFFD}') && !res.contains('診') {
                return res;
            }
        }
    }

    // 3. Пробуем CP_ACP = 0 (ANSI кодовая страница Windows, например CP1251)
    let needed_acp = unsafe {
        MultiByteToWideChar(
            0,
            0,
            bytes.as_ptr(),
            bytes.len() as i32,
            std::ptr::null_mut(),
            0,
        )
    };

    if needed_acp > 0 {
        let mut buf = vec![0u16; needed_acp as usize];
        let written = unsafe {
            MultiByteToWideChar(
                0,
                0,
                bytes.as_ptr(),
                bytes.len() as i32,
                buf.as_mut_ptr(),
                needed_acp,
            )
        };
        if written > 0 {
            return String::from_utf16_lossy(&buf);
        }
    }

    String::from_utf8_lossy(bytes).to_string()
}

// ---------------------------------------------------------------------------
// Port & Process Dashboard (Монитор занятых портов и процессов)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PortEntry {
    pub protocol: String,
    pub local_address: String,
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub memory_mb: f64,
    pub is_dev_port: bool,
    pub category: String,
}

pub fn get_listening_ports() -> Result<Vec<PortEntry>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let mut proc_map: std::collections::HashMap<u32, (String, f64)> = std::collections::HashMap::new();
        if let Ok(task_out) = std::process::Command::new("tasklist")
            .args(&["/FO", "CSV", "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let text = decode_oem_string(&task_out.stdout);
            for line in text.lines() {
                let parts: Vec<&str> = line.split("\",\"").collect();
                if parts.len() >= 5 {
                    let name = parts[0].trim_matches('"').to_string();
                    let pid_str = parts[1].trim();
                    let mem_raw = parts[4].trim_matches('"');
                    let mem_cleaned: String = mem_raw.chars().filter(|c| c.is_ascii_digit()).collect();
                    let mem_kb: f64 = mem_cleaned.parse().unwrap_or(0.0);
                    let mem_mb = (mem_kb / 1024.0 * 10.0).round() / 10.0;
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        proc_map.insert(pid, (name, mem_mb));
                    }
                }
            }
        }

        let mut cmd = std::process::Command::new("netstat");
        cmd.args(&["-ano", "-p", "tcp"]);
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd.output().map_err(|e| format!("Ошибка вызова netstat: {}", e))?;
        let text = String::from_utf8_lossy(&output.stdout);

        let mut results = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for line in text.lines() {
            let line = line.trim();
            if !line.starts_with("TCP") || !line.contains("LISTENING") {
                continue;
            }
            let tokens: Vec<&str> = line.split_whitespace().collect();
            if tokens.len() >= 5 {
                let local_addr = tokens[1];
                let pid_str = tokens[tokens.len() - 1];
                if let Ok(pid) = pid_str.parse::<u32>() {
                    if let Some(colon_pos) = local_addr.rfind(':') {
                        if let Ok(port) = local_addr[colon_pos + 1..].parse::<u16>() {
                            let key = (port, pid);
                            if seen.contains(&key) {
                                continue;
                            }
                            seen.insert(key);

                            let (proc_name, mem_mb) = proc_map
                                .get(&pid)
                                .cloned()
                                .unwrap_or_else(|| ("Неизвестно".to_string(), 0.0));

                            let is_dev_port = matches!(
                                port,
                                3000..=3010 | 5000 | 5173..=5176 | 7860 | 8000 | 8080..=8085 | 8888 | 9000 | 9222
                            );

                            let category = match port {
                                3000..=3010 | 5173..=5176 | 8000 | 8080..=8085 | 7860 | 4200 => "Web / Dev".to_string(),
                                5432 | 3306 | 27017 | 6379 | 1433 | 8086 => "База данных".to_string(),
                                135 | 445 | 139 | 53 | 80 | 443 => "Система / ОС".to_string(),
                                _ => "Служба".to_string(),
                            };

                            results.push(PortEntry {
                                protocol: "TCP".to_string(),
                                local_address: local_addr.to_string(),
                                port,
                                pid,
                                process_name: proc_name,
                                memory_mb: mem_mb,
                                is_dev_port,
                                category,
                            });
                        }
                    }
                }
            }
        }

        results.sort_by(|a, b| {
            b.is_dev_port.cmp(&a.is_dev_port).then_with(|| a.port.cmp(&b.port))
        });

        Ok(results)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // macOS / Linux: lsof -iTCP -sTCP:LISTEN -P -n
        let mut cmd = std::process::Command::new("lsof");
        cmd.args(&["-iTCP", "-sTCP:LISTEN", "-P", "-n"]);
        let mut results = Vec::new();
        let mut seen = std::collections::HashSet::new();

        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines().skip(1) {
                    let tokens: Vec<&str> = line.split_whitespace().collect();
                    if tokens.len() >= 9 {
                        let proc_name = tokens[0].to_string();
                        let pid = tokens[1].parse::<u32>().unwrap_or(0);
                        let name_col = tokens[tokens.len() - 2];
                        if let Some(pos) = name_col.rfind(':') {
                            if let Ok(port) = name_col[pos + 1..].parse::<u16>() {
                                let key = (port, pid);
                                if seen.contains(&key) {
                                    continue;
                                }
                                seen.insert(key);

                                let is_dev_port = matches!(
                                    port,
                                    3000..=3010 | 5000 | 5173..=5176 | 7860 | 8000 | 8080..=8085 | 8888 | 9000 | 9222
                                );

                                let category = match port {
                                    3000..=3010 | 5173..=5176 | 8000 | 8080..=8085 | 7860 | 4200 => "Web / Dev".to_string(),
                                    5432 | 3306 | 27017 | 6379 | 1433 | 8086 => "База данных".to_string(),
                                    _ => "Служба".to_string(),
                                };

                                results.push(PortEntry {
                                    protocol: "TCP".to_string(),
                                    local_address: name_col.to_string(),
                                    port,
                                    pid,
                                    process_name: proc_name,
                                    memory_mb: 0.0,
                                    is_dev_port,
                                    category,
                                });
                            }
                        }
                    }
                }
            }
        }

        results.sort_by(|a, b| {
            b.is_dev_port.cmp(&a.is_dev_port).then_with(|| a.port.cmp(&b.port))
        });

        Ok(results)
    }
}

pub fn kill_process_by_pid(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // 1. Попытка мгновенного прямого завершения через Win32 API OpenProcess + TerminateProcess
        #[link(name = "kernel32")]
        extern "system" {
            fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> *mut std::ffi::c_void;
            fn TerminateProcess(hProcess: *mut std::ffi::c_void, uExitCode: u32) -> i32;
            fn CloseHandle(hObject: *mut std::ffi::c_void) -> i32;
            fn GetLastError() -> u32;
        }

        const PROCESS_TERMINATE: u32 = 0x0001;

        if pid == 0 || pid == 4 {
            return Err(format!("PID {} — критический системный процесс ядра Windows (System / Idle). Завершение защищено системой.", pid));
        }

        let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
        if !handle.is_null() {
            let res = unsafe { TerminateProcess(handle, 1) };
            unsafe { CloseHandle(handle) };
            if res != 0 {
                return Ok(());
            }
        } else {
            let err_code = unsafe { GetLastError() };
            if err_code == 5 {
                // ERROR_ACCESS_DENIED
                return Err(format!(
                    "Отказано в доступе: процесс PID {} защищен системой (SYSTEM) или системной службой. Для завершения требуются права администратора.",
                    pid
                ));
            } else if err_code == 87 {
                // ERROR_INVALID_PARAMETER
                return Err(format!("Процесс PID {} не найден или уже завершён.", pid));
            }
        }

        // 2. Вторая попытка через taskkill /F /T
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = std::process::Command::new("taskkill");
        cmd.args(&["/F", "/T", "/PID", &pid.to_string()]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let out = cmd.output().map_err(|e| format!("Не удалось выполнить taskkill: {}", e))?;
        if out.status.success() {
            Ok(())
        } else {
            let decoded_err = decode_oem_string(&out.stderr);
            let lower = decoded_err.to_lowercase();
            if lower.contains("отказано") || lower.contains("access is denied") || lower.contains("access denied") {
                Err(format!(
                    "Отказано в доступе: процесс PID {} защищен системой (SYSTEM) или системной службой. Для завершения требуются права администратора.",
                    pid
                ))
            } else if lower.contains("не найден") || lower.contains("not found") {
                Err(format!("Процесс PID {} уже завершен или не существует.", pid))
            } else {
                let clean = decoded_err.trim().to_string();
                if clean.is_empty() || clean.contains('\u{FFFD}') || clean.contains('診') {
                    Err(format!("Отказано в доступе: процесс PID {} защищен системой. Для завершения требуются права администратора.", pid))
                } else {
                    Err(format!("Ошибка завершения процесса PID {}: {}", pid, clean))
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = std::process::Command::new("kill");
        cmd.args(&["-9", &pid.to_string()]);
        let out = cmd.output().map_err(|e| format!("Не удалось выполнить kill: {}", e))?;
        if out.status.success() {
            Ok(())
        } else {
            let err = String::from_utf8_lossy(&out.stderr);
            let lower = err.to_lowercase();
            if lower.contains("operation not permitted") || lower.contains("permission denied") {
                Err(format!(
                    "Отказано в доступе: процесс PID {} защищен macOS (SIP) или принадлежит root. Требуются права суперпользователя.",
                    pid
                ))
            } else {
                Err(format!("Ошибка завершения процесса PID {}: {}", pid, err.trim()))
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Screen Color Inspector (Захват пикселя экрана через Win32 GDI)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScreenPixelColor {
    pub hex: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

pub fn pick_screen_color_at_cursor() -> Result<ScreenPixelColor, String> {
    #[cfg(target_os = "windows")]
    {
        #[repr(C)]
        struct POINT {
            x: i32,
            y: i32,
        }
        #[link(name = "user32")]
        extern "system" {
            fn GetCursorPos(lpPoint: *mut POINT) -> i32;
            fn GetDC(hWnd: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
            fn ReleaseDC(hWnd: *mut std::ffi::c_void, hDC: *mut std::ffi::c_void) -> i32;
        }
        #[link(name = "gdi32")]
        extern "system" {
            fn GetPixel(hdc: *mut std::ffi::c_void, x: i32, y: i32) -> u32;
        }

        unsafe {
            let mut pt = POINT { x: 0, y: 0 };
            GetCursorPos(&mut pt);
            let hdc = GetDC(std::ptr::null_mut());
            if hdc.is_null() {
                return Err("Не удалось получить контекст экрана (GetDC)".to_string());
            }
            let color = GetPixel(hdc, pt.x, pt.y);
            ReleaseDC(std::ptr::null_mut(), hdc);

            let r = (color & 0xFF) as u8;
            let g = ((color >> 8) & 0xFF) as u8;
            let b = ((color >> 16) & 0xFF) as u8;
            let hex = format!("#{:02X}{:02X}{:02X}", r, g, b);

            Ok(ScreenPixelColor { hex, r, g, b })
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Поддерживается только на Windows".to_string())
    }
}
