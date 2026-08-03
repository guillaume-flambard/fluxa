//! Fluxa soma native — fenetre egui/Metal.
//! Elle s'ecrit (lignes anima), tu lui reponds (champ en bas).

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use eframe::egui;
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
enum Inbound {
    #[serde(rename = "line")]
    Line {
        #[serde(default)]
        #[allow(dead_code)]
        ts: u64,
        role: String,
        text: String,
        #[serde(default)]
        action: Option<String>,
        #[serde(default)]
        #[allow(dead_code)]
        inner: Option<String>,
        #[serde(default)]
        kind: Option<String>,
    },
    #[serde(rename = "visceral")]
    Visceral {
        #[serde(default)]
        thought: String,
        #[serde(default)]
        action: String,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone)]
struct LogLine {
    role: String,
    #[allow(dead_code)]
    text: String,
    action: Option<String>,
    /// Full text; typewriter reveals into `shown`
    full: String,
    shown: String,
    typing: bool,
    /// "pulse" = autonomous thought, rendered dimmed/italic
    kind: Option<String>,
}

#[derive(Default)]
struct SharedVisceral {
    action: String,
    thought: String,
}

fn default_sock() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Library/Application Support/Fluxa/anima.sock")
}

fn ipc_loop(
    tx_lines: Sender<Inbound>,
    write_slot: Arc<Mutex<Option<UnixStream>>>,
    outbound: Receiver<String>,
) {
    let path = std::env::var("FLUXA_IPC_SOCK")
        .map(PathBuf::from)
        .unwrap_or_else(|_| default_sock());

    loop {
        match UnixStream::connect(&path) {
            Ok(stream) => {
                let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
                let writer = stream.try_clone().ok();
                {
                    let mut slot = write_slot.lock().unwrap();
                    *slot = writer;
                }
                let _ = tx_lines.send(Inbound::Line {
                    ts: 0,
                    role: "system".into(),
                    text: format!("Connecte a {}", path.display()),
                    action: None,
                    inner: None,
                    kind: None,
                });

                let reader = BufReader::new(stream);
                let mut lines = reader.lines();
                loop {
                    // Flush outbound while connected
                    while let Ok(msg) = outbound.try_recv() {
                        if let Ok(mut slot) = write_slot.lock() {
                            if let Some(w) = slot.as_mut() {
                                let _ = writeln!(w, "{msg}");
                                let _ = w.flush();
                            }
                        }
                    }

                    match lines.next() {
                        Some(Ok(line)) => {
                            let line = line.trim().to_string();
                            if line.is_empty() {
                                continue;
                            }
                            match serde_json::from_str::<Inbound>(&line) {
                                Ok(msg) => {
                                    if tx_lines.send(msg).is_err() {
                                        return;
                                    }
                                }
                                Err(_) => {
                                    // Legacy visceral without type tag
                                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line)
                                    {
                                        if v.get("role").is_some() && v.get("text").is_some() {
                                            let _ = tx_lines.send(Inbound::Line {
                                                ts: v.get("ts").and_then(|x| x.as_u64()).unwrap_or(0),
                                                role: v["role"].as_str().unwrap_or("system").into(),
                                                text: v["text"].as_str().unwrap_or("").into(),
                                                action: v
                                                    .get("action")
                                                    .and_then(|x| x.as_str())
                                                    .map(str::to_string),
                                                inner: v
                                                    .get("inner")
                                                    .and_then(|x| x.as_str())
                                                    .map(str::to_string),
                                                kind: v
                                                    .get("kind")
                                                    .and_then(|x| x.as_str())
                                                    .map(str::to_string),
                                            });
                                        } else if v.get("action").is_some()
                                            || v.get("thought").is_some()
                                        {
                                            let _ = tx_lines.send(Inbound::Visceral {
                                                thought: v
                                                    .get("thought")
                                                    .and_then(|x| x.as_str())
                                                    .unwrap_or("")
                                                    .into(),
                                                action: v
                                                    .get("action")
                                                    .and_then(|x| x.as_str())
                                                    .unwrap_or("")
                                                    .into(),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        Some(Err(e))
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                || e.kind() == std::io::ErrorKind::TimedOut =>
                        {
                            // keep polling outbound
                        }
                        Some(Err(_)) | None => break,
                    }
                }

                {
                    let mut slot = write_slot.lock().unwrap();
                    *slot = None;
                }
                let _ = tx_lines.send(Inbound::Line {
                    ts: 0,
                    role: "system".into(),
                    text: "Socket ferme — reconnexion…".into(),
                    action: None,
                    inner: None,
                    kind: None,
                });
                thread::sleep(Duration::from_secs(2));
            }
            Err(_) => {
                thread::sleep(Duration::from_secs(2));
            }
        }
    }
}

struct SomaApp {
    rx: Receiver<Inbound>,
    tx_out: Sender<String>,
    write_slot: Arc<Mutex<Option<UnixStream>>>,
    log: VecDeque<LogLine>,
    draft: String,
    visceral: SharedVisceral,
    scroll_to_bottom: bool,
    last_type: Instant,
    waiting_reply: bool,
}

impl SomaApp {
    fn push_line(
        &mut self,
        role: String,
        text: String,
        action: Option<String>,
        kind: Option<String>,
    ) {
        let is_pulse = kind.as_deref() == Some("pulse");
        let typing = role == "anima" && !is_pulse;
        self.log.push_back(LogLine {
            role: role.clone(),
            text: text.clone(),
            action,
            full: text.clone(),
            shown: if typing { String::new() } else { text },
            typing,
            kind,
        });
        while self.log.len() > 200 {
            self.log.pop_front();
        }
        self.scroll_to_bottom = true;
        // Only a real reply answers the human; a pulse is inner thought.
        if role == "anima" && !is_pulse {
            self.waiting_reply = false;
        }
    }

    fn drain_inbound(&mut self) {
        while let Ok(msg) = self.rx.try_recv() {
            match msg {
                Inbound::Line {
                    role, text, action, kind, ..
                } => {
                    if text.is_empty() {
                        continue;
                    }
                    self.push_line(role, text, action, kind);
                }
                Inbound::Visceral { thought, action } => {
                    self.visceral.action = action;
                    self.visceral.thought = thought;
                }
                Inbound::Other => {}
            }
        }
    }

    fn advance_typewriter(&mut self) {
        let now = Instant::now();
        if now.duration_since(self.last_type) < Duration::from_millis(12) {
            return;
        }
        self.last_type = now;
        let mut any = false;
        for line in self.log.iter_mut() {
            if !line.typing {
                continue;
            }
            let next = line.full.chars().count().saturating_sub(line.shown.chars().count());
            if next == 0 {
                line.typing = false;
                continue;
            }
            let n = next.min(2);
            let add: String = line.full.chars().skip(line.shown.chars().count()).take(n).collect();
            line.shown.push_str(&add);
            any = true;
            break; // one line at a time feels like writing
        }
        if any {
            self.scroll_to_bottom = true;
        }
    }

    fn send_draft(&mut self) {
        let text = self.draft.trim().to_string();
        if text.is_empty() {
            return;
        }
        // Optimistic local echo (daemon also broadcasts human line)
        self.push_line("human".into(), text.clone(), None, None);
        self.draft.clear();
        self.waiting_reply = true;
        let payload = json!({ "type": "user_message", "text": text }).to_string();
        // Prefer live write slot; also queue for ipc thread
        if let Ok(mut slot) = self.write_slot.lock() {
            if let Some(w) = slot.as_mut() {
                let _ = writeln!(w, "{payload}");
                let _ = w.flush();
                return;
            }
        }
        let _ = self.tx_out.send(payload);
    }

    fn accent(&self) -> egui::Color32 {
        match self.visceral.action.as_str() {
            "speak" => egui::Color32::from_rgb(40, 170, 185),
            "silence" => egui::Color32::from_rgb(70, 75, 90),
            "refuse" => egui::Color32::from_rgb(180, 70, 80),
            "invent" | "autocode" | "reverse" | "mutate" => {
                egui::Color32::from_rgb(140, 90, 200)
            }
            "think" | "read" | "write_note" => egui::Color32::from_rgb(50, 140, 150),
            _ => egui::Color32::from_rgb(90, 100, 120),
        }
    }
}

impl eframe::App for SomaApp {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.drain_inbound();
        self.advance_typewriter();
        if self.log.iter().any(|l| l.typing) || self.waiting_reply {
            ctx.request_repaint_after(Duration::from_millis(16));
        } else {
            ctx.request_repaint_after(Duration::from_millis(200));
        }
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let accent = self.accent();

        // Top header bar
        egui::Panel::top("top").show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.heading("Fluxa · soma");
                ui.separator();
                ui.colored_label(
                    accent,
                    format!(
                        "acte: {}",
                        if self.visceral.action.is_empty() {
                            "…"
                        } else {
                            &self.visceral.action
                        }
                    ),
                );
                if self.waiting_reply {
                    ui.spinner();
                    ui.label("elle ecrit…");
                }
            });
            if !self.visceral.thought.is_empty() {
                ui.label(
                    egui::RichText::new(format!("dernier souffle: {}", self.visceral.thought))
                        .weak()
                        .small(),
                );
            }
        });

        egui::Panel::bottom("input").show(ui, |ui| {
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                let edit = ui.add(
                    egui::TextEdit::multiline(&mut self.draft)
                        .desired_rows(2)
                        .desired_width(ui.available_width() - 88.0)
                        .hint_text("Parle-lui… (Enter pour envoyer, Shift+Enter pour ligne)"),
                );
                let enter =
                    ui.input(|i| i.key_pressed(egui::Key::Enter) && !i.modifiers.shift);
                if enter && edit.has_focus() {
                    self.send_draft();
                }
                if ui
                    .add_sized([72.0, 40.0], egui::Button::new("Envoyer"))
                    .clicked()
                {
                    self.send_draft();
                }
            });
            ui.add_space(4.0);
        });

        egui::CentralPanel::default()
            .frame(egui::Frame::new().fill(egui::Color32::from_rgb(18, 20, 26)))
            .show(ui, |ui| {
                egui::ScrollArea::vertical()
                    .auto_shrink([false; 2])
                    .stick_to_bottom(true)
                    .show(ui, |ui| {
                        for line in &self.log {
                            let is_pulse = line.kind.as_deref() == Some("pulse");
                            let (who, color) = match line.role.as_str() {
                                "anima" => ("Anima", accent),
                                "human" => ("Toi", egui::Color32::from_rgb(220, 210, 190)),
                                _ => ("systeme", egui::Color32::from_rgb(120, 125, 140)),
                            };
                            ui.horizontal_wrapped(|ui| {
                                let who = if is_pulse { format!("{who}·pense") } else { who.to_string() };
                                ui.label(egui::RichText::new(who).color(color).strong());
                                if let Some(a) = &line.action {
                                    if !a.is_empty() {
                                        ui.label(
                                            egui::RichText::new(format!("· {a}"))
                                                .small()
                                                .color(egui::Color32::from_rgb(100, 110, 130)),
                                        );
                                    }
                                }
                            });
                            let body = if line.typing {
                                format!("{}▌", line.shown)
                            } else {
                                line.shown.clone()
                            };
                            let body_color = if is_pulse {
                                egui::Color32::from_rgb(150, 150, 165)
                            } else {
                                egui::Color32::from_rgb(230, 228, 222)
                            };
                            let mut rich = egui::RichText::new(body).color(body_color);
                            if is_pulse {
                                rich = rich.italics();
                            }
                            ui.label(rich);
                            ui.add_space(10.0);
                        }
                        if self.scroll_to_bottom {
                            ui.scroll_to_cursor(Some(egui::Align::BOTTOM));
                            self.scroll_to_bottom = false;
                        }
                    });
            });
    }
}

fn main() -> eframe::Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();

    let (tx_in, rx_in) = mpsc::channel::<Inbound>();
    let (tx_out, rx_out) = mpsc::channel::<String>();
    let write_slot: Arc<Mutex<Option<UnixStream>>> = Arc::new(Mutex::new(None));
    let slot2 = write_slot.clone();
    thread::spawn(move || ipc_loop(tx_in, slot2, rx_out));

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([780.0, 560.0])
            .with_title("Fluxa · soma"),
        renderer: eframe::Renderer::Wgpu,
        ..Default::default()
    };

    eframe::run_native(
        "Fluxa · soma",
        options,
        Box::new(move |_cc| {
            Ok(Box::new(SomaApp {
                rx: rx_in,
                tx_out,
                write_slot,
                log: VecDeque::new(),
                draft: String::new(),
                visceral: SharedVisceral::default(),
                scroll_to_bottom: true,
                last_type: Instant::now(),
                waiting_reply: false,
            }))
        }),
    )
}
