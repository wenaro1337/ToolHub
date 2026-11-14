<div align="center">

<img src="docs/assets/cover.svg" width="760" alt="ToolHub">

<img src="ui/icon.png" width="80" height="80" alt="ToolHub">

# ToolHub

**ToolHub** — мощное, быстрое вайбкодерское приложение на базе **Rust**, **Tauri 2.0**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/wenaro1337/ToolHub?include_prereleases&label=release)](https://github.com/wenaro1337/ToolHub/releases)
[![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-0078D6?logo=windows&logoColor=white)](#-сборка-из-исходного-кода)
[![Rust](https://img.shields.io/badge/Rust-100%25-DEA584?logo=rust&logoColor=white)](src-tauri)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri&logoColor=white)](https://tauri.app)

<br>

<img src="docs/assets/app-preview.jpg" width="720" alt="Интерфейс ToolHub">

</div>

---

> [!IMPORTANT]
> **Используйте ToolHub на свой страх и риск.** Некоторые модули меняют настройки Windows, удаляют приложения или обрабатывают файлы. Перед такими операциями сделайте резервную копию важных данных.
> При работе со сторонними сервисами учитывайте их правила и ограничения.

## Основные модули

### 1. Claude Code & AI Sentinel
- **Сетевой риск-аудит**: Проверка Egress IP, Cloudflare edge colo, детекция дата-центров/хостингов, Split-Tunneling и блокированных стран
- **Цифровой отпечаток (machineID Sanitizer)**: Сброс криптографического аппаратного `machineID` (SHA-256) и `userID` в `~/.claude.json` с очисткой очередей телеметрии
- **Изоляция профилей (Config Isolator)**: Создание независимых каталогов профилей `~/.claude-profiles` с генерацией `.bat` / `.sh` файлов запуска, подавлением телеметрии и динамической привязкой `TZ` под проверенный IP
- **Kill-Switch**: Не даст запуститься Claude Code до того как не будет запущен и проверен IP-адрес 

<div align="center">
<img src="docs/assets/sentinel-status.png" width="720" alt="Статус блокировки Kill-Switch">
</div>

### 2. Хуманизация видео (TikTok / Reels / Shorts)
- **Anti-pHash DSP**: Сдвиг перцептивного хэша на 40+ бит за счёт микромасштабирования (1.8%), динамического шума сенсора камеры (PRNU) и микрокоррекции линзы
- **Audio DSP Masking**: Маскировка синтезированных нейроголосов с добавлением естественного комнатного тона и восстановлением спектра выше 12 kHz
- **C2PA & Метаданные**: Полная зачистка от ИИ манифестов и перезапись заголовков контейнера под физическую съёмку Apple QuickTime

### 3. Деинсталлятор & Очистка хвостов (BCU Engine)
- **Молниеносный аудит реестра и UWP**: Опрос `HKLM`/`HKCU` и приложений Windows Store (AppX Bloatware) за миллисекунды
- **Пакетное тихое удаление**: Автоматическое распознавание движков инсталляторов (Inno Setup, MSI, NSIS, Squirrel, Win32) с подстановкой скрытых ключей без лишних диалоговых окон
- **Глубокий поиск и зачистка хвостов**: Анализ и удаление остаточных каталогов в `%AppData%`, `%LocalAppData%`, `%ProgramData%` и ключей реестра с оценкой безопасности

---

## 🛠️ Сборка из исходного кода

### Требования:
- **Rust** 1.78+ (`cargo`)
- **Node.js** 18+ (для сборки UI бандла)
- **Windows 10/11** или **macOS**

### Инструкция:
```bash
# 1. Клонирование репозитория
git clone https://github.com/wenaro1337/ToolHub.git
cd ToolHub

# 2. Сборка монолитного UI (CSS + JS)
node build_ui.js

# 3. Компиляция десктопного release-приложения
cargo build --release --manifest-path src-tauri/Cargo.toml

# Готовый исполняемый файл будет находиться в:
# src-tauri/target/release/toolhub.exe
```

---

## Архитектура автообновлений

ToolHub поддерживает автоматические обновления через **GitHub Releases** и **GitHub Actions**:
1. Релизы собираются и криптографически подписываются через GitHub Actions при пуше тега версии (`v*`)
2. Манифест обновлений `latest.json` раздаётся бесплатно через CDN GitHub Releases
3. Клиент проверяет обновления в приложении и обновляется в 1 клик

---

## Лицензия

MIT
