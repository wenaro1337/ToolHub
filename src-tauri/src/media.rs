use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use rand::Rng;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

// 16-byte UUID identifiers for C2PA (Content Credentials) and XMP in ISOBMFF containers
pub const C2PA_UUID: [u8; 16] = [
    0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c,
    0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81,
];
pub const XMP_UUID: [u8; 16] = [
    0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8,
    0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac,
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaTaskParams {
    pub tool: String, // "master_humanizer" or "inspector"
    pub input_path: String,
    pub output_path: Option<String>,
    #[serde(default = "default_true")]
    pub enable_video: bool,
    #[serde(default = "default_true")]
    pub enable_audio: bool,
    #[serde(default = "default_grain")]
    pub grain_strength: u32,
    #[serde(default = "default_room_tone")]
    pub room_tone_vol: f64,
    pub crf: Option<u32>,
}

fn default_true() -> bool {
    true
}
fn default_grain() -> u32 {
    12
}
fn default_room_tone() -> f64 {
    0.35
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStatus {
    pub job_id: String,
    pub tool: String,
    pub status: String, // "running", "finished", "failed"
    pub logs: Vec<String>,
    pub result_path: Option<String>,
    pub scrubbed_manifests: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskEventPayload {
    pub job_id: String,
    pub event_type: String, // "log", "progress", "finished", "error"
    pub message: String,
    pub progress: Option<f32>,
    pub status: String,
    pub result_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunTaskResponse {
    pub job_id: String,
}

#[derive(Clone, Default)]
pub struct AppState {
    pub jobs: Arc<Mutex<HashMap<String, TaskStatus>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub fn get_output_dir() -> PathBuf {
    let base = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let out = base.join("toolhub_output");
    let _ = fs::create_dir_all(&out);
    out
}

pub fn open_output_dir() -> Result<(), String> {
    let out = get_output_dir();
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(out.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("Ошибка открытия проводника: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(out.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("Ошибка открытия Finder: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(out.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("Ошибка открытия менеджера файлов: {}", e))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Операционная система не поддерживается".into())
}

/// Scans ISOBMFF box headers and safely replaces C2PA / XMP UUID boxes with 'free' (padding) atoms.
/// Overwrites the box type in-place to guarantee zero corruption of sample chunk offsets (stco/co64).
pub fn sanitize_c2pa_binary<P: AsRef<Path>>(path: P) -> std::io::Result<usize> {
    let mut file = OpenOptions::new().read(true).write(true).open(path)?;
    let total_size = file.seek(SeekFrom::End(0))?;
    file.seek(SeekFrom::Start(0))?;

    let mut scrubbed = 0;
    let mut current_offset = 0u64;

    while current_offset < total_size {
        file.seek(SeekFrom::Start(current_offset))?;
        let mut header = [0u8; 8];
        if file.read_exact(&mut header).is_err() {
            break;
        }

        let mut box_size = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as u64;
        let box_type = &header[4..8];

        if box_size == 1 {
            let mut large_buf = [0u8; 8];
            if file.read_exact(&mut large_buf).is_err() {
                break;
            }
            box_size = u64::from_be_bytes(large_buf);
        } else if box_size == 0 {
            box_size = total_size - current_offset;
        }

        if box_type == b"uuid" {
            let mut uuid_bytes = [0u8; 16];
            if file.read_exact(&mut uuid_bytes).is_ok()
                && (uuid_bytes == C2PA_UUID || uuid_bytes == XMP_UUID)
            {
                // Overwrite 'uuid' at offset + 4 with 'free'
                file.seek(SeekFrom::Start(current_offset + 4))?;
                file.write_all(b"free")?;
                // Zero out the 16 bytes of UUID payload
                file.write_all(&[0u8; 16])?;
                scrubbed += 1;
            }
        }

        let next_offset = current_offset.saturating_add(box_size);
        if next_offset <= current_offset || next_offset > total_size {
            break;
        }
        current_offset = next_offset;
    }

    Ok(scrubbed)
}

fn append_log(
    app: Option<&AppHandle>,
    jobs: &Arc<Mutex<HashMap<String, TaskStatus>>>,
    job_id: &str,
    msg: String,
    event_type: &str,
    progress: Option<f32>,
) {
    if let Ok(mut map) = jobs.lock() {
        if let Some(task) = map.get_mut(job_id) {
            task.logs.push(msg.clone());
        }
    }

    if let Some(handle) = app {
        let payload = TaskEventPayload {
            job_id: job_id.to_string(),
            event_type: event_type.to_string(),
            message: msg,
            progress,
            status: "running".to_string(),
            result_path: None,
        };
        let _ = handle.emit("media-task-event", payload);
    }
}

fn finish_task(
    app: Option<&AppHandle>,
    jobs: &Arc<Mutex<HashMap<String, TaskStatus>>>,
    job_id: &str,
    success: bool,
    result_path: Option<String>,
    scrubbed: usize,
) {
    let status_str = if success { "finished" } else { "failed" };

    if let Ok(mut map) = jobs.lock() {
        if let Some(task) = map.get_mut(job_id) {
            task.status = status_str.to_string();
            task.result_path = result_path.clone();
            task.scrubbed_manifests = scrubbed;
        }
    }

    if let Some(handle) = app {
        let payload = TaskEventPayload {
            job_id: job_id.to_string(),
            event_type: if success { "finished".into() } else { "error".into() },
            message: if success {
                "Обработка успешно завершена".into()
            } else {
                "Ошибка выполнения конвейера".into()
            },
            progress: Some(1.0),
            status: status_str.to_string(),
            result_path,
        };
        let _ = handle.emit("media-task-event", payload);
    }
}

pub fn spawn_media_task(
    app: Option<AppHandle>,
    jobs: Arc<Mutex<HashMap<String, TaskStatus>>>,
    job_id: String,
    params: MediaTaskParams,
) {
    thread::spawn(move || {
        let log = |msg: &str| {
            append_log(app.as_ref(), &jobs, &job_id, msg.to_string(), "log", None);
        };

        let progress_log = |msg: &str, pct: f32| {
            append_log(
                app.as_ref(),
                &jobs,
                &job_id,
                msg.to_string(),
                "progress",
                Some(pct),
            );
        };

        let input_path = PathBuf::from(&params.input_path);
        if !input_path.exists() {
            log(&format!("[ОШИБКА] Входной файл не найден: {:?}", input_path));
            finish_task(app.as_ref(), &jobs, &job_id, false, None, 0);
            return;
        }

        if params.tool == "inspector" {
            run_inspector_pipeline(app.as_ref(), &jobs, &job_id, &input_path);
            return;
        }

        // --- MASTER HUMANIZER PIPELINE ---
        log(&format!("[*] Старт комплексной хуманизации: {:?}", input_path.file_name().unwrap_or_default()));

        let out_dir = get_output_dir();
        let stem = input_path.file_stem().and_then(|s| s.to_str()).unwrap_or("video");
        let ext = input_path.extension().and_then(|s| s.to_str()).unwrap_or("mp4");

        let out_path = if let Some(custom) = &params.output_path {
            PathBuf::from(custom)
        } else {
            out_dir.join(format!("{}_humanized.{}", stem, ext))
        };

        let temp_out = out_dir.join(format!("temp_{}_humanized.{}", stem, ext));

        // Randomized micro-perturbations within psychoacoustically & visually transparent bounds
        let mut rng = rand::thread_rng();
        let scale: f64 = rng.gen_range(1.015..1.022);
        let speed: f64 = rng.gen_range(1.009..1.015);
        let lens_k1: f64 = rng.gen_range(-0.0035..-0.0020);
        let lens_k2: f64 = rng.gen_range(0.0006..0.0012);
        let grain_strength = params.grain_strength;
        let room_tone_vol = params.room_tone_vol;

        log(&format!(
            "[ПАРАМЕТРЫ] Видео: {} | Звук: {}",
            if params.enable_video { "вкл" } else { "копия" },
            if params.enable_audio { "вкл" } else { "копия" }
        ));
        log(&format!(
            "[ОПТИКА] Зум: {:.4}x, скорость: {:.4}x, зерно матрицы: {}, комнатный тон: {:.2}",
            scale, speed, grain_strength, room_tone_vol
        ));

        let mut filter_parts = Vec::new();
        let mut map_v = "0:v:0".to_string();
        let mut map_a = "0:a:0".to_string();

        if params.enable_video {
            let vf = format!(
                "[0:v]setpts=PTS/{speed:.4},\
                 scale=w='trunc(iw*{scale:.4}/2)*2':h='trunc(ih*{scale:.4}/2)*2':flags=lanczos,\
                 crop=w='trunc(in_w/{scale:.4}/2)*2':h='trunc(in_h/{scale:.4}/2)*2',\
                 lenscorrection=cx=0.5:cy=0.5:k1={lens_k1:.5}:k2={lens_k2:.5},\
                 curves=master='0/0 0.25/0.238 0.5/0.504 0.75/0.764 1/1':\
                 red='0/0 0.5/0.505 1/1':blue='0/0 0.5/0.495 1/1',\
                 eq=contrast=1.025:saturation=1.035:gamma=0.995[v_mod];\
                 [v_mod]split=2[v_base][v_noise_src];\
                 [v_noise_src]format=gray,noise=alls={grain_strength}:allf=t+u,avgblur=sizeX=2:sizeY=2[v_grain];\
                 [v_base][v_grain]blend=all_mode=overlay:all_opacity=0.30,\
                 fps=fps=30:round=near,format=yuv420p[outv]"
            );
            filter_parts.push(vf);
            map_v = "[outv]".to_string();
        }

        if params.enable_audio {
            let af = format!(
                "anoisesrc=c=pink:r=48000:a=0.0016[raw_noise];\
                 [raw_noise]highpass=f=90,lowpass=f=4200,volume={room_tone_vol:.2}[room_tone];\
                 [0:a]atempo={speed:.4},aresample=48000,\
                 equalizer=f=1450:width_type=q:width=3.2:g=-3.5,\
                 equalizer=f=3400:width_type=q:width=3.8:g=-3.0,\
                 equalizer=f=8200:width_type=q:width=3.0:g=-2.5,\
                 equalizer=f=160:width_type=q:width=1.5:g=1.8,\
                 aexciter=level_in=1.0:level_out=1.0:amount=1.4:drive=2.2:freq=7000:ceil=17500,\
                 vibrato=f=4.6:d=0.012[shaped_voice];\
                 [shaped_voice][room_tone]amix=inputs=2:duration=first:dropout_transition=0:weights=1 1:normalize=0[mixed];\
                 [mixed]asoftclip=type=tanh:threshold=0.88:param=1.0:oversample=2,\
                 acompressor=threshold=-22dB:ratio=2.8:attack=15:release=120:makeup=2.2dB,\
                 alimiter=limit=-1.0dB:attack=5:release=50[outa]"
            );
            filter_parts.push(af);
            map_a = "[outa]".to_string();
        }

        let mut cmd = Command::new("ffmpeg");
        cmd.args(["-y", "-i", input_path.to_str().unwrap()]);

        if !filter_parts.is_empty() {
            cmd.args(["-filter_complex", &filter_parts.join(";")]);
        }

        cmd.args(["-map", &map_v, "-map", &map_a]);

        if params.enable_video {
            let crf_str = params.crf.unwrap_or(18).to_string();
            cmd.args([
                "-c:v", "libx264",
                "-preset", "slow",
                "-crf", &crf_str,
                "-tune", "film",
                "-x264-params", "aq-mode=3:aq-strength=0.9:psy-rd=1.0,0.15:no-info=1",
            ]);
        } else {
            cmd.args(["-c:v", "copy"]);
        }

        // Anti-forensic metadata stripping and native iOS camera handler spoofing
        cmd.args([
            "-map_metadata", "-1",
            "-map_chapters", "-1",
            "-fflags", "+bitexact",
            "-flags:v", "+bitexact",
            "-flags:a", "+bitexact",
            "-metadata:s:v", "handler_name=Core Media Video",
            "-metadata:s:a", "handler_name=Core Media Audio",
            "-metadata", "encoder=",
        ]);

        if params.enable_audio {
            cmd.args(["-c:a", "aac", "-b:a", "256k", "-ar", "48000"]);
        } else {
            cmd.args(["-c:a", "copy"]);
        }

        cmd.args(["-movflags", "+faststart", temp_out.to_str().unwrap()]);

        log("[ПРОЦЕСС] Запуск FFmpeg кодирования...");

        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                log(&format!("[ОШИБКА] Не удалось запустить ffmpeg: {}. Убедитесь, что FFmpeg установлен в PATH.", e));
                finish_task(app.as_ref(), &jobs, &job_id, false, None, 0);
                return;
            }
        };

        if let Some(stderr) = child.stderr.take() {
            let reader = BufReader::new(stderr);
            for line_result in reader.lines() {
                if let Ok(line) = line_result {
                    let trimmed = line.trim();
                    if trimmed.contains("frame=") || trimmed.contains("time=") || trimmed.contains("size=") {
                        progress_log(&format!("[ПРОГРЕСС] {}", trimmed), 0.5);
                    }
                }
            }
        }

        let exit_status = match child.wait() {
            Ok(st) => st,
            Err(e) => {
                log(&format!("[ОШИБКА] Сбой ожидания ffmpeg: {}", e));
                finish_task(app.as_ref(), &jobs, &job_id, false, None, 0);
                return;
            }
        };

        if !exit_status.success() {
            log(&format!("[ОШИБКА] FFmpeg завершился с кодом {:?}", exit_status.code()));
            if temp_out.exists() {
                let _ = fs::remove_file(&temp_out);
            }
            finish_task(app.as_ref(), &jobs, &job_id, false, None, 0);
            return;
        }

        // Post-processing: ISOBMFF Box Sanitizer
        log("[КОНТЕЙНЕР] Поиск и нейтрализация атомов C2PA/XMP...");
        let scrubbed = match sanitize_c2pa_binary(&temp_out) {
            Ok(count) => {
                log(&format!("[+] Нейтрализовано скрытых манифестов ИИ: {}", count));
                count
            }
            Err(e) => {
                log(&format!("[!] Предупреждение при очистке ISOBMFF контейнера: {}", e));
                0
            }
        };

        if out_path.exists() {
            let _ = fs::remove_file(&out_path);
        }

        if let Err(e) = fs::rename(&temp_out, &out_path) {
            log(&format!("[ОШИБКА] Не удалось переименовать файл: {}", e));
            finish_task(app.as_ref(), &jobs, &job_id, false, None, scrubbed);
            return;
        }

        log(&format!("[УСПЕХ] Файл полностью готов к публикации: {:?}", out_path));
        finish_task(
            app.as_ref(),
            &jobs,
            &job_id,
            true,
            Some(out_path.to_string_lossy().to_string()),
            scrubbed,
        );
    });
}

fn run_inspector_pipeline(
    app: Option<&AppHandle>,
    jobs: &Arc<Mutex<HashMap<String, TaskStatus>>>,
    job_id: &str,
    input_path: &Path,
) {
    let log = |msg: &str| {
        append_log(app, jobs, job_id, msg.to_string(), "log", None);
    };

    log(&format!("[*] Анализ файла: {:?}", input_path.file_name().unwrap_or_default()));

    // Run ffprobe for stream inspection
    match Command::new("ffprobe")
        .args([
            "-hide_banner",
            "-show_format",
            "-show_streams",
            input_path.to_str().unwrap(),
        ])
        .output()
    {
        Ok(out) => {
            log("[МЕТАДАННЫЕ ПОТОКОВ]");
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines().take(25) {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    log(&format!("  {}", trimmed));
                }
            }
        }
        Err(e) => {
            log(&format!("[!] Предупреждение: ffprobe не обнаружен ({})", e));
        }
    }

    // Binary byte scan for forensic traces in the first 4 MB
    log("[ПРОВЕРКА НА СКРЫТЫЕ МАРКЕРЫ ИИ]");
    if let Ok(mut file) = fs::File::open(input_path) {
        let mut buffer = vec![0u8; 4 * 1024 * 1024];
        let bytes_read = file.read(&mut buffer).unwrap_or(0);
        let slice = &buffer[..bytes_read];

        let has_c2pa = slice.windows(16).any(|w| w == C2PA_UUID);
        let has_xmp = slice.windows(16).any(|w| w == XMP_UUID);
        let has_lavf = slice.windows(4).any(|w| w == b"Lavf" || w == b"Lavc");

        if has_c2pa {
            log("  [!] НАЙДЕН C2PA МАНИФЕСТ (Content Credentials). Файл помечен как генерация ИИ.");
        } else {
            log("  [+] Манифесты C2PA не обнаружены.");
        }

        if has_xmp {
            log("  [!] Обнаружен служебный блок XMP монтажного редактора.");
        } else {
            log("  [+] Пакеты XMP отсутствуют.");
        }

        if has_lavf {
            log("  [!] Присутствуют стандартные теги FFmpeg (Lavf/Lavc).");
        } else {
            log("  [+] Теги кодеров соответствуют чистой съемке смартфона.");
        }
    }

    finish_task(app, jobs, job_id, true, None, 0);
}
