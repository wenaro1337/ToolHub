use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(windows)]
use winreg::enums::*;
#[cfg(windows)]
use winreg::RegKey;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledApp {
    pub id: String,
    pub name: String,
    pub version: String,
    pub publisher: String,
    pub install_date: String,
    pub install_location: String,
    pub uninstall_string: String,
    pub quiet_uninstall_string: String,
    pub estimated_size_kb: u64,
    pub app_type: String, // "msi", "inno", "nsis", "squirrel", "uwp", "win32"
    pub is_system_component: bool,
    pub hive: String, // "HKLM", "HKLM32", "HKCU", "UWP"
    pub display_icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeftoverItem {
    pub id: String,
    pub app_name: String,
    pub item_type: String, // "directory", "registry"
    pub path: String,
    pub size_bytes: u64,
    pub confidence: String, // "high", "medium"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UninstallExecutionResult {
    pub app_id: String,
    pub success: bool,
    pub message: String,
    pub leftovers_found: usize,
    pub leftovers_cleaned: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanLeftoversResult {
    pub deleted_count: usize,
    pub freed_bytes: u64,
    pub errors: Vec<String>,
}

/// Detect installer engine to inject accurate silent flags
pub fn detect_installer_type(uninstall_string: &str, quiet_string: &str, location: &str) -> String {
    let lower_u = uninstall_string.to_lowercase();
    let lower_q = quiet_string.to_lowercase();
    let lower_loc = location.to_lowercase();

    if lower_u.contains("msiexec") || lower_q.contains("msiexec") || lower_u.contains("/i{") || lower_u.contains("/x{") {
        return "msi".to_string();
    }
    if lower_u.contains("unins000.exe") || lower_u.contains("inno setup") || lower_loc.contains("inno") {
        return "inno".to_string();
    }
    if lower_u.contains("uninstall.exe") || lower_u.contains("uninst.exe") || lower_u.contains("nullsoft") {
        return "nsis".to_string();
    }
    if lower_u.contains("update.exe") && (lower_u.contains("--uninstall") || lower_u.contains("-uninstall")) {
        return "squirrel".to_string();
    }
    if lower_u.ends_with(".exe") || !lower_u.is_empty() {
        return "win32".to_string();
    }
    "other".to_string()
}

/// Extract MSI Product GUID `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`
fn extract_msi_guid(s: &str) -> Option<String> {
    let open_brace = s.find('{')?;
    let close_brace = s.find('}')?;
    if close_brace > open_brace && (close_brace - open_brace) == 37 {
        Some(s[open_brace..=close_brace].to_string())
    } else {
        None
    }
}

/// Parse command string into executable and arguments
fn parse_command_line(cmd: &str) -> Option<(String, Vec<String>)> {
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.starts_with('"') {
        if let Some(second_quote) = trimmed[1..].find('"') {
            let exe = &trimmed[1..=second_quote];
            let rest = trimmed[second_quote + 2..].trim();
            let args: Vec<String> = rest.split_whitespace().map(|s| s.to_string()).collect();
            return Some((exe.to_string(), args));
        }
    }

    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    if parts.is_empty() {
        return None;
    }
    let exe = parts[0].to_string();
    let args = parts[1..].iter().map(|s| s.to_string()).collect();
    Some((exe, args))
}

/// Build appropriate command and arguments for silent or normal execution
pub fn build_uninstall_command(app: &InstalledApp, silent: bool) -> Result<(String, Vec<String>), String> {
    if app.app_type == "uwp" {
        let package_name = &app.id;
        return Ok((
            "powershell.exe".to_string(),
            vec![
                "-NoProfile".to_string(),
                "-Command".to_string(),
                format!("Remove-AppxPackage -Package '{}'", package_name),
            ],
        ));
    }

    if silent && !app.quiet_uninstall_string.trim().is_empty() {
        if let Some((exe, args)) = parse_command_line(&app.quiet_uninstall_string) {
            return Ok((exe, args));
        }
    }

    let raw_cmd = if app.uninstall_string.trim().is_empty() {
        &app.quiet_uninstall_string
    } else {
        &app.uninstall_string
    };

    if raw_cmd.trim().is_empty() {
        return Err("Отсутствует строка деинсталляции для данного приложения".to_string());
    }

    if app.app_type == "msi" {
        if let Some(guid) = extract_msi_guid(raw_cmd) {
            let mut args = vec!["/X".to_string(), guid];
            if silent {
                args.push("/qn".to_string());
                args.push("/norestart".to_string());
            }
            return Ok(("msiexec.exe".to_string(), args));
        }
    }

    if let Some((exe, mut args)) = parse_command_line(raw_cmd) {
        if silent {
            match app.app_type.as_str() {
                "inno" => {
                    args.push("/VERYSILENT".to_string());
                    args.push("/SUPPRESSMSGBOXES".to_string());
                    args.push("/NORESTART".to_string());
                    args.push("/SP-".to_string());
                }
                "nsis" => {
                    args.push("/S".to_string());
                }
                "squirrel" => {
                    args.push("--uninstall".to_string());
                    args.push("-s".to_string());
                }
                _ => {
                    if !args.iter().any(|a| a.eq_ignore_ascii_case("/s") || a.eq_ignore_ascii_case("/silent")) {
                        args.push("/S".to_string());
                    }
                }
            }
        }
        return Ok((exe, args));
    }

    Err(format!("Не удалось разобрать команду удаления: {}", raw_cmd))
}

/// Calculate directory size in bytes with strict safety limits (max 500 files or 3 levels)
pub fn calculate_dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let mut count = 0;
    for entry in walkdir::WalkDir::new(path).min_depth(1).max_depth(4).into_iter().filter_map(|e| e.ok()) {
        count += 1;
        if count > 500 {
            break; // Guard against recursive traversal hanging on massive directories
        }
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                total += meta.len();
            }
        }
    }
    total
}

/// Instant scan of installed apps from Windows Registry (HKLM, WOW6432Node, HKCU, and UWP repository)
pub fn get_installed_apps() -> Vec<InstalledApp> {
    let mut apps: Vec<InstalledApp> = Vec::with_capacity(512);

    #[cfg(windows)]
    {
        // 1. Scan HKLM 64-bit (Instant ~5ms)
        scan_registry_hive(
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            "HKLM",
            &mut apps,
        );

        // 2. Scan HKLM 32-bit (Instant ~5ms)
        scan_registry_hive(
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
            "HKLM32",
            &mut apps,
        );

        // 3. Scan HKCU (Instant ~2ms)
        scan_registry_hive(
            HKEY_CURRENT_USER,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            "HKCU",
            &mut apps,
        );

        // 4. Scan UWP AppModel directly from Registry (Instant ~5ms, no PowerShell process spawn)
        scan_uwp_from_registry(&mut apps);
    }

    // Deduplicate by normalized name and version
    let mut deduped: Vec<InstalledApp> = Vec::with_capacity(apps.len());
    let mut seen = std::collections::HashSet::new();

    for app in apps {
        let key = format!("{}_{}", app.name.to_lowercase().trim(), app.version.to_lowercase().trim());
        if !seen.contains(&key) {
            seen.insert(key);
            deduped.push(app);
        }
    }

    deduped.sort_by(|a, b| {
        if a.is_system_component != b.is_system_component {
            a.is_system_component.cmp(&b.is_system_component)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    deduped
}

#[cfg(windows)]
fn scan_registry_hive(
    root: winreg::HKEY,
    subpath: &str,
    hive_name: &str,
    out: &mut Vec<InstalledApp>,
) {
    let reg_root = RegKey::predef(root);
    let uninstall_key = match reg_root.open_subkey_with_flags(subpath, KEY_READ) {
        Ok(k) => k,
        Err(_) => return,
    };

    for subkey_name in uninstall_key.enum_keys().filter_map(|k| k.ok()) {
        let app_key = match uninstall_key.open_subkey_with_flags(&subkey_name, KEY_READ) {
            Ok(k) => k,
            Err(_) => continue,
        };

        let name: String = match app_key.get_value("DisplayName") {
            Ok(n) => n,
            Err(_) => continue,
        };

        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            continue;
        }

        if trimmed_name.starts_with("KB") && trimmed_name.chars().nth(2).map_or(false, |c| c.is_ascii_digit()) {
            continue;
        }

        let system_component: u32 = app_key.get_value("SystemComponent").unwrap_or(0);
        let is_system_component = system_component == 1;

        let version: String = app_key.get_value("DisplayVersion").unwrap_or_default();
        let publisher: String = app_key.get_value("Publisher").unwrap_or_default();
        let install_date: String = app_key.get_value("InstallDate").unwrap_or_default();
        let install_location: String = app_key.get_value("InstallLocation").unwrap_or_default();
        let uninstall_string: String = app_key.get_value("UninstallString").unwrap_or_default();
        let quiet_uninstall_string: String = app_key.get_value("QuietUninstallString").unwrap_or_default();
        let display_icon: String = app_key.get_value("DisplayIcon").unwrap_or_default();

        // Use EstimatedSize registry value directly (fast, 0ms)
        let size_kb: u64 = app_key.get_value::<u32, _>("EstimatedSize").map(|s| s as u64).unwrap_or(0);

        let app_type = detect_installer_type(&uninstall_string, &quiet_uninstall_string, &install_location);

        out.push(InstalledApp {
            id: format!("{}_{}", hive_name, subkey_name),
            name: trimmed_name.to_string(),
            version: version.trim().to_string(),
            publisher: publisher.trim().to_string(),
            install_date: install_date.trim().to_string(),
            install_location: install_location.trim().to_string(),
            uninstall_string: uninstall_string.trim().to_string(),
            quiet_uninstall_string: quiet_uninstall_string.trim().to_string(),
            estimated_size_kb: size_kb,
            app_type,
            is_system_component,
            hive: hive_name.to_string(),
            display_icon: display_icon.trim().to_string(),
        });
    }
}

/// Instant pure-Rust scan of UWP packages directly from registry without launching powershell.exe
#[cfg(windows)]
fn scan_uwp_from_registry(out: &mut Vec<InstalledApp>) {
    let reg_root = RegKey::predef(HKEY_CURRENT_USER);
    let uwp_path = r"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages";
    let uwp_key = match reg_root.open_subkey_with_flags(uwp_path, KEY_READ) {
        Ok(k) => k,
        Err(_) => return,
    };

    for pkg_name in uwp_key.enum_keys().filter_map(|k| k.ok()) {
        // Filter out system internal packages
        if pkg_name.starts_with("Microsoft.Windows.") || pkg_name.starts_with("Microsoft.UI.") || pkg_name.starts_with("Microsoft.VCLibs") || pkg_name.starts_with("Microsoft.NET.") {
            continue;
        }

        let parts: Vec<&str> = pkg_name.split('_').collect();
        if parts.is_empty() {
            continue;
        }

        let raw_name = parts[0];
        let version = if parts.len() > 1 { parts[1] } else { "" };

        // Clean user friendly name
        let clean_name = raw_name
            .replace("Microsoft.", "")
            .replace("Windows.", "");

        // Only include interesting consumer apps and bloatware
        let is_interesting = clean_name.contains("Xbox")
            || clean_name.contains("Cortana")
            || clean_name.contains("Clipchamp")
            || clean_name.contains("Bing")
            || clean_name.contains("Solitaire")
            || clean_name.contains("Zune")
            || clean_name.contains("Spotify")
            || clean_name.contains("Skype")
            || clean_name.contains("Netflix")
            || clean_name.contains("CandyCrush")
            || clean_name.contains("TikTok")
            || clean_name.contains("Phone");

        if !is_interesting && clean_name.len() < 3 {
            continue;
        }

        out.push(InstalledApp {
            id: pkg_name.clone(),
            name: format!("{} [UWP]", clean_name),
            version: version.to_string(),
            publisher: "Microsoft Store".to_string(),
            install_date: String::new(),
            install_location: String::new(),
            uninstall_string: format!("Remove-AppxPackage -Package '{}'", pkg_name),
            quiet_uninstall_string: format!("Remove-AppxPackage -Package '{}'", pkg_name),
            estimated_size_kb: 0,
            app_type: "uwp".to_string(),
            is_system_component: false,
            hive: "UWP".to_string(),
            display_icon: String::new(),
        });
    }
}

/// Scan residual files/folders left behind in AppData, LocalAppData, ProgramData, Program Files
pub fn scan_leftovers(app_name: &str, install_location: &str) -> Vec<LeftoverItem> {
    let mut leftovers = Vec::new();
    let norm_name = app_name
        .to_lowercase()
        .replace("[uwp]", "")
        .replace("(64-bit)", "")
        .replace("(32-bit)", "")
        .replace("x64", "")
        .replace("x86", "")
        .trim()
        .to_string();

    if norm_name.len() < 3 {
        return leftovers;
    }

    let mut search_dirs = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        search_dirs.push(PathBuf::from(appdata));
    }
    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
        search_dirs.push(PathBuf::from(localappdata));
    }
    if let Ok(progdata) = std::env::var("ProgramData") {
        search_dirs.push(PathBuf::from(progdata));
    }

    let norm_loc = install_location.to_lowercase().trim().to_string();

    for base_path in search_dirs {
        if !base_path.exists() {
            continue;
        }

        if let Ok(entries) = std::fs::read_dir(&base_path) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                let dir_name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                let path_str = path.to_string_lossy().to_string();
                if !norm_loc.is_empty() && path_str.to_lowercase() == norm_loc {
                    continue;
                }

                if dir_name == norm_name || dir_name.starts_with(&norm_name) {
                    let size = calculate_dir_size(&path);
                    leftovers.push(LeftoverItem {
                        id: uuid::Uuid::new_v4().to_string(),
                        app_name: app_name.to_string(),
                        item_type: "directory".to_string(),
                        path: path_str,
                        size_bytes: size,
                        confidence: if dir_name == norm_name { "high".to_string() } else { "medium".to_string() },
                    });
                }
            }
        }
    }

    leftovers
}

/// Safely clean residual leftover items
pub fn clean_leftovers(paths: Vec<String>) -> CleanLeftoversResult {
    let mut deleted_count = 0;
    let mut freed_bytes = 0u64;
    let mut errors = Vec::new();

    for path_str in paths {
        let p = Path::new(&path_str);
        if !p.exists() {
            continue;
        }

        let is_safe = path_str.contains("AppData")
            || path_str.contains("ProgramData")
            || path_str.contains("Program Files");

        let is_forbidden = path_str.len() <= 3
            || path_str.eq_ignore_ascii_case("C:\\Windows")
            || path_str.eq_ignore_ascii_case("C:\\Program Files")
            || path_str.eq_ignore_ascii_case("C:\\Program Files (x86)")
            || path_str.eq_ignore_ascii_case("C:\\Users");

        if !is_safe || is_forbidden {
            errors.push(format!("Удаление заблокировано защитой: {}", path_str));
            continue;
        }

        let size = if p.is_dir() { calculate_dir_size(p) } else { p.metadata().map(|m| m.len()).unwrap_or(0) };

        let res = if p.is_dir() {
            std::fs::remove_dir_all(p)
        } else {
            std::fs::remove_file(p)
        };

        match res {
            Ok(_) => {
                deleted_count += 1;
                freed_bytes += size;
            }
            Err(e) => {
                errors.push(format!("{}: {}", path_str, e));
            }
        }
    }

    CleanLeftoversResult {
        deleted_count,
        freed_bytes,
        errors,
    }
}

/// Execute uninstallation of a single app
pub fn run_uninstall(app: &InstalledApp, silent: bool) -> Result<String, String> {
    let (exe, args) = build_uninstall_command(app, silent)?;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let mut cmd = Command::new(&exe);
        cmd.args(&args);

        if silent {
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let status = cmd
            .status()
            .map_err(|e| format!("Ошибка запуска деинсталлятора '{}': {}", exe, e))?;

        if status.success() {
            Ok(format!("Деинсталляция '{}' успешно завершена", app.name))
        } else {
            Err(format!(
                "Деинсталлятор завершился с кодом ошибки {:?}",
                status.code()
            ))
        }
    }

    #[cfg(not(windows))]
    {
        Err("Деинсталлятор поддерживается только на платформе Windows".to_string())
    }
}

/// Execute batch uninstallation of multiple applications sequentially
pub fn run_batch_uninstall(app_ids: Vec<String>, silent: bool, clean_residues: bool) -> Vec<UninstallExecutionResult> {
    let all_apps = get_installed_apps();
    let mut results = Vec::new();

    for id in app_ids {
        let app_opt = all_apps.iter().find(|a| a.id == id).cloned();
        let app = match app_opt {
            Some(a) => a,
            None => {
                results.push(UninstallExecutionResult {
                    app_id: id,
                    success: false,
                    message: "Приложение не найдено в списке установленных".to_string(),
                    leftovers_found: 0,
                    leftovers_cleaned: 0,
                });
                continue;
            }
        };

        let app_name = app.name.clone();
        let install_loc = app.install_location.clone();

        match run_uninstall(&app, silent) {
            Ok(msg) => {
                let mut found_count = 0;
                let mut cleaned_count = 0;

                if clean_residues {
                    let leftovers = scan_leftovers(&app_name, &install_loc);
                    found_count = leftovers.len();
                    if !leftovers.is_empty() {
                        let paths: Vec<String> = leftovers.into_iter().map(|l| l.path).collect();
                        let clean_res = clean_leftovers(paths);
                        cleaned_count = clean_res.deleted_count;
                    }
                }

                results.push(UninstallExecutionResult {
                    app_id: id,
                    success: true,
                    message: msg,
                    leftovers_found: found_count,
                    leftovers_cleaned: cleaned_count,
                });
            }
            Err(err) => {
                results.push(UninstallExecutionResult {
                    app_id: id,
                    success: false,
                    message: err,
                    leftovers_found: 0,
                    leftovers_cleaned: 0,
                });
            }
        }
    }

    results
}
