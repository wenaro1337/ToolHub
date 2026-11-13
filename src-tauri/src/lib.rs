pub mod chatgpt;
pub mod claude;
pub mod commands;
pub mod http_server;
pub mod killswitch;
pub mod media;
pub mod system;
pub mod uninstaller;

use media::AppState;
use tauri::Manager;
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

fn local_log_path(name: &str) -> std::path::PathBuf {
    let directory = dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("ToolHub");
    let _ = std::fs::create_dir_all(&directory);
    directory.join(name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(start_minimized: bool) {
    let log_path = crate::local_log_path("frontend_debug.log");
    std::panic::set_hook(Box::new(|info| {
        let log_path = crate::local_log_path("frontend_debug.log");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
            use std::io::Write;
            let _ = writeln!(f, "[PANIC]: {:?}", info);
        }
    }));

    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        use std::io::Write;
        let _ = writeln!(f, "[{}] [RUST] ToolHub started (PID: {})", chrono::Local::now().format("%H:%M:%S%.3f"), std::process::id());
    }

    let state = AppState::new();

    // Start background KillSwitch Guardian (monitors network leaks & process gatekeeping)
    killswitch::start_killswitch_guardian();

    // Launch embedded local HTTP API server on port 7860 (for MCP AI agents and web fallback)
    http_server::start_http_server(state.clone(), 7860);

    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        use std::io::Write;
        let _ = writeln!(f, "[{}] [RUST] Starting Tauri builder...", chrono::Local::now().format("%H:%M:%S%.3f"));
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .setup(move |app| {
            let log_path = crate::local_log_path("frontend_debug.log");
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
                use std::io::Write;
                let _ = writeln!(f, "[{}] [SETUP] Tauri setup successfully! Windows: {:?}", chrono::Local::now().format("%H:%M:%S%.3f"), app.webview_windows().keys().collect::<Vec<_>>());
            }

            // Clean up any legacy ToolHub.cmd shortcut from startup
            system::cleanup_legacy_startup_cmd();

            // Create tray menu
            let is_safe = killswitch::NETWORK_IS_SAFE.load(std::sync::atomic::Ordering::SeqCst);
            let claude_title = if is_safe { "🟢 Claude Code (Активен)" } else { "🔴 Claude Code (Заблокирован)" };

            let show_item = MenuItem::with_id(app, "show", "Показать ToolHub", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let claude_item = MenuItem::with_id(app, "claude", claude_title, true, None::<&str>)?;
            let chatgpt_item = MenuItem::with_id(app, "chatgpt", "🟡 ChatGPT (В разработке)", true, None::<&str>)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &sep1, &claude_item, &chatgpt_item, &sep2, &quit_item])?;

            let claude_item_for_tray = claude_item.clone();

            // Build Tray Icon
            let icon = app.default_window_icon().cloned();
            let mut tray_builder = TrayIconBuilder::new()
                .tooltip("ToolHub")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "claude" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                                let _ = window.eval("if (window.switchSection) { window.switchSection('claude'); }");
                            }
                        }
                        "chatgpt" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                                let _ = window.eval("if (window.showNotification) { window.showNotification('Модуль ChatGPT находится в активной разработке', 'info', 3000); }");
                            }
                        }
                        "quit" => {
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(move |tray, event| {
                    match event {
                        TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        TrayIconEvent::Click { button: MouseButton::Right, button_state: MouseButtonState::Up, .. } => {
                            let safe = killswitch::NETWORK_IS_SAFE.load(std::sync::atomic::Ordering::SeqCst);
                            let enabled = killswitch::KILLSWITCH_ENABLED.load(std::sync::atomic::Ordering::SeqCst);
                            let title = if !enabled {
                                "⚪ Claude Code (Kill-Switch выкл)"
                            } else if safe {
                                "🟢 Claude Code (Активен)"
                            } else {
                                "🔴 Claude Code (Заблокирован)"
                            };
                            let _ = claude_item_for_tray.set_text(title);
                        }
                        _ => {}
                    }
                });

            if let Some(ic) = icon {
                tray_builder = tray_builder.icon(ic);
            }

            let _ = tray_builder.build(app)?;

            // If started with --minimized flag (e.g. from autostart), hide main window
            if start_minimized {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_system_specs,
            commands::get_system_info,
            commands::open_win_tool,
            commands::regenerate_hwid,
            commands::get_claude_code_info,
            commands::get_claude_info,
            commands::reset_claude_code,
            commands::open_claude_folder,
            commands::audit_claude_network,
            commands::generate_claude_profile,
            commands::sync_system_timezone,
            commands::restore_system_timezone,
            commands::get_current_system_timezone,
            commands::test_custom_proxy,
            commands::get_chatgpt_info,
            commands::reset_chatgpt_session,
            commands::open_chatgpt_folder,
            commands::run_media_task,
            commands::run_tool,
            commands::get_task_status,
            commands::get_status,
            commands::open_output_dir,
            commands::open_output,
            commands::log_from_js,
            commands::get_autostart_status,
            commands::set_autostart,
            commands::get_cache_size,
            commands::clear_app_cache,
            commands::set_always_on_top,
            commands::get_keep_awake_status,
            commands::set_keep_awake,
            commands::get_listening_ports,
            commands::kill_process_by_pid,
            commands::pick_screen_color_at_cursor,
            commands::check_for_updates,
            commands::install_update,
            commands::get_killswitch_status,
            commands::set_killswitch_enabled,
            commands::set_allowed_ips,
            commands::set_killswitch_strict_mode,
            commands::is_running_as_admin,
            commands::restart_as_admin,
            commands::set_priority_autostart,
            commands::is_priority_autostart_active,
            commands::safe_launch_claude,
            commands::set_persistent_firewall,
            commands::set_ifeo_guard,
            commands::get_installed_apps,
            commands::uninstall_app,
            commands::batch_uninstall,
            commands::scan_app_leftovers,
            commands::clean_app_leftovers,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Intercept close button [X]: prevent process exit, minimize/hide window to system tray
                api.prevent_close();
                let _ = window.hide();
            }
        });

    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        use std::io::Write;
        let _ = writeln!(f, "[{}] [RUST] Calling builder.run()...", chrono::Local::now().format("%H:%M:%S%.3f"));
    }

    let res = builder.run(tauri::generate_context!());

    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        use std::io::Write;
        let _ = writeln!(f, "[{}] [RUST] tauri.run finished: {:?}", chrono::Local::now().format("%H:%M:%S%.3f"), res);
    }
}
