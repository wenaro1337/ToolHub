const fs = require('fs');
const path = require('path');

const uiDir = path.join(__dirname, 'ui');
const stylesPath = path.join(uiDir, 'styles.css');
const appPath = path.join(uiDir, 'app.js');
const indexPath = path.join(uiDir, 'index.html');

const stylesCss = fs.readFileSync(stylesPath, 'utf8');
const appJs = fs.readFileSync(appPath, 'utf8');

const initialOptionsHtml = `
    <div style="margin-bottom: 12px;">
        <!-- ИНТЕРАКТИВНЫЙ СЛАЙДЕР 1 -->
        <div class="toggle-card active" id="card-toggle-video" role="button" tabindex="0" onclick="toggleOption('enable_video')">
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
        <div class="toggle-card active" id="card-toggle-audio" role="button" tabindex="0" onclick="toggleOption('enable_audio')">
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
        <div class="toggle-card active" id="card-toggle-c2pa" role="button" tabindex="0" onclick="toggleOption('enable_c2pa')">
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
`;

// Window Global Function Exports
const globalBindings = `
// --------------------------------------------------------------------------
// Window Global Function Exports
// --------------------------------------------------------------------------
window.switchTool = switchTool;
window.toggleOption = toggleOption;
window.filterSidebarTools = filterSidebarTools;
window.openModal = openModal;
window.closeModal = closeModal;
window.openSystemModal = openSystemModal;
window.toggleLogsDrawer = toggleLogsDrawer;
window.copyAllLogs = copyAllLogs;
window.clearLogs = clearLogs;
window.updateLogsCount = updateLogsCount;
window.executeCurrentTool = executeCurrentTool;
window.openWinTool = openWinTool;
window.copyText = copyText;
window.executeClaudeReset = executeClaudeReset;
window.openClaudeFolder = openClaudeFolder;
window.regenerateHwid = regenerateHwid;
window.openOutputFolder = openOutputFolder;
window.handleFileSelect = handleFileSelect;
window.renderSystemSpecsDashboard = renderSystemSpecsDashboard;
window.renderClaudeDashboard = renderClaudeDashboard;
window.renderChatGptDashboard = renderChatGptDashboard;
window.executeChatGptReset = executeChatGptReset;
window.openChatGptFolder = openChatGptFolder;
window.applyTheme = applyTheme;
window.renderSettingsDashboard = renderSettingsDashboard;
window.toggleAutostartSetting = toggleAutostartSetting;
window.toggleAlwaysOnTopSetting = toggleAlwaysOnTopSetting;
window.toggleGpuSetting = toggleGpuSetting;
window.executeClearCache = executeClearCache;
window.checkUpdateClick = checkUpdateClick;
window.installUpdateClick = installUpdateClick;
window.copyAuditJsonAction = copyAuditJsonAction;
window.toggleKillSwitchClick = toggleKillSwitchClick;
window.safeLaunchClaudeClick = safeLaunchClaudeClick;
window.refreshPorts = refreshPorts;
window.filterPortsByTab = filterPortsByTab;
window.filterPortsBySearch = filterPortsBySearch;
window.killPortProcessAction = killPortProcessAction;
window.renderPortManagerDashboard = renderPortManagerDashboard;
window.renderColorInspectorDashboard = renderColorInspectorDashboard;
window.pickScreenColorAction = pickScreenColorAction;
window.onColorInputDirect = onColorInputDirect;
window.copyColorValue = copyColorValue;
window.renderKeepAwakeDashboard = renderKeepAwakeDashboard;
window.changeKeepAwakeMode = changeKeepAwakeMode;
window.escapeHtml = escapeHtml;
window.escapeAttr = escapeAttr;
window.showNotification = showNotification;
window.isMacOS = isMacOS;
window.isWindows = isWindows;
window.updatePlatformTexts = updatePlatformTexts;
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
`;

const htmlContent = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ToolHub</title>
    <link rel="icon" type="image/svg+xml" href="logo.svg">
    <link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="favicon-16x16.png">
    <link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">
    <style>
${stylesCss}
    </style>
</head>
<body>

    <!-- МОДАЛЬНОЕ ОКНО СПРАВКИ -->
    <div id="modal-overlay" class="modal-backdrop hidden" onclick="closeModal(event)">
        <div class="modal-card" onclick="event.stopPropagation()">
            <div class="modal-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 22px; height: 22px; background: #fff; border-radius: 5px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <svg viewBox="0 0 512 512" style="width: 13px; height: 13px; fill: #000; display: block;">
                            <path fill-rule="evenodd" d="M0 0h362v362H0V0zm60 60h241v241H60V60z"/>
                            <path fill-rule="evenodd" d="M151 151h361v361H151V151zm60 60h241v241H211V211z"/>
                            <rect x="151" y="151" width="211" height="211"/>
                        </svg>
                    </div>
                    <span class="modal-title" id="modal-title">Справка</span>
                </div>
                <button class="modal-close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body" id="modal-content">
                <!-- Контент модалки -->
            </div>
        </div>
    </div>

    <!-- ВЫДВИЖНАЯ ШТОРКА ЛОГОВ (SLIDE-OVER DRAWER) -->
    <div id="logs-drawer-backdrop" class="drawer-backdrop hidden" onclick="toggleLogsDrawer(false)">
        <aside class="logs-drawer" onclick="event.stopPropagation()">
            <div class="drawer-header">
                <div class="drawer-title-row">
                    <div style="width: 22px; height: 22px; background: #fff; border-radius: 5px; display: flex; align-items: center; justify-content: center; margin-right: 6px; flex-shrink: 0;">
                        <svg viewBox="0 0 512 512" style="width: 13px; height: 13px; fill: #000; display: block;">
                            <path fill-rule="evenodd" d="M0 0h362v362H0V0zm60 60h241v241H60V60z"/>
                            <path fill-rule="evenodd" d="M151 151h361v361H151V151zm60 60h241v241H211V211z"/>
                            <rect x="151" y="151" width="211" height="211"/>
                        </svg>
                    </div>
                    <span class="drawer-title">Журнал выполнения</span>
                    <span class="mini-tag mini-tag-cyan" id="logs-count-badge">2 записи</span>
                </div>
                <div class="drawer-actions">
                    <button type="button" class="mini-tool-btn" onclick="copyAllLogs(this)" title="Скопировать все логи">
                        <svg class="icon" viewBox="0 0 24 24" style="width: 12px; height: 12px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        Копировать
                    </button>
                    <button type="button" class="mini-tool-btn" onclick="clearLogs()" title="Очистить терминал">
                        <svg class="icon" viewBox="0 0 24 24" style="width: 12px; height: 12px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        Очистить
                    </button>
                    <button type="button" class="modal-close-btn" onclick="toggleLogsDrawer(false)">&times;</button>
                </div>
            </div>
            <div class="drawer-body" id="console">
                <span class="log-line log-info">[СИСТЕМА] ToolHub запущен и готов к работе.</span>
                <span class="log-line">[ГОТОВНОСТЬ] Выберите файл для запуска конвейера.</span>
            </div>
        </aside>
    </div>

    <!-- САЙДБАР С ПОИСКОМ -->
    <aside class="sidebar">
        <div class="brand-header">
            <div class="brand-icon" title="ToolHub Studio">
                <svg viewBox="0 0 512 512" style="width: 17px; height: 17px; fill: #000; display: block;">
                    <path fill-rule="evenodd" d="M0 0h362v362H0V0zm60 60h241v241H60V60z"/>
                    <path fill-rule="evenodd" d="M151 151h361v361H151V151zm60 60h241v241H211V211z"/>
                    <rect x="151" y="151" width="211" height="211"/>
                </svg>
            </div>
            <span class="brand-title">ToolHub</span>
            <span class="brand-badge">STUDIO</span>
        </div>

        <!-- ПОИСК ИНСТРУМЕНТОВ В САЙДБАРЕ -->
        <div class="sidebar-search">
            <svg class="icon" viewBox="0 0 24 24" style="width: 14px; height: 14px; color: var(--text-dim);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" id="tool-search" placeholder="Поиск инструментов..." oninput="filterSidebarTools(this.value)">
        </div>

        <!-- СПИСОК ИНСТРУМЕНТОВ (СКРОЛЛИРУЕМЫЙ, БЕЗ СКРОЛЛБАРА) -->
        <div id="tools-nav-list">
            <div class="nav-category" style="margin-top: 2px;">Инструменты</div>
            <button type="button" class="tool-link active" data-tool="master_humanizer" data-title="полная хуманизация видео снятие детекции ии c2pa tiktok reels shorts" onclick="switchTool('master_humanizer')">
                <svg class="icon" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>
                <div class="tool-link-text">
                    <span class="tool-link-title">Полная хуманизация видео</span>
                    <span class="tool-link-sub">Снятие детекции ИИ и C2PA</span>
                </div>
            </button>

            <button type="button" class="tool-link" data-tool="inspector" data-title="проверка файла на метки ии инспектор c2pa кодеков" onclick="switchTool('inspector')">
                <svg class="icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <div class="tool-link-text">
                    <span class="tool-link-title">Проверка файла на метки ИИ</span>
                    <span class="tool-link-sub">Инспектор C2PA и кодеков</span>
                </div>
            </button>

            <!-- РАЗДЕЛ: СИСТЕМА И УТИЛИТЫ -->
            <div class="nav-category">Система и утилиты</div>

            <button type="button" class="tool-link" data-tool="port_manager" data-title="порты сокеты процессы port killer listen tcp kill task netstat pid eaddrinuse" onclick="switchTool('port_manager')">
                <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                <div class="tool-link-text">
                    <span class="tool-link-title">Монитор портов и процессов</span>
                    <span class="tool-link-sub">Занятые сокеты и PID</span>
                </div>
            </button>

            <button type="button" class="tool-link" data-tool="keep_awake" data-title="антисон awake сон спящий режим таймер экран бодрствование" onclick="switchTool('keep_awake')">
                <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                <div class="tool-link-text">
                    <span class="tool-link-title">Режим Антисон</span>
                    <span class="tool-link-sub">Предотвращение сна ПК</span>
                </div>
            </button>

            <button type="button" class="tool-link" data-tool="app_uninstaller" data-title="деинсталлятор удаление программ очистка хвостов bcu bulk crap uninstaller bloatware реестр мусор" onclick="switchTool('app_uninstaller')">
                <svg class="icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                <div class="tool-link-text">
                    <span class="tool-link-title">Деинсталлятор & Хвосты</span>
                    <span class="tool-link-sub">Тихий снос и остаточный мусор</span>
                </div>
            </button>

            <!-- РАЗДЕЛ: НЕЙРОСЕТИ -->
            <div class="nav-category">Нейросети</div>

            <button type="button" class="tool-link" data-tool="claude_code" data-title="claude code ai sentinel anthropic антибан kyc ip net coffee аудит сброс хвид отпечаток телеметрия" onclick="switchTool('claude_code')">
                <svg class="icon" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                <div class="tool-link-text" style="width: 100%;">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <span class="tool-link-title">Claude Code & Sentinel</span>
                        <span class="mini-tag mini-tag-emerald" style="font-size: 8px; padding: 1px 5px;">SENTINEL</span>
                    </div>
                    <span class="tool-link-sub">Антибан, Сетевой аудит, Изоляция</span>
                </div>
            </button>

            <button type="button" class="tool-link" data-tool="chatgpt" data-title="chatgpt openai codex нейросеть агент сброс отпечаток сессия токены" onclick="switchTool('chatgpt')">
                <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v4m0 12v4M2 12h4m12 0h4m-3.17-6.83l-2.83 2.83m-8 8l-2.83 2.83m0-13.66l2.83 2.83m8 8l2.83 2.83"></path></svg>
                <div class="tool-link-text" style="width: 100%;">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <span class="tool-link-title">ChatGPT</span>
                        <span class="mini-tag mini-tag-amber" style="font-size: 8px; padding: 1px 5px;">В РАЗРАБОТКЕ</span>
                    </div>
                    <span class="tool-link-sub">Отпечаток и сессии (Codex)</span>
                </div>
            </button>

            <div class="nav-category">Интеграции</div>
            <button type="button" class="tool-link" data-tool="mcp_api" data-title="mcp ai интеграция api модель cursor claude агенты" onclick="switchTool('mcp_api')">
                <svg class="icon" viewBox="0 0 24 24"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1"></path><path d="M18 8h4a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-4"></path><circle cx="8" cy="12" r="2"></circle></svg>
                <div class="tool-link-text">
                    <span class="tool-link-title">MCP & AI Интеграция</span>
                    <span class="tool-link-sub">API для подключения AI-агентов</span>
                </div>
            </button>
        </div>

        <!-- ФУТЕР САЙДБАРА: ХАРАКТЕРИСТИКИ ПК + Ч/Б ИКОНКА НАСТРОЕК -->
        <div class="sidebar-footer-row">
            <button type="button" class="system-status-btn compact" id="btn-system-specs" onclick="switchTool('system_specs')" title="Характеристики ПК и HWID">
                <div class="sys-badge-dot"></div>
                <div class="sys-btn-text">
                    <span class="sys-title">Характеристики ПК</span>
                    <span class="sys-sub" id="sys-short-summary">Загрузка данных...</span>
                </div>
            </button>

            <button type="button" class="sidebar-icon-btn" id="btn-app-settings" onclick="switchTool('app_settings')" title="Настройки приложения">
                <svg viewBox="0 0 24 24" class="icon settings-mono-icon">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
            </button>
        </div>
    </aside>

    <!-- ОСНОВНАЯ ПАНЕЛЬ -->
    <main class="workspace">
        <header class="top-navbar">
            <div class="active-tool-header">
                <h1 id="tool-name">Полная хуманизация видео</h1>
                <span id="tool-pill" style="display: none;"></span>
            </div>

            <!-- ДЕЙСТВИЯ В НАВБАРЕ -->
            <div class="nav-actions">
                <!-- КНОПКА ЖУРНАЛА ЛОГОВ (ТОЛЬКО ИКОНКА) -->
                <button type="button" class="action-badge-btn icon-only" id="btn-toggle-logs" onclick="toggleLogsDrawer()" title="Журнал логов">
                    <svg class="icon" style="width: 14px; height: 14px; stroke: var(--accent-cyan);" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
                    <span class="status-pulse-dot" id="log-status-dot"></span>
                </button>

                <!-- КНОПКА СПРАВКИ (ТОЛЬКО ИКОНКА) -->
                <button type="button" class="action-badge-btn icon-only" onclick="openModal()" title="Справка и советы">
                    <svg class="icon" style="width: 14px; height: 14px; stroke: var(--accent-emerald);" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                </button>
            </div>
        </header>

        <div class="content-scroll" id="content-scroll-area">
            <div class="card" id="main-card">

                <div id="file-selection-area">
                    <div class="card-title">
                        <span>Исходный медиафайл</span>
                    </div>

                    <div class="dropzone" id="dropzone" onclick="document.getElementById('file-picker').click()">
                        <div class="dropzone-icon">
                            <svg class="icon" style="width: 26px; height: 26px;" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                        </div>
                        <div class="dropzone-text" id="dropzone-label">Перетащите видео сюда или нажмите для выбора</div>
                        <div class="dropzone-sub">MP4, MOV, WEBM, WAV, MP3</div>
                        <input type="file" id="file-picker" style="display: none;" onchange="handleFileSelect(event)">
                    </div>

                    <div class="input-group" style="margin-top: 12px;">
                        <label>Или укажите локальный путь к файлу:</label>
                        <input type="text" id="input-path" class="input-text" placeholder="C:\\path\\to\\video.mp4">
                    </div>
                </div>

                <div id="dynamic-options">
${initialOptionsHtml}
                </div>

                <!-- КНОПКА ЗАПУСКА -->
                <button class="btn-primary" id="run-btn" onclick="executeCurrentTool()">
                    Запустить обработку
                </button>

                <!-- КОМПАКТНЫЙ СТАТУС ВЫПОЛНЕНИЯ В РЕАЛЬНОМ ВРЕМЕНИ -->
                <div id="processing-banner" class="processing-banner hidden">
                    <div class="processing-spinner"></div>
                    <div class="processing-content">
                        <div class="processing-title-row">
                            <span class="processing-title">Выполняется обработка видео...</span>
                            <span class="processing-job" id="processing-job-id"></span>
                        </div>
                        <div class="processing-log-preview" id="processing-log-preview">[ГОТОВНОСТЬ] Запуск конвейера...</div>
                    </div>
                    <button type="button" class="btn-subtle" onclick="toggleLogsDrawer(true)">
                        Открыть логи &rarr;
                    </button>
                </div>

                <!-- БЛОК ЗАВЕРШЕНИЯ И РЕЗУЛЬТАТА -->
                <div class="result-bar" id="result-box">
                    <div class="result-info-row">
                        <svg class="icon" style="stroke: var(--accent-emerald); width: 16px; height: 16px; flex-shrink: 0;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        <span id="result-text" class="result-text"></span>
                    </div>
                    <div class="result-btn-row">
                        <button type="button" class="btn btn-secondary" style="padding: 5px 12px; font-size: 11px;" onclick="toggleLogsDrawer(true)">Смотреть логи</button>
                        <button type="button" class="btn-primary" style="padding: 5px 14px; font-size: 11px;" onclick="openOutputFolder()">Открыть папку</button>
                    </div>
                </div>
            </div>
        </div>
    </main>

    <!-- ВСТРОЕННЫЙ СКРИПТ (СИНХРОННЫЙ, БЕЗ СЕТЕВЫХ ЗАПРОСОВ К ФАЙЛАМ) -->
    <script>
${appJs}

${globalBindings}
    </script>
</body>
</html>
`;

fs.writeFileSync(indexPath, htmlContent, 'utf8');
console.log('Successfully bundled index.html (self-contained with embedded CSS and JS)!');
