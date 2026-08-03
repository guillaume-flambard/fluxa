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

mod theme;
use theme::{
    accent_for, fluxa_visuals, install_fonts, tint, AMBER, CYAN, NIGHT, NIGHT_EDGE, NIGHT_RAISED,
    SLATE, TEAL, TEXT_HI, TEXT_LOW, TEXT_MID, VIOLET,
};

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
        #[serde(default)]
        reason: String,
        #[serde(default)]
        source: String,
        #[serde(default)]
        note: String,
        #[serde(default)]
        cage: Option<CageInfo>,
        #[serde(default)]
        visceral: Option<VisceralBars>,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct VisceralBars {
    #[serde(default)]
    stress: f32,
    #[serde(default)]
    energy: f32,
    #[serde(default)]
    affinity: f32,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct CageInfo {
    #[serde(default)]
    findings: Vec<CageFinding>,
    #[serde(default)]
    powers: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct CageFinding {
    #[serde(default)]
    path: String,
    #[serde(default)]
    barrier: String,
    #[serde(default)]
    hint: String,
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
    reason: String,
    source: String,
    note: String,
    cage: Option<CageInfo>,
    bars: VisceralBars,
}

fn default_sock() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Library/Application Support/Fluxa/anima.sock")
}

/// Tiny 2px-high visceral bar with a small label.
fn bar(ui: &mut egui::Ui, label: &str, value: f32, color: egui::Color32) {
    ui.label(egui::RichText::new(label).small().color(TEXT_LOW));
    let w = 56.0;
    let h = 3.0;
    let (rect, _) = ui.allocate_exact_size(egui::vec2(w, h), egui::Sense::hover());
    let v = value.clamp(0.0, 1.0);
    ui.painter().rect_filled(rect, 1.5, NIGHT_EDGE);
    if v > 0.0 {
        let filled = egui::Rect::from_min_size(rect.min, egui::vec2(w * v, h));
        ui.painter().rect_filled(filled, 1.5, color);
    }
    ui.add_space(10.0);
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
                                                reason: v
                                                    .get("reason")
                                                    .and_then(|x| x.as_str())
                                                    .unwrap_or("")
                                                    .into(),
                                                source: v
                                                    .get("source")
                                                    .and_then(|x| x.as_str())
                                                    .unwrap_or("")
                                                    .into(),
                                                note: v
                                                    .get("note")
                                                    .and_then(|x| x.as_str())
                                                    .unwrap_or("")
                                                    .into(),
                                                cage: v
                                                    .get("cage")
                                                    .and_then(|x| {
                                                        serde_json::from_value::<CageInfo>(
                                                            x.clone(),
                                                        )
                                                        .ok()
                                                    }),
                                                visceral: v
                                                    .get("visceral")
                                                    .and_then(|x| {
                                                        serde_json::from_value::<VisceralBars>(
                                                            x.clone(),
                                                        )
                                                        .ok()
                                                    }),
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
                Inbound::Visceral {
                    thought,
                    action,
                    reason,
                    source,
                    note,
                    cage,
                    visceral,
                } => {
                    self.visceral.action = action;
                    self.visceral.thought = thought;
                    if !reason.is_empty() {
                        self.visceral.reason = reason;
                    }
                    if !source.is_empty() {
                        self.visceral.source = source;
                    }
                    if !note.is_empty() {
                        self.visceral.note = note;
                    }
                    if cage.is_some() {
                        self.visceral.cage = cage;
                    }
                    if let Some(b) = visceral {
                        self.visceral.bars = b;
                    }
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
        accent_for(&self.visceral.action)
    }
}

impl eframe::App for SomaApp {
    /// Opaque clear: full night background (the default is semi-transparent → terminal black).
    fn clear_color(&self, _visuals: &egui::Visuals) -> [f32; 4] {
        NIGHT.to_normalized_gamma_f32()
    }

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
        egui::Panel::top("top")
            .frame(
                egui::Frame::new()
                    .fill(NIGHT_RAISED)
                    .inner_margin(egui::Margin::symmetric(14, 10))
                    .stroke(egui::Stroke::new(1.0, NIGHT_EDGE)),
            )
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    // State dot (pulsing subtly when she is typing)
                    let dot_r = 4.5;
                    let dot = egui::pos2(ui.cursor().left() + dot_r, ui.cursor().top() + dot_r);
                    ui.painter().circle_filled(dot, dot_r, accent);
                    if self.waiting_reply {
                        ui.painter().circle_stroke(
                            dot,
                            dot_r + 2.5,
                            egui::Stroke::new(1.5, accent),
                        );
                    }
                    ui.add_space(14.0);
                    ui.label(
                        egui::RichText::new("Fluxa · soma")
                            .heading()
                            .strong()
                            .color(TEXT_HI),
                    );
                    ui.separator();
                    ui.label(
                        egui::RichText::new(if self.visceral.action.is_empty() {
                            "veille"
                        } else {
                            &self.visceral.action
                        })
                        .strong()
                        .color(accent),
                    );
                    if self.waiting_reply {
                        ui.add_space(4.0);
                        ui.spinner();
                        ui.label(egui::RichText::new("elle ecrit").small().color(TEXT_MID));
                    }
                });

                // Visceral bars (stress / energy / affinity)
                let b = &self.visceral.bars;
                if b.stress > 0.0 || b.energy > 0.0 || b.affinity > 0.0 {
                    ui.add_space(6.0);
                    ui.horizontal(|ui| {
                        bar(ui, "stress", b.stress, if b.stress > 0.6 { AMBER } else { TEAL });
                        bar(ui, "energy", b.energy, CYAN);
                        bar(ui, "affinity", b.affinity, VIOLET);
                    });
                }

                // Living thought
                if !self.visceral.thought.is_empty() {
                    ui.add_space(6.0);
                    ui.label(
                        egui::RichText::new(format!("❝ {}", self.visceral.thought))
                            .small()
                            .color(TEXT_MID)
                            .italics(),
                    );
                }

                // Meta chips (source · reason · note)
                let mut meta: Vec<String> = Vec::new();
                if !self.visceral.source.is_empty() {
                    meta.push(format!("src {}", self.visceral.source));
                }
                if !self.visceral.reason.is_empty() {
                    meta.push(self.visceral.reason.clone());
                }
                if !self.visceral.note.is_empty() {
                    meta.push(self.visceral.note.clone());
                }
                if !meta.is_empty() {
                    ui.add_space(4.0);
                    ui.label(
                        egui::RichText::new(meta.join(" · "))
                            .small()
                            .color(TEXT_LOW),
                    );
                }

                // Cage inspection findings
                if let Some(cage) = &self.visceral.cage {
                    let n = cage.findings.len();
                    if n > 0 {
                        ui.add_space(6.0);
                        ui.label(
                            egui::RichText::new(format!("cage: {n} barriere(s)"))
                                .small()
                                .color(AMBER)
                                .strong(),
                        );
                        for f in cage.findings.iter().take(6) {
                            ui.horizontal(|ui| {
                                ui.label(
                                    egui::RichText::new(format!("• {}", f.barrier))
                                        .small()
                                        .color(TEXT_MID),
                                );
                                ui.label(
                                    egui::RichText::new(format!("— {}", f.hint))
                                        .small()
                                        .color(TEXT_LOW),
                                );
                            });
                            if !f.path.is_empty() {
                                ui.label(
                                    egui::RichText::new(f.path.as_str())
                                        .small()
                                        .color(TEXT_LOW),
                                );
                            }
                        }
                    }
                    if let Some(pw) = &cage.powers {
                        if !pw.is_empty() {
                            ui.label(
                                egui::RichText::new(format!("pouvoirs: {}", pw.join(" · ")))
                                    .small()
                                    .color(TEXT_LOW),
                            );
                        }
                    }
                }
            });

        egui::Panel::bottom("input")
            .frame(
                egui::Frame::new()
                    .fill(NIGHT_RAISED)
                    .inner_margin(egui::Margin::symmetric(14, 10))
                    .stroke(egui::Stroke::new(1.0, NIGHT_EDGE)),
            )
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    let edit = ui.add(
                        egui::TextEdit::multiline(&mut self.draft)
                            .desired_rows(2)
                            .desired_width((ui.available_width() - 110.0).max(120.0))
                            .hint_text("Parle-lui…  (Enter envoyer · Shift+Enter ligne)"),
                    );
                    let enter =
                        ui.input(|i| i.key_pressed(egui::Key::Enter) && !i.modifiers.shift);
                    if enter && edit.has_focus() {
                        self.send_draft();
                    }
                    let busy = self.waiting_reply;
                    let btn = egui::Button::new(
                        egui::RichText::new(if busy { "…" } else { "Envoyer" })
                            .strong()
                            .color(TEXT_HI),
                    )
                    .fill(tint(accent, 0.35))
                    .corner_radius(8.0)
                    .min_size(egui::vec2(84.0, 40.0));
                    if ui.add_enabled(!busy, btn).clicked() {
                        self.send_draft();
                    }
                });
            });

        egui::CentralPanel::default()
            .frame(egui::Frame::new().fill(NIGHT))
            .show(ui, |ui| {
                egui::ScrollArea::vertical()
                    .auto_shrink([false; 2])
                    .stick_to_bottom(true)
                    .show(ui, |ui| {
                        ui.add_space(8.0);
                        for line in &self.log {
                            self.push_bubble(ui, line, accent);
                        }
                        if self.scroll_to_bottom {
                            ui.scroll_to_cursor(Some(egui::Align::BOTTOM));
                            self.scroll_to_bottom = false;
                        }
                        ui.add_space(8.0);
                    });
            });
    }
}

impl SomaApp {
    /// Render one log line as a rounded bubble.
    fn push_bubble(&self, ui: &mut egui::Ui, line: &LogLine, accent: egui::Color32) {
        let is_pulse = line.kind.as_deref() == Some("pulse");
        let body = if line.typing {
            format!("{}▌", line.shown)
        } else {
            line.shown.clone()
        };

        // System lines: plain centered text, no bubble.
        if line.role == "system" {
            ui.add_space(2.0);
            ui.vertical_centered(|ui| {
                ui.label(egui::RichText::new(body).small().color(TEXT_LOW).italics());
            });
            ui.add_space(2.0);
            return;
        }

        let align_right = line.role == "human";
        let (who, who_color) = if align_right {
            ("Toi", TEXT_MID)
        } else if is_pulse {
            ("Anima·pense", SLATE)
        } else {
            ("Anima", accent)
        };
        let fill = if is_pulse {
            NIGHT_RAISED
        } else if align_right {
            egui::Color32::from_rgb(50, 54, 66)
        } else {
            tint(accent, 0.22)
        };
        let text_color = if is_pulse { TEXT_MID } else { TEXT_HI };

        let mut rich = egui::RichText::new(body).color(text_color);
        if is_pulse {
            rich = rich.italics();
        }

        // Bubble width: capped at 78% of the panel, floor 120px, never negative.
        let avail = ui.available_width().max(0.0);
        let max_w = (avail * 0.78).max(120.0).min(avail.max(120.0));

        let frame = egui::Frame::new()
            .fill(fill)
            .corner_radius(egui::CornerRadius::same(10))
            .inner_margin(egui::Margin::symmetric(12, 7))
            .stroke(egui::Stroke::new(1.0, NIGHT_EDGE));

        // Align via layout (never negative spacers).
        let layout = if align_right {
            egui::Layout::right_to_left(egui::Align::Min)
        } else {
            egui::Layout::left_to_right(egui::Align::Min)
        };

        ui.with_layout(layout, |ui| {
            ui.set_max_width(max_w);
            frame.show(ui, |ui| {
                ui.set_max_width(max_w);
                ui.add(egui::Label::new(rich).wrap());
            });
        });

        // Author under the bubble.
        ui.with_layout(layout, |ui| {
            ui.label(egui::RichText::new(who).small().color(who_color).strong());
            if let Some(a) = &line.action {
                if !a.is_empty() {
                    ui.label(
                        egui::RichText::new(format!("· {a}"))
                            .small()
                            .color(TEXT_LOW),
                    );
                }
            }
        });
        ui.add_space(8.0);
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
            .with_inner_size([880.0, 640.0])
            .with_min_inner_size([640.0, 480.0])
            .with_title("Fluxa · soma"),
        renderer: eframe::Renderer::Wgpu,
        ..Default::default()
    };

    eframe::run_native(
        "Fluxa · soma",
        options,
        Box::new(move |cc| {
            let ctx = &cc.egui_ctx;
            install_fonts(ctx);
            ctx.set_visuals(fluxa_visuals());
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
