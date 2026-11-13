use std::fs;
use std::path::PathBuf;
use std::process::Command;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatGptInfo {
    pub installed: bool,
    pub path: String,
    #[serde(rename = "installationId")]
    pub installation_id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "cachedFiles")]
    pub cached_files: usize,
    #[serde(rename = "lastActive")]
    pub last_active: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatGptResetResult {
    pub success: bool,
    #[serde(rename = "installationId")]
    pub installation_id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "cleanedFiles")]
    pub cleaned_files: usize,
    pub error: Option<String>,
}

pub fn get_user_home() -> PathBuf {
    dirs::home_dir()
        .or_else(|| std::env::var("USERPROFILE").ok().map(PathBuf::from))
        .or_else(|| std::env::var("HOME").ok().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn get_chatgpt_dir() -> PathBuf {
    let home = get_user_home();
    let codex_dir = home.join(".codex");
    if codex_dir.exists() {
        return codex_dir;
    }
    let chatgpt_dir = home.join(".chatgpt");
    if chatgpt_dir.exists() {
        return chatgpt_dir;
    }
    let openai_dir = home.join(".openai");
    if openai_dir.exists() {
        return openai_dir;
    }
    codex_dir
}

pub fn get_chatgpt_info() -> ChatGptInfo {
    let target_dir = get_chatgpt_dir();
    let path_str = target_dir.to_string_lossy().to_string();

    let mut info = ChatGptInfo {
        installed: target_dir.exists(),
        path: path_str,
        installation_id: "Не обнаружен".to_string(),
        session_id: "N/A".to_string(),
        cached_files: 0,
        last_active: "N/A".to_string(),
    };

    if target_dir.exists() {
        // Read installation_id if present
        let install_file = target_dir.join("installation_id");
        if install_file.exists() {
            if let Ok(content) = fs::read_to_string(&install_file) {
                let trimmed = content.trim().to_string();
                if !trimmed.is_empty() {
                    info.installation_id = trimmed;
                }
            }
        }

        // Count temp/cache files in .tmp or cache directory
        let mut count = 0;
        let tmp_dir = target_dir.join(".tmp");
        if tmp_dir.exists() {
            if let Ok(entries) = fs::read_dir(tmp_dir) {
                count += entries.flatten().count();
            }
        }
        let cache_dir = target_dir.join("cache");
        if cache_dir.exists() {
            if let Ok(entries) = fs::read_dir(cache_dir) {
                count += entries.flatten().count();
            }
        }
        info.cached_files = count;

        // Last modified time
        if let Ok(meta) = fs::metadata(&target_dir) {
            if let Ok(modified) = meta.modified() {
                let dt: chrono::DateTime<chrono::Local> = modified.into();
                info.last_active = dt.format("%d.%m.%Y %H:%M").to_string();
            }
        }
    }

    info
}

pub fn reset_chatgpt_session() -> ChatGptResetResult {
    let target_dir = get_chatgpt_dir();
    if !target_dir.exists() {
        let _ = fs::create_dir_all(&target_dir);
    }

    // 1. Generate new cryptographically clean UUID v4 for installation_id
    let new_installation_id = Uuid::new_v4().to_string();
    let new_session_id = format!("sess_{}", &Uuid::new_v4().simple().to_string()[..12]);

    let install_file = target_dir.join("installation_id");
    if let Err(e) = fs::write(&install_file, format!("{}\n", new_installation_id)) {
        return ChatGptResetResult {
            success: false,
            installation_id: String::new(),
            session_id: String::new(),
            cleaned_files: 0,
            error: Some(format!("Не удалось обновить installation_id: {}", e)),
        };
    }

    // 2. Clean temporary scratch/cache directories if present
    let mut cleaned = 0;
    let tmp_dir = target_dir.join(".tmp");
    if tmp_dir.exists() {
        if let Ok(entries) = fs::read_dir(&tmp_dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    if fs::remove_file(entry.path()).is_ok() {
                        cleaned += 1;
                    }
                }
            }
        }
    }

    ChatGptResetResult {
        success: true,
        installation_id: new_installation_id,
        session_id: new_session_id,
        cleaned_files: cleaned,
        error: None,
    }
}

pub fn open_chatgpt_folder() -> Result<(), String> {
    let target_dir = get_chatgpt_dir();
    if !target_dir.exists() {
        let _ = fs::create_dir_all(&target_dir);
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(target_dir.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("Ошибка открытия проводника: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target_dir.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("Ошибка открытия Finder: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(target_dir.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("Ошибка открытия файлового менеджера: {}", e))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Операционная система не поддерживается".into())
}
