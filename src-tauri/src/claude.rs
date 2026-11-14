use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCodeInfo {
    pub installed: bool,
    pub path: String,
    #[serde(rename = "machineID")]
    pub machine_id: String,
    #[serde(rename = "userID")]
    pub user_id: String,
    #[serde(rename = "firstStartTime")]
    pub first_start_time: String,
    #[serde(rename = "firstStartVersion")]
    pub first_start_version: String,
    pub telemetry_files: usize,
    pub file_history_count: usize,
    pub projects_count: usize,
    pub sessions_count: usize,
    pub oauth_email: Option<String>,
    pub oauth_org_id: Option<String>,
    pub oauth_org_name: Option<String>,
    pub billing_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeResetResult {
    pub success: bool,
    #[serde(rename = "machineID")]
    pub machine_id: String,
    #[serde(rename = "userID")]
    pub user_id: String,
    pub cleaned_files: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreDeduction {
    pub category: String,
    pub points: i32,
    pub passed: bool,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AntiBanPillar {
    pub id: String,
    pub name: String,
    pub max_score: u32,
    pub current_score: u32,
    pub passed: bool,
    pub status: String,
    pub details: String,
    pub action_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeNetworkAudit {
    pub egress_ip: String,
    pub egress_loc: String,
    pub egress_colo: String,
    pub cf_ip: String,
    pub cf_loc: String,
    pub isp: String,
    pub asn: String,
    pub is_datacenter: bool,
    pub country_name: String,
    pub city: String,
    pub timezone: String,
    pub system_timezone: String,
    pub timezone_skew_detected: bool,
    pub split_tunnel_detected: bool,
    pub is_restricted_country: bool,
    pub risk_level: String, // "safe", "warning", "critical"
    pub trust_score: u32,
    pub anti_ban_index: u32,
    pub pillars: Vec<AntiBanPillar>,
    pub score_breakdown: Vec<ScoreDeduction>,
    pub risk_reasons: Vec<String>,
    pub recommendations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeProfileResult {
    pub success: bool,
    pub profile_name: String,
    pub profile_path: String,
    #[serde(rename = "machineID")]
    pub machine_id: String,
    #[serde(rename = "userID")]
    pub user_id: String,
    pub bat_script: String,
    pub sh_script: String,
    pub target_tz: Option<String>,
    pub error: Option<String>,
}

pub fn get_user_home() -> PathBuf {
    dirs::home_dir()
        .or_else(|| std::env::var("USERPROFILE").ok().map(PathBuf::from))
        .or_else(|| std::env::var("HOME").ok().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn get_claude_code_info() -> ClaudeCodeInfo {
    let home = get_user_home();
    let claude_json_path = home.join(".claude.json");
    let path_str = claude_json_path.to_string_lossy().to_string();

    let mut info = ClaudeCodeInfo {
        installed: false,
        path: path_str,
        machine_id: "Не найден".to_string(),
        user_id: "Не найден".to_string(),
        first_start_time: "Не зафиксировано".to_string(),
        first_start_version: "N/A".to_string(),
        telemetry_files: 0,
        file_history_count: 0,
        projects_count: 0,
        sessions_count: 0,
        oauth_email: None,
        oauth_org_id: None,
        oauth_org_name: None,
        billing_type: None,
    };

    if claude_json_path.exists() {
        info.installed = true;
        if let Ok(content) = fs::read_to_string(&claude_json_path) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(m_id) = json_val.get("machineID").and_then(|v| v.as_str()) {
                    info.machine_id = m_id.to_string();
                }
                if let Some(u_id) = json_val.get("userID").and_then(|v| v.as_str()) {
                    info.user_id = u_id.to_string();
                }
                if let Some(fst) = json_val.get("firstStartTime").and_then(|v| v.as_str()) {
                    info.first_start_time = fst.to_string();
                }
                if let Some(fsv) = json_val.get("firstStartVersion").and_then(|v| v.as_str()) {
                    info.first_start_version = fsv.to_string();
                }

                // Parse OAuth Account if present
                if let Some(oauth) = json_val.get("oauthAccount") {
                    if let Some(acc) = oauth.get("account") {
                        if let Some(email) = acc.get("emailAddress").and_then(|v| v.as_str()) {
                            info.oauth_email = Some(email.to_string());
                        }
                    }
                    if let Some(org_id) = oauth.get("organizationId").and_then(|v| v.as_str()) {
                        info.oauth_org_id = Some(org_id.to_string());
                    }
                    if let Some(org_name) = oauth.get("organizationName").and_then(|v| v.as_str()) {
                        info.oauth_org_name = Some(org_name.to_string());
                    }
                    if let Some(billing) = oauth.get("billingType").and_then(|v| v.as_str()) {
                        info.billing_type = Some(billing.to_string());
                    }
                }

                // Count projects listed in .claude.json
                if let Some(projects) = json_val.get("projects").and_then(|v| v.as_object()) {
                    info.projects_count = projects.len();
                }
            }
        }
    }

    let claude_dir = home.join(".claude");
    if claude_dir.exists() && claude_dir.is_dir() {
        // Count telemetry files
        let telem_dir = claude_dir.join("telemetry");
        if telem_dir.exists() && telem_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(telem_dir) {
                info.telemetry_files = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
                    .count();
            }
        }

        // Count file-history files
        let fh_dir = claude_dir.join("file-history");
        if fh_dir.exists() && fh_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(fh_dir) {
                info.file_history_count = entries
                    .filter_map(|e| e.ok())
                    .count();
            }
        }

        // Count sessions
        let sess_dir = claude_dir.join("sessions");
        if sess_dir.exists() && sess_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(sess_dir) {
                info.sessions_count = entries
                    .filter_map(|e| e.ok())
                    .count();
            }
        }
    }

    info
}

pub fn reset_claude_code() -> ClaudeResetResult {
    let home = get_user_home();
    let claude_json_path = home.join(".claude.json");

    let raw_uuid = Uuid::new_v4().to_string();
    let mut hasher = Sha256::new();
    hasher.update(raw_uuid.as_bytes());
    let new_machine_id = format!("{:x}", hasher.finalize());

    let u1 = Uuid::new_v4().simple().to_string();
    let u2 = Uuid::new_v4().simple().to_string();
    let new_user_id = format!("{}{}", u1, u2);

    let mut root_json: serde_json::Value = if claude_json_path.exists() {
        fs::read_to_string(&claude_json_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if let Some(map) = root_json.as_object_mut() {
        map.insert("machineID".to_string(), serde_json::json!(new_machine_id));
        map.insert("userID".to_string(), serde_json::json!(new_user_id));
        let now_str = chrono::Utc::now().to_rfc3339();
        map.insert("firstStartTime".to_string(), serde_json::json!(now_str));
    }

    if let Ok(serialized) = serde_json::to_string_pretty(&root_json) {
        if let Err(e) = fs::write(&claude_json_path, serialized) {
            return ClaudeResetResult {
                success: false,
                machine_id: String::new(),
                user_id: String::new(),
                cleaned_files: 0,
                error: Some(format!("Не удалось сохранить ~/.claude.json: {}", e)),
            };
        }
    }

    let claude_dir = home.join(".claude");
    let mut cleaned_files = 0;

    let subdirs_to_clean = ["telemetry", "file-history", "shell-snapshots", "sessions"];
    for sub in subdirs_to_clean {
        let dir = claude_dir.join(sub);
        if dir.exists() && dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if fs::remove_file(&path).is_ok() {
                            cleaned_files += 1;
                        }
                    } else if path.is_dir() {
                        if fs::remove_dir_all(&path).is_ok() {
                            cleaned_files += 1;
                        }
                    }
                }
            }
        }
    }

    ClaudeResetResult {
        success: true,
        machine_id: new_machine_id,
        user_id: new_user_id,
        cleaned_files,
        error: None,
    }
}

pub fn open_claude_folder() -> Result<(), String> {
    let home = get_user_home();
    let claude_dir = home.join(".claude");
    if !claude_dir.exists() {
        let _ = fs::create_dir_all(&claude_dir);
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(claude_dir.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("Ошибка открытия проводника: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(claude_dir.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("Ошибка открытия Finder: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(claude_dir.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("Ошибка открытия файлового менеджера: {}", e))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Операционная система не поддерживается".into())
}

// ---------------------------------------------------------------------------
// Network & IP Risk Inspector + Custom Proxy Tester
// ---------------------------------------------------------------------------

pub fn fetch_cf_trace(url: &str, proxy: Option<&str>) -> Result<HashMap<String, String>, String> {
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut cmd = Command::new("curl");
    let mut args = vec!["-s", "-m", "7", url];
    if let Some(p) = proxy {
        if !p.trim().is_empty() {
            args.insert(0, "-x");
            args.insert(1, p.trim());
        }
    }
    cmd.args(&args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd.output().map_err(|e| format!("curl query failed: {}", e))?;
    if !out.status.success() {
        return Err(format!("curl error code {:?}", out.status.code()));
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut map = HashMap::new();
    for line in text.lines() {
        if let Some((k, v)) = line.split_once('=') {
            map.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    Ok(map)
}

fn fetch_ip_api_json(ip: &str, proxy: Option<&str>) -> Option<serde_json::Value> {
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let url = if ip.is_empty() {
        "http://ip-api.com/json".to_string()
    } else {
        format!("http://ip-api.com/json/{}", ip)
    };

    let mut cmd = Command::new("curl");
    let mut args = vec!["-s", "-m", "7", &url];
    if let Some(p) = proxy {
        if !p.trim().is_empty() {
            args.insert(0, "-x");
            args.insert(1, p.trim());
        }
    }
    cmd.args(&args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }

    serde_json::from_slice(&out.stdout).ok()
}

pub fn get_current_system_timezone() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new("tzutil");
        cmd.arg("/g");
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                return String::from_utf8_lossy(&out.stdout).trim().to_string();
            }
        }
    }
    "Russian Standard Time".to_string()
}

pub fn audit_claude_network() -> Result<ClaudeNetworkAudit, String> {
    let result = audit_claude_network_internal(None);
    if result.is_err() {
        crate::killswitch::revoke_network_trust("Сетевой аудит завершился ошибкой");
    }
    result
}

pub fn test_custom_proxy(proxy_url: String) -> Result<ClaudeNetworkAudit, String> {
    if proxy_url.trim().is_empty() {
        return Err("Укажите адрес прокси (например: socks5://127.0.0.1:1080 или http://user:pass@ip:port)".to_string());
    }
    audit_claude_network_internal(Some(&proxy_url))
}

fn audit_claude_network_internal(proxy: Option<&str>) -> Result<ClaudeNetworkAudit, String> {
    // 1. First stealth probe via neutral Cloudflare edge (1.1.1.1).
    // This avoids leaking Russian IP or abnormal requests to claude.ai directly!
    let cf_trace = fetch_cf_trace("https://1.1.1.1/cdn-cgi/trace", proxy)
        .map_err(|e| format!("Не удалось проверить сетевой периметр{}: {}. Проверьте подключение или настройки прокси.", if proxy.is_some() { " через прокси" } else { "" }, e))?;

    let cf_ip = cf_trace.get("ip").cloned().unwrap_or_else(|| "127.0.0.1".to_string());
    let cf_loc = cf_trace.get("loc").cloned().unwrap_or_else(|| "XX".to_string()).to_uppercase();
    let cf_colo = cf_trace.get("colo").cloned().unwrap_or_else(|| "N/A".to_string());

    let restricted_list = ["RU", "BY", "CN", "HK", "MO", "IR", "KP", "SY", "CU", "VE"];
    let is_neutral_restricted = restricted_list.contains(&cf_loc.as_str());

    // 2. Only probe claude.ai if neutral check already confirms non-restricted country (e.g. NL, US, DE).
    // If the user's IP is in RU/BY, we NEVER send packets to claude.ai!
    let (egress_ip, egress_loc, egress_colo) = if !is_neutral_restricted {
        match fetch_cf_trace("https://claude.ai/cdn-cgi/trace", proxy) {
            Ok(t) => {
                let ip = t.get("ip").cloned().unwrap_or_else(|| cf_ip.clone());
                let loc = t.get("loc").cloned().unwrap_or_else(|| cf_loc.clone()).to_uppercase();
                let colo = t.get("colo").cloned().unwrap_or_else(|| cf_colo.clone());
                (ip, loc, colo)
            }
            Err(_) => (cf_ip.clone(), cf_loc.clone(), cf_colo.clone())
        }
    } else {
        (cf_ip.clone(), cf_loc.clone(), cf_colo.clone())
    };

    let ip_data = fetch_ip_api_json(&egress_ip, proxy);
    let country_name = ip_data.as_ref()
        .and_then(|j| j.get("country").and_then(|v| v.as_str()))
        .unwrap_or("Неизвестно")
        .to_string();
    let city = ip_data.as_ref()
        .and_then(|j| j.get("city").and_then(|v| v.as_str()))
        .unwrap_or("Неизвестно")
        .to_string();
    let isp = ip_data.as_ref()
        .and_then(|j| j.get("isp").and_then(|v| v.as_str()))
        .unwrap_or("Неизвестно")
        .to_string();
    let asn = ip_data.as_ref()
        .and_then(|j| j.get("as").and_then(|v| v.as_str()))
        .unwrap_or("Неизвестно")
        .to_string();
    let timezone = ip_data.as_ref()
        .and_then(|j| j.get("timezone").and_then(|v| v.as_str()))
        .unwrap_or("UTC")
        .to_string();

    let system_tz = get_current_system_timezone();
    let mapped_win_tz = iana_to_windows_tz(&timezone);
    let timezone_skew_detected = system_tz != mapped_win_tz;

    let split_tunnel_detected = !cf_ip.is_empty() && !egress_ip.is_empty() && (cf_ip != egress_ip);

    let restricted_list = ["RU", "BY", "CN", "HK", "MO", "IR", "KP", "SY", "CU", "VE"];
    let is_restricted = restricted_list.contains(&egress_loc.as_str())
        || restricted_list.contains(&cf_loc.as_str())
        || crate::killswitch::is_country_restricted(&country_name)
        || crate::killswitch::is_country_restricted(&egress_loc)
        || crate::killswitch::is_country_restricted(&cf_loc);

    let isp_lower = isp.to_lowercase();
    let is_datacenter = isp_lower.contains("hosting")
        || isp_lower.contains("server")
        || isp_lower.contains("cloud")
        || isp_lower.contains("digitalocean")
        || isp_lower.contains("hetzner")
        || isp_lower.contains("ovh")
        || isp_lower.contains("linode")
        || isp_lower.contains("amazon")
        || isp_lower.contains("google")
        || isp_lower.contains("microsoft")
        || isp_lower.contains("mastersoft")
        || isp_lower.contains("m24")
        || isp_lower.contains("vps");

    // Dynamic Trust Score Calculation with detailed itemized deductions
    let mut score_breakdown = Vec::new();
    let mut reasons = Vec::new();
    let mut recommendations = Vec::new();

    // -----------------------------------------------------------------------
    // ToolHub Composite 5-Pillar Anti-Ban Matrix Calculation
    // -----------------------------------------------------------------------
    let code_info = get_claude_code_info();
    let is_valid_machine_id = code_info.machine_id.len() == 64 && code_info.machine_id.chars().all(|c| c.is_ascii_hexdigit());
    let telemetry_queue = code_info.telemetry_files;

    let home = get_user_home();
    let profiles_root = home.join(".claude-profiles");
    let mut profiles_count = 0;
    if profiles_root.exists() {
        if let Ok(entries) = fs::read_dir(&profiles_root) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    profiles_count += 1;
                }
            }
        }
    }

    let killswitch_active = crate::killswitch::KILLSWITCH_ENABLED.load(std::sync::atomic::Ordering::SeqCst);
    let tz_synced = !timezone_skew_detected;

    // Pillar 1: HWID & Clean Device State (max 25)
    let (p1_score, p1_passed, p1_status, p1_details, p1_act) = if is_valid_machine_id && telemetry_queue == 0 {
        (25, true, "Чистый HWID".to_string(), format!("Уникальный machineID ({:.12}...), телеметрия чиста", code_info.machine_id), None)
    } else if is_valid_machine_id {
        (18, false, format!("В очереди: {} ф.", telemetry_queue), "В ~/.claude/telemetry есть накопленные файлы телеметрии".to_string(), Some("reset_hwid".to_string()))
    } else {
        (10, false, "Не настроен".to_string(), "Конфигурация ~/.claude.json не найдена".to_string(), Some("reset_hwid".to_string()))
    };

    // Pillar 2: Profile Isolation (max 20)
    let (p2_score, p2_passed, p2_status, p2_details, p2_act) = if profiles_count > 0 {
        (20, true, format!("Изолирован ({} проф.)", profiles_count), "Профили используют независимые каталоги сессий".to_string(), None)
    } else {
        (10, false, "Общий каталог ~/.claude".to_string(), "Рекомендуется создать отдельный профиль сессии".to_string(), Some("create_profile".to_string()))
    };

    // Pillar 3: Network & VPN Gateways (max 25)
    let (p3_score, p3_passed, p3_status, p3_details) = if is_restricted {
        (0, false, format!("Блокировка ({})", egress_loc), format!("IP в санкционной зоне ({}: {}). Вход приведет к немедленному бану.", egress_loc, country_name))
    } else {
        let base = 15;
        let split_bonus = if split_tunnel_detected { 0 } else { 7 };
        let isp_bonus = if is_datacenter { 1 } else { 3 };
        let score = base + split_bonus + isp_bonus;
        let status = if split_tunnel_detected {
            "Split-Tunneling!".to_string()
        } else if is_datacenter {
            "Серверный VPN (DC)".to_string()
        } else {
            "Резидентный ISP".to_string()
        };
        let details = if split_tunnel_detected {
            "Разделение DNS/шлюзов: риск утечки системного IP".to_string()
        } else if is_datacenter {
            format!("VPN сервер: {} ({}). Шлюзы чистые, при чистом HWID риск минимален.", isp, asn)
        } else {
            format!("Домашний оператор: {} ({}). Максимальный уровень доверия.", isp, asn)
        };
        (score, !split_tunnel_detected, status, details)
    };

    // Pillar 4: Timezone Geo-Coherence (max 15)
    let (p4_score, p4_passed, p4_status, p4_details, p4_act) = if tz_synced {
        (15, true, "Синхронно".to_string(), format!("Зона Windows ({}) синхронизирована с локацией IP ({})", system_tz, timezone), None)
    } else {
        (0, false, "Рассинхрон".to_string(), format!("Система: '{}' vs IP: '{}' ({})", system_tz, timezone, mapped_win_tz), Some("sync_tz".to_string()))
    };

    // Pillar 5: KillSwitch Protection (max 15)
    let (p5_score, p5_passed, p5_status, p5_details, p5_act) = if killswitch_active {
        (15, true, "Активен".to_string(), "Блокирует запуск Claude при отключённом VPN".to_string(), None)
    } else {
        (0, false, "Отключён".to_string(), "Фильтр выключен: при сбое VPN возможна утечка реального IP".to_string(), Some("toggle_killswitch".to_string()))
    };

    let pillars = vec![
        AntiBanPillar {
            id: "hwid".to_string(),
            name: "Отпечаток устройства (HWID)".to_string(),
            max_score: 25,
            current_score: p1_score,
            passed: p1_passed,
            status: p1_status,
            details: p1_details,
            action_type: p1_act,
        },
        AntiBanPillar {
            id: "profile".to_string(),
            name: "Изоляция профиля".to_string(),
            max_score: 20,
            current_score: p2_score,
            passed: p2_passed,
            status: p2_status,
            details: p2_details,
            action_type: p2_act,
        },
        AntiBanPillar {
            id: "network".to_string(),
            name: "Сетевой шлюз (VPN)".to_string(),
            max_score: 25,
            current_score: p3_score,
            passed: p3_passed,
            status: p3_status,
            details: p3_details,
            action_type: None,
        },
        AntiBanPillar {
            id: "timezone".to_string(),
            name: "Часовой пояс".to_string(),
            max_score: 15,
            current_score: p4_score,
            passed: p4_passed,
            status: p4_status,
            details: p4_details,
            action_type: p4_act,
        },
        AntiBanPillar {
            id: "killswitch".to_string(),
            name: "Защитный фильтр сети".to_string(),
            max_score: 15,
            current_score: p5_score,
            passed: p5_passed,
            status: p5_status,
            details: p5_details,
            action_type: p5_act,
        },
    ];

    let anti_ban_index: u32 = if is_restricted {
        0
    } else {
        (p1_score + p2_score + p3_score + p4_score + p5_score).clamp(0, 100)
    };

    // Populate itemized deductions
    if is_restricted {
        score_breakdown.push(ScoreDeduction {
            category: "Гео-юрисдикция".to_string(),
            points: -100,
            passed: false,
            details: format!("Критический бан-регион: {} ({}). Запросы запрещены правилами Anthropic.", egress_loc, country_name),
        });
        reasons.push(format!("КРИТИЧЕСКИЙ РИСК: Выходной IP находится в заблокированной юрисдикции ({}: {}). Вход приведет к бану.", egress_loc, country_name));
        recommendations.push("НЕМЕДЛЕННО включите VPN с выходом в разрешённой стране (US, GB, DE, NL, JP, SG).".to_string());
    } else {
        score_breakdown.push(ScoreDeduction {
            category: "Гео-юрисдикция".to_string(),
            points: 0,
            passed: true,
            details: format!("Разрешенная страна: {} ({})", country_name, egress_loc),
        });

        if is_datacenter {
            score_breakdown.push(ScoreDeduction {
                category: "Тип провайдера (ASN)".to_string(),
                points: -2,
                passed: true,
                details: format!("Серверный ASN хостинга: {} ({}). Допустимый VPN-шлюз. При чистом HWID угроза бана отсутствует.", isp, asn),
            });
        } else {
            score_breakdown.push(ScoreDeduction {
                category: "Тип провайдера (ASN)".to_string(),
                points: 0,
                passed: true,
                details: format!("Резидентный оператор (ISP): {}", isp),
            });
        }

        if timezone_skew_detected {
            score_breakdown.push(ScoreDeduction {
                category: "Часовой пояс (Timezone Skew)".to_string(),
                points: -15,
                passed: false,
                details: format!("Рассинхрон: ПК настроен на '{}', а IP находится в поясе '{}' ('{}').", system_tz, timezone, mapped_win_tz),
            });
            reasons.push(format!("Рассинхрон часового пояса: система сообщает '{}', в то время как IP находится в '{}'. Нажмите «Синхронизировать часовой пояс».", system_tz, timezone));
        } else {
            score_breakdown.push(ScoreDeduction {
                category: "Часовой пояс (Timezone Skew)".to_string(),
                points: 0,
                passed: true,
                details: format!("Часовой пояс Windows синхронен с IP ('{}')", system_tz),
            });
        }

        if split_tunnel_detected {
            score_breakdown.push(ScoreDeduction {
                category: "Маршрутизация (Split-Tunneling)".to_string(),
                points: -20,
                passed: false,
                details: format!("Разделение маршрутов: claude.ai идет через {}, а 1.1.1.1 через {}.", egress_ip, cf_ip),
            });
            reasons.push("Обнаружен Split-Tunneling: трафик разделяется, возможна утечка реального системного DNS.".to_string());
            recommendations.push("Включите Global TUN Mode в вашем VPN/прокси-клиенте.".to_string());
        } else {
            score_breakdown.push(ScoreDeduction {
                category: "Маршрутизация (Split-Tunneling)".to_string(),
                points: 0,
                passed: true,
                details: "Шлюзы 1.1.1.1 и claude.ai полностью совпадают. Трафик не разделяется.".to_string(),
            });
        }
    }

    let risk_level = if is_restricted {
        "critical".to_string()
    } else if anti_ban_index >= 85 {
        "safe".to_string()
    } else if anti_ban_index >= 60 {
        "warning".to_string()
    } else {
        "critical".to_string()
    };

    if risk_level == "safe" {
        recommendations.push("Сетевой периметр и HWID чисты: IP разрешен, KillSwitch активен, таймзона выровнена.".to_string());
    }

    // Synchronize network safety state with the KillSwitch
    let is_network_safe = !is_restricted && p3_score >= 15;
    if proxy.is_none() {
        crate::killswitch::update_network_safety(is_network_safe, &egress_ip, &country_name, anti_ban_index, split_tunnel_detected);
    }

    Ok(ClaudeNetworkAudit {
        egress_ip,
        egress_loc,
        egress_colo,
        cf_ip,
        cf_loc,
        isp,
        asn,
        is_datacenter,
        country_name,
        city,
        timezone,
        system_timezone: system_tz,
        timezone_skew_detected,
        split_tunnel_detected,
        is_restricted_country: is_restricted,
        risk_level,
        trust_score: anti_ban_index,
        anti_ban_index,
        pillars,
        score_breakdown,
        risk_reasons: reasons,
        recommendations,
    })
}

// ---------------------------------------------------------------------------
// Timezone Management (Синхронизация таймзоны Windows с IP)
// ---------------------------------------------------------------------------

pub fn iana_to_windows_tz(iana: &str) -> &'static str {
    let lower = iana.to_lowercase();
    if lower.contains("amsterdam") || lower.contains("berlin") || lower.contains("paris") || lower.contains("rome") || lower.contains("madrid") || lower.contains("warsaw") || lower.contains("vienna") || lower.contains("brussels") {
        "W. Europe Standard Time"
    } else if lower.contains("london") || lower.contains("dublin") || lower.contains("lisbon") {
        "GMT Standard Time"
    } else if lower.contains("new_york") || lower.contains("detroit") || lower.contains("toronto") || lower.contains("montreal") {
        "Eastern Standard Time"
    } else if lower.contains("chicago") || lower.contains("houston") || lower.contains("winnipeg") {
        "Central Standard Time"
    } else if lower.contains("denver") || lower.contains("phoenix") || lower.contains("calgary") {
        "Mountain Standard Time"
    } else if lower.contains("los_angeles") || lower.contains("san_francisco") || lower.contains("seattle") || lower.contains("vancouver") {
        "Pacific Standard Time"
    } else if lower.contains("tokyo") {
        "Tokyo Standard Time"
    } else if lower.contains("singapore") {
        "Singapore Standard Time"
    } else if lower.contains("helsinki") || lower.contains("athens") || lower.contains("kyiv") || lower.contains("bucharest") {
        "FLE Standard Time"
    } else if lower.contains("moscow") || lower.contains("petersburg") {
        "Russian Standard Time"
    } else {
        "W. Europe Standard Time"
    }
}

pub fn sync_system_timezone(iana_tz: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let current_tz = get_current_system_timezone();
        let target_tz_id = iana_to_windows_tz(&iana_tz);

        // Save original timezone to backup file if not already saved
        let home = get_user_home();
        let profiles_dir = home.join(".claude-profiles");
        let _ = fs::create_dir_all(&profiles_dir);
        let backup_file = profiles_dir.join("original_timezone.txt");
        if !backup_file.exists() && !current_tz.is_empty() {
            let _ = fs::write(&backup_file, &current_tz);
        }

        let mut cmd = Command::new("tzutil");
        cmd.args(&["/s", target_tz_id]);
        cmd.creation_flags(CREATE_NO_WINDOW);

        let out = cmd.output().map_err(|e| format!("Ошибка вызова tzutil: {}", e))?;
        if out.status.success() {
            Ok(format!("Часовой пояс Windows успешно изменён на '{}' ({})", target_tz_id, iana_tz))
        } else {
            let err = String::from_utf8_lossy(&out.stderr);
            Err(format!("Не удалось изменить часовой пояс: {}", err.trim()))
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Смена системного часового пояса поддерживается на Windows".to_string())
    }
}

pub fn restore_system_timezone() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let home = get_user_home();
        let backup_file = home.join(".claude-profiles").join("original_timezone.txt");
        let default_restore = "Russian Standard Time".to_string();
        let original_tz = if backup_file.exists() {
            fs::read_to_string(&backup_file).unwrap_or(default_restore)
        } else {
            default_restore
        };
        let clean_tz = original_tz.trim();

        let mut cmd = Command::new("tzutil");
        cmd.args(&["/s", clean_tz]);
        cmd.creation_flags(CREATE_NO_WINDOW);

        let out = cmd.output().map_err(|e| format!("Ошибка вызова tzutil: {}", e))?;
        if out.status.success() {
            Ok(format!("Исходный часовой пояс Windows восстановлен: '{}'", clean_tz))
        } else {
            let err = String::from_utf8_lossy(&out.stderr);
            Err(format!("Не удалось восстановить часовой пояс: {}", err.trim()))
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Восстановление часового пояса поддерживается на Windows".to_string())
    }
}

// ---------------------------------------------------------------------------
// Isolated Profile Generator
// ---------------------------------------------------------------------------

pub fn generate_claude_profile(profile_name: String, target_tz: Option<String>) -> Result<ClaudeProfileResult, String> {
    let clean_name = profile_name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>();

    if clean_name.is_empty() {
        return Err("Имя профиля должно содержать латинские буквы или цифры".to_string());
    }

    let home = get_user_home();
    let profiles_root = home.join(".claude-profiles");
    let target_dir = profiles_root.join(&clean_name);

    if let Err(e) = fs::create_dir_all(&target_dir) {
        return Err(format!("Не удалось создать директорию профиля: {}", e));
    }

    // Generate unique SHA-256 machineID
    let raw_uuid = Uuid::new_v4().to_string();
    let mut hasher = Sha256::new();
    hasher.update(raw_uuid.as_bytes());
    let machine_id = format!("{:x}", hasher.finalize());

    // Generate unique 64-char userID
    let u1 = Uuid::new_v4().simple().to_string();
    let u2 = Uuid::new_v4().simple().to_string();
    let user_id = format!("{}{}", u1, u2);

    let now_str = chrono::Utc::now().to_rfc3339();
    let config = serde_json::json!({
        "machineID": machine_id,
        "userID": user_id,
        "firstStartTime": now_str,
        "firstStartVersion": "0.2.32",
        "hasCompletedOnboarding": true,
        "telemetry": {
            "disabled": true
        }
    });

    let config_path = target_dir.join(".claude.json");
    if let Ok(serialized) = serde_json::to_string_pretty(&config) {
        fs::write(&config_path, serialized).map_err(|e| e.to_string())?;
    }

    let target_path_str = target_dir.to_string_lossy().to_string();

    // Dynamically apply TZ only if a verified IP timezone was provided
    let tz_trimmed = target_tz.unwrap_or_default().trim().to_string();
    let (bat_tz_line, sh_tz_line, tz_echo) = if !tz_trimmed.is_empty() {
        (
            format!("set TZ={}\r\n", tz_trimmed),
            format!("export TZ=\"{}\"\n", tz_trimmed),
            format!(" (TZ={})", tz_trimmed),
        )
    } else {
        (
            String::new(),
            String::new(),
            String::new(),
        )
    };

    let bat_script = format!(
        "@echo off\r\nset CLAUDE_CONFIG_DIR={}\r\n{}set DISABLE_TELEMETRY=1\r\nset DISABLE_ERROR_REPORTING=1\r\nset CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1\r\nset CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1\r\necho [Claude Sentinel] Isolated Profile '{}' Activated{}.\r\nclaude\r\n",
        target_path_str, bat_tz_line, clean_name, tz_echo
    );

    let sh_script = format!(
        "#!/usr/bin/env bash\nexport CLAUDE_CONFIG_DIR=\"{}\"\n{}export DISABLE_TELEMETRY=1\nexport DISABLE_ERROR_REPORTING=1\nexport CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1\nexport CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1\necho \"[Claude Sentinel] Isolated Profile '{}' Activated{}.\"\nclaude\n",
        target_path_str, sh_tz_line, clean_name, tz_echo
    );

    fs::write(target_dir.join(format!("run_{}.bat", clean_name)), &bat_script).map_err(|e| e.to_string())?;
    fs::write(target_dir.join(format!("run_{}.sh", clean_name)), &sh_script).map_err(|e| e.to_string())?;

    Ok(ClaudeProfileResult {
        success: true,
        profile_name: clean_name,
        profile_path: target_path_str,
        machine_id,
        user_id,
        bat_script,
        sh_script,
        target_tz: if !tz_trimmed.is_empty() { Some(tz_trimmed) } else { None },
        error: None,
    })
}

pub fn list_claude_profiles() -> Result<Vec<String>, String> {
    let root = get_user_home().join(".claude-profiles");
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type().map_err(|e| e.to_string())?.is_dir()
            && valid_profile_name(&name)
            && entry.path().join(format!("run_{name}.bat")).is_file()
        {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}

pub(crate) fn valid_profile_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

pub fn reset_claude_profile(name: String) -> Result<(), String> {
    if !list_claude_profiles()?.contains(&name) {
        return Err("Профиль не найден.".to_string());
    }
    let root = get_user_home().join(".claude-profiles");
    let profile = root.join(&name);
    let backup = root.join(format!(".backup-{}-{}", name, Uuid::new_v4()));
    fs::rename(&profile, &backup).map_err(|e| format!("Не удалось сохранить копию профиля: {e}"))?;
    if let Err(error) = generate_claude_profile(name, None) {
        return match fs::rename(&backup, &profile) {
            Ok(()) => Err(error),
            Err(restore) => Err(format!("{error}. Копия сохранена в {}. Ошибка восстановления: {restore}", backup.display())),
        };
    }
    Ok(())
}
