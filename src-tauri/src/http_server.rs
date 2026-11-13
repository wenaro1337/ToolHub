use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use uuid::Uuid;

use crate::chatgpt;
use crate::claude;
use crate::media::{self, AppState, MediaTaskParams, TaskStatus};
use crate::system;

pub fn start_http_server(state: AppState, port: u16) {
    thread::spawn(move || {
        let addr = format!("127.0.0.1:{}", port);
        let listener = match TcpListener::bind(&addr) {
            Ok(l) => l,
            Err(_) => return,
        };

        for stream in listener.incoming() {
            if let Ok(stream) = stream {
                let state_clone = state.clone();
                thread::spawn(move || {
                    handle_connection(stream, state_clone);
                });
            }
        }
    });
}

fn handle_connection(mut stream: TcpStream, state: AppState) {
    let mut reader = BufReader::new(&stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() || request_line.is_empty() {
        return;
    }

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0];
    let full_path = parts[1];

    // Read HTTP headers
    let mut content_length = 0usize;
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
            break;
        }
        if line.to_lowercase().starts_with("content-length:") {
            if let Some(val) = line.split(':').nth(1) {
                content_length = val.trim().parse::<usize>().unwrap_or(0);
            }
        }
    }

    // Read Body if present
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        let _ = reader.read_exact(&mut body);
    }

    let path_and_query: Vec<&str> = full_path.split('?').collect();
    let path = path_and_query[0];
    let query = path_and_query.get(1).copied().unwrap_or("");

    let cors_headers = "HTTP/1.1 200 OK\r\n\
        Access-Control-Allow-Origin: *\r\n\
        Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
        Access-Control-Allow-Headers: Content-Type\r\n\
        Content-Type: application/json; charset=utf-8\r\n\r\n";

    if method == "OPTIONS" {
        let _ = stream.write_all(cors_headers.as_bytes());
        return;
    }

    match (method, path) {
        ("GET", "/api/system_info") => {
            let specs = system::get_system_specs();
            if let Ok(json) = serde_json::to_string(&specs) {
                let response = format!("{}{}", cors_headers, json);
                let _ = stream.write_all(response.as_bytes());
            }
        }

        ("GET", "/api/claude_code_info") => {
            let info = claude::get_claude_code_info();
            if let Ok(json) = serde_json::to_string(&info) {
                let response = format!("{}{}", cors_headers, json);
                let _ = stream.write_all(response.as_bytes());
            }
        }

        ("GET", "/api/chatgpt_info") => {
            let info = chatgpt::get_chatgpt_info();
            if let Ok(json) = serde_json::to_string(&info) {
                let response = format!("{}{}", cors_headers, json);
                let _ = stream.write_all(response.as_bytes());
            }
        }

        ("GET", "/api/autostart") => {
            let enabled = system::get_autostart_status();
            let response = format!("{}{{\"autostart\":{}}}", cors_headers, enabled);
            let _ = stream.write_all(response.as_bytes());
        }

        ("GET", "/api/cache_size") => {
            let size = system::get_cache_size();
            let response = format!("{}{{\"cache_size\":\"{}\"}}", cors_headers, size);
            let _ = stream.write_all(response.as_bytes());
        }

        ("GET", "/api/status") => {
            let mut job_id = "";
            for param in query.split('&') {
                let mut kv = param.split('=');
                if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
                    if k == "job_id" {
                        job_id = v;
                    }
                }
            }

            if let Ok(map) = state.jobs.lock() {
                if let Some(job) = map.get(job_id) {
                    if let Ok(json) = serde_json::to_string(job) {
                        let response = format!("{}{}", cors_headers, json);
                        let _ = stream.write_all(response.as_bytes());
                        return;
                    }
                }
            }

            let not_found = "HTTP/1.1 404 NOT FOUND\r\n\r\n{\"error\":\"Задача не найдена\"}";
            let _ = stream.write_all(not_found.as_bytes());
        }

        ("POST", "/api/log_error") => {
            let body_str = String::from_utf8_lossy(&body);
            let log_path = crate::local_log_path("frontend_errors.log");
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
                let _ = writeln!(f, "[{}] {}", chrono::Local::now().format("%H:%M:%S%.3f"), body_str);
            }
            let response = format!("{}{{\"status\":\"logged\"}}", cors_headers);
            let _ = stream.write_all(response.as_bytes());
        }

        ("GET", "/api/tools") => {
            let schema = serde_json::json!({
                "name": "ToolHub Media & AI Automation",
                "version": "2.0.0",
                "tools": [
                    {
                        "name": "master_humanizer",
                        "description": "Полная хуманизация видео: pHash сдвиг, зачистка C2PA, шум матрицы камеры, маскировка нейроголоса",
                        "parameters": {
                            "input_path": "string (абсолютный путь к файлу)",
                            "enable_video": "boolean",
                            "enable_audio": "boolean",
                            "grain_strength": "integer (8-20)",
                            "room_tone_vol": "float (0.2-0.5)"
                        }
                    },
                    {
                        "name": "inspector",
                        "description": "Криминалистическая проверка медиафайла на наличие скрытых меток C2PA и тегов FFmpeg",
                        "parameters": {
                            "input_path": "string (абсолютный путь к файлу)"
                        }
                    }
                ]
            });
            let response = format!("{}{}", cors_headers, schema);
            let _ = stream.write_all(response.as_bytes());
        }

        ("POST", "/api/run") => {
            if let Ok(req) = serde_json::from_slice::<serde_json::Value>(&body) {
                let tool = req.get("tool").and_then(|v| v.as_str()).unwrap_or("master_humanizer").to_string();
                let input_path = req.get("input_path").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let params_obj = req.get("params");

                let enable_video = params_obj
                    .and_then(|p| p.get("enable_video"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                let enable_audio = params_obj
                    .and_then(|p| p.get("enable_audio"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                let grain_strength = params_obj
                    .and_then(|p| p.get("grain_strength"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(12) as u32;
                let room_tone_vol = params_obj
                    .and_then(|p| p.get("room_tone_vol"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.35);

                let job_id = format!("job_{}", &Uuid::new_v4().simple().to_string()[..8]);

                let initial_status = TaskStatus {
                    job_id: job_id.clone(),
                    tool: tool.clone(),
                    status: "running".to_string(),
                    logs: vec![format!("[*] Инициализирована задача #{} [{}]", job_id, tool)],
                    result_path: None,
                    scrubbed_manifests: 0,
                };

                if let Ok(mut map) = state.jobs.lock() {
                    map.insert(job_id.clone(), initial_status);
                }

                let task_params = MediaTaskParams {
                    tool,
                    input_path,
                    output_path: None,
                    enable_video,
                    enable_audio,
                    grain_strength,
                    room_tone_vol,
                    crf: Some(18),
                };

                media::spawn_media_task(None, state.jobs.clone(), job_id.clone(), task_params);

                let resp_json = serde_json::json!({ "job_id": job_id });
                let response = format!("{}{}", cors_headers, resp_json);
                let _ = stream.write_all(response.as_bytes());
                return;
            }

            let bad_req = "HTTP/1.1 400 BAD REQUEST\r\n\r\n{\"error\":\"Неверный JSON\"}";
            let _ = stream.write_all(bad_req.as_bytes());
        }

        ("POST", "/api/open_win_tool") => {
            if let Ok(req) = serde_json::from_slice::<serde_json::Value>(&body) {
                if let Some(tool) = req.get("tool").and_then(|v| v.as_str()) {
                    let success = system::open_win_tool(tool).is_ok();
                    let resp_json = serde_json::json!({ "success": success });
                    let response = format!("{}{}", cors_headers, resp_json);
                    let _ = stream.write_all(response.as_bytes());
                    return;
                }
            }
            let bad_req = "HTTP/1.1 400 BAD REQUEST\r\n\r\n";
            let _ = stream.write_all(bad_req.as_bytes());
        }

        ("POST", "/api/reset_claude_code") => {
            let res = claude::reset_claude_code();
            if let Ok(json) = serde_json::to_string(&res) {
                let response = format!("{}{}", cors_headers, json);
                let _ = stream.write_all(response.as_bytes());
            }
        }

        ("POST", "/api/open_claude_folder") => {
            let _ = claude::open_claude_folder();
            let _ = stream.write_all(cors_headers.as_bytes());
        }

        ("GET", "/api/claude_network_audit") | ("POST", "/api/claude_network_audit") => {
            match claude::audit_claude_network() {
                Ok(audit) => {
                    if let Ok(json) = serde_json::to_string(&audit) {
                        let response = format!("{}{}", cors_headers, json);
                        let _ = stream.write_all(response.as_bytes());
                    }
                }
                Err(err) => {
                    let err_json = serde_json::json!({ "error": err });
                    let response = format!("HTTP/1.1 500 INTERNAL SERVER ERROR\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\n\r\n{}", err_json);
                    let _ = stream.write_all(response.as_bytes());
                }
            }
        }

        ("POST", "/api/generate_claude_profile") => {
            if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body) {
                let name = val.get("profile_name").and_then(|v| v.as_str()).unwrap_or("isolated-profile").to_string();
                let target_tz = val.get("target_tz").and_then(|v| v.as_str()).map(|s| s.to_string());
                match claude::generate_claude_profile(name, target_tz) {
                    Ok(res) => {
                        if let Ok(json) = serde_json::to_string(&res) {
                            let response = format!("{}{}", cors_headers, json);
                            let _ = stream.write_all(response.as_bytes());
                            return;
                        }
                    }
                    Err(e) => {
                        let err_json = serde_json::json!({ "error": e });
                        let response = format!("HTTP/1.1 400 BAD REQUEST\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\n\r\n{}", err_json);
                        let _ = stream.write_all(response.as_bytes());
                        return;
                    }
                }
            }
            let bad_req = "HTTP/1.1 400 BAD REQUEST\r\n\r\n";
            let _ = stream.write_all(bad_req.as_bytes());
        }

        ("POST", "/api/sync_timezone") => {
            let target_tz = if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body) {
                val.get("timezone").and_then(|v| v.as_str()).unwrap_or("").to_string()
            } else {
                String::new()
            };
            if target_tz.is_empty() {
                let err_json = serde_json::json!({ "success": false, "error": "Не указан часовой пояс для синхронизации" });
                let response = format!("HTTP/1.1 400 BAD REQUEST\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\n\r\n{}", err_json);
                let _ = stream.write_all(response.as_bytes());
                return;
            }
            match claude::sync_system_timezone(target_tz) {
                Ok(msg) => {
                    let json = serde_json::json!({ "success": true, "message": msg });
                    let response = format!("{}{}", cors_headers, json);
                    let _ = stream.write_all(response.as_bytes());
                }
                Err(e) => {
                    let json = serde_json::json!({ "success": false, "error": e });
                    let response = format!("HTTP/1.1 400 BAD REQUEST\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\n\r\n{}", json);
                    let _ = stream.write_all(response.as_bytes());
                }
            }
        }

        ("POST", "/api/restore_timezone") => {
            match claude::restore_system_timezone() {
                Ok(msg) => {
                    let json = serde_json::json!({ "success": true, "message": msg });
                    let response = format!("{}{}", cors_headers, json);
                    let _ = stream.write_all(response.as_bytes());
                }
                Err(e) => {
                    let json = serde_json::json!({ "success": false, "error": e });
                    let response = format!("HTTP/1.1 400 BAD REQUEST\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\n\r\n{}", json);
                    let _ = stream.write_all(response.as_bytes());
                }
            }
        }

        ("GET", "/api/killswitch/status") => {
            let status = crate::killswitch::get_killswitch_status();
            if let Ok(json) = serde_json::to_string(&status) {
                let response = format!("{}{}", cors_headers, json);
                let _ = stream.write_all(response.as_bytes());
                return;
            }
        }

        ("POST", "/api/killswitch/toggle") => {
            let enabled = if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body) {
                val.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true)
            } else {
                true
            };
            let status = crate::killswitch::set_killswitch_enabled(enabled);
            if let Ok(json) = serde_json::to_string(&status) {
                let response = format!("{}{}", cors_headers, json);
                let _ = stream.write_all(response.as_bytes());
                return;
            }
        }

        ("POST", "/api/killswitch/allowed_ips") => {
            let ips: Vec<String> = if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body) {
                if let Some(arr) = val.get("ips").and_then(|v| v.as_array()) {
                    arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()
                } else if let Some(ip) = val.get("ip").and_then(|v| v.as_str()) {
                    vec![ip.to_string()]
                } else {
                    Vec::new()
                }
            } else {
                Vec::new()
            };
            let status = crate::killswitch::set_allowed_ips(ips);
            if let Ok(json) = serde_json::to_string(&status) {
                let response = format!("{}{}", cors_headers, json);
                let _ = stream.write_all(response.as_bytes());
                return;
            }
        }

        ("POST", "/api/killswitch/strict_mode") => {
            let mut strict = true;
            if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body) {
                if let Some(s) = val.get("strict").and_then(|v| v.as_bool()) {
                    strict = s;
                }
            }
            let status = crate::killswitch::set_strict_mode(strict);
            if let Ok(json) = serde_json::to_string(&status) {
                let response = format!("{}{}", cors_headers, json);
                let _ = stream.write_all(response.as_bytes());
                return;
            }
        }

        ("GET", "/api/system/admin_status") => {
            let is_admin = crate::killswitch::is_running_as_admin();
            let json = serde_json::json!({ "is_admin": is_admin });
            let response = format!("{}{}", cors_headers, json);
            let _ = stream.write_all(response.as_bytes());
            return;
        }

        ("POST", "/api/system/restart_admin") => {
            match crate::killswitch::restart_as_admin() {
                Ok(_) => {
                    let json = serde_json::json!({ "success": true, "message": "Перезапуск с правами Администратора..." });
                    let response = format!("{}{}", cors_headers, json);
                    let _ = stream.write_all(response.as_bytes());
                    return;
                }
                Err(e) => {
                    let json = serde_json::json!({ "success": false, "error": e });
                    let response = format!("HTTP/1.1 400 BAD REQUEST\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\n\r\n{}", json);
                    let _ = stream.write_all(response.as_bytes());
                    return;
                }
            }
        }

        ("GET", "/api/system/priority_autostart_status") => {
            let active = system::is_priority_autostart_active();
            let json = serde_json::json!({ "active": active });
            let response = format!("{}{}", cors_headers, json);
            let _ = stream.write_all(response.as_bytes());
            return;
        }

        ("POST", "/api/system/priority_autostart") => {
            let enabled = if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body) {
                val.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true)
            } else {
                true
            };
            match system::set_priority_autostart(enabled) {
                Ok(res) => {
                    let json = serde_json::json!({ "success": true, "active": res });
                    let response = format!("{}{}", cors_headers, json);
                    let _ = stream.write_all(response.as_bytes());
                    return;
                }
                Err(e) => {
                    let json = serde_json::json!({ "success": false, "error": e });
                    let response = format!("HTTP/1.1 400 BAD REQUEST\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\n\r\n{}", json);
                    let _ = stream.write_all(response.as_bytes());
                    return;
                }
            }
        }

        ("POST", "/api/claude/safe_launch") => {
            if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body) {
                let launch_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("cli").to_string();
                let profile = val.get("profile").and_then(|v| v.as_str()).map(|s| s.to_string());
                match crate::killswitch::safe_launch_claude(&launch_type, profile) {
                    Ok(msg) => {
                        let json = serde_json::json!({ "success": true, "message": msg });
                        let response = format!("{}{}", cors_headers, json);
                        let _ = stream.write_all(response.as_bytes());
                        return;
                    }
                    Err(e) => {
                        let json = serde_json::json!({ "success": false, "error": e });
                        let response = format!("HTTP/1.1 400 BAD REQUEST\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\n\r\n{}", json);
                        let _ = stream.write_all(response.as_bytes());
                        return;
                    }
                }
            }
        }

        ("POST", "/api/test_proxy") => {
            if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body) {
                let proxy_url = val.get("proxy_url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                match claude::test_custom_proxy(proxy_url) {
                    Ok(audit) => {
                        if let Ok(json) = serde_json::to_string(&audit) {
                            let response = format!("{}{}", cors_headers, json);
                            let _ = stream.write_all(response.as_bytes());
                            return;
                        }
                    }
                    Err(e) => {
                        let json = serde_json::json!({ "error": e });
                        let response = format!("HTTP/1.1 400 BAD REQUEST\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\n\r\n{}", json);
                        let _ = stream.write_all(response.as_bytes());
                        return;
                    }
                }
            }
            let bad_req = "HTTP/1.1 400 BAD REQUEST\r\n\r\n";
            let _ = stream.write_all(bad_req.as_bytes());
        }

        ("POST", "/api/reset_chatgpt") => {
            let res = chatgpt::reset_chatgpt_session();
            if let Ok(json) = serde_json::to_string(&res) {
                let response = format!("{}{}", cors_headers, json);
                let _ = stream.write_all(response.as_bytes());
            }
        }

        ("POST", "/api/open_chatgpt_folder") => {
            let _ = chatgpt::open_chatgpt_folder();
            let _ = stream.write_all(cors_headers.as_bytes());
        }

        ("POST", "/api/regenerate_hwid") => {
            let res = system::regenerate_hwid();
            if let Ok(json) = serde_json::to_string(&res) {
                let response = format!("{}{}", cors_headers, json);
                let _ = stream.write_all(response.as_bytes());
            }
        }

        ("POST", "/api/open_output") => {
            let _ = media::open_output_dir();
            let _ = stream.write_all(cors_headers.as_bytes());
        }

        ("POST", "/api/autostart") => {
            let mut enabled = false;
            if let Ok(req) = serde_json::from_slice::<serde_json::Value>(&body) {
                if let Some(b) = req.get("enabled").and_then(|v| v.as_bool()) {
                    enabled = b;
                }
            }
            let res = system::set_autostart(enabled).unwrap_or(false);
            let response = format!("{}{{\"success\":true,\"enabled\":{}}}", cors_headers, res);
            let _ = stream.write_all(response.as_bytes());
        }

        ("POST", "/api/clear_cache") => {
            let removed = system::clear_app_cache().unwrap_or(0);
            let response = format!("{}{{\"success\":true,\"removed_files\":{}}}", cors_headers, removed);
            let _ = stream.write_all(response.as_bytes());
        }

        ("GET", "/api/keep_awake") => {
            let status = system::get_keep_awake_status();
            if let Ok(json) = serde_json::to_string(&status) {
                let response = format!("{}{}", cors_headers, json);
                let _ = stream.write_all(response.as_bytes());
            }
        }

        ("POST", "/api/keep_awake") => {
            let mut mode = "off".to_string();
            if let Ok(req) = serde_json::from_slice::<serde_json::Value>(&body) {
                if let Some(m) = req.get("mode").and_then(|v| v.as_str()) {
                    mode = m.to_string();
                }
            }
            let res = system::set_keep_awake(&mode).unwrap_or_else(|_| system::get_keep_awake_status());
            if let Ok(json) = serde_json::to_string(&res) {
                let response = format!("{}{}", cors_headers, json);
                let _ = stream.write_all(response.as_bytes());
            }
        }

        ("GET", "/api/ports") => {
            let ports = system::get_listening_ports().unwrap_or_default();
            if let Ok(json) = serde_json::to_string(&ports) {
                let response = format!("{}{}", cors_headers, json);
                let _ = stream.write_all(response.as_bytes());
            }
        }

        ("POST", "/api/kill_port_process") => {
            let mut pid = 0;
            if let Ok(req) = serde_json::from_slice::<serde_json::Value>(&body) {
                if let Some(p) = req.get("pid").and_then(|v| v.as_u64()) {
                    pid = p as u32;
                }
            }
            let res = system::kill_process_by_pid(pid);
            let success = res.is_ok();
            let err_msg = res.err().unwrap_or_default();
            let resp_json = serde_json::json!({
                "success": success,
                "pid": pid,
                "error": if success { serde_json::Value::Null } else { serde_json::Value::String(err_msg) }
            });
            let response = format!("{}{}", cors_headers, resp_json);
            let _ = stream.write_all(response.as_bytes());
        }

        ("GET", "/api/pick_color") => {
            let color = system::pick_screen_color_at_cursor();
            if let Ok(c) = color {
                if let Ok(json) = serde_json::to_string(&c) {
                    let response = format!("{}{}", cors_headers, json);
                    let _ = stream.write_all(response.as_bytes());
                }
            } else {
                let response = format!("{}{{\"error\":\"failed to pick color\"}}", cors_headers);
                let _ = stream.write_all(response.as_bytes());
            }
        }

        _ => {
            let not_found = "HTTP/1.1 404 NOT FOUND\r\n\r\n{\"error\":\"Маршрут не найден\"}";
            let _ = stream.write_all(not_found.as_bytes());
        }
    }
}
