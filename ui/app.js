/**
 * ==========================================================================
 * ToolHub — Frontend Application Logic & Universal IPC Client
 * Compatible with Tauri 2.0 (window.__TAURI__.core.invoke) and Web Browser (fetch)
 * ==========================================================================
 */

// --------------------------------------------------------------------------
// Global Error Trapping & Diagnostics
// --------------------------------------------------------------------------
try {
    fetch('http://127.0.0.1:7860/api/log_error', {
        method: 'POST',
        body: '[LIFECYCLE]: app.js executed! URL=' + (typeof window !== 'undefined' ? window.location.href : 'none')
    }).catch(() => {});
} catch(e) {}

window.onerror = function(msg, url, line, col, err) {
    const text = `[JS ОШИБКА] ${msg} (${url}:${line}:${col})${err ? ' ' + err.stack : ''}`;
    if (typeof logConsole === 'function') logConsole(text);
    else console.error(text);
    try {
        fetch('http://127.0.0.1:7860/api/log_error', { method: 'POST', body: text }).catch(() => {});
    } catch(e) {}
};
window.addEventListener('unhandledrejection', function(e) {
    const text = `[PROMISE ОШИБКА] ${e.reason}${e.reason && e.reason.stack ? ' ' + e.reason.stack : ''}`;
    if (typeof logConsole === 'function') logConsole(text);
    else console.error(text);
    try {
        fetch('http://127.0.0.1:7860/api/log_error', { method: 'POST', body: text }).catch(() => {});
    } catch(e) {}
});

// --------------------------------------------------------------------------
// 1. Universal IPC & API Client
// Compatible with Tauri 2.0 (window.__TAURI_INTERNALS__ / window.__TAURI__)
// and Web Browser (direct HTTP to embedded server at 127.0.0.1:7860)
// --------------------------------------------------------------------------
const API_BASE = (typeof window !== 'undefined' && (
    window.location.origin.includes('tauri.localhost') || 
    window.location.protocol === 'file:' || 
    !window.location.port
)) ? 'http://127.0.0.1:7860' : '';

const appIpc = {
    isTauri() {
        return typeof window !== 'undefined' && (
            !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') ||
            !!(window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') ||
            !!(window.__TAURI__ && typeof window.__TAURI__.invoke === 'function')
        );
    },

    async invoke(cmd, args = {}, fallbackHttp = null) {
        if (typeof window !== 'undefined') {
            // Priority 1: Official Tauri 2.0 API
            if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
                try {
                    return await window.__TAURI__.core.invoke(cmd, args);
                } catch (err) {
                    console.warn(`[IPC core] "${cmd}" failed:`, err);
                    if (fallbackHttp) {
                        try { return await fallbackHttp(); } catch (fErr) { console.warn(`[HTTP fallback] error:`, fErr); }
                    }
                    throw err;
                }
            }
            // Priority 2: Tauri 2.0 internal bridge
            if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
                try {
                    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
                } catch (err) {
                    console.warn(`[IPC internals] "${cmd}" failed:`, err);
                    if (fallbackHttp) {
                        try { return await fallbackHttp(); } catch (fErr) { console.warn(`[HTTP fallback] error:`, fErr); }
                    }
                    throw err;
                }
            }
            // Priority 3: Legacy Tauri invoke
            if (window.__TAURI__ && typeof window.__TAURI__.invoke === 'function') {
                try {
                    return await window.__TAURI__.invoke(cmd, args);
                } catch (err) {
                    console.warn(`[IPC invoke] "${cmd}" failed:`, err);
                    if (fallbackHttp) {
                        try { return await fallbackHttp(); } catch (fErr) { console.warn(`[HTTP fallback] error:`, fErr); }
                    }
                    throw err;
                }
            }
        }
        if (fallbackHttp) {
            return await fallbackHttp();
        }
        throw new Error(`Команда "${cmd}" недоступна: Tauri IPC и HTTP fallback недоступны.`);
    },

    // --- Domain API Calls ---

    async getSystemInfo() {
        return this.invoke('get_system_specs', {}, async () => {
            const res = await fetch(`${API_BASE}/api/system_info`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async getClaudeInfo() {
        return this.invoke('get_claude_code_info', {}, async () => {
            const res = await fetch(`${API_BASE}/api/claude_code_info`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async getChatGptInfo() {
        return this.invoke('get_chatgpt_info', {}, async () => {
            const res = await fetch(`${API_BASE}/api/chatgpt_info`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async resetChatGptSession() {
        return this.invoke('reset_chatgpt_session', {}, async () => {
            const res = await fetch(`${API_BASE}/api/reset_chatgpt`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async openChatGptFolder() {
        return this.invoke('open_chatgpt_folder', {}, async () => {
            const res = await fetch(`${API_BASE}/api/open_chatgpt_folder`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async getAutostartStatus() {
        return this.invoke('get_autostart_status', {}, async () => {
            const res = await fetch(`${API_BASE}/api/autostart`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.autostart;
        });
    },

    async setAutostart(enabled) {
        return this.invoke('set_autostart', { enabled }, async () => {
            const res = await fetch(`${API_BASE}/api/autostart`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.enabled;
        });
    },

    async getCacheSize() {
        return this.invoke('get_cache_size', {}, async () => {
            const res = await fetch(`${API_BASE}/api/cache_size`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.cache_size;
        });
    },

    async clearAppCache() {
        return this.invoke('clear_app_cache', {}, async () => {
            const res = await fetch(`${API_BASE}/api/clear_cache`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.removed_files;
        });
    },

    async setAlwaysOnTop(enabled) {
        return this.invoke('set_always_on_top', { enabled }, async () => {
            return true;
        });
    },

    async getKeepAwakeStatus() {
        return this.invoke('get_keep_awake_status', {}, async () => {
            const res = await fetch(`${API_BASE}/api/keep_awake`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async setKeepAwake(mode) {
        return this.invoke('set_keep_awake', { mode }, async () => {
            const res = await fetch(`${API_BASE}/api/keep_awake`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async getListeningPorts() {
        return this.invoke('get_listening_ports', {}, async () => {
            const res = await fetch(`${API_BASE}/api/ports`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async killPortProcess(pid) {
        return this.invoke('kill_process_by_pid', { pid }, async () => {
            const res = await fetch(`${API_BASE}/api/kill_port_process`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pid })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to kill process');
            return true;
        });
    },

    async pickScreenColor() {
        if (typeof window !== 'undefined' && window.EyeDropper) {
            try {
                const eyeDropper = new window.EyeDropper();
                const result = await eyeDropper.open();
                return { hex: result.sRGBHex.toUpperCase() };
            } catch (err) {
                if (err.name === 'AbortError') return null;
            }
        }
        return this.invoke('pick_screen_color_at_cursor', {}, async () => {
            const res = await fetch(`${API_BASE}/api/pick_color`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async runTool(tool, inputPath, params) {
        const taskParams = {
            tool: tool,
            input_path: inputPath,
            output_path: null,
            enable_video: params.enable_video !== false,
            enable_audio: params.enable_audio !== false,
            grain_strength: parseInt(params.grain_strength || 12, 10),
            room_tone_vol: parseFloat(params.room_tone_vol || 0.35),
            crf: null
        };
        const payload = {
            params: taskParams,
            ...taskParams
        };
        return this.invoke('run_media_task', payload, async () => {
            const res = await fetch(`${API_BASE}/api/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tool: tool,
                    input_path: inputPath,
                    params: params
                })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async getStatus(jobId) {
        return this.invoke('get_task_status', { job_id: jobId, jobId: jobId }, async () => {
            const res = await fetch(`${API_BASE}/api/status?job_id=${encodeURIComponent(jobId)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async openOutput() {
        return this.invoke('open_output_dir', {}, async () => {
            const res = await fetch(`${API_BASE}/api/open_output`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async openWinTool(toolName) {
        return this.invoke('open_win_tool', { tool: toolName }, async () => {
            const res = await fetch(`${API_BASE}/api/open_win_tool`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tool: toolName })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async resetClaudeCode() {
        return this.invoke('reset_claude_code', {}, async () => {
            const res = await fetch(`${API_BASE}/api/reset_claude_code`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async openClaudeFolder() {
        return this.invoke('open_claude_folder', {}, async () => {
            const res = await fetch(`${API_BASE}/api/open_claude_folder`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async auditClaudeNetwork() {
        return this.invoke('audit_claude_network', {}, async () => {
            const res = await fetch(`${API_BASE}/api/claude_network_audit`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }
            return await res.json();
        });
    },

    async generateClaudeProfile(profileName, targetTz = '') {
        return this.invoke('generate_claude_profile', { profileName, targetTz: targetTz || null }, async () => {
            const res = await fetch(`${API_BASE}/api/generate_claude_profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profile_name: profileName, target_tz: targetTz || null })
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }
            return await res.json();
        });
    },

    async syncTimezone(timezone) {
        return this.invoke('sync_system_timezone', { ianaTz: timezone }, async () => {
            const res = await fetch(`${API_BASE}/api/sync_timezone`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ timezone })
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }
            return await res.json();
        });
    },

    async restoreTimezone() {
        return this.invoke('restore_system_timezone', {}, async () => {
            const res = await fetch(`${API_BASE}/api/restore_timezone`, { method: 'POST' });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }
            return await res.json();
        });
    },

    async testCustomProxy(proxyUrl) {
        return this.invoke('test_custom_proxy', { proxyUrl }, async () => {
            const res = await fetch(`${API_BASE}/api/test_proxy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proxy_url: proxyUrl })
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }
            return await res.json();
        });
    },

    async regenerateHwid() {
        return this.invoke('regenerate_hwid', {}, async () => {
            const res = await fetch(`${API_BASE}/api/regenerate_hwid`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async uploadFile(file) {
        if (file && file.path) {
            return { path: file.path };
        }
        // In local webview mode, file.name can be set if absolute path unavailable
        return { path: file.name || '' };
    },

    async checkForUpdates() {
        return this.invoke('check_for_updates', {}, async () => ({
            available: false,
            current_version: '0.2.3',
            version: '',
            body: null
        }));
    },

    async installUpdate() {
        return this.invoke('install_update', {}, async () => {
            return 'Обновление поддерживается в десктопном приложении ToolHub.';
        });
    },

    async getKillSwitchStatus() {
        return this.invoke('get_killswitch_status', {}, async () => {
            const res = await fetch(`${API_BASE}/api/killswitch/status`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async setKillSwitchEnabled(enabled) {
        return this.invoke('set_killswitch_enabled', { enabled }, async () => {
            const res = await fetch(`${API_BASE}/api/killswitch/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async safeLaunchClaude(launchType, profileName = null) {
        return this.invoke('safe_launch_claude', { launchType, profileName }, async () => {
            const res = await fetch(`${API_BASE}/api/claude/safe_launch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ launch_type: launchType, profile_name: profileName })
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }
            return await res.json();
        });
    },

    async setAllowedIps(ips) {
        return this.invoke('set_allowed_ips', { ips }, async () => {
            const res = await fetch(`${API_BASE}/api/killswitch/allowed_ips`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ips })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async setKillSwitchStrictMode(strict) {
        return this.invoke('set_killswitch_strict_mode', { strict }, async () => {
            const res = await fetch(`${API_BASE}/api/killswitch/strict_mode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ strict })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        });
    },

    async setPersistentFirewall(enabled) {
        return this.invoke('set_persistent_firewall', { enabled });
    },

    async setIfeoGuard(enabled) {
        return this.invoke('set_ifeo_guard', { enabled });
    },

    async isRunningAsAdmin() {
        return this.invoke('is_running_as_admin', {}, async () => {
            const res = await fetch(`${API_BASE}/api/system/admin_status`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.is_admin;
        });
    },

    async restartAsAdmin() {
        return this.invoke('restart_as_admin', {}, async () => {
            const res = await fetch(`${API_BASE}/api/system/restart_admin`, { method: 'POST' });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }
            return await res.json();
        });
    },

    async setPriorityAutostart(enabled) {
        return this.invoke('set_priority_autostart', { enabled }, async () => {
            const res = await fetch(`${API_BASE}/api/system/priority_autostart`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }
            return await res.json();
        });
    },

    async isPriorityAutostartActive() {
        return this.invoke('is_priority_autostart_active', {}, async () => {
            const res = await fetch(`${API_BASE}/api/system/priority_autostart_status`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.active;
        });
    }
};

// --------------------------------------------------------------------------
// Platform / OS Detection & Dynamic Differentiation
// Windows vs macOS (strict branding & native feature separation)
// --------------------------------------------------------------------------
let currentPlatform = (typeof navigator !== 'undefined' && (
    (navigator.platform && navigator.platform.toLowerCase().includes('mac')) ||
    (navigator.userAgent && navigator.userAgent.toLowerCase().includes('mac'))
)) ? 'macos' : 'windows';

function isMacOS() {
    return currentPlatform === 'macos';
}

function isWindows() {
    return currentPlatform === 'windows';
}

function getPlatformLabel() {
    return isMacOS() ? 'macOS' : 'Windows';
}

function updatePlatformTexts(platform) {
    if (platform) {
        const p = platform.toLowerCase();
        if (p.includes('mac') || p.includes('darwin')) {
            currentPlatform = 'macos';
        } else if (p.includes('win')) {
            currentPlatform = 'windows';
        } else {
            currentPlatform = p;
        }
    }
    const mac = isMacOS();

    if (toolsData.system_specs) {
        toolsData.system_specs.pill = mac ? "macOS (Apple Silicon / Intel)" : "Windows 10 / 11 (64-bit)";
    }
    if (toolsData.port_manager) {
        toolsData.port_manager.pill = mac ? "macOS • Сокеты и PID" : "Windows • Сокеты и PID";
    }
    if (toolsData.keep_awake) {
        toolsData.keep_awake.pill = mac ? "macOS • Энергосбережение" : "Windows • Электропитание";
    }
    if (toolsData.app_settings) {
        toolsData.app_settings.pill = `ToolHub Studio • ${mac ? 'macOS' : 'Windows'}`;
    }

    if (toolsData[currentTool]) {
        const pEl = document.getElementById('tool-pill');
        if (pEl) pEl.innerText = toolsData[currentTool].pill;
    }
}

// --------------------------------------------------------------------------
// Toast Notification Engine (Obsidian / Dark Studio Toast)
// Replaces native browser alerts with smooth non-intrusive in-app toasts
// --------------------------------------------------------------------------
function getOrCreateToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}

function showNotification(message, type = 'info', duration = 5000, customTitle = null) {
    const container = getOrCreateToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;

    let iconSvg = '';
    let title = customTitle;
    if (type === 'error') {
        title = title || 'Ошибка выполнения';
        iconSvg = '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    } else if (type === 'success') {
        title = title || 'Успешно';
        iconSvg = '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    } else if (type === 'warning') {
        title = title || 'Внимание';
        iconSvg = '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    } else {
        title = title || 'Информация';
        iconSvg = '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }

    toast.innerHTML = `
        ${iconSvg}
        <div class="toast-body">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-text">${escapeHtml(message)}</div>
        </div>
        <button type="button" class="toast-close-btn" onclick="this.parentElement.remove()" title="Закрыть">
            <svg viewBox="0 0 24 24" style="width: 14px; height: 14px;" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
    `;

    container.appendChild(toast);

    if (duration > 0) {
        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.add('toast-closing');
                setTimeout(() => toast.remove(), 250);
            }
        }, duration);
    }
}

// --------------------------------------------------------------------------
// 2. State & Tools Catalog (5 Views)
// --------------------------------------------------------------------------
let currentTool = 'master_humanizer';
let currentJobId = null;
let pollTimer = null;

// Состояние интерактивных переключателей для хуманизации
const toolState = {
    enable_video: true,
    enable_audio: true,
    enable_c2pa: true
};

const toolsData = {
    master_humanizer: {
        name: "Полная хуманизация видео",
        pill: "TikTok / Reels / Shorts",
        isExecutable: true,
        modalContent: `
            <div class="modal-section-title">Что делает инструмент:</div>
            <p class="modal-text">Единый конвейер: удаляет метки авторства нейросетей (C2PA манифесты), изменяет цифровой отпечаток видеоряда (Anti-pHash) и делает голос живым.</p>

            <div class="modal-section-title">Какую проблему решает:</div>
            <p class="modal-text">Если загрузить «сырой» рендер из Midjourney/Sora или чужую нарезку, алгоритм TikTok за секунду сверяет хэш и метаданные. Ролик либо получает статус <strong>«Не подходит для ленты рекомендаций»</strong>, либо виснет на 200 просмотрах.</p>

            <div class="modal-section-title">Как работает под капотом:</div>
            <p class="modal-text">
                1. <strong>Видео</strong>: сдвигает pHash на 40+ бит за счёт микро-масштаба (1.8%), динамического шума сенсора PRNU и коррекции линзы.<br>
                2. <strong>Звук</strong>: подмешивает комнатный тон (-52 dBFS), восстанавливает частоты выше 12 kHz (срез OpenAI TTS) и сбивает водяные знаки ElevenLabs/SynthID.<br>
                3. <strong>Заголовки</strong>: стирает C2PA/XMP и маскирует кодек под съемку iPhone.
            </p>
        `,
        options: `
            <div style="margin-bottom: 12px;">
                <!-- ИНТЕРАКТИВНЫЙ СЛАЙДЕР 1 -->
                <div class="toggle-card active" id="card-toggle-video" onclick="toggleOption('enable_video')">
                    <div class="toggle-info">
                        <div class="toggle-title-row">
                            <span class="toggle-title">Хуманизация видеоряда (Anti-pHash)</span>
                            <span class="mini-tag mini-tag-emerald">Anti-pHash + Шум</span>
                        </div>
                        <div class="toggle-sub">Зум 1.8%, динамический шум сенсора, калибровка линзы</div>
                    </div>
                    <div class="toggle-slider">
                        <div class="toggle-thumb"></div>
                    </div>
                </div>

                <!-- ИНТЕРАКТИВНЫЙ СЛАЙДЕР 2 -->
                <div class="toggle-card active" id="card-toggle-audio" onclick="toggleOption('enable_audio')">
                    <div class="toggle-info">
                        <div class="toggle-title-row">
                            <span class="toggle-title">Маскировка нейроголоса (Audio DSP)</span>
                            <span class="mini-tag mini-tag-cyan">Срез 12 kHz + Комнатный тон</span>
                        </div>
                        <div class="toggle-sub">Фоновый тон -52 dBFS, частоты 7–17 kHz, фазовый джиттер</div>
                    </div>
                    <div class="toggle-slider">
                        <div class="toggle-thumb"></div>
                    </div>
                </div>

                <!-- ИНТЕРАКТИВНЫЙ СЛАЙДЕР 3 -->
                <div class="toggle-card active" id="card-toggle-c2pa" onclick="toggleOption('enable_c2pa')">
                    <div class="toggle-info">
                        <div class="toggle-title-row">
                            <span class="toggle-title">Зачистка C2PA и метаданных</span>
                            <span class="mini-tag mini-tag-purple">Apple QuickTime</span>
                        </div>
                        <div class="toggle-sub">Стирание манифестов ИИ и маскировка под Apple QuickTime</div>
                    </div>
                    <div class="toggle-slider">
                        <div class="toggle-thumb"></div>
                    </div>
                </div>
            </div>

            <div class="input-group">
                <label>Зернистость матрицы камеры (по умолчанию: 12, диапазон: 8–20):</label>
                <input type="number" id="opt-grain" class="input-text" value="12" min="8" max="20">
            </div>

            <div class="input-group" style="margin-top: 8px;">
                <label>Уровень фонового комнатного тона (по умолчанию: 0.35):</label>
                <input type="number" step="0.05" id="opt-roomtone" class="input-text" value="0.35">
            </div>
        `
    },

    inspector: {
        name: "Проверка файла на метки ИИ",
        pill: "Инспектор C2PA и кодеков",
        isExecutable: true,
        modalContent: `
            <div class="modal-section-title">Что делает инспектор:</div>
            <p class="modal-text">Сканирует медиафайл перед публикацией, считывая внутренние ISOBMFF-боксы, метаданные кодеков и потоков.</p>

            <div class="modal-section-title">Зачем это нужно:</div>
            <p class="modal-text">Помогает на 100% убедиться, что видео не содержит скрытых манифестов генерации ИИ, пометок FFmpeg Lavf или некорректных параметров потока.</p>
        `,
        options: `<p style="font-size: 12px; color: var(--text-dim); line-height: 1.5;">Нажмите «Запустить обработку» для вывода детального отчета в терминал справа.</p>`
    },

    mcp_api: {
        name: "MCP & AI Интеграция",
        pill: "Model Context Protocol / API",
        isExecutable: false,
        modalContent: `
            <div class="modal-section-title">Что такое MCP сервер в ToolHub:</div>
            <p class="modal-text">ToolHub предоставляет локальный программный интерфейс (REST & JSON-RPC) по протоколу Model Context Protocol (MCP). Это позволяет AI-агентам (в Cursor, Claude Desktop, Antigravity) напрямую вызывать инструменты ToolHub без необходимости ручного управления.</p>
        `,
        options: `
            <div class="card" style="margin-bottom: 12px; padding: 14px;">
                <div class="card-title">Конфигурация для Claude Desktop / Cursor:</div>
                <p style="font-size: 12px; color: var(--text-medium); margin-top: 4px;">Добавьте следующий фрагмент в файл <code>claude_desktop_config.json</code>:</p>
                <div class="mcp-box">{
  "mcpServers": {
    "toolhub": {
      "url": "http://127.0.0.1:7860/api/tools"
    }
  }
}</div>
            </div>

            <div class="card" style="padding: 14px;">
                <div class="card-title">Доступные эндпоинты для вызова агентами:</div>
                <ul style="font-size: 12px; color: var(--text-medium); margin-left: 18px; margin-top: 8px; line-height: 1.8;">
                    <li><code>POST /api/run</code> — запуск задачи (параметры: tool, input_path, params)</li>
                    <li><code>GET /api/status?job_id=...</code> — опрос статуса и логов выполнения</li>
                    <li><code>POST /api/upload</code> — загрузка медиафайла в рабочий кэш</li>
                    <li><code>GET /api/system_info</code> — получение характеристик оборудования ПК</li>
                </ul>
            </div>
        `
    },

    system_specs: {
        name: "Характеристики ПК",
        pill: isMacOS() ? "macOS (Apple Silicon / Intel)" : "Windows 10 / 11 (64-bit)",
        isExecutable: false,
        modalContent: `
            <div class="modal-section-title">Аппаратные компоненты и система:</div>
            <p class="modal-text">Мониторинг физических компонентов машины: точная модель процессора, графический адаптер, состояние памяти, занятость накопителей и системный идентификатор оборудования (${isMacOS() ? 'IOPlatformUUID' : 'HWID / MachineGuid'}).</p>
            <div class="modal-section-title">Быстрый запуск утилит:</div>
            <p class="modal-text">Кнопки внизу экрана позволяют в 1 клик открыть системные панели управления ${isMacOS() ? 'macOS (Activity Monitor, Настройки, Дисковая утилита, Терминал)' : 'Windows (Редактор реестра regedit, Диспетчер задач, Диспетчер устройств, Управление дисками)'} напрямую в 1 клик.</p>
        `,
        options: `
            <div id="specs-dashboard-container">
                <div style="text-align: center; color: var(--text-dim); padding: 40px;">Загрузка компонентов системы...</div>
            </div>
        `
    },

    claude_code: {
        name: "Claude Code & AI Sentinel",
        pill: "Антибан, IP-аудит, Изоляция",
        isExecutable: false,
        modalContent: `
            <div class="modal-lead">Архитектура защиты Claude Sentinel (WFP Zero-Leak & IFEO Guard)</div>

            <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 8px;">

                <!-- БАРЬЕР 1: WFP ZERO-LEAK FIREWALL -->
                <div class="modal-block" style="border-left: 3px solid #10b981;">
                    <div class="modal-block-title" style="color: #10b981; display: flex; align-items: center; justify-content: space-between;">
                        <span>1. Персистентный барьер Брандмауэра Windows (WFP Zero-Leak)</span>
                        <span class="mini-tag mini-tag-emerald" style="font-size: 8px;">Ядро Windows</span>
                    </div>
                    <p class="modal-text">
                        <strong>Как работает:</strong> В службу Windows Advanced Firewall на уровне сетевого драйвера ядра внедряются постоянные исходящие правила фильтрации (<code>ToolHub_Claude_ZeroLeak</code> и <code>ToolHub_Claude_Cowork_ZeroLeak</code>), блокирующие прямой сетевой трафик исполняемых файлов Claude и фонового сервиса <code>cowork-svc.exe</code>.
                    </p>
                    <p class="modal-text" style="margin-top: 4px;">
                        <strong>Защита при закрытом ToolHub:</strong> Даже если ToolHub полностью закрыт, перезагружен, выключен из автозапуска или находится в процессе обновления — <strong>правило сохраняется в ядре ОС</strong>. Ни единый сетевой пакет Claude физически не выйдет в интернет напрямую без безопасного VPN. Сеть будет наглухо перекрыта драйвером Windows.
                    </p>
                    <p class="modal-text" style="margin-top: 4px;">
                        <strong>Шлюз безопасного пропуска:</strong> Шлюз кратковременно открывается только при нажатии <em>«Безопасный запуск Claude»</em> внутри ToolHub после успешной верификации VPN и отсутствия утечек. При любом обрыве соединения или смене сетевого интерфейса встроенный вотчдог ядра мгновенно восстанавливает блокировку за долю миллисекунды.
                    </p>
                </div>

                <!-- БАРЬЕР 2: АППАРАТНЫЙ ПЕРЕХВАТ IFEO -->
                <div class="modal-block" style="border-left: 3px solid #38bdf8;">
                    <div class="modal-block-title" style="color: #38bdf8; display: flex; align-items: center; justify-content: space-between;">
                        <span>2. Аппаратный перехват запуска (IFEO — Image File Execution Options)</span>
                        <span class="mini-tag mini-tag-cyan" style="font-size: 8px;">Реестр HKLM</span>
                    </div>
                    <p class="modal-text">
                        <strong>Как работает:</strong> В системный реестр Windows (ветка <code>HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options</code>) внедряется системный отладчик-перехватчик для <code>claude.exe</code>, <code>claude-desktop.exe</code> и <code>cowork-svc.exe</code>.
                    </p>
                    <p class="modal-text" style="margin-top: 4px;">
                        <strong>Защита от случайного запуска:</strong> Если вы, стороннее расширение (в Cursor, VS Code) или консольный скрипт случайно попытаются вызвать команду <code>claude</code> в PowerShell/CMD или дважды кликнуть по ярлыку Claude на рабочем столе без VPN — <strong>ядро Windows перехватит запуск ДО того, как процесс успеет создаться в памяти</strong>, и перенаправит вызов в защитный модуль ToolHub.
                    </p>
                    <p class="modal-text" style="margin-top: 4px;">
                        <strong>Всплывающее предупреждение:</strong> Вместо скрытой отправки телеметрии на серверы Anthropic вы увидите системное уведомление <em>«ToolHub IFEO Safe Guard: Прямой запуск заблокирован»</em>. Claude не запустится, а ваш аккаунт и подписка останутся в полной безопасности.
                    </p>
                </div>

                <!-- БЛОК 3: ПОШАГОВЫЙ РЕГЛАМЕНТ РАБОТЫ -->
                <div class="modal-block">
                    <div class="modal-block-title">3. Пошаговый регламент безопасной работы</div>
                    <ol class="modal-text" style="padding-left: 18px; margin: 4px 0 0 0; display: flex; flex-direction: column; gap: 4px;">
                        <li><strong>Включите VPN</strong>: Убедитесь, что активен режим Global TUN/TAP (без раздельного туннелирования DNS или WebRTC).</li>
                        <li><strong>Проверьте Антибан-индекс</strong>: В панели Sentinel нажмите <em>«Аудит сети»</em>. Индекс безопасности должен быть <strong>80+ баллов</strong>, а страна выхода — разрешённая юрисдикция (US, DE, NL и др.).</li>
                        <li><strong>Запуск через ToolHub</strong>: Используйте кнопки <em>«Claude Desktop»</em> или <em>«Claude CLI»</em> в баннере Sentinel. ToolHub автоматически снимет временный барьер только для авторизованной сессии.</li>
                        <li><strong>Синхронизация профилей</strong>: При работе с несколькими аккаунтами используйте вкладку <em>«Генератор профилей»</em> для разделения <code>CLAUDE_CONFIG_DIR</code> и изоляции отпечатков.</li>
                    </ol>
                </div>

                <!-- БЛОК 4: ИССЛЕДОВАТЕЛЬСКИЙ ФУНДАМЕНТ -->
                <div class="modal-block">
                    <div class="modal-block-title">4. Сетевой аудит и телеметрия Anthropic</div>
                    <ul class="modal-text" style="padding-left: 18px; margin: 4px 0 0 0; display: flex; flex-direction: column; gap: 4px;">
                        <li><strong>Сетевой риск-аудит</strong>: Проверка Egress IP, Cloudflare edge, детекция Split-Tunneling и запрещённых юрисдикций (RU, BY, CN и др.).</li>
                        <li><strong>Цифровой отпечаток</strong>: Сброс аппаратного <code>machineID</code> (SHA-256) и <code>userID</code> в <code>~/.claude.json</code> с очисткой очередей телеметрии.</li>
                        <li><strong>Изоляция профилей</strong>: Запуск разных аккаунтов в независимых окружениях (<code>CLAUDE_CONFIG_DIR</code>) с блокировкой скрытых маяков и авто-привязкой TZ под проверенный IP.</li>
                        <li><strong>Маршрутизация трафика</strong>: Готовые конфигурации для Clash Meta и Sing-box с обязательным проксированием <code>statsig.com</code> и <code>auth0.com</code>.</li>
                    </ul>
                </div>

            </div>
        `,
        options: `
            <div id="claude-dashboard-container">
                <div style="text-align: center; color: var(--text-dim); padding: 40px;">Загрузка модуля Claude Sentinel...</div>
            </div>
        `
    },

    chatgpt: {
        name: "ChatGPT",
        pill: "Статус: В разработке",
        isExecutable: false,
        modalContent: `
            <div class="modal-section-title">Архитектура модуля ChatGPT:</div>
            <p class="modal-text">Модуль спроектирован по принципу Claude Code: управление идентификатором устройства (installation_id / Device ID), очистка кэша сессий и подготовка среды к подключению ваших персональных сценариев автоматизации.</p>
            <div class="modal-section-title">Что делает сброс:</div>
            <p class="modal-text">
                1. Генерирует новый криптографический UUID для <code>installation_id</code>.<br>
                2. Очищает временные файлы и сессионный кэш.<br>
                3. Готовит изолированное окружение для новых сессий.
            </p>
        `,
        options: `
            <div id="chatgpt-dashboard-container">
                <div style="text-align: center; color: var(--text-dim); padding: 40px;">Загрузка параметров ChatGPT...</div>
            </div>
        `
    },

    port_manager: {
        name: "Монитор портов и процессов",
        pill: isMacOS() ? "macOS • Сокеты и PID" : "Windows • Сокеты и PID",
        isExecutable: false,
        modalContent: `
            <div class="modal-section-title">Что делает инструмент:</div>
            <p class="modal-text">Сканирует сетевые сокеты ${isMacOS() ? 'macOS (Darwin)' : 'Windows'} и выводит список всех прослушиваемых TCP портов в реальном времени. Показывает, какая программа держит порт (Vite, Next.js, Node.js, Python, PostgreSQL, Docker и др.), её PID и потребление памяти.</p>
            <div class="modal-section-title">Какую проблему решает:</div>
            <p class="modal-text">Ошибки вида <code>EADDRINUSE: address already in use :::3000</code>. Вместо ручного поиска PID через ${isMacOS() ? 'lsof в терминале и ввода kill -9' : 'netstat в терминале и ввода taskkill'} вы можете освободить порт в 1 клик прямо из таблицы.</p>
        `,
        options: `
            <div id="port-manager-container">
                <div style="text-align: center; color: var(--text-dim); padding: 40px;">Загрузка сетевых сокетов...</div>
            </div>
        `
    },

    keep_awake: {
        name: "Режим Антисон",
        pill: isMacOS() ? "macOS • Энергосбережение" : "Windows • Электропитание",
        isExecutable: false,
        modalContent: `
            <div class="modal-section-title">Что делает режим Антисон:</div>
            <p class="modal-text">Предотвращает автоматическое отключение дисплея и переход системы в спящий режим во время длительных задач: рендеринга видео, скачивания тяжелых файлов, компиляции или генерации нейросетями ${isMacOS() ? '(по принципу утилит Caffeine / Amphetamine в macOS)' : '(по принципу утилиты Awake из Microsoft PowerToys в Windows)'}.</p>
            <div class="modal-section-title">Безопасность и архитектура:</div>
            <p class="modal-text">Использует системные вызовы ядра энергосбережения ${isMacOS() ? 'macOS (caffeinate / IOKit API)' : 'Windows (Win32 SetThreadExecutionState)'}. Не нагружает процессор, не требует прав суперпользователя и автоматически возвращает систему в стандартный режим сна по истечении выбранного таймера.</p>
        `,
        options: `
            <div id="keep-awake-container">
                <div style="text-align: center; color: var(--text-dim); padding: 40px;">Инициализация таймера бодрствования...</div>
            </div>
        `
    },

    app_uninstaller: {
        name: "Деинсталлятор & Хвосты",
        pill: isMacOS() ? "macOS • Очистка приложений" : "Windows • Bulk Uninstaller & Clean",
        isExecutable: false,
        modalContent: `
            <div class="modal-section-title">Что делает инструмент:</div>
            <p class="modal-text">Пакетный деинсталлятор и сканер остаточного мусора в стиле Bulk Crap Uninstaller. Молниеносно сканирует реестр Windows (HKLM/HKCU), приложения магазина Windows (AppX/UWP Bloatware) и выявляет забытые остатки в AppData/ProgramData.</p>
            <div class="modal-section-title">Тихое пакетное удаление:</div>
            <p class="modal-text">Автоматически определяет тип инсталлятора (Inno Setup, MSI, NSIS, Squirrel, Win32) и формирует аргументы фонового тихого удаления, избавляя от необходимости вручную нажимать «Далее-Далее-Готово».</p>
            <div class="modal-section-title">Очистка хвостов:</div>
            <p class="modal-text">После удаления (или по запросу) анализирует дисковые пути в %AppData%, %LocalAppData%, %ProgramData% и реестре, предотвращая захламление системы гигабайтами скрытого кэша.</p>
        `,
        options: `
            <div id="uninstaller-container">
                <div style="text-align: center; color: var(--text-dim); padding: 40px;">Загрузка списка установленных программ...</div>
            </div>
        `
    },

    app_settings: {
        name: "Настройки приложения",
        pill: `ToolHub Studio • ${isMacOS() ? 'macOS' : 'Windows'}`,
        isExecutable: false,
        modalContent: `
            <div class="modal-section-title">Конфигурация ToolHub Studio:</div>
            <p class="modal-text">Управление системным автозапуском при старте ${isMacOS() ? 'macOS (LaunchAgents)' : 'Windows (Реестр Run)'}, переключение студийных цветовых тем, аппаратное ускорение видеомонтажа и очистка дискового кэша.</p>
        `,
        options: `
            <div id="settings-dashboard-container">
                <div style="text-align: center; color: var(--text-dim); padding: 40px;">Загрузка настроек студии...</div>
            </div>
        `
    }
};

// --------------------------------------------------------------------------
// 3. UI Interactions & Event Handlers
// --------------------------------------------------------------------------

// Переключение опций ползунками
function toggleOption(key) {
    toolState[key] = !toolState[key];
    const cardMap = {
        'enable_video': 'card-toggle-video',
        'enable_audio': 'card-toggle-audio',
        'enable_c2pa': 'card-toggle-c2pa'
    };
    const el = document.getElementById(cardMap[key]);
    if (el) {
        if (toolState[key]) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    }
}

// Фильтрация инструментов в сайдбаре
function filterSidebarTools(query) {
    const q = query.trim().toLowerCase();
    const links = document.querySelectorAll('#tools-nav-list .tool-link');
    links.forEach(l => {
        const text = l.getAttribute('data-title') || l.innerText.toLowerCase();
        if (!q || text.includes(q)) {
            l.style.display = 'flex';
        } else {
            l.style.display = 'none';
        }
    });
}

// Модальное окно справки
function openModal() {
    const info = toolsData[currentTool];
    if (!info) return;
    document.getElementById('modal-title').innerText = info.name;
    document.getElementById('modal-content').innerHTML = info.modalContent;
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.add('hidden');
}

// Модальное окно характеристик ПК (быстрый вызов)
function openSystemModal() {
    document.getElementById('modal-title').innerText = "Характеристики ПК";
    document.getElementById('modal-content').innerHTML = `
        <div style="text-align: center; color: var(--text-dim); padding: 30px;">
            Опрос компонентов системы...
        </div>
    `;
    document.getElementById('modal-overlay').classList.remove('hidden');

    appIpc.getSystemInfo()
        .then(s => {
            document.getElementById('modal-content').innerHTML = `
                <div class="modal-lead" style="display: flex; align-items: center; justify-content: space-between;">
                    <span>${s.os}</span>
                    <span class="pill" style="margin-left: 8px;">64-bit</span>
                </div>

                <div class="modal-block">
                    <div class="modal-block-title">Процессор (CPU):</div>
                    <div class="modal-text" style="color: var(--text-high); font-weight: 500;">${s.cpu}</div>
                </div>

                <div class="modal-block">
                    <div class="modal-block-title">Оперативная память (RAM):</div>
                    <div class="modal-text" style="color: var(--text-high); font-weight: 500;">
                        ${s.ram_total} <span style="color: var(--text-dim); font-size: 11px;">(${s.ram_avail} • ${s.ram_load} занято)</span>
                    </div>
                </div>

                <div class="modal-block">
                    <div class="modal-block-title">Графический адаптер (GPU):</div>
                    <div class="modal-text" style="color: var(--text-high); font-weight: 500;">${s.gpus ? s.gpus.join(', ') : 'N/A'}</div>
                </div>

                <div class="modal-block">
                    <div class="modal-block-title">Идентификатор оборудования (HWID / MachineGuid):</div>
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 5px; background: rgba(0,0,0,0.35); padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border-dim);">
                        <code style="font-family: var(--font-mono); font-size: 11.5px; color: var(--accent-cyan); letter-spacing: 0.03em;">${s.hwid}</code>
                        <button onclick="navigator.clipboard.writeText('${s.hwid}'); this.innerText='Скопировано!';" class="mini-copy-btn">Копировать</button>
                    </div>
                </div>

                <div class="modal-block">
                    <div class="modal-block-title">Аппаратное ускорение кодеков:</div>
                    <div class="modal-text" style="color: var(--accent-emerald); font-weight: 500;">${s.hw_accel || 'N/A'}</div>
                </div>

                <div class="modal-block">
                    <div class="modal-block-title">Сетевое имя ПК и пользователь:</div>
                    <div class="modal-text" style="color: var(--text-medium);">${s.computer_name || 'PC'} / ${s.user_name || 'User'}</div>
                </div>
            `;
        })
        .catch(err => {
            document.getElementById('modal-content').innerHTML = `
                <div style="color: #f87171; padding: 20px;">Ошибка получения характеристик: ${err}</div>
            `;
        });
}

// Переключение активного инструмента
function switchTool(toolKey) {
    currentTool = toolKey;

    // Сброс активных классов в сайдбаре
    document.querySelectorAll('#tools-nav-list .tool-link').forEach(l => l.classList.remove('active'));
    const statusBtn = document.getElementById('btn-system-specs');
    if (statusBtn) statusBtn.classList.remove('active');
    const settingsBtn = document.getElementById('btn-app-settings');
    if (settingsBtn) settingsBtn.classList.remove('active');

    // Подсветка активного пункта
    const targetLink = document.querySelector(`#tools-nav-list .tool-link[data-tool="${toolKey}"]`);
    if (targetLink) {
        targetLink.classList.add('active');
    } else if (toolKey === 'system_specs' && statusBtn) {
        statusBtn.classList.add('active');
    } else if (toolKey === 'app_settings' && settingsBtn) {
        settingsBtn.classList.add('active');
    }

    const info = toolsData[toolKey];
    if (!info) return;

    const toolNameEl = document.getElementById('tool-name');
    if (toolNameEl) toolNameEl.innerText = info.name;

    const toolPillEl = document.getElementById('tool-pill');
    if (toolPillEl) toolPillEl.innerText = info.pill;

    const dynamicOpts = document.getElementById('dynamic-options');
    if (dynamicOpts) dynamicOpts.innerHTML = info.options;

    const isExecutable = !!info.isExecutable;
    const fileSelectionArea = document.getElementById('file-selection-area');
    if (fileSelectionArea) fileSelectionArea.style.display = isExecutable ? 'block' : 'none';

    const runBtn = document.getElementById('run-btn');
    if (runBtn) runBtn.style.display = isExecutable ? 'flex' : 'none';

    const scrollArea = document.getElementById('content-scroll-area');
    if (scrollArea) {
        if (!isExecutable) {
            scrollArea.classList.add('full-width');
        } else {
            scrollArea.classList.remove('full-width');
        }
    }

    if (toolKey === 'system_specs') {
        renderSystemSpecsDashboard();
    } else if (toolKey === 'claude_code') {
        renderClaudeDashboard();
    } else if (toolKey === 'chatgpt') {
        renderChatGptDashboard();
    } else if (toolKey === 'app_settings') {
        renderSettingsDashboard();
    } else if (toolKey === 'port_manager') {
        renderPortManagerDashboard();
    } else if (toolKey === 'keep_awake') {
        renderKeepAwakeDashboard();
    } else if (toolKey === 'app_uninstaller') {
        renderUninstallerDashboard();
    }

    if (toolKey !== 'claude_code') {
        stopKillSwitchPolling();
    }

    logConsole(`[ВЫБОР] Активен раздел: ${info.name}`);
}

function escapeAttr(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Надежное копирование текста с fallback для любых WebView
function copyText(txt, btn) {
    if (!txt) return;
    const str = String(txt);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(str)
            .then(() => showCopyFeedback(btn))
            .catch(() => fallbackCopy(str, btn));
    } else {
        fallbackCopy(str, btn);
    }
}

function fallbackCopy(str, btn) {
    const el = document.createElement('textarea');
    el.value = str;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    try {
        document.execCommand('copy');
        showCopyFeedback(btn);
    } catch (e) {
        console.warn('Fallback copy error:', e);
    }
    document.body.removeChild(el);
}

function showCopyFeedback(btn) {
    if (!btn) return;
    const orig = btn.innerText;
    btn.innerText = 'Скопировано!';
    setTimeout(() => { btn.innerText = orig; }, 1400);
}

// Запуск системных апплетов Windows
function openWinTool(toolName) {
    appIpc.openWinTool(toolName)
        .then(() => {
            logConsole(`[WINDOWS] Запущена системная утилита: ${toolName}`);
        })
        .catch(err => logConsole(`[ОШИБКА] Не удалось запустить ${toolName}: ${err}`));
}

// --------------------------------------------------------------------------
// 4. Отрисовка Дашбордов (Характеристики ПК и Claude Code)
// --------------------------------------------------------------------------

// Отрисовка характеристик ПК внутри основного экрана
function renderSystemSpecsDashboard() {
    appIpc.getSystemInfo()
        .then(s => {
            const el = document.getElementById('specs-dashboard-container');
            if (!el) return;

            let drivesHtml = '';
            if (s.drives && s.drives.length > 0) {
                drivesHtml = s.drives.map(d => {
                    const isHigh = d.pct_num > 85;
                    const barColor = isHigh ? 'var(--accent-amber)' : 'var(--accent-emerald)';
                    return `
                        <div class="spec-card">
                            <div class="spec-card-header">
                                <span class="spec-card-label">НАКОПИТЕЛЬ ${d.drive}</span>
                                <span class="mini-tag ${isHigh ? 'mini-tag-amber' : 'mini-tag-emerald'}">${d.percent} занято</span>
                            </div>
                            <div class="spec-card-value">${d.total}</div>
                            <div class="spec-card-sub">${d.free} свободно (${d.used} занято)</div>
                            <div class="ram-bar-track">
                                <div class="ram-bar-fill" style="width: ${d.percent}; background: ${barColor};"></div>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            const mac = isMacOS();
            const hwidTag = mac ? 'IOPlatformUUID' : 'Реестр Windows';
            const hwidDesc = mac
                ? 'Аппаратный UUID устройства Apple Silicon / Intel, считываемый софтом для фингерпринтинга.'
                : 'Уникальный ключ оборудования Windows Cryptography (MachineGuid), считываемый софтом для фингерпринтинга.';
            const toolsLabel = mac
                ? 'СИСТЕМНЫЕ УТИЛИТЫ MACOS (БЫСТРЫЙ ЗАПУСК)'
                : 'СИСТЕМНЫЕ УТИЛИТЫ WINDOWS (БЫСТРЫЙ ЗАПУСК)';

            const toolsGridHtml = mac ? `
                <button class="win-tool-btn" onclick="openWinTool('taskmgr')">
                    <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                    Мониторинг (Activity Monitor)
                </button>
                <button class="win-tool-btn" onclick="openWinTool('settings')">
                    <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    Системные настройки
                </button>
                <button class="win-tool-btn" onclick="openWinTool('diskmgmt')">
                    <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>
                    Дисковая утилита (Disk Utility)
                </button>
                <button class="win-tool-btn" onclick="openWinTool('devmgmt')">
                    <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                    Сведения о системе
                </button>
                <button class="win-tool-btn" onclick="openWinTool('regedit')">
                    <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
                    Терминал (Terminal)
                </button>
                <button class="win-tool-btn" onclick="openWinTool('ncpa')">
                    <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
                    Настройки сети
                </button>
            ` : `
                <button class="win-tool-btn" onclick="openWinTool('regedit')">
                    <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                    Реестр (regedit)
                </button>
                <button class="win-tool-btn" onclick="openWinTool('taskmgr')">
                    <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                    Диспетчер задач
                </button>
                <button class="win-tool-btn" onclick="openWinTool('devmgmt')">
                    <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                    Диспетчер устройств
                </button>
                <button class="win-tool-btn" onclick="openWinTool('settings')">
                    <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    О системе (Settings)
                </button>
                <button class="win-tool-btn" onclick="openWinTool('diskmgmt')">
                    <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>
                    Управление дисками
                </button>
                <button class="win-tool-btn" onclick="openWinTool('ncpa')">
                    <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
                    Сетевые подключения
                </button>
            `;

            el.innerHTML = `
                <div class="specs-grid">
                    <!-- ПРОЦЕССОР -->
                    <div class="spec-card">
                        <div class="spec-card-header">
                            <span class="spec-card-label">ПРОЦЕССОР (CPU)</span>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span class="mini-tag mini-tag-cyan">Многопоточный</span>
                                <button data-copy="${escapeAttr(s.cpu)}" onclick="copyText(this.getAttribute('data-copy'), this)" class="mini-copy-btn">Копировать</button>
                            </div>
                        </div>
                        <div class="spec-card-value">${s.cpu}</div>
                    </div>

                    <!-- ОПЕРАТИВНАЯ ПАМЯТЬ -->
                    <div class="spec-card">
                        <div class="spec-card-header">
                            <span class="spec-card-label">ОПЕРАТИВНАЯ ПАМЯТЬ (RAM)</span>
                            <span class="mini-tag mini-tag-emerald">${s.ram_load} занято</span>
                        </div>
                        <div class="spec-card-value">${s.ram_total}</div>
                        <div class="spec-card-sub">${s.ram_avail} доступно</div>
                        <div class="ram-bar-track">
                            <div class="ram-bar-fill" style="width: ${s.ram_load};"></div>
                        </div>
                    </div>

                    <!-- ВИДЕОКАРТА -->
                    <div class="spec-card">
                        <div class="spec-card-header">
                            <span class="spec-card-label">ГРАФИЧЕСКИЙ ПРОЦЕССОР (GPU)</span>
                            <button data-copy="${escapeAttr((s.gpus || []).join(', '))}" onclick="copyText(this.getAttribute('data-copy'), this)" class="mini-copy-btn">Копировать</button>
                        </div>
                        <div class="spec-card-value">${(s.gpus && s.gpus.length) ? s.gpus.join(', ') : 'N/A'}</div>
                    </div>

                    <!-- ОПЕРАЦИОННАЯ СИСТЕМА -->
                    <div class="spec-card">
                        <div class="spec-card-header">
                            <span class="spec-card-label">ОПЕРАЦИОННАЯ СИСТЕМА</span>
                            <button data-copy="${escapeAttr(s.os)}" onclick="copyText(this.getAttribute('data-copy'), this)" class="mini-copy-btn">Копировать</button>
                        </div>
                        <div class="spec-card-value">${s.os}</div>
                        <div class="spec-card-sub">ПК: ${s.computer_name || 'PC'} • Пользователь: ${s.user_name || 'User'}</div>
                    </div>

                    <!-- НАКОПИТЕЛИ ДИСКОВ -->
                    ${drivesHtml}

                    <!-- HWID КАРТОЧКА -->
                    <div class="spec-card" style="grid-column: 1 / -1;">
                        <div class="spec-card-header">
                            <span class="spec-card-label">ЦИФРОВОЙ ИДЕНТИФИКАТОР ОБОРУДОВАНИЯ (HWID / ${hwidTag.toUpperCase()})</span>
                            <span class="mini-tag mini-tag-purple">${hwidTag}</span>
                        </div>
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 6px; background: rgba(0,0,0,0.4); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-dim);">
                            <code id="hwid-val-text" style="font-family: var(--font-mono); font-size: 13px; color: var(--accent-cyan); letter-spacing: 0.04em;">${s.hwid}</code>
                            <button data-copy="${escapeAttr(s.hwid)}" onclick="copyText(this.getAttribute('data-copy'), this)" class="btn btn-secondary" style="padding: 4px 12px; font-size: 11px;">Копировать HWID</button>
                        </div>
                        <div class="spec-card-sub" style="margin-top: 6px; line-height: 1.5;">
                            ${hwidDesc}
                        </div>
                        <div id="hwid-action-status" style="margin-top: 6px; font-size: 11.5px; display: none;"></div>
                    </div>

                    <!-- БЫСТРЫЕ СИСТЕМНЫЕ УТИЛИТЫ -->
                    <div class="spec-card" style="grid-column: 1 / -1;">
                        <div class="spec-card-header">
                            <span class="spec-card-label">${toolsLabel}</span>
                            <span class="mini-tag mini-tag-cyan">Системные апплеты</span>
                        </div>
                        <div class="win-tools-grid">
                            ${toolsGridHtml}
                        </div>
                    </div>
                </div>
            `;
        })
        .catch(err => {
            const el = document.getElementById('specs-dashboard-container');
            if (el) el.innerHTML = `<div style="color: #f87171; padding: 20px;">Ошибка загрузки характеристик: ${err}</div>`;
        });
}

// ==========================================================================
// CLAUDE CODE & AI SENTINEL (АНТИБАН, IP-АУДИТ, ИЗОЛЯЦИЯ)
// ==========================================================================

let currentClaudeTab = 'network';
let claudeAuditData = null;
let claudeInfoData = null;
let claudeAuditLoading = false;
let detectedWebRtcIps = [];

// Kill-Switch State
let killSwitchStatus = null;
let killSwitchPollingTimer = null;

function isCountryRestrictedClient(country) {
    if (!country) return true;
    const c = country.trim().toLowerCase();
    if (!c || c === 'неизвестно' || c === 'unknown') return true;
    return c === 'ru' || c === 'russia' || c.includes('russian') ||
           c === 'by' || c === 'belarus' ||
           c === 'cn' || c === 'china' ||
           c === 'ir' || c === 'iran' ||
           c === 'kp' || c.includes('korea') ||
           c === 'sy' || c === 'cu' || c === 've' || c === 'hk';
}

function renderKillSwitchBanner() {
    const ks = killSwitchStatus || {
        enabled: true,
        network_safe: false,
        status: 'blocked',
        status_text: 'БАРЬЕР АКТИВЕН: Запуск Claude заблокирован до включения безопасного VPN',
        blocked_count: 0,
        last_event: null,
        egress_ip: '',
        egress_country: '',
        claude_desktop_installed: false,
        claude_desktop_path: null,
        is_admin: false,
        allowed_ips: [],
        ip_matches_whitelist: true,
        priority_autostart_active: false
    };

    const isEnabled = ks.enabled;
    const isRestricted = isCountryRestrictedClient(ks.egress_country);
    const pinnedIp = (ks.allowed_ips && ks.allowed_ips.length > 0) ? ks.allowed_ips[0] : '';
    const ipMatches = !pinnedIp || (ks.ip_matches_whitelist !== false);

    const isStrict = ks.strict_mode !== false;
    const scoreVal = (ks.anti_ban_score !== undefined) ? ks.anti_ban_score : 0;
    const scoreLow = isStrict ? (scoreVal < 80) : (scoreVal < 40);
    const splitDetected = isStrict && ks.split_tunnel_detected;

    // Hard truth: if restricted country or empty IP, it is NEVER safe
    const isSafe = !isRestricted && ks.network_safe && Boolean(ks.egress_ip) && !scoreLow && !splitDetected && ipMatches;
    const heroClass = !isEnabled ? 'disabled' : isSafe ? 'armed' : 'blocked';

    let title = !isEnabled 
        ? 'Сетевой фильтр выключен' 
        : isSafe 
            ? 'Защита сети: Активна (VPN подключён)' 
            : 'Защита сети: Заблокировано';

    let badgeText = !isEnabled 
        ? 'ОТКЛЮЧЕНО' 
        : isSafe 
            ? 'БЕЗОПАСНО' 
            : 'ЗАБЛОКИРОВАНО';

    let desc = !isEnabled 
        ? 'Сетевой фильтр выключен. Запуск Claude не контролируется.' 
        : isRestricted
            ? `Выходной IP находится в санкционной зоне (${escapeHtml(ks.egress_country || 'Россия')}). Запуск Claude заблокирован.`
            : pinnedIp && !ipMatches
                ? `Текущий IP (${escapeHtml(ks.egress_ip || 'Не проверен')}) не совпадает с закреплённым (${escapeHtml(pinnedIp)}). Запуск заблокирован.`
                : splitDetected
                    ? 'Обнаружен Split-Tunneling (трафик разделяется). Запуск Claude заблокирован до включения прямого VPN.'
                    : scoreLow
                        ? `Оценка безопасности (${scoreVal}/100) ниже порога (${isStrict ? '80+' : '40+'}). Запуск Claude ограничен.`
                        : isSafe 
                            ? `Шлюз подтверждён: <strong style="color: var(--text-high);">${escapeHtml(ks.egress_country || 'VPN')}</strong> ${ks.egress_ip ? '(' + escapeHtml(ks.egress_ip) + ')' : ''}. При обрыве VPN процесс Claude будет мгновенно закрыт.` 
                            : 'VPN не обнаружен. Запуск Claude (Desktop и CLI) заблокирован до включения безопасного VPN.';

    const canLaunch = !isEnabled || isSafe;
    const desktopInstalled = ks.claude_desktop_installed;

    let statusBadge = '';
    if (pinnedIp) {
        if (ipMatches && ks.egress_ip) {
            statusBadge = `<span class="mini-tag mini-tag-emerald" style="font-size: 9px; padding: 1px 6px;">Совпадает</span>`;
        } else {
            statusBadge = `<span class="mini-tag mini-tag-red" style="font-size: 9px; padding: 1px 6px;">Не совпадает</span>`;
        }
    }

    let lastEventHtml = '';
    if (ks.last_event) {
        let cleanReason = (ks.last_event.reason || 'Заблокирован запуск без VPN')
            .replace(/\(\s*:\s*\)/g, '(шлюз не проверен / прямое соединение)')
            .replace(/\(\s*:\s*/g, '(');

        lastEventHtml = `
            <div class="ks-intercept-banner" style="margin-top: 6px;">
                <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                    <span class="mini-tag mini-tag-red" style="font-size: 9px; padding: 1px 6px; font-weight: 700;">БЛОКИРОВКА</span>
                    <span style="color: #fca5a5; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeAttr(cleanReason)}">${escapeHtml(cleanReason)}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                    <code style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.06); color: #94a3b8; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-family: var(--font-mono);">PID: ${ks.last_event.pid}</code>
                    <span style="font-size: 10px; color: var(--text-dim); font-family: var(--font-mono);">${escapeHtml(ks.last_event.timestamp || '')}</span>
                </div>
            </div>
        `;
    }

    return `
        <div class="claude-killswitch-hero ${heroClass}" id="claude-killswitch-card">
            <div class="ks-header-row">
                <div class="ks-brand-col">
                    <div class="ks-shield-icon-wrap">
                        ${!isEnabled 
                            ? '<svg class="icon" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
                            : isSafe 
                                ? '<svg class="icon" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 12 2 2 4-4"></path></svg>'
                                : '<svg class="icon" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'}
                    </div>
                    <div>
                        <div class="ks-title">
                            <span>${title}</span>
                            <span class="mini-tag ${!isEnabled ? '' : isSafe ? 'mini-tag-emerald' : 'mini-tag-red'}" style="font-size: 9px; font-weight: 700; ${!isEnabled ? 'background: rgba(255,255,255,0.08); color: var(--text-dim);' : ''}">
                                ${badgeText}
                            </span>
                        </div>
                        <div class="ks-desc">${desc}</div>
                    </div>
                </div>

                <div class="ks-control-col">
                    <div class="toggle-card ${isEnabled ? 'active' : ''}" style="padding: 5px 10px; margin: 0; min-width: auto; gap: 8px;" onclick="toggleKillSwitchClick()" role="button" tabindex="0" title="Включить / выключить сетевой фильтр">
                        <span style="font-size: 11px; font-weight: 600; color: ${isEnabled ? 'var(--text-high)' : 'var(--text-dim)'};">${isEnabled ? 'Фильтр: ВКЛ' : 'Фильтр: ВЫКЛ'}</span>
                        <div class="toggle-slider">
                            <div class="toggle-thumb"></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- СТРОКА ФИКСАЦИИ IP И СТРОГОГО ПОРОГА -->
            <div class="ks-single-ip-row">
                <span style="font-size: 11px; font-weight: 500; color: var(--text-dim); display: flex; align-items: center; gap: 5px; flex-shrink: 0;">
                    <svg class="icon" style="width: 12px; height: 12px; stroke: var(--text-dim);" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                    <span>Привязка к IP:</span>
                </span>
                <div class="ks-ip-field-wrap">
                    <input type="text" id="ks-single-ip-input" class="ks-ip-lock-input" placeholder="Любой безопасный VPN" value="${escapeHtml(pinnedIp)}" onkeydown="if(event.key==='Enter') saveSingleIpClick()">
                    ${statusBadge}
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="saveSingleIpClick()" style="padding: 3px 8px; font-size: 11px;">OK</button>
                ${ks.egress_ip ? `
                <button type="button" class="btn btn-secondary btn-sm" onclick="quickPinCurrentIp('${escapeHtml(ks.egress_ip)}')" style="padding: 3px 8px; font-size: 11px;" title="Зафиксировать текущий определенный IP (${escapeHtml(ks.egress_ip)})">
                    <span>Зафиксировать текущий</span>
                </button>
                ` : ''}
                ${pinnedIp ? `
                <button type="button" class="btn btn-subtle btn-sm" onclick="clearSingleIpClick()" title="Сбросить привязку к IP" style="padding: 3px 6px; font-size: 11px; color: var(--text-dim);">✕</button>
                ` : ''}

                <!-- Чекбокс строгого порога -->
                <div style="display: flex; align-items: center; gap: 6px; margin-left: auto; padding-left: 10px; border-left: 1px solid rgba(255,255,255,0.06);">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 11px; color: ${isStrict ? 'var(--text-high)' : 'var(--text-dim)'}; user-select: none;" title="Блокирует запуск Claude, если индекс ниже 80 баллов или обнаружен Split-Tunneling">
                        <input type="checkbox" id="ks-strict-mode-checkbox" ${isStrict ? 'checked' : ''} onchange="toggleStrictModeClick(this.checked)" style="accent-color: #10b981; cursor: pointer;">
                        <span>Строгий режим (индекс ≥ 80)</span>
                    </label>
                </div>
            </div>

            ${lastEventHtml}

            <div class="ks-stats-bar">
                <div class="ks-pills-row">
                    <span style="font-size: 11px; color: var(--text-dim); display: flex; align-items: center; gap: 6px;">
                        ${ks.blocked_count > 0 
                            ? `<span style="color: #f87171; font-weight: 600;">Перехвачено: <strong style="font-family: var(--font-mono);">${ks.blocked_count}</strong></span>` 
                            : `<span>Перехвачено: <strong style="color: var(--text-high); font-family: var(--font-mono);">0</strong></span>`}
                    </span>
                    <span style="font-size: 10px; color: var(--text-dim);">•</span>
                    <span style="font-size: 11px; color: var(--text-dim);">
                        Шлюз: <span style="color: var(--text-high);">${escapeHtml(ks.egress_country || 'Не проверен')} ${ks.egress_ip ? '(' + escapeHtml(ks.egress_ip) + ')' : ''}</span>
                    </span>
                    <span style="font-size: 10px; color: var(--text-dim);">•</span>
                    <span style="font-size: 11px; color: var(--text-dim);">
                        Desktop: <span style="color: ${desktopInstalled ? 'var(--text-high)' : 'var(--text-dim)'};">${desktopInstalled ? 'Установлен' : 'Не найден'}</span>
                    </span>
                </div>

                <div class="ks-launch-actions">
                    <span style="font-size: 11px; color: var(--text-dim); margin-right: 2px;">Запуск:</span>
                    <button type="button" class="btn btn-secondary ${canLaunch ? '' : 'disabled'}" style="padding: 5px 12px; font-size: 11px; gap: 6px; ${canLaunch ? '' : 'opacity: 0.35; cursor: not-allowed;'}" onclick="safeLaunchClaudeClick('desktop')" title="${canLaunch ? 'Запустить Claude Desktop' : 'Заблокировано: включите VPN'}">
                        <svg class="icon" style="width: 11px; height: 11px;" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        <span>Claude Desktop</span>
                    </button>
                    <button type="button" class="btn btn-secondary ${canLaunch ? '' : 'disabled'}" style="padding: 5px 12px; font-size: 11px; gap: 6px; ${canLaunch ? '' : 'opacity: 0.35; cursor: not-allowed;'}" onclick="safeLaunchClaudeClick('cli')" title="${canLaunch ? 'Запустить Claude CLI' : 'Заблокировано: включите VPN'}">
                        <svg class="icon" style="width: 11px; height: 11px;" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
                        <span>Claude CLI</span>
                    </button>
                </div>
            </div>
        </div>
    `;
}

async function quickPinCurrentIp(ip) {
    if (!ip) {
        showNotification('Сначала выполните аудит сети, чтобы определить текущий IP.', 'warning', 3500);
        return;
    }
    try {
        const newStatus = await appIpc.setAllowedIps([ip]);
        killSwitchStatus = newStatus;
        renderClaudeDashboard();
        showNotification(`Доверенный IP зафиксирован: ${ip}`, 'success', 3500, 'IP зафиксирован');
    } catch (err) {
        showNotification(`Ошибка фиксации IP: ${err.message || err}`, 'error', 4000);
    }
}

async function saveSingleIpClick() {
    const input = document.getElementById('ks-single-ip-input');
    const rawVal = input ? input.value.trim() : '';
    const ips = rawVal ? [rawVal] : [];

    try {
        const newStatus = await appIpc.setAllowedIps(ips);
        killSwitchStatus = newStatus;
        renderClaudeDashboard();
        if (ips.length > 0) {
            showNotification(`Доверенный IP зафиксирован: ${ips[0]}`, 'success', 3500, 'Сохранено');
        } else {
            showNotification('Привязка к IP снята. Разрешён любой безопасный VPN.', 'info', 3000);
        }
    } catch (err) {
        showNotification(`Ошибка сохранения IP: ${err.message || err}`, 'error', 4000);
    }
}

async function clearSingleIpClick() {
    try {
        const newStatus = await appIpc.setAllowedIps([]);
        killSwitchStatus = newStatus;
        renderClaudeDashboard();
        showNotification('Привязка к IP снята. Разрешён любой безопасный VPN.', 'info', 3000);
    } catch (err) {
        showNotification(`Ошибка: ${err.message || err}`, 'error', 4000);
    }
}

async function toggleStrictModeClick(checked) {
    try {
        const newStatus = await appIpc.setKillSwitchStrictMode(checked);
        killSwitchStatus = newStatus;
        renderClaudeDashboard();
        showNotification(
            checked 
                ? 'Строгий барьер включён: запуск Claude заблокирован при индексе < 80 или утечках.' 
                : 'Строгий барьер отключён: порог индекса снят.',
            checked ? 'success' : 'warning',
            3500,
            checked ? 'Строгий режим' : 'Мягкий режим'
        );
    } catch (err) {
        showNotification(`Ошибка смены режима: ${err.message || err}`, 'error', 4000);
    }
}

async function toggleKillSwitchClick() {
    try {
        const currentEnabled = killSwitchStatus ? killSwitchStatus.enabled : true;
        const newStatus = await appIpc.setKillSwitchEnabled(!currentEnabled);
        killSwitchStatus = newStatus;
        renderClaudeDashboard();
        if (newStatus.enabled) {
            showNotification('Kill-Switch активирован! Запуск Claude заблокирован до подтверждения безопасного VPN.', 'info', 4000, 'Защита включена');
        } else {
            showNotification('Внимание! Kill-Switch отключен. Claude может выходить в сеть без проверки.', 'warning', 5000, 'Защита выключена');
        }
    } catch (err) {
        showNotification(`Ошибка Kill-Switch: ${err.message || err}`, 'error', 5000);
    }
}

async function safeLaunchClaudeClick(type) {
    if (killSwitchStatus && killSwitchStatus.enabled && !killSwitchStatus.network_safe) {
        showNotification('Запуск заблокирован Kill-Switch! Сетевое подключение не верифицировано как безопасное (VPN выключен или IP находится в санкционной зоне). Сначала включите VPN и нажмите «Обновить аудит».', 'error', 7000, 'Блокировка пуска');
        return;
    }

    try {
        showNotification(`Безопасный запуск Claude (${type === 'desktop' ? 'Desktop' : 'CLI'})...`, 'info', 3000);
        const res = await appIpc.safeLaunchClaude(type);
        showNotification(res || 'Claude успешно запущен под защитой Kill-Switch!', 'success', 5000, 'Успешный старт');
        logConsole(`[KILLSWITCH] Safe Launch: ${type} -> ${res}`);
    } catch (err) {
        showNotification(`Не удалось запустить Claude: ${err.message || err}`, 'error', 6000);
    }
}

async function updateKillSwitchState() {
    try {
        const prevBlockedCount = killSwitchStatus ? killSwitchStatus.blocked_count : 0;
        const prevSafe = killSwitchStatus ? killSwitchStatus.network_safe : false;
        killSwitchStatus = await appIpc.getKillSwitchStatus();

        if (killSwitchStatus.blocked_count > prevBlockedCount) {
            const now = Date.now();
            if (!window._lastInterceptToastTime || (now - window._lastInterceptToastTime > 6000)) {
                window._lastInterceptToastTime = now;
                showNotification(`Запуск Claude заблокирован: требуется безопасный VPN (Перехватов: ${killSwitchStatus.blocked_count})`, 'warning', 4000, 'Защита сети');
            }
            logConsole(`[KILLSWITCH ALERT] Intercepted unauthorized Claude process without safe VPN! Total intercepts: ${killSwitchStatus.blocked_count}`);
            renderClaudeDashboard();
        } else if (killSwitchStatus.network_safe !== prevSafe) {
            renderClaudeDashboard();
        }
    } catch (e) {
        // silent fail
    }
}

function startKillSwitchPolling() {
    if (killSwitchPollingTimer) return;
    killSwitchPollingTimer = setInterval(updateKillSwitchState, 2500);
}

function stopKillSwitchPolling() {
    if (killSwitchPollingTimer) {
        clearInterval(killSwitchPollingTimer);
        killSwitchPollingTimer = null;
    }
}

function checkWebRtcCandidates() {
    return new Promise((resolve) => {
        try {
            const RTCPeer = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
            if (!RTCPeer) {
                resolve([]);
                return;
            }
            const rtc = new RTCPeer({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
            const ips = [];
            rtc.createDataChannel('leak_test');
            rtc.createOffer().then(offer => rtc.setLocalDescription(offer)).catch(() => resolve([]));
            rtc.onicecandidate = (event) => {
                if (!event || !event.candidate) {
                    resolve(ips);
                    return;
                }
                const cand = event.candidate.candidate;
                const parts = cand.split(' ');
                const ip = parts[4];
                if (ip && !ips.includes(ip) && ip.indexOf(':') === -1) {
                    ips.push(ip);
                }
            };
            setTimeout(() => resolve(ips), 2500);
        } catch (e) {
            resolve([]);
        }
    });
}

async function renderClaudeDashboard() {
    const el = document.getElementById('claude-dashboard-container');
    if (!el) return;

    // Load Kill-Switch status if not cached
    if (!killSwitchStatus) {
        try {
            killSwitchStatus = await appIpc.getKillSwitchStatus();
        } catch (e) {
            // fallback
        }
    }
    startKillSwitchPolling();

    // Load Claude Code info if not cached
    if (!claudeInfoData) {
        try {
            claudeInfoData = await appIpc.getClaudeInfo();
        } catch (e) {
            claudeInfoData = { installed: false, machineID: 'Не найден', userID: 'Не найден' };
        }
    }

    el.innerHTML = `
        <div class="claude-sentinel-wrap">
            <!-- KILL-SWITCH GUARDIAN HERO -->
            ${renderKillSwitchBanner()}

            <!-- TAB NAVIGATION (4 TABS) -->
            <div class="claude-tabs-bar">
                <button type="button" class="claude-nav-btn ${currentClaudeTab === 'network' ? 'active' : ''}" data-tab="network" onclick="switchClaudeTab('network')" title="Индекс защиты от бана и сетевой контур">
                    <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                    <span>Антибан-индекс</span>
                </button>
                <button type="button" class="claude-nav-btn ${currentClaudeTab === 'fingerprint' ? 'active' : ''}" data-tab="fingerprint" onclick="switchClaudeTab('fingerprint')" title="Цифровой отпечаток (machineID / HWID)">
                    <svg class="icon" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                    <span>Отпечаток (HWID)</span>
                </button>
                <button type="button" class="claude-nav-btn ${currentClaudeTab === 'profiles' ? 'active' : ''}" data-tab="profiles" onclick="switchClaudeTab('profiles')" title="Изоляция профилей (Config Isolator)">
                    <svg class="icon" viewBox="0 0 24 24"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>
                    <span>Изоляция профилей</span>
                </button>
                <button type="button" class="claude-nav-btn ${currentClaudeTab === 'routing' ? 'active' : ''}" data-tab="routing" onclick="switchClaudeTab('routing')" title="Маршрутизация (Clash / Sing-box)">
                    <svg class="icon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                    <span>Маршрутизация</span>
                </button>
            </div>

            <!-- TAB CONTENT CONTAINER -->
            <div id="claude-tab-content">
                ${renderCurrentClaudeTabContent()}
            </div>
        </div>
    `;
}

function switchClaudeTab(tab) {
    currentClaudeTab = tab;
    const contentEl = document.getElementById('claude-tab-content');
    if (contentEl) {
        contentEl.innerHTML = renderCurrentClaudeTabContent();
    }
    // Update button active states
    document.querySelectorAll('.claude-nav-btn').forEach(btn => {
        const btnTab = btn.getAttribute('data-tab');
        const text = btn.innerText || '';
        if (
            btnTab === tab ||
            (tab === 'network' && text.includes('Сетевой')) ||
            (tab === 'fingerprint' && (text.includes('Цифровой') || text.includes('Отпечаток'))) ||
            (tab === 'profiles' && text.includes('Изоляция')) ||
            (tab === 'routing' && text.includes('Маршрутизация'))
        ) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function renderCurrentClaudeTabContent() {
    switch (currentClaudeTab) {
        case 'network':
            return renderNetworkTab();
        case 'fingerprint':
            return renderFingerprintTab();
        case 'profiles':
            return renderProfilesTab();
        case 'routing':
            return renderRoutingTab();
        default:
            return renderNetworkTab();
    }
}

// --------------------------------------------------------------------------
// TAB 1: NETWORK & RISK AUDIT (IP.NET.COFFEE / CLAUDE)
// --------------------------------------------------------------------------
function renderNetworkTab() {
    if (claudeAuditLoading) {
        return `
            <div style="padding: 40px; text-align: center; background: var(--bg-card); border: 1px solid var(--border-dim); border-radius: 8px;">
                <div style="font-size: 14px; font-weight: 600; color: var(--accent-cyan); margin-bottom: 8px;">
                    Выполняется сетевой аудит контура Claude & Cloudflare Edge...
                </div>
                <div style="font-size: 11.5px; color: var(--text-dim);">
                    Запрос claude.ai/cdn-cgi/trace, проверка Split-Tunneling, DNS-утечек и WebRTC STUN...
                </div>
            </div>
        `;
    }

    const a = claudeAuditData;
    if (!a) {
        return `
            <div style="padding: 30px; text-align: center; background: var(--bg-card); border: 1px solid var(--border-dim); border-radius: 8px;">
                <div style="font-size: 13px; color: var(--text-medium); margin-bottom: 12px;">Аудит сетевого контура ещё не проводился.</div>
                <button onclick="runClaudeNetworkAudit(true)" class="btn btn-primary" style="font-size: 12px; padding: 8px 18px;">
                    Запустить аудит контура Claude.ai
                </button>
            </div>
        `;
    }

    const isCritical = a.risk_level === 'critical' || a.is_restricted_country;
    const isWarning = a.risk_level === 'warning' || a.split_tunnel_detected;
    const heroClass = isCritical ? 'critical' : isWarning ? 'warning' : 'safe';
    const heroColor = isCritical ? '#f87171' : isWarning ? '#fbbf24' : '#34d399';
    const statusTitle = isCritical 
        ? 'РИСК: САНКЦИОННАЯ ЗОНА' 
        : isWarning 
            ? 'ТРЕБУЕТСЯ НАСТРОЙКА' 
            : 'БЕЗОПАСНО: ДОПУСТИМЫЙ ШЛЮЗ';

    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Не определено';
    const tzMismatch = localTz !== a.timezone;
    const scoreVal = (a.anti_ban_index !== undefined) ? a.anti_ban_index : (a.trust_score || 0);

    return `
        <!-- HERO TRUST SCORE GAUGE -->
        <div class="claude-trust-hero ${heroClass}">
            <div style="display: flex; flex-direction: column; gap: 6px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="mini-tag ${isCritical ? 'mini-tag-red' : isWarning ? 'mini-tag-amber' : 'mini-tag-emerald'}" style="font-size: 9.5px; font-weight: 700;">
                        ${statusTitle}
                    </span>
                    <span style="font-size: 11px; color: var(--text-dim);">Оценка готовности окружения</span>
                </div>
                <div style="font-size: 14px; font-weight: 600; color: #f4f4f5;">
                    ${isCritical 
                        ? 'Выходной IP находится в санкционной зоне (Россия / СНГ). Вход на claude.ai вызовет блокировку.' 
                        : isWarning 
                            ? 'Параметры безопасности требуют оптимизации (синхронизируйте таймзону или сбросьте HWID).' 
                            : 'Сетевое окружение безопасно: чистый VPN-шлюз, HWID изолирован, часовой пояс синхронизирован.'}
                </div>
                <div style="display: flex; gap: 8px; margin-top: 6px; align-items: center; flex-wrap: wrap;">
                    <button onclick="runClaudeNetworkAudit(true)" class="btn btn-secondary" style="font-size: 11px; padding: 5px 12px;">
                        Обновить аудит
                    </button>
                    <button onclick="copyAuditJsonAction()" class="btn btn-secondary" style="font-size: 11px; padding: 5px 12px; border-color: rgba(255, 255, 255, 0.12);" title="Скопировать весь JSON-отчёт аудита">
                        Экспорт JSON
                    </button>
                    <span style="font-size: 11px; color: var(--text-dim);">Шлюз: <code style="color: var(--accent-cyan);">${escapeHtml(a.egress_ip)}</code> (${escapeHtml(a.country_name)})</span>
                </div>
            </div>

            <div class="trust-score-badge" style="color: ${heroColor};">
                <span class="trust-score-num">${scoreVal}%</span>
                <span class="trust-score-label">ИНДЕКС</span>
            </div>
        </div>

        <!-- КЛЮЧЕВЫЕ ФАКТОРЫ ЗАЩИТЫ -->
        <div class="score-breakdown-card" style="margin-top: 12px; border-color: rgba(255, 255, 255, 0.08);">
            <div class="score-breakdown-title" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: var(--text-high); font-weight: 600; font-size: 12.5px;">Факторы защиты профиля</span>
                <span style="font-family: var(--font-mono); font-size: 12px; color: ${heroColor}; font-weight: 700;">
                    ${scoreVal} / 100 баллов
                </span>
            </div>
            <div style="font-size: 11px; color: var(--text-dim); margin-bottom: 10px; line-height: 1.4;">
                Проверка сетевого шлюза, конфигурации устройства и системных параметров перед запуском.
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px;">
                ${(a.pillars || []).map(p => {
                    const isPass = p.passed;
                    const tagClass = isPass ? 'mini-tag-emerald' : p.current_score > 0 ? 'mini-tag-amber' : 'mini-tag-red';
                    let actHtml = '';
                    if (p.action_type === 'reset_hwid') {
                        actHtml = `<button onclick="executeClaudeReset()" class="btn btn-secondary" style="font-size: 10.5px; padding: 4px 10px; margin-top: 6px; width: 100%;">Сбросить HWID</button>`;
                    } else if (p.action_type === 'create_profile') {
                        actHtml = `<button onclick="switchClaudeTab('profiles')" class="btn btn-secondary" style="font-size: 10.5px; padding: 4px 10px; margin-top: 6px; width: 100%;">Создать профиль</button>`;
                    } else if (p.action_type === 'sync_tz') {
                        actHtml = `<button onclick="syncTimezoneAction('${escapeAttr(a.timezone)}')" class="btn btn-primary" style="font-size: 10.5px; padding: 4px 10px; margin-top: 6px; width: 100%;">Синхронизировать (+15)</button>`;
                    } else if (p.action_type === 'toggle_killswitch') {
                        actHtml = `<button onclick="toggleKillSwitchClick()" class="btn btn-primary" style="font-size: 10.5px; padding: 4px 10px; margin-top: 6px; width: 100%;">Включить фильтр</button>`;
                    }
                    return `
                        <div style="background: rgba(255,255,255,0.02); border: 1px solid ${isPass ? 'rgba(16, 185, 129, 0.18)' : 'rgba(245, 158, 11, 0.2)'}; border-radius: 6px; padding: 9px; display: flex; flex-direction: column; justify-content: space-between;">
                            <div>
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px;">
                                    <span style="font-size: 11px; font-weight: 600; color: #f4f4f5;">${escapeHtml(p.name)}</span>
                                    <span class="mini-tag ${tagClass}" style="font-size: 9px; font-weight: 700;">${p.current_score}/${p.max_score} б.</span>
                                </div>
                                <div style="font-size: 10.5px; color: ${isPass ? 'var(--accent-emerald)' : '#fbbf24'}; font-weight: 600; margin-bottom: 2px;">
                                    ${escapeHtml(p.status)}
                                </div>
                                <div style="font-size: 10px; color: var(--text-dim); line-height: 1.35;">
                                    ${escapeHtml(p.details)}
                                </div>
                            </div>
                            ${actHtml}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>

        <!-- RISK REASONS & RECOMMENDATIONS -->
        ${a.risk_reasons && a.risk_reasons.length > 0 ? `
            <div style="margin-top: 14px; background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 14px;">
                <div style="font-size: 12px; font-weight: 700; color: #f87171; margin-bottom: 8px; text-transform: uppercase;">
                    Выявленные угрозы безопасности:
                </div>
                <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: var(--text-medium); line-height: 1.5;">
                    ${a.risk_reasons.map(r => `<li style="margin-bottom: 4px;">${escapeHtml(r)}</li>`).join('')}
                </ul>
            </div>
        ` : ''}

        ${a.recommendations && a.recommendations.length > 0 ? `
            <div style="margin-top: 12px; background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; padding: 14px;">
                <div style="font-size: 12px; font-weight: 700; color: var(--accent-emerald); margin-bottom: 8px; text-transform: uppercase;">
                    Рекомендации по защите аккаунта:
                </div>
                <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: var(--text-medium); line-height: 1.5;">
                    ${a.recommendations.map(r => `<li style="margin-bottom: 4px;">${escapeHtml(r)}</li>`).join('')}
                </ul>
            </div>
        ` : ''}
    `;
}

async function runClaudeNetworkAudit(force = false) {
    if (claudeAuditLoading) return;
    claudeAuditLoading = true;
    renderClaudeDashboard();

    try {
        // Run WebRTC STUN candidate test in parallel
        checkWebRtcCandidates().then(ips => {
            detectedWebRtcIps = ips;
        });

        const audit = await appIpc.auditClaudeNetwork();
        claudeAuditData = audit;
        try {
            killSwitchStatus = await appIpc.getKillSwitchStatus();
        } catch (e) {}
        logConsole(`[CLAUDE SENTINEL] Аудит завершён: IP=${audit.egress_ip} (${audit.egress_loc}), Trust Score=${audit.trust_score}/100`);
    } catch (err) {
        showNotification(`Сетевой аудит: ${err.message || err}`, 'error', 7000);
        logConsole(`[CLAUDE SENTINEL ОШИБКА] ${err.message || err}`);
    } finally {
        claudeAuditLoading = false;
        renderClaudeDashboard();
    }
}

async function syncTimezoneAction(targetTz) {
    try {
        showNotification(`Синхронизация часового пояса с ${targetTz}...`, 'info', 2000);
        const res = await appIpc.syncTimezone(targetTz);
        showNotification(res.message || 'Часовой пояс Windows синхронизирован с IP!', 'success', 5000, 'Таймзона выровнена');
        logConsole(`[ТАЙМЗОНА] ${res.message || 'Синхронизировано'}`);
        await runClaudeNetworkAudit(true);
    } catch (err) {
        showNotification(err.message || String(err), 'error', 6000);
    }
}

async function restoreTimezoneAction() {
    try {
        const res = await appIpc.restoreTimezone();
        showNotification(res.message || 'Исходный часовой пояс восстановлен.', 'success', 5000);
        logConsole(`[ТАЙМЗОНА] ${res.message || 'Восстановлено'}`);
        await runClaudeNetworkAudit(true);
    } catch (err) {
        showNotification(err.message || String(err), 'error', 6000);
    }
}

function copyAuditJsonAction() {
    if (!claudeAuditData) {
        showNotification('Данные аудита ещё не получены', 'warning');
        return;
    }
    const jsonStr = JSON.stringify(claudeAuditData, null, 2);
    copyText(jsonStr);
    showNotification('JSON-отчёт аудита скопирован в буфер!', 'success', 4000, 'Экспорт готов');
}

async function testProxyAction() {
    const input = document.getElementById('custom-proxy-input');
    const wrap = document.getElementById('custom-proxy-result');
    if (!input || !wrap) return;

    const proxy = (input.value || '').trim();
    if (!proxy) {
        showNotification('Введите адрес прокси (например: socks5://127.0.0.1:1080)', 'warning');
        return;
    }

    wrap.style.display = 'block';
    wrap.innerHTML = `
        <div style="padding: 12px; background: rgba(255,255,255,0.03); border-radius: 6px; font-size: 12px; color: var(--accent-cyan);">
            Выполняется аудит прокси через кластер Claude.ai (проверка ASN, скорости и Trust Score)...
        </div>
    `;

    try {
        const pAudit = await appIpc.testCustomProxy(proxy);
        claudeAuditData = pAudit; // Store tested proxy as current audit for TZ binding
        const isGood = pAudit.trust_score >= 80;
        const isDanger = pAudit.trust_score < 40 || pAudit.is_restricted_country;
        const badgeColor = isDanger ? 'mini-tag-red' : isGood ? 'mini-tag-emerald' : 'mini-tag-amber';
        const verdict = isGood ? 'РЕКОМЕНДУЕТСЯ ДЛЯ CLAUDE PRO / MAX' : isDanger ? 'КРИТИЧЕСКИЙ РИСК: БАН АККАУНТА' : 'СРЕДНИЙ РИСК: ДАТА-ЦЕНТР';

        wrap.innerHTML = `
            <div style="background: rgba(0,0,0,0.4); border: 1px solid var(--border-medium); border-radius: 8px; padding: 14px; margin-top: 6px;">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="mini-tag ${badgeColor}" style="font-weight: 700;">${verdict}</span>
                        <span style="font-size: 11px; color: var(--text-dim);">Egress IP: <code style="color: #fff;">${escapeHtml(pAudit.egress_ip)}</code> (${escapeHtml(pAudit.country_name)})</span>
                    </div>
                    <div style="font-family: var(--font-mono); font-size: 14px; font-weight: 800; color: ${isDanger ? '#ef4444' : isGood ? '#10b981' : '#f59e0b'};">
                        TRUST SCORE: ${pAudit.trust_score} / 100
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; font-size: 11.5px;">
                    <div><strong>Провайдер (ISP):</strong> <span style="color: var(--text-high);">${escapeHtml(pAudit.isp)}</span></div>
                    <div><strong>ASN:</strong> <span style="color: var(--text-high);">${escapeHtml(pAudit.asn)}</span></div>
                    <div><strong>Тип подключения:</strong> <span style="color: ${pAudit.is_datacenter ? '#f59e0b' : 'var(--accent-emerald)'}; font-weight: 600;">${pAudit.is_datacenter ? 'Дата-центр / Хостинг' : 'Чистый Residential (ISP)'}</span></div>
                    <div><strong>Часовой пояс IP:</strong> <span style="color: var(--text-high);">${escapeHtml(pAudit.timezone)}</span></div>
                </div>
            </div>
        `;
        showNotification(`Прокси протестирован! Trust Score: ${pAudit.trust_score}/100`, isDanger ? 'error' : isGood ? 'success' : 'warning');
    } catch (e) {
        wrap.innerHTML = `
            <div style="padding: 10px 14px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; font-size: 12px; color: #f87171;">
                Ошибка проверки прокси: ${escapeHtml(e.message || String(e))}
            </div>
        `;
        showNotification(`Ошибка прокси: ${e.message || e}`, 'error');
    }
}

// --------------------------------------------------------------------------
// TAB 2: DIGITAL FINGERPRINT & SANITIZER
// --------------------------------------------------------------------------
function renderFingerprintTab() {
    const c = claudeInfoData || {};

    return `
        <div class="specs-grid">
            <!-- КАРТОЧКА machineID -->
            <div class="spec-card" style="grid-column: 1 / -1;">
                <div class="spec-card-header">
                    <span class="spec-card-label">ТЕКУЩИЙ MACHINEID (АППАРАТНЫЙ ХЭШ УСТРОЙСТВА)</span>
                    <button data-copy="${escapeAttr(c.machineID || '')}" onclick="copyText(this.getAttribute('data-copy'), this)" class="mini-copy-btn">Копировать</button>
                </div>
                <div style="margin-top: 4px; background: rgba(0,0,0,0.35); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-dim);">
                    <code style="font-family: var(--font-mono); font-size: 12px; color: var(--accent-cyan); word-break: break-all;">${escapeHtml(c.machineID || 'Не найден (~/.claude.json)')}</code>
                </div>
                <div class="spec-card-sub" style="margin-top: 6px;">
                    64-значный криптографический SHA-256 хэш. Anthropic связывает все сессии и аккаунты с данным хэшем при каждом запуске CLI.
                </div>
            </div>

            <!-- КАРТОЧКА userID -->
            <div class="spec-card" style="grid-column: 1 / -1;">
                <div class="spec-card-header">
                    <span class="spec-card-label">ИДЕНТИФИКАТОР УСТАНОВКИ (USERID / DEVICE_ID)</span>
                    <button data-copy="${escapeAttr(c.userID || '')}" onclick="copyText(this.getAttribute('data-copy'), this)" class="mini-copy-btn">Копировать</button>
                </div>
                <div style="margin-top: 4px; background: rgba(0,0,0,0.35); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-dim);">
                    <code style="font-family: var(--font-mono); font-size: 12px; color: var(--accent-emerald); word-break: break-all;">${escapeHtml(c.userID || 'Не найден (~/.claude.json)')}</code>
                </div>
                <div class="spec-card-sub" style="margin-top: 6px;">
                    Уникальный идентификатор клиентского профиля. Передается в заголовках телеметрии к <code>/api/event_logging/v2/batch</code>.
                </div>
            </div>

            <!-- СТАТИСТИКА АККАУНТА & ХРАНИЛИЩА -->
            <div class="spec-card">
                <div class="spec-card-header">
                    <span class="spec-card-label">ПРИВЯЗАННЫЙ АККАУНТ OAUTH</span>
                </div>
                <div class="spec-card-value" style="font-size: 13px;">${escapeHtml(c.oauth_email || 'Не авторизован')}</div>
                <div class="spec-card-sub">
                    Организация: ${escapeHtml(c.oauth_org_name || c.oauth_org_id || 'N/A')}<br>
                    Тариф: <strong>${escapeHtml(c.billing_type || 'Стандарт')}</strong>
                </div>
            </div>

            <div class="spec-card">
                <div class="spec-card-header">
                    <span class="spec-card-label">ОЧЕРЕДЬ ТЕЛЕМЕТРИИ</span>
                    <span class="mini-tag ${c.telemetry_files > 0 ? 'mini-tag-amber' : 'mini-tag-emerald'}">${c.telemetry_files || 0} файлов</span>
                </div>
                <div class="spec-card-value">${c.telemetry_files || 0} событий</div>
                <div class="spec-card-sub">Папка: <code>~/.claude/telemetry</code></div>
            </div>

            <div class="spec-card">
                <div class="spec-card-header">
                    <span class="spec-card-label">ИСТОРИЯ ФАЙЛОВ & ПРОЕКТЫ</span>
                    <span class="mini-tag mini-tag-purple">${c.file_history_count || 0} снимков</span>
                </div>
                <div class="spec-card-value">${c.projects_count || 0} проектов</div>
                <div class="spec-card-sub">
                    Снимков кода: ${c.file_history_count || 0} | Сессий: ${c.sessions_count || 0}
                </div>
            </div>

            <div class="spec-card">
                <div class="spec-card-header">
                    <span class="spec-card-label">ДАТА ПЕРВОГО ЗАПУСКА</span>
                </div>
                <div class="spec-card-value" style="font-size: 12px;">${escapeHtml(c.firstStartTime || 'Не зафиксирована')}</div>
                <div class="spec-card-sub">Версия первого запуска: <strong>${escapeHtml(c.firstStartVersion || 'N/A')}</strong></div>
            </div>

            <!-- УПРАВЛЕНИЕ ОТПЕЧАТКОМ -->
            <div class="spec-card" style="grid-column: 1 / -1; border-color: rgba(16, 185, 129, 0.35);">
                <div class="spec-card-header">
                    <span class="spec-card-label" style="color: var(--accent-emerald);">ГЛУБОКАЯ ОЧИСТКА & СБРОС ОТПЕЧАТКА (1-CLICK DEEP RESET)</span>
                    <span class="mini-tag mini-tag-emerald">БЕЗОПАСНО</span>
                </div>
                <div class="spec-card-sub" style="margin-top: 6px; line-height: 1.5; color: var(--text-high);">
                    Выполняет комплексную санитарную обработку профиля:
                    <ul style="margin: 6px 0 0 16px; padding: 0;">
                        <li>Генерирует новый криптографический SHA-256 хэш для <code>machineID</code>;</li>
                        <li>Генерирует новый случайный 64-значный <code>userID</code>;</li>
                        <li>Очищает папки очереди телеметрии <code>telemetry/</code>, снимки файлов <code>file-history/</code> и сессии <code>sessions/</code>;</li>
                        <li>Обновляет дату первого старта, делая систему «чистым новым компьютером» для антифрод-системы Anthropic.</li>
                    </ul>
                </div>
                <div style="display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap;">
                    <button onclick="executeClaudeReset()" class="btn btn-primary" style="font-size: 12px; padding: 9px 18px;">
                        Сбросить цифровой отпечаток (Deep Reset)
                    </button>
                    <button onclick="openClaudeFolder()" class="btn btn-secondary" style="font-size: 11.5px; padding: 8px 14px;">
                        Открыть папку ~/.claude
                    </button>
                </div>
            </div>
        </div>
    `;
}

async function executeClaudeReset() {
    try {
        const res = await appIpc.resetClaudeCode();
        if (res && res.success) {
            claudeInfoData = await appIpc.getClaudeInfo();
            renderClaudeDashboard();
            showNotification(`Сброс завершен: новый machineID=${res.machineID.substring(0, 12)}..., очищено ${res.cleaned_files} файлов телеметрии.`, 'success', 6000, 'Отпечаток обновлен');
            logConsole(`[CLAUDE SENTINEL] Deep Reset: machineID=${res.machineID}, очищено ${res.cleaned_files} файлов`);
        } else {
            showNotification(res.error || 'Ошибка сброса отпечатка', 'error');
        }
    } catch (err) {
        showNotification(err.message || String(err), 'error');
    }
}

function openClaudeFolder() {
    appIpc.openClaudeFolder()
        .then(() => showNotification('Папка ~/.claude открыта в файловом менеджере.', 'info', 3000))
        .catch(err => showNotification(`Не удалось открыть папку: ${err}`, 'error'));
}

// --------------------------------------------------------------------------
// TAB 3: PROFILES ISOLATION & ENV SCRIPT GENERATOR
// --------------------------------------------------------------------------
function renderProfilesTab() {
    const detectedTz = (claudeAuditData && claudeAuditData.timezone) ? claudeAuditData.timezone : null;
    return `
        <div class="specs-grid">
            <div class="spec-card" style="grid-column: 1 / -1;">
                <div class="spec-card-header">
                    <span class="spec-card-label">ИЗОЛЯЦИЯ РАБОЧИХ ПРОФИЛЕЙ (CLAUDE_CONFIG_DIR)</span>
                    <span class="mini-tag mini-tag-purple">MULTIPLE ACCOUNTS</span>
                </div>
                <div class="spec-card-sub" style="margin-top: 6px; line-height: 1.5;">
                    Если вы используете несколько аккаунтов Claude Code (например, личный, рабочий и агентский), переключение в одном стандартном каталоге <code>~/.claude</code> приводит к мгновенной связке аккаунтов по machineID. ToolHub позволяет создать полностью изолированные профили с персональной переменной <code>CLAUDE_CONFIG_DIR</code>.
                </div>

                <div style="margin-top: 10px; font-size: 11.5px; display: flex; align-items: center; gap: 8px;">
                    <span style="color: var(--text-dim);">Авто-привязка таймзоны Node.js:</span>
                    ${detectedTz
                        ? `<span class="mini-tag mini-tag-cyan" style="font-size: 11px;">TZ: ${escapeHtml(detectedTz)} (по проверенному IP)</span>`
                        : `<span class="mini-tag mini-tag-amber" style="font-size: 11px;">IP не проверен — таймзона не будет привязана</span>`
                    }
                </div>

                <div style="display: flex; gap: 10px; margin-top: 14px; align-items: center; flex-wrap: wrap;">
                    <input type="text" id="claude-new-profile-input" placeholder="Имя профиля (например: client-project)" style="background: var(--bg-card); border: 1px solid var(--border-dim); border-radius: 6px; padding: 7px 12px; font-size: 12px; color: #fff; min-width: 260px;">
                    <button onclick="createClaudeProfileClick()" class="btn btn-secondary" style="font-size: 12px; padding: 7px 16px;">
                        Создать изолированный профиль
                    </button>
                </div>
                <div id="claude-profile-result-wrap" style="margin-top: 14px; display: none;"></div>
            </div>

            <!-- БЛОКИРОВКА СКРЫТОЙ ТЕЛЕМЕТРИИ CLI -->
            <div class="spec-card" style="grid-column: 1 / -1;">
                <div class="spec-card-header">
                    <span class="spec-card-label">ОБЯЗАТЕЛЬНЫЕ ФЛАГИ ОТКЛЮЧЕНИЯ ТЕЛЕМЕТРИИ CLI</span>
                    <span class="mini-tag mini-tag-cyan">ENVIRONMENT FLAGS</span>
                </div>
                <div class="spec-card-sub" style="margin-top: 6px; line-height: 1.5;">
                    При каждом вызове CLI команды <code>claude</code> агент отправляет телеметрию и сканирует переменные среды. Добавьте эти переменные в командный файл запуска или системные настройки:
                </div>
                <div class="claude-terminal-box" style="margin-top: 10px;">
<span style="color: var(--accent-cyan);"># Windows (PowerShell / CMD)</span>
set CLAUDE_CONFIG_DIR=%USERPROFILE%\\.claude-profiles\\my-isolated-profile
${detectedTz ? `set TZ=${detectedTz}\n` : ''}set DISABLE_TELEMETRY=1
set DISABLE_ERROR_REPORTING=1
set CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
set CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1

<span style="color: var(--accent-emerald);"># macOS / Linux (Bash / Zsh)</span>
export CLAUDE_CONFIG_DIR="$HOME/.claude-profiles/my-isolated-profile"
${detectedTz ? `export TZ="${detectedTz}"\n` : ''}export DISABLE_TELEMETRY=1
export DISABLE_ERROR_REPORTING=1
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1</div>
                <div style="margin-top: 10px; display: flex; gap: 8px;">
                    <button class="mini-copy-btn" onclick="copyText('set CLAUDE_CONFIG_DIR=%USERPROFILE%\\\\.claude-profiles\\\\isolated\\n${detectedTz ? `set TZ=${detectedTz}\\n` : ''}set DISABLE_TELEMETRY=1\\nset DISABLE_ERROR_REPORTING=1\\nset CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1\\nset CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1', this)">Копировать для Windows</button>
                    <button class="mini-copy-btn" onclick="copyText('export CLAUDE_CONFIG_DIR=\\\"$HOME/.claude-profiles/isolated\\\"\\n${detectedTz ? `export TZ=\\\"${detectedTz}\\\"\\n` : ''}export DISABLE_TELEMETRY=1\\nexport DISABLE_ERROR_REPORTING=1\\nexport CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1\\nexport CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1', this)">Копировать для macOS</button>
                </div>
            </div>
        </div>
    `;
}

async function createClaudeProfileClick() {
    const input = document.getElementById('claude-new-profile-input');
    const wrap = document.getElementById('claude-profile-result-wrap');
    if (!input || !wrap) return;

    const name = (input.value || '').trim();
    if (!name) {
        showNotification('Укажите имя профиля (например: work-account)', 'warning');
        return;
    }

    // Bind timezone from the verified IP in this tool only
    const detectedTz = (claudeAuditData && claudeAuditData.timezone) ? claudeAuditData.timezone : '';

    try {
        const res = await appIpc.generateClaudeProfile(name, detectedTz);
        if (res && res.success) {
            wrap.style.display = 'block';
            wrap.innerHTML = `
                <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 14px;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-weight: 700; color: var(--accent-emerald); font-size: 13px;">Профиль "${escapeHtml(res.profile_name)}" успешно создан!</span>
                        <span class="mini-tag mini-tag-emerald">ГОТОВ К ЗАПУСКУ</span>
                    </div>
                    <div style="font-size: 11.5px; color: var(--text-medium); margin-top: 6px;">
                        Путь к профилю: <code>${escapeHtml(res.profile_path)}</code><br>
                        Сгенерирован независимый machineID: <code>${escapeHtml(res.machine_id.substring(0, 16))}...</code><br>
                        ${res.target_tz ? `Таймзона Node.js: <code style="color: var(--accent-cyan); font-weight: 600;">TZ=${escapeHtml(res.target_tz)}</code> (по проверенному IP)<br>` : '<span style="color: var(--text-dim);">Таймзона TZ не установлена (IP не был проверен во вкладке сетевого аудита)</span><br>'}
                    </div>
                    <div style="margin-top: 10px;">
                        <span style="font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase;">Файл запуска (Windows .bat):</span>
                        <div class="claude-terminal-box" style="margin-top: 4px;">${escapeHtml(res.bat_script)}</div>
                        <button class="mini-copy-btn" style="margin-top: 6px;" onclick="copyText(this.getAttribute('data-copy'), this)" data-copy="${escapeAttr(res.bat_script)}">Копировать BAT скрипт</button>
                    </div>
                </div>
            `;
            showNotification(`Изолированный профиль "${name}" успешно создан.`, 'success');
        } else {
            showNotification(res.error || 'Ошибка создания профиля', 'error');
        }
    } catch (e) {
        showNotification(e.message || String(e), 'error');
    }
}

// --------------------------------------------------------------------------
// TAB 4: TRAFFIC ROUTING (CLASH / SING-BOX)
// --------------------------------------------------------------------------
function renderRoutingTab() {
    return `
        <div class="specs-grid">
            <!-- КРИТИЧЕСКИЕ ДОМЕНЫ -->
            <div class="spec-card" style="grid-column: 1 / -1;">
                <div class="spec-card-header">
                    <span class="spec-card-label">ОБЯЗАТЕЛЬНЫЙ СПИСОК ДОМЕНОВ ДЛЯ ПРОКСИРОВАНИЯ</span>
                    <span class="mini-tag mini-tag-amber">КРИТИЧЕСКИ ВАЖНО</span>
                </div>
                <div class="spec-card-sub" style="margin-top: 6px; line-height: 1.5;">
                    Пользователи часто сталкиваются с бесконечной загрузкой claude.ai («белый экран» или скелетон) из-за того, что проксируют только <code>claude.ai</code>, забывая о внешних провайдерах фича-флагов и аутентификации. Все перечисленные домены должны направляться через чистый зарубежный шлюз:
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; margin-top: 12px;">
                    <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--border-dim); border-radius: 6px; padding: 10px;">
                        <code style="color: var(--accent-cyan); font-weight: 600;">statsig.com</code>
                        <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">
                            Провайдер конфигураций и экспериментов. Если не проксируется — claude.ai зависает на этапе предзагрузки.
                        </div>
                    </div>
                    <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--border-dim); border-radius: 6px; padding: 10px;">
                        <code style="color: var(--accent-emerald); font-weight: 600;">auth0.com</code>
                        <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">
                            Сервер авторизации OAuth. При блокировке вход в аккаунт сбрасывается в циклический редирект.
                        </div>
                    </div>
                    <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--border-dim); border-radius: 6px; padding: 10px;">
                        <code style="color: #a78bfa; font-weight: 600;">claude.ai & anthropic.com</code>
                        <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">
                            Основные API шлюзы инференса и статики интерфейса.
                        </div>
                    </div>
                </div>
            </div>

            <!-- КОНФИГУРАЦИЯ CLASH META (YAML) -->
            <div class="spec-card">
                <div class="spec-card-header">
                    <span class="spec-card-label">CLASH META / MIHOMO (YAML)</span>
                    <button class="mini-copy-btn" onclick="copyText(this.getAttribute('data-copy'), this)" data-copy="rules:
  - DOMAIN-SUFFIX,claude.ai,CLAUDE-PROXY
  - DOMAIN-SUFFIX,anthropic.com,CLAUDE-PROXY
  - DOMAIN-SUFFIX,statsig.com,CLAUDE-PROXY
  - DOMAIN-SUFFIX,auth0.com,CLAUDE-PROXY
  - DOMAIN-KEYWORD,anthropic,CLAUDE-PROXY
  - DOMAIN-KEYWORD,claude,CLAUDE-PROXY">Копировать</button>
                </div>
                <div class="claude-terminal-box" style="margin-top: 8px;">
<span style="color: var(--accent-cyan);"># Clash Ruleset for Anthropic</span>
rules:
  - DOMAIN-SUFFIX,claude.ai,CLAUDE-PROXY
  - DOMAIN-SUFFIX,anthropic.com,CLAUDE-PROXY
  - DOMAIN-SUFFIX,statsig.com,CLAUDE-PROXY
  - DOMAIN-SUFFIX,auth0.com,CLAUDE-PROXY
  - DOMAIN-KEYWORD,anthropic,CLAUDE-PROXY
  - DOMAIN-KEYWORD,claude,CLAUDE-PROXY</div>
            </div>

            <!-- КОНФИГУРАЦИЯ SING-BOX (JSON) -->
            <div class="spec-card">
                <div class="spec-card-header">
                    <span class="spec-card-label">SING-BOX (JSON RULESET)</span>
                    <button class="mini-copy-btn" onclick="copyText(this.getAttribute('data-copy'), this)" data-copy='{
  "type": "field",
  "domain_suffix": [
    "claude.ai",
    "anthropic.com",
    "statsig.com",
    "auth0.com"
  ],
  "outbound": "proxy-out"
}'>Копировать</button>
                </div>
                <div class="claude-terminal-box" style="margin-top: 8px;">
<span style="color: var(--accent-emerald);">// Sing-box Route Rule</span>
{
  "type": "field",
  "domain_suffix": [
    "claude.ai",
    "anthropic.com",
    "statsig.com",
    "auth0.com"
  ],
  "outbound": "proxy-out"
}</div>
            </div>
        </div>
    `;
}

// --------------------------------------------------------------------------
// Отрисовка раздела ChatGPT (Экосистема OpenAI & Codex)
// --------------------------------------------------------------------------
function renderChatGptDashboard() {
    appIpc.getChatGptInfo()
        .then(c => {
            const el = document.getElementById('chatgpt-dashboard-container');
            if (!el) return;

            el.innerHTML = `
                <div class="specs-grid">
                    <!-- СТАТУС В РАЗРАБОТКЕ -->
                    <div class="spec-card" style="grid-column: 1 / -1; border-color: rgba(245, 158, 11, 0.3); background: rgba(245, 158, 11, 0.04);">
                        <div class="spec-card-header">
                            <span class="spec-card-label" style="color: #fbbf24;">МОДУЛЬ В РАЗРАБОТКЕ</span>
                            <span class="mini-tag mini-tag-amber">В РАЗРАБОТКЕ</span>
                        </div>
                        <div class="spec-card-sub" style="color: var(--text-high); margin-top: 4px; line-height: 1.5;">
                            Раздел для работы с агентом <strong>ChatGPT</strong> по принципу Claude Code. Модуль находится в разработке и подготавливается к внедрению вашей персональной логики.
                        </div>
                    </div>

                    <!-- КАРТОЧКА INSTALLATION_ID -->
                    <div class="spec-card" style="grid-column: 1 / -1;">
                        <div class="spec-card-header">
                            <span class="spec-card-label">ИДЕНТИФИКАТОР УСТАНОВКИ (INSTALLATION_ID / DEVICE FINGERPRINT)</span>
                            <button data-copy="${escapeAttr(c.installationId || '')}" onclick="copyText(this.getAttribute('data-copy'), this)" class="mini-copy-btn">Копировать</button>
                        </div>
                        <div style="margin-top: 4px; background: rgba(0,0,0,0.35); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-dim);">
                            <code style="font-family: var(--font-mono); font-size: 12px; color: var(--accent-cyan); word-break: break-all;">${c.installationId || 'Не обнаружен (~/.codex/installation_id)'}</code>
                        </div>
                        <div class="spec-card-sub" style="margin-top: 4px;">Служит уникальным отпечатком клиента при обращении к инфраструктуре OpenAI.</div>
                    </div>

                    <!-- СВОДКА КАТАЛОГА -->
                    <div class="spec-card">
                        <div class="spec-card-header">
                            <span class="spec-card-label">РАБОЧИЙ КАТАЛОГ КОНФИГУРАЦИИ</span>
                        </div>
                        <div class="spec-card-value" style="font-size: 11px; word-break: break-all;">${c.path || '~/.codex'}</div>
                        <div class="spec-card-sub">Статус: ${c.installed ? 'Обнаружен в системе' : 'Готов к инициализации'}</div>
                    </div>

                    <div class="spec-card">
                        <div class="spec-card-header">
                            <span class="spec-card-label">СЕССИОННЫЙ КЭШ</span>
                            <span class="mini-tag mini-tag-purple">${c.cachedFiles || 0} файлов</span>
                        </div>
                        <div class="spec-card-value">${c.cachedFiles || 0} временных объектов</div>
                        <div class="spec-card-sub">Последняя активность: ${c.lastActive || 'Не зафиксирована'}</div>
                    </div>

                    <!-- УПРАВЛЕНИЕ ОТПЕЧАТКОМ -->
                    <div class="spec-card" style="grid-column: 1 / -1;">
                        <div class="spec-card-header">
                            <span class="spec-card-label">УПРАВЛЕНИЕ ЦИФРОВЫМ ОТПЕЧАТКОМ CHATGPT</span>
                        </div>
                        <div class="spec-card-sub" style="margin-top: 4px; line-height: 1.5;">
                            Генерирует новый криптографический UUID для <code>installation_id</code>, обновляет конфигурацию и очищает локальный кэш сессий.
                        </div>
                        <div style="display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap;">
                            <button onclick="executeChatGptReset()" class="btn btn-secondary" style="font-size: 11.5px; padding: 8px 16px; border-color: rgba(6, 182, 212, 0.4); color: var(--accent-cyan);">
                                Сбросить цифровой отпечаток ChatGPT
                            </button>
                            <button onclick="openChatGptFolder()" class="btn btn-secondary" style="font-size: 11px; padding: 8px 14px;">
                                Открыть папку в Explorer
                            </button>
                        </div>
                        <div id="chatgpt-reset-msg" style="margin-top: 8px; font-size: 11.5px; display: none;"></div>
                    </div>
                </div>
            `;
        })
        .catch(err => {
            const el = document.getElementById('chatgpt-dashboard-container');
            if (el) el.innerHTML = `<div style="color: #f87171; padding: 20px;">Ошибка загрузки параметров ChatGPT: ${err}</div>`;
        });
}

function executeChatGptReset() {
    const msgEl = document.getElementById('chatgpt-reset-msg');
    if (msgEl) {
        msgEl.style.display = 'block';
        msgEl.style.color = 'var(--text-dim)';
        msgEl.innerText = 'Выполняется генерация нового отпечатка...';
    }

    appIpc.resetChatGptSession()
        .then(data => {
            if (data && data.success) {
                if (msgEl) {
                    msgEl.style.color = 'var(--accent-cyan)';
                    msgEl.innerText = `[Успешно] Новый installation_id установлен! Очищено временных файлов: ${data.cleanedFiles}`;
                }
                renderChatGptDashboard();
                logConsole(`[CHATGPT] Сброс отпечатка выполнен: новый installation_id=${(data.installationId || '').substring(0, 16)}...`);
            } else {
                if (msgEl) {
                    msgEl.style.color = '#f87171';
                    msgEl.innerText = `[Ошибка] ${data ? data.error : 'Неизвестная ошибка'}`;
                }
            }
        })
        .catch(err => {
            if (msgEl) {
                msgEl.style.color = '#f87171';
                msgEl.innerText = `[Ошибка] ${err}`;
            }
        });
}

function openChatGptFolder() {
    appIpc.openChatGptFolder()
        .catch(err => logConsole(`[ОШИБКА] Не удалось открыть папку: ${err}`));
}

function regenerateHwid() {
    const statusEl = document.getElementById('hwid-action-status');
    if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--text-dim)';
        statusEl.innerText = 'Генерация нового MachineGuid...';
    }

    appIpc.regenerateHwid()
        .then(data => {
            if (data && data.success) {
                if (statusEl) {
                    statusEl.style.color = 'var(--accent-emerald)';
                    statusEl.innerText = `[Успех] Новый HWID успешно установлен: ${data.hwid}`;
                }
                const hwidText = document.getElementById('hwid-val-text');
                if (hwidText) hwidText.innerText = data.hwid;
                logConsole(`[HWID] Установлен новый MachineGuid: ${data.hwid}`);
            } else {
                if (statusEl) {
                    statusEl.style.color = '#f87171';
                    statusEl.innerText = `[Ошибка] ${data ? data.error : 'Неизвестная ошибка'}`;
                }
            }
        })
        .catch(err => {
            if (statusEl) {
                statusEl.style.color = '#f87171';
                statusEl.innerText = `[Ошибка сети] ${err}`;
            }
        });
}

function resetClaudeCodeFingerprint() {
    executeClaudeReset();
}

// --------------------------------------------------------------------------
// 5. File Selection & Drag-and-Drop
// --------------------------------------------------------------------------
const dropzone = document.getElementById('dropzone');

if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
            uploadFile(e.dataTransfer.files[0]);
        }
    });
}

function handleFileSelect(event) {
    if (event.target && event.target.files && event.target.files.length > 0) {
        uploadFile(event.target.files[0]);
    }
}

function uploadFile(file) {
    const labelEl = document.getElementById('dropzone-label');
    if (labelEl) labelEl.innerText = `Подготовка: ${file.name}...`;
    logConsole(`[*] Подготовка файла ${file.name}...`);

    appIpc.uploadFile(file)
        .then(data => {
            if (data && data.path) {
                document.getElementById('input-path').value = data.path;
                if (labelEl) labelEl.innerText = `Выбран файл: ${file.name}`;
                logConsole(`[+] Файл подготовлен: ${data.path}`);
            }
        })
        .catch(err => {
            if (labelEl) labelEl.innerText = `Ошибка при выборе файла`;
            logConsole(`[ОШИБКА] Сбой подготовки файла: ${err}`);
        });
}

// Native Tauri Drag-and-Drop Event Listener (Tauri 2.0)
if (typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.event) {
    try {
        window.__TAURI__.event.listen('tauri://drag-drop', (event) => {
            const paths = event.payload && (event.payload.paths || event.payload);
            if (Array.isArray(paths) && paths.length > 0) {
                const filePath = paths[0];
                document.getElementById('input-path').value = filePath;
                const fileName = filePath.split(/[/\\]/).pop();
                const labelEl = document.getElementById('dropzone-label');
                if (labelEl) labelEl.innerText = `Выбран файл: ${fileName}`;
                logConsole(`[+] Файл выбран через окно Tauri: ${filePath}`);
            }
        });
    } catch (e) {
        // Ignored if event listen not enabled
    }
}

// --------------------------------------------------------------------------
// 6. Console Logging & Job Execution
// --------------------------------------------------------------------------
function toggleLogsDrawer(forceState) {
    const backdrop = document.getElementById('logs-drawer-backdrop');
    if (!backdrop) return;
    if (typeof forceState === 'boolean') {
        if (forceState) backdrop.classList.remove('hidden');
        else backdrop.classList.add('hidden');
    } else {
        backdrop.classList.toggle('hidden');
    }
}

function copyAllLogs(btn) {
    const consoleEl = document.getElementById('console');
    if (!consoleEl) return;
    const text = consoleEl.innerText;
    copyText(text, btn);
}

function clearLogs() {
    const consoleEl = document.getElementById('console');
    if (consoleEl) {
        consoleEl.innerHTML = '<span class="log-line log-info">[СИСТЕМА] Журнал очищен.</span>';
    }
    updateLogsCount();
}

function updateLogsCount() {
    const consoleEl = document.getElementById('console');
    const badge = document.getElementById('logs-count-badge');
    if (consoleEl && badge) {
        const count = consoleEl.querySelectorAll('.log-line').length;
        badge.innerText = `${count} ${count === 1 ? 'запись' : (count < 5 ? 'записи' : 'записей')}`;
    }
}

function logConsole(msg) {
    const consoleEl = document.getElementById('console');
    if (consoleEl) {
        const line = document.createElement('span');
        line.className = 'log-line';
        if (msg.includes('[УСПЕХ]') || msg.includes('[+]')) line.className += ' log-success';
        else if (msg.includes('[ОШИБКА]') || msg.includes('[СБОЙ]')) line.className += ' log-error';
        else if (msg.includes('[!]')) line.className += ' log-warn';
        else if (msg.includes('[*]') || msg.includes('[ПАРАМЕТРЫ]')) line.className += ' log-info';
        line.innerText = msg;
        consoleEl.appendChild(line);
        consoleEl.scrollTop = consoleEl.scrollHeight;
        updateLogsCount();
    }

    const previewEl = document.getElementById('processing-log-preview');
    if (previewEl) {
        previewEl.innerText = msg;
    }

    const dot = document.getElementById('log-status-dot');
    if (dot) {
        if (msg.includes('[ЗАДАЧА]') || msg.includes('Выполняется')) {
            dot.classList.add('running');
        } else if (msg.includes('[УСПЕХ]') || msg.includes('[ГОТОВО]') || msg.includes('[ОШИБКА]')) {
            dot.classList.remove('running');
        }
    }

    if (typeof window !== 'undefined') {
        if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
            window.__TAURI__.core.invoke('log_from_js', { msg: String(msg) }).catch(() => {});
        } else if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
            window.__TAURI_INTERNALS__.invoke('log_from_js', { msg: String(msg) }).catch(() => {});
        }
    }
    try {
        fetch('http://127.0.0.1:7860/api/log_error', { method: 'POST', body: '[CONSOLE]: ' + msg }).catch(() => {});
    } catch(e) {}
}

function executeCurrentTool() {
    const inputPath = document.getElementById('input-path').value.trim();
    if (!inputPath) {
        showNotification("Укажите путь к файлу или перетащите его в поле!", "warning");
        return;
    }

    const btn = document.getElementById('run-btn');
    btn.disabled = true;
    btn.innerText = 'Выполняется обработка...';

    const procBanner = document.getElementById('processing-banner');
    if (procBanner) procBanner.classList.remove('hidden');

    const resultBox = document.getElementById('result-box');
    if (resultBox) resultBox.classList.remove('visible');

    const params = {
        enable_video: toolState.enable_video,
        enable_audio: toolState.enable_audio,
        enable_c2pa: toolState.enable_c2pa,
        grain_strength: document.getElementById('opt-grain') ? parseFloat(document.getElementById('opt-grain').value) : 12,
        room_tone_vol: document.getElementById('opt-roomtone') ? parseFloat(document.getElementById('opt-roomtone').value) : 0.35
    };

    appIpc.runTool(currentTool, inputPath, params)
        .then(data => {
            currentJobId = data.job_id;
            const procJobId = document.getElementById('processing-job-id');
            if (procJobId) procJobId.innerText = `#${currentJobId}`;
            logConsole(`[ЗАДАЧА] Запущена обработка #${currentJobId}`);
            startLogPolling();
        })
        .catch(err => {
            logConsole(`[ОШИБКА] Сбой запроса: ${err}`);
            btn.disabled = false;
            btn.innerText = 'Запустить обработку';
            if (procBanner) procBanner.classList.add('hidden');
        });
}

function startLogPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
        if (!currentJobId) return;

        appIpc.getStatus(currentJobId)
            .then(job => {
                if (job.logs && Array.isArray(job.logs)) {
                    const consoleEl = document.getElementById('console');
                    if (consoleEl) {
                        consoleEl.innerHTML = '';
                        job.logs.forEach(l => logConsole(l));
                    }
                }

                if (job.status === 'finished' || job.status === 'failed') {
                    clearInterval(pollTimer);
                    const btn = document.getElementById('run-btn');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerText = 'Запустить обработку';
                    }

                    const procBanner = document.getElementById('processing-banner');
                    if (procBanner) procBanner.classList.add('hidden');

                    const dot = document.getElementById('log-status-dot');
                    if (dot) dot.classList.remove('running');

                    if (job.status === 'finished' && job.result_path) {
                        const resText = document.getElementById('result-text');
                        if (resText) resText.innerText = `Готово: ${job.result_path}`;
                        const resBox = document.getElementById('result-box');
                        if (resBox) resBox.classList.add('visible');
                    }
                }
            })
            .catch(err => {
                console.warn(`[Polling] Ошибка опроса: ${err}`);
            });
    }, 600);
}

function openOutputFolder() {
    appIpc.openOutput()
        .catch(err => logConsole(`[ОШИБКА] Не удалось открыть папку результатов: ${err}`));
}

// Закрытие модалок и шторок по Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
        toggleLogsDrawer(false);
    }
});

// --------------------------------------------------------------------------
// 7. Initial Initialization (Immediate & Resilient)
// --------------------------------------------------------------------------
function initApp() {
    // Начальная инициализация текстов под целевую платформу (Windows / macOS)
    updatePlatformTexts();

    // Начальная отрисовка опций первого инструмента
    const dynamicOpts = document.getElementById('dynamic-options');
    if (dynamicOpts && toolsData.master_humanizer) {
        dynamicOpts.innerHTML = toolsData.master_humanizer.options;
    }

    // Загрузка кратких характеристик в нижний бейдж сайдбара
    appIpc.getSystemInfo()
        .then(s => {
            if (s && s.platform) {
                updatePlatformTexts(s.platform);
            }
            const shortCpu = (s.cpu || '').split('with')[0].replace('Processor', '').trim();
            const summaryEl = document.getElementById('sys-short-summary');
            if (summaryEl) {
                summaryEl.innerText = `${shortCpu} • ${s.ram_total || ''}`;
            }
        })
        .catch(err => {
            console.warn('[Init] System specs load error:', err);
            const summaryEl = document.getElementById('sys-short-summary');
            if (summaryEl) summaryEl.innerText = "Система готова";
        });

    // Проверка статуса KillSwitch
    appIpc.getKillSwitchStatus()
        .then(ks => {
            killSwitchStatus = ks;
        })
        .catch(() => {});

    logConsole(appIpc.isTauri() ? "[СИСТЕМА] Запущено в среде Tauri 2.0 (Rust)." : "[СИСТЕМА] Запущено в веб-среде.");
}

// --------------------------------------------------------------------------
// 7. Темизация и Настройки Приложения (Themes & App Settings)
// --------------------------------------------------------------------------

function applyTheme(themeId) {
    if (!themeId) themeId = 'obsidian';
    document.documentElement.setAttribute('data-theme', themeId);
    try {
        localStorage.setItem('toolhub_theme', themeId);
    } catch (e) {}

    document.querySelectorAll('.theme-card-option').forEach(card => {
        if (card.getAttribute('data-theme-id') === themeId) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });
    logConsole(`[ТЕМА] Применена тема: ${themeId}`);
}

function loadSavedTheme() {
    try {
        const saved = localStorage.getItem('toolhub_theme') || 'obsidian';
        document.documentElement.setAttribute('data-theme', saved);
    } catch (e) {}
}
loadSavedTheme();

async function renderSettingsDashboard() {
    const el = document.getElementById('settings-dashboard-container');
    if (!el) return;

    let autostart = false;
    try {
        autostart = await appIpc.getAutostartStatus();
    } catch (e) {}

    let cacheSize = '0 KB';
    try {
        cacheSize = await appIpc.getCacheSize();
    } catch (e) {}

    const currentTheme = localStorage.getItem('toolhub_theme') || 'obsidian';
    const alwaysOnTop = localStorage.getItem('toolhub_always_on_top') === 'true';
    const gpuAccel = localStorage.getItem('toolhub_gpu_accel') !== 'false';

    const themesList = [
        { id: 'obsidian', name: 'Obsidian Dark', colors: ['#09090b', '#18191f', '#06b6d4'] },
        { id: 'cyberpunk', name: 'Cyber Matrix', colors: ['#050811', '#151e36', '#22d3ee'] },
        { id: 'emerald', name: 'Emerald Code', colors: ['#050d08', '#142b1e', '#10b981'] },
        { id: 'amethyst', name: 'Royal Amethyst', colors: ['#090511', '#201536', '#c084fc'] },
        { id: 'light', name: 'Studio Light', colors: ['#f8fafc', '#e2e8f0', '#0284c7'] }
    ];

    const themeCardsHtml = themesList.map(t => `
        <div class="theme-card-option ${t.id === currentTheme ? 'active' : ''}" data-theme-id="${t.id}" onclick="applyTheme('${t.id}')">
            <div class="theme-preview-bars">
                <div class="theme-color-slice" style="background: ${t.colors[0]};"></div>
                <div class="theme-color-slice" style="background: ${t.colors[1]};"></div>
                <div class="theme-color-slice" style="background: ${t.colors[2]};"></div>
            </div>
            <div class="theme-card-info">
                <span class="theme-card-name">${t.name}</span>
                <span class="theme-check-icon"></span>
            </div>
        </div>
    `).join('');

    const mac = isMacOS();
    const osTitle = mac ? 'macOS' : 'Windows';
    const ks = killSwitchStatus;
    const isPriority = ks && ks.priority_autostart_active;
    const isAdmin = ks && ks.is_admin;
    const autostartNote = autostart
        ? (mac ? '[АКТИВНО] Записано в ~/Library/LaunchAgents/com.toolhub.studio.plist' : (isPriority ? '[АКТИВНО] Приоритетный запуск в Планировщике (стартует раньше Claude Desktop)' : '[АКТИВНО] Записано в HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'))
        : '[ОТКЛЮЧЕНО] Приложение не запускается автоматически';
    const gpuDesc = mac
        ? 'Apple VideoToolbox / Metal аппаратный рендеринг видео'
        : 'NVIDIA NVENC / AMD AMF аппаратный рендеринг видео';

    el.innerHTML = `
        <div class="specs-grid">
            <!-- ТЕМЫ ОФОРМЛЕНИЯ -->
            <div class="spec-card" style="grid-column: 1 / -1;">
                <div class="spec-card-header">
                    <span class="spec-card-label">ЦВЕТОВАЯ ПАЛИТРА И ТЕМА СТУДИИ</span>
                    <span class="mini-tag mini-tag-cyan">5 пресетов</span>
                </div>
                <div class="spec-card-sub" style="margin-top: 4px;">
                    Выберите визуальный стиль оформления интерфейса. Изменения сохраняются и применяются мгновенно.
                </div>
                <div class="theme-selector-grid">
                    ${themeCardsHtml}
                </div>
            </div>

            <!-- СИСТЕМНЫЙ АВТОЗАПУСК -->
            <div class="spec-card" style="grid-column: 1 / -1; cursor: pointer;" onclick="toggleAutostartSetting()">
                <div class="settings-item-row" style="background: transparent; border: none; padding: 0; margin: 0; cursor: pointer;">
                    <div class="settings-item-text">
                        <div class="settings-item-title" style="display: flex; align-items: center; gap: 8px;">
                            <span>Автозагрузка при старте ${osTitle}</span>
                            ${isPriority ? '<span class="mini-tag mini-tag-emerald" style="font-size: 9.5px;">ПРИОРИТЕТ В ПЛАНИРОВЩИКЕ</span>' : ''}
                        </div>
                        <div class="settings-item-desc">Автоматический запуск ToolHub в трее при входе в Windows для непрерывного перехвата утечек Claude.</div>
                    </div>
                    <div class="toggle-slider ${autostart ? 'active' : ''}" id="toggle-autostart-slider">
                        <div class="toggle-thumb"></div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 10px; flex-wrap: wrap; gap: 8px;">
                    <div id="autostart-status-note" style="font-size: 11px; color: ${autostart ? 'var(--accent-emerald)' : 'var(--text-dim)'}; font-family: var(--font-mono);">
                        ${autostartNote}
                    </div>
                </div>
            </div>

            <!-- РЕЖИМ ПОВЕРХ ВСЕХ ОКОН (ALWAYS ON TOP) -->
            <div class="spec-card" style="cursor: pointer;" onclick="toggleAlwaysOnTopSetting()">
                <div class="settings-item-row" style="background: transparent; border: none; padding: 0; margin: 0; cursor: pointer;">
                    <div class="settings-item-text">
                        <div class="settings-item-title">Поверх всех окон</div>
                        <div class="settings-item-desc">Закрепить окно ToolHub поверх остальных программ</div>
                    </div>
                    <div class="toggle-slider ${alwaysOnTop ? 'active' : ''}" id="toggle-always-top-slider">
                        <div class="toggle-thumb"></div>
                    </div>
                </div>
            </div>

            <!-- АППАРАТНОЕ УСКОРЕНИЕ GPU -->
            <div class="spec-card" style="cursor: pointer;" onclick="toggleGpuSetting()">
                <div class="settings-item-row" style="background: transparent; border: none; padding: 0; margin: 0; cursor: pointer;">
                    <div class="settings-item-text">
                        <div class="settings-item-title">Аппаратное GPU-ускорение</div>
                        <div class="settings-item-desc">${gpuDesc}</div>
                    </div>
                    <div class="toggle-slider ${gpuAccel ? 'active' : ''}" id="toggle-gpu-slider">
                        <div class="toggle-thumb"></div>
                    </div>
                </div>
            </div>

            <!-- ОЧИСТКА ВРЕМЕННОГО КЭША -->
            <div class="spec-card">
                <div class="spec-card-header">
                    <span class="spec-card-label">ДИСКОВЫЙ КЭШ И ОЧИСТКА</span>
                    <span class="mini-tag mini-tag-amber" id="cache-size-badge">${cacheSize}</span>
                </div>
                <div class="spec-card-sub" style="margin-top: 4px;">Временные видеосегменты и аудиозаписи в папке <code>cache/</code>.</div>
                <div style="margin-top: 12px; display: flex; gap: 10px; align-items: center;">
                    <button type="button" class="btn btn-secondary" onclick="executeClearCache()" style="font-size: 11px; padding: 6px 14px;">
                        Очистить кэш
                    </button>
                    <span id="cache-clear-msg" style="font-size: 11px; color: var(--accent-emerald); display: none;"></span>
                </div>
            </div>

            <!-- ЛОКАЛЬНЫЙ API И СВЕДЕНИЯ -->
            <div class="spec-card">
                <div class="spec-card-header">
                    <span class="spec-card-label">ЛОКАЛЬНЫЙ API СЕРВЕР</span>
                    <span class="mini-tag mini-tag-emerald">ПОРТ 7860</span>
                </div>
                <div class="spec-card-sub" style="margin-top: 4px;">
                    REST API & JSON-RPC эндпоинты для вызова AI-агентами в Cursor, Claude Desktop и Antigravity.
                </div>
                <div style="margin-top: 12px; font-family: var(--font-mono); font-size: 11px; color: var(--accent-cyan);">
                    http://127.0.0.1:7860
                </div>
            </div>

            <!-- АВТООБНОВЛЕНИЕ GITHUB RELEASES -->
            <div class="spec-card" style="grid-column: 1 / -1; border-color: rgba(6, 182, 212, 0.3); background: rgba(6, 182, 212, 0.03);">
                <div class="spec-card-header">
                    <span class="spec-card-label" style="color: var(--accent-cyan);">ОБНОВЛЕНИЯ СИСТЕМЫ (GITHUB RELEASES)</span>
                    <span class="mini-tag mini-tag-cyan">v0.2.3 • 100% FREE CDN</span>
                </div>
                <div class="spec-card-sub" style="margin-top: 4px;">
                    ToolHub автоматически проверяет релизы на GitHub (wenaro1337/ToolHub) и безопасно устанавливает подписанные обновления без сторонних серверов.
                </div>
                <div style="margin-top: 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                    <button type="button" class="btn btn-secondary" onclick="checkUpdateClick()" id="check-update-btn" style="font-size: 11.5px; padding: 7px 16px;">
                        <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px; vertical-align: -2px; margin-right: 4px;"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                        Проверить обновления
                    </button>
                    <div id="update-status-msg" style="font-size: 11.5px; color: var(--text-medium);"></div>
                </div>
                <div id="update-details-box" style="margin-top: 10px; display: none;"></div>
            </div>

            <!-- ИНФОРМАЦИЯ О СБОРКЕ -->
            <div class="spec-card" style="grid-column: 1 / -1; border-color: rgba(255, 255, 255, 0.05); background: rgba(255, 255, 255, 0.02);">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 26px; height: 26px; background: #fff; border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            <svg viewBox="0 0 512 512" style="width: 15px; height: 15px; fill: #000; display: block;">
                                <path fill-rule="evenodd" d="M0 0h362v362H0V0zm60 60h241v241H60V60z"/>
                                <path fill-rule="evenodd" d="M151 151h361v361H151V151zm60 60h241v241H211V211z"/>
                                <rect x="151" y="151" width="211" height="211"/>
                            </svg>
                        </div>
                        <div>
                            <div style="font-size: 12px; font-weight: 700; color: var(--text-high);">ToolHub Studio</div>
                            <div style="font-size: 10.5px; color: var(--text-dim); font-family: var(--font-mono);">Версия 0.2.1 (Release) • Rust Tauri 2.0 • Native WebView2</div>
                        </div>
                    </div>
                    <div style="font-size: 11px; color: var(--text-dim);">
                        Поддержка: Windows 10/11 & macOS
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function toggleAutostartSetting() {
    const slider = document.getElementById('toggle-autostart-slider');
    const note = document.getElementById('autostart-status-note');
    if (!slider) return;

    const currentActive = slider.classList.contains('active');
    const newState = !currentActive;

    // Instant visual toggle
    if (newState) slider.classList.add('active');
    else slider.classList.remove('active');

    if (note) {
        note.style.color = 'var(--text-medium)';
        note.innerText = newState ? 'Активация автозапуска Windows...' : 'Отключение автозапуска...';
    }

    try {
        const res = await appIpc.setAutostart(newState);
        let isPriority = false;
        try {
            isPriority = await appIpc.isPriorityAutostartActive();
        } catch (_) {}

        if (res) {
            slider.classList.add('active');
        } else {
            slider.classList.remove('active');
        }

        if (note) {
            note.style.color = res ? 'var(--accent-emerald)' : 'var(--text-dim)';
            if (!res) {
                note.innerText = '[ОТКЛЮЧЕНО] Приложение не запускается автоматически';
            } else if (isPriority) {
                note.innerText = '[АКТИВНО] Зарегистрировано в Планировщике Windows (запуск в трее с наивысшими правами)';
            } else {
                note.innerText = '[АКТИВНО] Записано в автозагрузку Windows (запуск в трее)';
            }
        }
        showNotification(res ? 'Автозапуск Windows включен' : 'Автозапуск Windows отключен', 'success', 3000);
        logConsole(`[НАСТРОЙКИ] Автозапуск: ${res ? (isPriority ? 'Приоритетный (Task Scheduler)' : 'Включен (Run)') : 'Отключен'}`);
    } catch (e) {
        if (currentActive) slider.classList.add('active');
        else slider.classList.remove('active');
        if (note) {
            note.style.color = '#f87171';
            note.innerText = `[ОШИБКА] ${e.message || e}`;
        }
        showNotification(`Ошибка автозагрузки: ${e.message || e}`, 'error', 4500);
    }
}

async function toggleAlwaysOnTopSetting() {
    const slider = document.getElementById('toggle-always-top-slider');
    if (!slider) return;

    const currentActive = slider.classList.contains('active');
    const newState = !currentActive;

    if (newState) slider.classList.add('active');
    else slider.classList.remove('active');

    try {
        localStorage.setItem('toolhub_always_on_top', String(newState));
        await appIpc.setAlwaysOnTop(newState);
        logConsole(`[НАСТРОЙКИ] Поверх всех окон: ${newState ? 'Включено' : 'Выключено'}`);
    } catch (e) {
        logConsole(`[ОШИБКА] Поверх всех окон: ${e}`);
    }
}

function toggleGpuSetting() {
    const slider = document.getElementById('toggle-gpu-slider');
    if (!slider) return;

    const currentActive = slider.classList.contains('active');
    const newState = !currentActive;

    if (newState) slider.classList.add('active');
    else slider.classList.remove('active');

    localStorage.setItem('toolhub_gpu_accel', String(newState));
    logConsole(`[НАСТРОЙКИ] Аппаратное ускорение GPU: ${newState ? 'Включено' : 'Выключено'}`);
}

async function executeClearCache() {
    const msg = document.getElementById('cache-clear-msg');
    const badge = document.getElementById('cache-size-badge');
    try {
        const count = await appIpc.clearAppCache();
        const newSize = await appIpc.getCacheSize();
        if (badge) badge.innerText = newSize;
        if (msg) {
            msg.style.display = 'inline';
            msg.innerText = `Очищено файлов: ${count}`;
            setTimeout(() => { msg.style.display = 'none'; }, 3000);
        }
        logConsole(`[КЭШ] Очищено ${count} временных файлов`);
    } catch (e) {
        if (msg) {
            msg.style.display = 'inline';
            msg.style.color = '#f87171';
            msg.innerText = `Ошибка: ${e}`;
        }
    }
}

async function checkUpdateClick() {
    const btn = document.getElementById('check-update-btn');
    const msg = document.getElementById('update-status-msg');
    const box = document.getElementById('update-details-box');
    if (!btn || !msg) return;

    btn.disabled = true;
    msg.innerHTML = '<span style="color: var(--accent-cyan);">Проверка GitHub Releases...</span>';
    if (box) box.style.display = 'none';

    try {
        const res = await appIpc.checkForUpdates();
        if (res && res.available) {
            msg.innerHTML = `<strong style="color: var(--accent-emerald);">Доступна новая версия: ${escapeHtml(res.version)}!</strong>`;
            if (box) {
                box.style.display = 'block';
                box.innerHTML = `
                    <div style="background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 12px; margin-top: 8px;">
                        <div style="font-size: 12px; font-weight: 700; color: #fff;">Что нового в ${escapeHtml(res.version)}:</div>
                        <div style="font-size: 11.5px; color: var(--text-medium); margin-top: 4px; white-space: pre-wrap;">${escapeHtml(res.body || 'Исправления и улучшения стабильности.')}</div>
                        <button onclick="installUpdateClick()" class="btn btn-primary" style="margin-top: 10px; font-size: 11.5px; padding: 6px 16px;">
                            Загрузить и обновить сейчас
                        </button>
                    </div>
                `;
            }
            showNotification(`Найдено обновление ToolHub ${res.version}!`, 'success', 6000);
        } else {
            msg.innerHTML = '<span style="color: var(--text-dim);">У вас установлена последняя актуальная версия (v0.2.0).</span>';
            showNotification('Установлена последняя версия ToolHub.', 'info', 3000);
        }
    } catch (err) {
        msg.innerHTML = `<span style="color: #f87171;">Ошибка: ${escapeHtml(err.message || String(err))}</span>`;
        showNotification(err.message || String(err), 'warning', 5000);
    } finally {
        btn.disabled = false;
    }
}

async function installUpdateClick() {
    const msg = document.getElementById('update-status-msg');
    const box = document.getElementById('update-details-box');
    if (msg) msg.innerHTML = '<span style="color: var(--accent-cyan);">Загрузка и установка обновления...</span>';

    try {
        const res = await appIpc.installUpdate();
        showNotification(res || 'Обновление установлено!', 'success', 8000, 'Перезапуск');
        if (box) {
            box.innerHTML = `<div style="color: var(--accent-emerald); font-size: 12px; padding: 8px 0;">${escapeHtml(res)}</div>`;
        }
    } catch (e) {
        showNotification(e.message || String(e), 'error');
        if (msg) msg.innerHTML = `<span style="color: #f87171;">${escapeHtml(e.message || String(e))}</span>`;
    }
}

// ==========================================================================
// 8. PORT & PROCESS DASHBOARD
// ==========================================================================

let allPortEntries = [];
let currentPortTab = 'all';
let currentPortSearch = '';

async function renderPortManagerDashboard() {
    const container = document.getElementById('port-manager-container');
    if (!container) return;

    container.innerHTML = `
        <div class="port-dashboard-wrap">
            <div class="port-toolbar">
                <div class="port-filter-tabs">
                    <button type="button" class="port-filter-btn ${currentPortTab === 'all' ? 'active' : ''}" onclick="filterPortsByTab('all')">Все порты</button>
                    <button type="button" class="port-filter-btn ${currentPortTab === 'dev' ? 'active' : ''}" onclick="filterPortsByTab('dev')">Дев-порты (Vite/Node/Python)</button>
                    <button type="button" class="port-filter-btn ${currentPortTab === 'db' ? 'active' : ''}" onclick="filterPortsByTab('db')">Базы данных</button>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div class="port-search-box">
                        <svg class="icon" viewBox="0 0 24 24" style="width: 12px; height: 12px; color: var(--text-dim);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                        <input type="text" placeholder="Поиск порта, PID или процесса..." oninput="filterPortsBySearch(this.value)" value="${escapeAttr(currentPortSearch)}">
                    </div>
                    <button type="button" class="mini-tool-btn" onclick="refreshPorts()" title="Обновить список портов">
                        <svg class="icon" viewBox="0 0 24 24" style="width: 12px; height: 12px;"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                        Обновить
                    </button>
                </div>
            </div>

            <div class="port-table-container">
                <table class="port-table">
                    <thead>
                        <tr>
                            <th>Порт</th>
                            <th>Протокол</th>
                            <th>Локальный адрес</th>
                            <th>Процесс</th>
                            <th>PID</th>
                            <th>ОЗУ</th>
                            <th>Категория</th>
                            <th style="text-align: right;">Действие</th>
                        </tr>
                    </thead>
                    <tbody id="port-table-body">
                        <tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 24px;">Сканирование сетевых сокетов...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    await refreshPorts();
}

async function refreshPorts() {
    const tbody = document.getElementById('port-table-body');
    try {
        allPortEntries = await appIpc.getListeningPorts();
        renderPortTable();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #f87171; padding: 24px;">Ошибка загрузки портов: ${err.message || err}</td></tr>`;
        }
    }
}

function renderPortTable() {
    const tbody = document.getElementById('port-table-body');
    if (!tbody) return;

    let filtered = allPortEntries.filter(p => {
        if (currentPortTab === 'dev' && !p.is_dev_port) return false;
        if (currentPortTab === 'db' && p.category !== 'База данных') return false;
        if (currentPortSearch) {
            const q = currentPortSearch.toLowerCase();
            const matchPort = String(p.port).includes(q);
            const matchName = (p.process_name || '').toLowerCase().includes(q);
            const matchPid = String(p.pid).includes(q);
            const matchAddr = (p.local_address || '').toLowerCase().includes(q);
            if (!matchPort && !matchName && !matchPid && !matchAddr) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 30px;">Нет активных сокетов по выбранному фильтру</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(p => {
        const isDev = p.is_dev_port;
        const devBadge = isDev ? `<span class="mini-tag mini-tag-emerald" style="font-size: 9px; padding: 1px 4px; margin-left: 6px;">DEV</span>` : '';
        return `
            <tr>
                <td>
                    <span class="port-num-badge ${isDev ? 'dev' : ''}">:${p.port}</span>
                    ${devBadge}
                </td>
                <td style="color: var(--text-medium); font-family: var(--font-mono); font-size: 11px;">${escapeHtml(p.protocol)}</td>
                <td style="color: var(--text-dim); font-family: var(--font-mono); font-size: 11px;">${escapeHtml(p.local_address)}</td>
                <td>
                    <span style="font-weight: 600; color: var(--text-high);">${escapeHtml(p.process_name)}</span>
                </td>
                <td style="font-family: var(--font-mono); color: var(--text-medium); font-size: 11px;">${p.pid}</td>
                <td style="color: var(--text-dim); font-size: 11px;">${p.memory_mb > 0 ? p.memory_mb + ' МБ' : '—'}</td>
                <td>
                    <span class="mini-tag ${p.category === 'Web / Dev' ? 'mini-tag-emerald' : p.category === 'База данных' ? 'mini-tag-purple' : 'mini-tag-cyan'}" style="font-size: 9.5px;">${escapeHtml(p.category)}</span>
                </td>
                <td style="text-align: right;">
                    <button type="button" class="port-kill-btn" onclick="killPortProcessAction(${p.pid}, ${p.port}, '${escapeAttr(p.process_name)}')">
                        Освободить
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterPortsByTab(tab) {
    currentPortTab = tab;
    document.querySelectorAll('.port-filter-btn').forEach(btn => btn.classList.remove('active'));
    const clicked = Array.from(document.querySelectorAll('.port-filter-btn')).find(b => {
        const attr = b.getAttribute('onclick') || '';
        return attr.includes(`'${tab}'`);
    });
    if (clicked) clicked.classList.add('active');
    renderPortTable();
}

function filterPortsBySearch(query) {
    currentPortSearch = query.trim();
    renderPortTable();
}

async function killPortProcessAction(pid, port, procName) {
    if (!confirm(`Завершить процесс "${procName}" (PID: ${pid}) и освободить порт :${port}?`)) {
        return;
    }
    try {
        await appIpc.killPortProcess(pid);
        showNotification(`Процесс "${procName}" (PID: ${pid}) на порту :${port} успешно завершён.`, 'success');
        logConsole(`[СЕТЬ] Процесс ${procName} (PID: ${pid}) на порту :${port} успешно завершён`);
        await refreshPorts();
    } catch (err) {
        const errorMsg = err.message || String(err);
        showNotification(errorMsg, 'error', 7000, `Ошибка завершения PID ${pid}`);
        logConsole(`[СЕТЬ ОШИБКА] Не удалось завершить PID ${pid}: ${errorMsg}`);
    }
}

// ==========================================================================
// 9. COLOR INSPECTOR & TAILWIND PALETTE
// ==========================================================================

let currentInspectorColor = '#4F46E5';

const TAILWIND_PALETTE = [
    { name: 'slate-500', class: 'bg-slate-500', hex: '#64748B', r: 100, g: 116, b: 139 },
    { name: 'slate-600', class: 'bg-slate-600', hex: '#475569', r: 71, g: 85, b: 105 },
    { name: 'slate-900', class: 'bg-slate-900', hex: '#0F172A', r: 15, g: 23, b: 42 },
    { name: 'gray-500', class: 'bg-gray-500', hex: '#6B7280', r: 107, g: 114, b: 128 },
    { name: 'gray-900', class: 'bg-gray-900', hex: '#111827', r: 17, g: 24, b: 39 },
    { name: 'zinc-500', class: 'bg-zinc-500', hex: '#71717A', r: 113, g: 113, b: 122 },
    { name: 'zinc-900', class: 'bg-zinc-900', hex: '#18181B', r: 24, g: 24, b: 27 },
    { name: 'red-500', class: 'bg-red-500', hex: '#EF4444', r: 239, g: 68, b: 68 },
    { name: 'red-600', class: 'bg-red-600', hex: '#DC2626', r: 220, g: 38, b: 38 },
    { name: 'orange-500', class: 'bg-orange-500', hex: '#F97316', r: 249, g: 115, b: 22 },
    { name: 'amber-500', class: 'bg-amber-500', hex: '#F59E0B', r: 245, g: 158, b: 11 },
    { name: 'yellow-500', class: 'bg-yellow-500', hex: '#EAB308', r: 234, g: 179, b: 8 },
    { name: 'lime-500', class: 'bg-lime-500', hex: '#84CC16', r: 132, g: 204, b: 22 },
    { name: 'green-500', class: 'bg-green-500', hex: '#22C55E', r: 34, g: 197, b: 94 },
    { name: 'green-600', class: 'bg-green-600', hex: '#16A34A', r: 22, g: 163, b: 74 },
    { name: 'emerald-500', class: 'bg-emerald-500', hex: '#10B981', r: 16, g: 185, b: 129 },
    { name: 'emerald-600', class: 'bg-emerald-600', hex: '#059669', r: 5, g: 150, b: 105 },
    { name: 'teal-500', class: 'bg-teal-500', hex: '#14B8A6', r: 20, g: 184, b: 166 },
    { name: 'cyan-500', class: 'bg-cyan-500', hex: '#06B6D4', r: 6, g: 182, b: 212 },
    { name: 'sky-500', class: 'bg-sky-500', hex: '#0EA5E9', r: 14, g: 165, b: 233 },
    { name: 'blue-500', class: 'bg-blue-500', hex: '#3B82F6', r: 59, g: 130, b: 246 },
    { name: 'blue-600', class: 'bg-blue-600', hex: '#2563EB', r: 37, g: 99, b: 235 },
    { name: 'indigo-500', class: 'bg-indigo-500', hex: '#6366F1', r: 99, g: 102, b: 241 },
    { name: 'indigo-600', class: 'bg-indigo-600', hex: '#4F46E5', r: 79, g: 70, b: 229 },
    { name: 'violet-500', class: 'bg-violet-500', hex: '#8B5CF6', r: 139, g: 92, b: 246 },
    { name: 'purple-500', class: 'bg-purple-500', hex: '#A855F7', r: 168, g: 85, b: 247 },
    { name: 'purple-600', class: 'bg-purple-600', hex: '#9333EA', r: 147, g: 51, b: 234 },
    { name: 'fuchsia-500', class: 'bg-fuchsia-500', hex: '#D946EF', r: 217, g: 70, b: 239 },
    { name: 'pink-500', class: 'bg-pink-500', hex: '#EC4899', r: 236, g: 72, b: 153 },
    { name: 'rose-500', class: 'bg-rose-500', hex: '#F43F5E', r: 244, g: 63, b: 94 },
    { name: 'rose-600', class: 'bg-rose-600', hex: '#E11D48', r: 225, g: 29, b: 72 },
    { name: 'white', class: 'bg-white', hex: '#FFFFFF', r: 255, g: 255, b: 255 },
    { name: 'black', class: 'bg-black', hex: '#000000', r: 0, g: 0, b: 0 }
];

function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
    }
    const num = parseInt(hex, 16);
    return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
    };
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100)
    };
}

function findNearestTailwind(r, g, b) {
    let nearest = TAILWIND_PALETTE[0];
    let minDist = Infinity;
    for (const tw of TAILWIND_PALETTE) {
        const dr = tw.r - r;
        const dg = tw.g - g;
        const db = tw.b - b;
        const dist = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
        if (dist < minDist) {
            minDist = dist;
            nearest = tw;
        }
    }
    return nearest;
}

function getRelativeLuminance(r, g, b) {
    const sRGB = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
}

function calcWcagContrast(r, g, b) {
    const lum = getRelativeLuminance(r, g, b);
    const lumWhite = 1.0;
    const lumBlack = 0.0;

    const ratioWhite = (lumWhite + 0.05) / (lum + 0.05);
    const ratioBlack = (lum + 0.05) / (lumBlack + 0.05);

    const getScore = (r) => {
        if (r >= 7.0) return { badge: 'AAA', pass: true };
        if (r >= 4.5) return { badge: 'AA', pass: true };
        return { badge: 'FAIL', pass: false };
    };

    return {
        white: { ratio: ratioWhite.toFixed(2), score: getScore(ratioWhite) },
        black: { ratio: ratioBlack.toFixed(2), score: getScore(ratioBlack) }
    };
}

function renderColorInspectorDashboard() {
    const container = document.getElementById('color-inspector-container');
    if (!container) return;

    const rgb = hexToRgb(currentInspectorColor);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const tw = findNearestTailwind(rgb.r, rgb.g, rgb.b);
    const wcag = calcWcagContrast(rgb.r, rgb.g, rgb.b);

    container.innerHTML = `
        <div class="color-inspector-wrap">
            <div class="color-hero-grid">
                <div class="color-swatch-box" style="background-color: ${currentInspectorColor};">
                    <span class="color-swatch-label">${currentInspectorColor.toUpperCase()}</span>
                </div>
                <div class="color-actions-col">
                    <button type="button" class="color-pick-big-btn" onclick="pickScreenColorAction()">
                        <svg class="icon" viewBox="0 0 24 24" style="width: 18px; height: 18px; stroke: var(--accent-emerald);"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>
                        Захватить пипеткой с экрана (EyeDropper)
                    </button>

                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="color" id="native-color-picker" value="${currentInspectorColor}" oninput="onColorInputDirect(this.value)" style="width: 38px; height: 32px; border-radius: 6px; border: 1px solid var(--border-dim); background: transparent; cursor: pointer;">
                        <input type="text" id="manual-hex-input" value="${currentInspectorColor.toUpperCase()}" onchange="onColorInputDirect(this.value)" class="input-text" style="font-family: var(--font-mono); font-size: 13px; font-weight: 600; text-transform: uppercase;">
                    </div>

                    <div class="color-values-grid">
                        <div class="color-value-card" onclick="copyColorValue('${currentInspectorColor.toUpperCase()}', 'HEX')">
                            <span class="color-value-label">HEX</span>
                            <span class="color-value-str">${currentInspectorColor.toUpperCase()}</span>
                        </div>
                        <div class="color-value-card" onclick="copyColorValue('rgb(${rgb.r}, ${rgb.g}, ${rgb.b})', 'RGB')">
                            <span class="color-value-label">RGB</span>
                            <span class="color-value-str">rgb(${rgb.r}, ${rgb.g}, ${rgb.b})</span>
                        </div>
                        <div class="color-value-card" onclick="copyColorValue('hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)', 'HSL')">
                            <span class="color-value-label">HSL</span>
                            <span class="color-value-str">${hsl.h}°, ${hsl.s}%, ${hsl.l}%</span>
                        </div>
                        <div class="color-value-card" onclick="copyColorValue('${tw.class}', 'Tailwind')">
                            <span class="color-value-label">Tailwind CSS</span>
                            <span class="color-value-str" style="color: var(--accent-emerald);">${tw.class}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- WCAG 2.1 КОНТРАСТНОСТЬ -->
            <div class="card" style="padding: 16px;">
                <div class="card-title" style="margin-bottom: 12px;">Анализатор контрастности текста (WCAG 2.1)</div>
                <div class="color-contrast-section">
                    <div class="contrast-card on-white">
                        <div>
                            <div style="font-size: 11px; opacity: 0.7; font-weight: 600;">На белом фоне (#FFFFFF)</div>
                            <div class="contrast-score-val" style="color: ${currentInspectorColor}; font-size: 18px; margin-top: 4px;">Пример текста</div>
                        </div>
                        <div style="text-align: right;">
                            <div class="contrast-score-val">${wcag.white.ratio}:1</div>
                            <span class="contrast-badge ${wcag.white.score.pass ? 'pass' : 'fail'}">${wcag.white.score.badge}</span>
                        </div>
                    </div>

                    <div class="contrast-card on-black">
                        <div>
                            <div style="font-size: 11px; opacity: 0.7; font-weight: 600;">На черном фоне (#000000)</div>
                            <div class="contrast-score-val" style="color: ${currentInspectorColor}; font-size: 18px; margin-top: 4px;">Пример текста</div>
                        </div>
                        <div style="text-align: right;">
                            <div class="contrast-score-val">${wcag.black.ratio}:1</div>
                            <span class="contrast-badge ${wcag.black.score.pass ? 'pass' : 'fail'}">${wcag.black.score.badge}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function pickScreenColorAction() {
    try {
        const res = await appIpc.pickScreenColor();
        if (res && res.hex) {
            currentInspectorColor = res.hex;
            renderColorInspectorDashboard();
            logConsole(`[ЦВЕТ] Захвачен пиксель с экрана: ${res.hex}`);
        }
    } catch (err) {
        logConsole(`[ЦВЕТ] Ошибка пипетки: ${err.message || err}`);
    }
}

function onColorInputDirect(val) {
    if (!val) return;
    if (!val.startsWith('#')) val = '#' + val;
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        currentInspectorColor = val.toUpperCase();
        renderColorInspectorDashboard();
    }
}

function copyColorValue(val, label) {
    navigator.clipboard.writeText(val);
    logConsole(`[ЦВЕТ] Скопировано (${label}): ${val}`);
}

// ==========================================================================
// 10. KEEP-AWAKE SENTINEL (РЕЖИМ АНТИСОН)
// ==========================================================================

let awakeStatusCache = { is_active: false, mode: 'off', remaining_secs: 0 };
let awakeTimerId = null;

async function renderKeepAwakeDashboard() {
    const container = document.getElementById('keep-awake-container');
    if (!container) return;

    try {
        awakeStatusCache = await appIpc.getKeepAwakeStatus();
    } catch (e) {
        console.warn('Keep awake status fetch err:', e);
    }

    const isActive = !!awakeStatusCache.is_active;
    const mode = awakeStatusCache.mode || 'off';
    const remSecs = awakeStatusCache.remaining_secs || 0;

    let remStr = 'Бесконечно (до отключения)';
    if (remSecs > 0) {
        const h = Math.floor(remSecs / 3600);
        const m = Math.floor((remSecs % 3600) / 60);
        const s = remSecs % 60;
        remStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    const mac = isMacOS();
    const platformLabel = mac ? 'macOS' : 'Windows';
    const activeTitle = mac
        ? 'Режим бодрствования активен (Caffeine / Amphetamine mode)'
        : 'Режим бодрствования активен (PowerToys Awake / Win32 API)';
    const inactiveTitle = `Режим сна: Стандартный ${platformLabel}`;
    const inactiveSub = mac
        ? 'Система переходит в спящий режим по правилам энергосбережения macOS'
        : 'Система переходит в спящий режим по схеме электропитания Windows';
    const turnOffSub = `Стандартный сон ${platformLabel}`;

    container.innerHTML = `
        <div class="keep-awake-wrap">
            <div class="awake-status-hero ${isActive ? 'active' : ''}">
                <div class="awake-hero-left">
                    <div class="awake-icon-orb">
                        <svg class="icon" viewBox="0 0 24 24" style="width: 24px; height: 24px;"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                    </div>
                    <div>
                        <div class="awake-hero-title">${isActive ? activeTitle : inactiveTitle}</div>
                        <div class="awake-hero-sub">${isActive ? `Дисплей и система защищены от засыпания • Осталось: <strong id="awake-countdown" style="color: var(--accent-emerald); font-family: var(--font-mono);">${remStr}</strong>` : inactiveSub}</div>
                    </div>
                </div>

                <div>
                    <span class="mini-tag ${isActive ? 'mini-tag-emerald' : 'mini-tag-purple'}" style="font-size: 11px; padding: 4px 10px;">
                        ${isActive ? 'АКТИВЕН' : 'ОТКЛЮЧЕН'}
                    </span>
                </div>
            </div>

            <div class="card" style="padding: 16px;">
                <div class="card-title" style="margin-bottom: 12px;">Выберите режим бодрствования:</div>
                <div class="awake-modes-grid">
                    <div class="awake-mode-card ${mode === '30m' ? 'active' : ''}" onclick="changeKeepAwakeMode('30m')">
                        <svg class="icon" viewBox="0 0 24 24" style="width: 20px; height: 20px; margin-bottom: 4px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span class="awake-mode-title">30 минут</span>
                        <span class="awake-mode-sub">Короткие сборки</span>
                    </div>

                    <div class="awake-mode-card ${mode === '1h' ? 'active' : ''}" onclick="changeKeepAwakeMode('1h')">
                        <svg class="icon" viewBox="0 0 24 24" style="width: 20px; height: 20px; margin-bottom: 4px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span class="awake-mode-title">1 час</span>
                        <span class="awake-mode-sub">Рендеринг видео</span>
                    </div>

                    <div class="awake-mode-card ${mode === '2h' ? 'active' : ''}" onclick="changeKeepAwakeMode('2h')">
                        <svg class="icon" viewBox="0 0 24 24" style="width: 20px; height: 20px; margin-bottom: 4px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span class="awake-mode-title">2 часа</span>
                        <span class="awake-mode-sub">Долгие скачивания</span>
                    </div>

                    <div class="awake-mode-card ${mode === 'infinite' ? 'active' : ''}" onclick="changeKeepAwakeMode('infinite')">
                        <svg class="icon" viewBox="0 0 24 24" style="width: 20px; height: 20px; margin-bottom: 4px;"><path d="M18.178 8c5.096 0 5.096 8 0 8-2.68 0-4.708-2.528-6.178-4-1.47 1.472-3.498 4-6.178 4-5.096 0-5.096-8 0-8 2.68 0 4.708 2.528 6.178 4 1.47-1.472 3.498-4 6.178-4z"></path></svg>
                        <span class="awake-mode-title">Бесконечно</span>
                        <span class="awake-mode-sub">Пока открыт ToolHub</span>
                    </div>

                    <div class="awake-mode-card ${mode === 'off' ? 'active' : ''}" onclick="changeKeepAwakeMode('off')">
                        <svg class="icon" viewBox="0 0 24 24" style="width: 20px; height: 20px; margin-bottom: 4px; stroke: #f87171;"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                        <span class="awake-mode-title" style="color: #f87171;">Выключить</span>
                        <span class="awake-mode-sub">${turnOffSub}</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    startAwakeCountdownTicker();
}

function startAwakeCountdownTicker() {
    if (awakeTimerId) clearInterval(awakeTimerId);
    awakeTimerId = setInterval(() => {
        if (!awakeStatusCache.is_active || awakeStatusCache.remaining_secs <= 0) {
            return;
        }
        awakeStatusCache.remaining_secs--;
        const el = document.getElementById('awake-countdown');
        if (el) {
            const remSecs = awakeStatusCache.remaining_secs;
            const h = Math.floor(remSecs / 3600);
            const m = Math.floor((remSecs % 3600) / 60);
            const s = remSecs % 60;
            el.innerText = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        if (awakeStatusCache.remaining_secs === 0) {
            renderKeepAwakeDashboard();
        }
    }, 1000);
}

async function changeKeepAwakeMode(mode) {
    try {
        awakeStatusCache = await appIpc.setKeepAwake(mode);
        renderKeepAwakeDashboard();
        logConsole(`[АНТИСОН] Переключен режим: ${mode}`);
    } catch (e) {
        logConsole(`[АНТИСОН] Ошибка установки режима: ${e.message || e}`);
    }
}

window.switchTool = switchTool;
window.switchSection = (k) => switchTool(k === 'claude' || k === 'claude_code' ? 'claude_code' : k);
window.switchClaudeTab = switchClaudeTab;
window.runClaudeNetworkAudit = runClaudeNetworkAudit;
window.executeClaudeReset = executeClaudeReset;
window.openClaudeFolder = openClaudeFolder;
window.createClaudeProfileClick = createClaudeProfileClick;
window.renderClaudeDashboard = renderClaudeDashboard;
window.syncTimezoneAction = syncTimezoneAction;
window.restoreTimezoneAction = restoreTimezoneAction;
window.copyAuditJsonAction = copyAuditJsonAction;
window.testProxyAction = testProxyAction;
window.toggleKillSwitchClick = toggleKillSwitchClick;
window.toggleStrictModeClick = toggleStrictModeClick;
window.safeLaunchClaudeClick = safeLaunchClaudeClick;
window.checkUpdateClick = checkUpdateClick;
window.installUpdateClick = installUpdateClick;

// ==========================================================================
// ToolHub Uninstaller & Leftover Cleaner (BCU Engine)
// ==========================================================================
let installedAppsCache = [];
let hasLoadedApps = false;
let selectedAppIds = new Set();
let currentUninstTab = 'all'; // 'all', 'win32', 'uwp', 'system'
let currentUninstSearch = '';
let isScanningApps = false;
let isBatchRunning = false;
let currentLeftoversList = [];
let currentLeftoverAppName = '';

function formatSizeKb(kb) {
    if (!kb || kb === 0) return '—';
    if (kb >= 1024 * 1024) {
        return (kb / (1024 * 1024)).toFixed(2) + ' ГБ';
    }
    if (kb >= 1024) {
        return (kb / 1024).toFixed(1) + ' МБ';
    }
    return kb + ' КБ';
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 Б';
    if (bytes >= 1024 * 1024 * 1024) {
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' ГБ';
    }
    if (bytes >= 1024 * 1024) {
        return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
    }
    if (bytes >= 1024) {
        return (bytes / 1024).toFixed(1) + ' КБ';
    }
    return bytes + ' Б';
}

function getAppTypeBadge(type) {
    switch (type) {
        case 'inno':
            return '<span class="uninst-badge uninst-badge-cyan">Inno</span>';
        case 'msi':
            return '<span class="uninst-badge uninst-badge-purple">MSI</span>';
        case 'uwp':
            return '<span class="uninst-badge uninst-badge-emerald">UWP</span>';
        case 'nsis':
            return '<span class="uninst-badge uninst-badge-amber">NSIS</span>';
        case 'squirrel':
            return '<span class="uninst-badge uninst-badge-blue">Electron</span>';
        default:
            return '<span class="uninst-badge uninst-badge-gray">Win32</span>';
    }
}

function renderUninstallerDashboard() {
    const container = document.getElementById('uninstaller-container');
    if (!container) return;

    if (!hasLoadedApps && !isScanningApps) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-dim); padding: 50px 20px;">
                <div style="display: inline-block; width: 28px; height: 28px; border: 2px solid var(--accent-emerald); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 14px;"></div>
                <div style="font-size: 13px; font-weight: 600; color: var(--text-high);">Сканирование установленных программ...</div>
                <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">Мгновенный опрос реестра Windows HKLM/HKCU</div>
            </div>
        `;
        setTimeout(() => refreshInstalledApps(), 10);
        return;
    }

    if (isScanningApps && installedAppsCache.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-dim); padding: 50px 20px;">
                <div style="display: inline-block; width: 28px; height: 28px; border: 2px solid var(--accent-emerald); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 14px;"></div>
                <div style="font-size: 13px; font-weight: 600; color: var(--text-high);">Сканирование установленных программ...</div>
                <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">Мгновенный опрос реестра Windows HKLM/HKCU</div>
            </div>
        `;
        return;
    }

    // Filter apps
    let filtered = installedAppsCache.filter(app => {
        // Tab filter
        if (currentUninstTab === 'win32' && app.app_type === 'uwp') return false;
        if (currentUninstTab === 'uwp' && app.app_type !== 'uwp') return false;
        if (currentUninstTab === 'system' && !app.is_system_component) return false;
        if (currentUninstTab !== 'system' && app.is_system_component) return false;

        // Search filter
        if (currentUninstSearch) {
            const q = currentUninstSearch.toLowerCase();
            const matchName = app.name.toLowerCase().includes(q);
            const matchPub = (app.publisher || '').toLowerCase().includes(q);
            const matchVer = (app.version || '').toLowerCase().includes(q);
            const matchLoc = (app.install_location || '').toLowerCase().includes(q);
            if (!matchName && !matchPub && !matchVer && !matchLoc) return false;
        }

        return true;
    });

    // Compute stats
    const totalApps = installedAppsCache.filter(a => !a.is_system_component).length;
    let totalSizeKb = 0;
    installedAppsCache.forEach(a => {
        if (!a.is_system_component && a.estimated_size_kb) {
            totalSizeKb += a.estimated_size_kb;
        }
    });

    // Compute selected stats
    let selectedCount = selectedAppIds.size;
    let selectedSizeKb = 0;
    selectedAppIds.forEach(id => {
        const a = installedAppsCache.find(x => x.id === id);
        if (a && a.estimated_size_kb) {
            selectedSizeKb += a.estimated_size_kb;
        }
    });

    const allCurrentSelected = filtered.length > 0 && filtered.every(a => selectedAppIds.has(a.id));

    let html = `
        <div class="uninst-dashboard-wrap">
            <div class="uninst-toolbar">
                <div class="uninst-filter-tabs">
                    <button type="button" class="uninst-filter-btn ${currentUninstTab === 'all' ? 'active' : ''}" onclick="filterUninstTab('all')">Все программы (${totalApps})</button>
                    <button type="button" class="uninst-filter-btn ${currentUninstTab === 'win32' ? 'active' : ''}" onclick="filterUninstTab('win32')">Win32 / MSI</button>
                    <button type="button" class="uninst-filter-btn ${currentUninstTab === 'uwp' ? 'active' : ''}" onclick="filterUninstTab('uwp')">Windows Store / UWP</button>
                    <button type="button" class="uninst-filter-btn ${currentUninstTab === 'system' ? 'active' : ''}" onclick="filterUninstTab('system')">Системные</button>
                </div>

                <div style="display: flex; align-items: center; gap: 8px;">
                    <div class="uninst-search-box">
                        <svg class="icon" viewBox="0 0 24 24" style="width: 13px; height: 13px; color: var(--text-dim);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                        <input type="text" placeholder="Поиск по названию или издателю..." oninput="filterUninstSearch(this.value)" value="${escapeAttr(currentUninstSearch)}">
                    </div>
                    <button type="button" class="mini-tool-btn" onclick="refreshInstalledApps()" title="Обновить список программ">
                        <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                    </button>
                </div>
            </div>

            <div class="uninst-stats-bar">
                <div>Найдено: <span class="uninst-stats-pill">${filtered.length}</span> из ${totalApps} программ</div>
                <div>Общий объём: <span class="uninst-stats-pill">${formatSizeKb(totalSizeKb)}</span></div>
            </div>

            <div class="uninst-table-container">
                <table class="uninst-table">
                    <thead>
                        <tr>
                            <th style="width: 36px; text-align: center;">
                                <input type="checkbox" onchange="toggleSelectAllFiltered(this.checked)" ${allCurrentSelected ? 'checked' : ''} style="cursor: pointer;">
                            </th>
                            <th>Программа</th>
                            <th style="width: 140px;">Издатель</th>
                            <th style="width: 90px; text-align: center;">Тип</th>
                            <th style="width: 100px; text-align: right;">Размер</th>
                            <th style="width: 160px; text-align: right;">Действия</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    if (filtered.length === 0) {
        html += `
            <tr>
                <td colspan="6" style="text-align: center; color: var(--text-dim); padding: 40px;">
                    ${currentUninstSearch ? 'Программ по запросу не найдено' : 'Список пуст'}
                </td>
            </tr>
        `;
    } else {
        filtered.forEach(app => {
            const isSelected = selectedAppIds.has(app.id);
            const badge = getAppTypeBadge(app.app_type);
            const sizeStr = formatSizeKb(app.estimated_size_kb);

            html += `
                <tr class="${isSelected ? 'selected' : ''}">
                    <td style="text-align: center;">
                        <input type="checkbox" onchange="toggleSelectApp('${escapeAttr(app.id)}')" ${isSelected ? 'checked' : ''} style="cursor: pointer;">
                    </td>
                    <td>
                        <div class="uninst-app-title">
                            <span>${escapeHtml(app.name)}</span>
                        </div>
                        ${app.version ? `<div class="uninst-app-ver">Версия: ${escapeHtml(app.version)}</div>` : ''}
                    </td>
                    <td>
                        <span style="color: var(--text-dim); font-size: 11.5px;">${escapeHtml(app.publisher || '—')}</span>
                    </td>
                    <td style="text-align: center;">
                        ${badge}
                    </td>
                    <td style="text-align: right;">
                        <span class="uninst-size-tag">${sizeStr}</span>
                    </td>
                    <td style="text-align: right;">
                        <div class="uninst-actions" style="justify-content: flex-end;">
                            <button type="button" class="uninst-btn-subtle" onclick="openLeftoversModal('${escapeAttr(app.id)}')" title="Найти оставшиеся файлы и кэш">Хвосты</button>
                            <button type="button" class="uninst-btn-danger" onclick="executeSingleUninstall('${escapeAttr(app.id)}')" title="Тихое удаление через автоподстановку флагов">Удалить</button>
                        </div>
                    </td>
                </tr>
            `;
        });
    }

    html += `
                    </tbody>
                </table>
            </div>

            <!-- Липкая панель пакетных действий -->
            ${selectedCount > 0 ? `
                <div class="uninst-floating-bar">
                    <div class="uninst-floating-info">
                        <span class="uninst-floating-count">${selectedCount}</span>
                        <span>Выбрано: <strong>${selectedCount}</strong> программ (~${formatSizeKb(selectedSizeKb)})</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button type="button" class="btn-primary" style="padding: 6px 14px; font-size: 11.5px;" onclick="executeBatchUninstall(false)">
                            🚀 Тихое удаление
                        </button>
                        <button type="button" class="btn-primary" style="padding: 6px 14px; font-size: 11.5px; background: #059669;" onclick="executeBatchUninstall(true)">
                            🧹 Снос + зачистка хвостов
                        </button>
                        <button type="button" class="uninst-btn-subtle" style="padding: 6px 10px;" onclick="clearAppSelection()">
                            ✕ Сбросить
                        </button>
                    </div>
                </div>
            ` : ''}
        </div>
    `;

    container.innerHTML = html;
}

async function refreshInstalledApps() {
    if (isScanningApps) return;
    isScanningApps = true;
    try {
        logConsole('[ДЕИНСТАЛЛЯТОР] Сканирование установленных программ...');
        const apps = await appIpc.invoke('get_installed_apps');
        installedAppsCache = apps || [];
        hasLoadedApps = true;
        logConsole(`[ДЕИНСТАЛЛЯТОР] Обнаружено ${installedAppsCache.length} установленных программ`);
    } catch (err) {
        logConsole(`[ОШИБКА ДЕИНСТАЛЛЯТОРА] ${err}`);
        showNotification(`Ошибка сканирования программ: ${err}`, 'error');
        hasLoadedApps = true;
    } finally {
        isScanningApps = false;
        renderUninstallerDashboard();
    }
}

function filterUninstTab(tab) {
    currentUninstTab = tab;
    renderUninstallerDashboard();
}

function filterUninstSearch(query) {
    currentUninstSearch = query;
    renderUninstallerDashboard();
}

function toggleSelectApp(id) {
    if (selectedAppIds.has(id)) {
        selectedAppIds.delete(id);
    } else {
        selectedAppIds.add(id);
    }
    renderUninstallerDashboard();
}

function toggleSelectAllFiltered(checked) {
    let filtered = installedAppsCache.filter(app => {
        if (currentUninstTab === 'win32' && app.app_type === 'uwp') return false;
        if (currentUninstTab === 'uwp' && app.app_type !== 'uwp') return false;
        if (currentUninstTab === 'system' && !app.is_system_component) return false;
        if (currentUninstTab !== 'system' && app.is_system_component) return false;
        if (currentUninstSearch) {
            const q = currentUninstSearch.toLowerCase();
            const matchName = app.name.toLowerCase().includes(q);
            const matchPub = (app.publisher || '').toLowerCase().includes(q);
            if (!matchName && !matchPub) return false;
        }
        return true;
    });

    if (checked) {
        filtered.forEach(a => selectedAppIds.add(a.id));
    } else {
        filtered.forEach(a => selectedAppIds.delete(a.id));
    }
    renderUninstallerDashboard();
}

function clearAppSelection() {
    selectedAppIds.clear();
    renderUninstallerDashboard();
}

async function executeSingleUninstall(appId) {
    const app = installedAppsCache.find(a => a.id === appId);
    if (!app) return;

    if (!confirm(`Вы действительно хотите удалить "${app.name}"?\nДеинсталлятор будет запущен в тихом режиме.`)) {
        return;
    }

    try {
        showNotification(`Запуск деинсталляции "${app.name}"...`, 'info', 4000);
        logConsole(`[ДЕИНСТАЛЛЯЦИЯ] Запуск удаления: ${app.name}`);

        const res = await appIpc.invoke('uninstall_app', { appId: app.id, silent: true });
        showNotification(`"${app.name}" успешно удалено!`, 'success', 5000);
        logConsole(`[ДЕИНСТАЛЛЯЦИЯ] Результат: ${res}`);

        selectedAppIds.delete(app.id);
        await refreshInstalledApps();
    } catch (err) {
        showNotification(`Ошибка удаления "${app.name}": ${err}`, 'error', 6000);
        logConsole(`[ОШИБКА] Деинсталляция не удалась: ${err}`);
    }
}

async function executeBatchUninstall(cleanResidues) {
    if (selectedAppIds.size === 0 || isBatchRunning) return;

    const count = selectedAppIds.size;
    const confirmMsg = cleanResidues
        ? `Выбрано ${count} программ для полного тихого удаления С ЗАЧИСТКОЙ ХВОСТОВ в AppData/ProgramData.\nПродолжить?`
        : `Выбрано ${count} программ для тихого удаления.\nПродолжить?`;

    if (!confirm(confirmMsg)) {
        return;
    }

    isBatchRunning = true;
    const ids = Array.from(selectedAppIds);

    showNotification(`Запущено пакетное удаление ${count} программ...`, 'info', 5000);
    logConsole(`[ПАКЕТНЫЙ КИЛЛЕР] Начало удаления ${count} приложений...`);

    try {
        const results = await appIpc.invoke('batch_uninstall', {
            appIds: ids,
            silent: true,
            cleanLeftovers: cleanResidues
        });

        let successCount = 0;
        let failCount = 0;
        let cleanedTotal = 0;

        (results || []).forEach(r => {
            if (r.success) {
                successCount++;
                cleanedTotal += (r.leftovers_cleaned || 0);
            } else {
                failCount++;
            }
        });

        selectedAppIds.clear();
        await refreshInstalledApps();

        let msg = `Пакетное удаление завершено: ${successCount} успешно`;
        if (failCount > 0) msg += `, ${failCount} с ошибками`;
        if (cleanedTotal > 0) msg += `. Зачищено ${cleanedTotal} остаточных папок`;

        showNotification(msg, successCount > 0 ? 'success' : 'warning', 6000);
        logConsole(`[ПАКЕТНЫЙ КИЛЛЕР] ${msg}`);
    } catch (err) {
        showNotification(`Ошибка пакетного удаления: ${err}`, 'error', 6000);
        logConsole(`[ОШИБКА ПАКЕТНОГО УДАЛЕНИЯ] ${err}`);
    } finally {
        isBatchRunning = false;
        renderUninstallerDashboard();
    }
}

async function openLeftoversModal(appId) {
    const app = installedAppsCache.find(a => a.id === appId);
    if (!app) return;

    currentLeftoverAppName = app.name;
    showNotification(`Поиск хвостов для "${app.name}"...`, 'info', 2000);

    try {
        const items = await appIpc.invoke('scan_app_leftovers', {
            appName: app.name,
            installLocation: app.install_location || ''
        });
        currentLeftoversList = items || [];
        renderLeftoversModal();
    } catch (err) {
        showNotification(`Ошибка сканирования хвостов: ${err}`, 'error');
    }
}

function renderLeftoversModal() {
    closeLeftoversModal();

    const overlay = document.createElement('div');
    overlay.id = 'uninst-leftovers-modal-overlay';
    overlay.className = 'uninst-modal-overlay';

    let totalBytes = 0;
    currentLeftoversList.forEach(item => {
        totalBytes += (item.size_bytes || 0);
    });

    let bodyHtml = '';
    if (currentLeftoversList.length === 0) {
        bodyHtml = `
            <div style="text-align: center; color: var(--text-dim); padding: 30px;">
                <svg class="icon" viewBox="0 0 24 24" style="width: 32px; height: 32px; stroke: var(--accent-emerald); margin-bottom: 10px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <div style="font-weight: 600; color: var(--text-high);">Остаточного мусора не обнаружено</div>
                <div style="font-size: 11.5px; margin-top: 4px;">В папках AppData, LocalAppData и ProgramData чисто.</div>
            </div>
        `;
    } else {
        bodyHtml = `
            <div style="font-size: 11.5px; color: var(--text-dim); margin-bottom: 6px;">
                Найдено <strong>${currentLeftoversList.length}</strong> остаточных элементов общим объемом <strong>${formatBytes(totalBytes)}</strong>:
            </div>
        `;

        currentLeftoversList.forEach((item, idx) => {
            const confClass = item.confidence === 'high' ? 'uninst-confidence-high' : 'uninst-confidence-medium';
            const confLabel = item.confidence === 'high' ? 'Точный матч' : 'Похожая папка';

            bodyHtml += `
                <div class="uninst-leftover-item">
                    <input type="checkbox" id="leftover-cb-${idx}" checked style="cursor: pointer;">
                    <div style="flex: 1; min-width: 0;">
                        <div class="uninst-leftover-path">${escapeHtml(item.path)}</div>
                        <div style="font-size: 10.5px; color: var(--text-dim); margin-top: 2px;">
                            Размер: <strong>${formatBytes(item.size_bytes)}</strong>
                        </div>
                    </div>
                    <span class="uninst-confidence-tag ${confClass}">${confLabel}</span>
                </div>
            `;
        });
    }

    overlay.innerHTML = `
        <div class="uninst-modal-box">
            <div class="uninst-modal-header">
                <div style="font-size: 13.5px; font-weight: 700; color: var(--text-high);">
                    Хвосты и кэш: ${escapeHtml(currentLeftoverAppName)}
                </div>
                <button type="button" class="mini-tool-btn" onclick="closeLeftoversModal()">✕</button>
            </div>
            <div class="uninst-modal-body">
                ${bodyHtml}
            </div>
            <div class="uninst-modal-footer">
                <button type="button" class="uninst-btn-subtle" onclick="closeLeftoversModal()">Закрыть</button>
                ${currentLeftoversList.length > 0 ? `
                    <button type="button" class="btn-primary" style="background: #ef4444; padding: 6px 14px; font-size: 11.5px;" onclick="cleanSelectedLeftovers()">
                        Очистить выбранные (${formatBytes(totalBytes)})
                    </button>
                ` : ''}
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
}

function closeLeftoversModal() {
    const existing = document.getElementById('uninst-leftovers-modal-overlay');
    if (existing) {
        existing.remove();
    }
}

async function cleanSelectedLeftovers() {
    const pathsToClean = [];
    currentLeftoversList.forEach((item, idx) => {
        const cb = document.getElementById(`leftover-cb-${idx}`);
        if (cb && cb.checked) {
            pathsToClean.push(item.path);
        }
    });

    if (pathsToClean.length === 0) {
        showNotification('Не выбрано ни одного элемента для удаления', 'warning');
        return;
    }

    try {
        const res = await appIpc.invoke('clean_app_leftovers', { paths: pathsToClean });
        closeLeftoversModal();

        const freedStr = formatBytes(res.freed_bytes);
        showNotification(`Удалено ${res.deleted_count} элементов, освобождено ${freedStr}`, 'success', 5000);
        logConsole(`[ОЧИСТКА ХВОСТОВ] Удалено ${res.deleted_count} папок, освобождено ${freedStr}`);
    } catch (err) {
        showNotification(`Ошибка очистки хвостов: ${err}`, 'error');
    }
}

window.renderUninstallerDashboard = renderUninstallerDashboard;
window.refreshInstalledApps = refreshInstalledApps;
window.filterUninstTab = filterUninstTab;
window.filterUninstSearch = filterUninstSearch;
window.toggleSelectApp = toggleSelectApp;
window.toggleSelectAllFiltered = toggleSelectAllFiltered;
window.clearAppSelection = clearAppSelection;
window.executeSingleUninstall = executeSingleUninstall;
window.executeBatchUninstall = executeBatchUninstall;
window.openLeftoversModal = openLeftoversModal;
window.closeLeftoversModal = closeLeftoversModal;
window.cleanSelectedLeftovers = cleanSelectedLeftovers;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}