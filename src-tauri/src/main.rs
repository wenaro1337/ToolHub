// Suppresses the black Windows console window completely in both debug and release builds
#![windows_subsystem = "windows"]

fn main() {
    let args: Vec<String> = std::env::args().collect();

    #[cfg(target_os = "windows")]
    {
        if args.iter().any(|a| a == "--blocked-by-ifeo") {
            toolhub_lib::killswitch::show_ifeo_blocked_dialog();
            return;
        }
    }

    let start_minimized = args.iter().any(|a| a == "--minimized" || a == "-m" || a == "/minimized");

    #[cfg(target_os = "windows")]
    {
        // Automatically ensure Administrator elevation upon startup
        if !toolhub_lib::killswitch::is_running_as_admin() {
            if toolhub_lib::killswitch::restart_as_admin().is_ok() {
                // Elevated process spawned, terminate unprivileged instance
                return;
            }
        }
    }

    toolhub_lib::run(start_minimized);
}
