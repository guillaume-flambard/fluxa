//! Fluxa soma visual identity: palette, fonts, egui theme.
//! Stays on egui; no new deps. Fonts are loaded from the macOS system.

use std::path::Path;

use egui::style::{Selection, Widgets, WidgetVisuals};
use egui::{
    Color32, Context, CornerRadius, FontDefinitions, FontFamily, FontId, Stroke, TextStyle,
    Visuals,
};

// ---- Fluxa palette (docs/anima-core.md phases) ----
pub const CYAN: Color32 = Color32::from_rgb(40, 190, 200); // symbiosis / speak
pub const TEAL: Color32 = Color32::from_rgb(46, 138, 148); // think / read
pub const VIOLET: Color32 = Color32::from_rgb(150, 120, 220); // dream / reverse / invent
pub const AMBER: Color32 = Color32::from_rgb(224, 123, 58); // friction
pub const RED: Color32 = Color32::from_rgb(176, 66, 79); // refuse / stress
pub const SLATE: Color32 = Color32::from_rgb(95, 104, 122); // neutral

// ---- Surfaces (deep night, organic) ----
pub const NIGHT: Color32 = Color32::from_rgb(14, 16, 22);
pub const NIGHT_RAISED: Color32 = Color32::from_rgb(21, 24, 32);
pub const NIGHT_EDGE: Color32 = Color32::from_rgb(34, 38, 50);
pub const TEXT_HI: Color32 = Color32::from_rgb(232, 230, 224);
pub const TEXT_MID: Color32 = Color32::from_rgb(176, 180, 190);
pub const TEXT_LOW: Color32 = Color32::from_rgb(110, 116, 132);

/// Accent color for a sovereign action (mirrors the Fluxa phase map).
pub fn accent_for(action: &str) -> Color32 {
    match action {
        "speak" => CYAN,
        "silence" => SLATE,
        "refuse" => RED,
        "invent" | "autocode" | "reverse" | "mutate" => VIOLET,
        "think" | "read" | "write_note" => TEAL,
        _ => SLATE,
    }
}

/// Alpha-blend a color over the night background.
pub fn tint(color: Color32, alpha: f32) -> Color32 {
    let a = alpha.clamp(0.0, 1.0);
    let r = color.r() as f32;
    let g = color.g() as f32;
    let b = color.b() as f32;
    let bg = [NIGHT.r() as f32, NIGHT.g() as f32, NIGHT.b() as f32];
    Color32::from_rgb(
        ((r * a + bg[0] * (1.0 - a)).round() as u8).clamp(0, 255),
        ((g * a + bg[1] * (1.0 - a)).round() as u8).clamp(0, 255),
        ((b * a + bg[2] * (1.0 - a)).round() as u8).clamp(0, 255),
    )
}

/// Load a system font file into FontDefinitions if it exists.
fn install_system_font(
    fonts: &mut FontDefinitions,
    path: &str,
    name: &str,
    family: FontFamily,
) {
    let p = Path::new(path);
    if !p.exists() {
        return;
    }
    if let Ok(bytes) = std::fs::read(p) {
        fonts.font_data.insert(
            name.to_string(),
            egui::FontData::from_owned(bytes).into(),
        );
        if let Some(list) = fonts.families.get_mut(&family) {
            list.insert(0, name.to_string());
        }
    }
}

/// Install SF Pro (proportional) + Menlo (monospace) from the system.
pub fn install_fonts(ctx: &Context) {
    let mut fonts = FontDefinitions::default();
    install_system_font(
        &mut fonts,
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "sfpro",
        FontFamily::Proportional,
    );
    install_system_font(
        &mut fonts,
        "/System/Library/Fonts/Menlo.ttc",
        "menlo",
        FontFamily::Monospace,
    );
    ctx.set_fonts(fonts);

    // Slightly larger, airier body text.
    ctx.style_mut_of(egui::Theme::Dark, |style| {
        style.text_styles.insert(TextStyle::Heading, FontId::new(20.0, FontFamily::Proportional));
        style.text_styles.insert(TextStyle::Body, FontId::new(14.0, FontFamily::Proportional));
        style.text_styles.insert(TextStyle::Button, FontId::new(14.0, FontFamily::Proportional));
        style.text_styles.insert(TextStyle::Small, FontId::new(11.5, FontFamily::Proportional));
        style.text_styles.insert(TextStyle::Monospace, FontId::new(13.0, FontFamily::Monospace));
    });
}

fn widget(
    bg_fill: Color32,
    weak_bg_fill: Color32,
    fg: Color32,
    corner: u8,
) -> WidgetVisuals {
    WidgetVisuals {
        bg_fill,
        weak_bg_fill,
        bg_stroke: Stroke::new(1.0, NIGHT_EDGE),
        corner_radius: CornerRadius::same(corner),
        fg_stroke: Stroke::new(1.0, fg),
        expansion: 0.0,
    }
}

/// Full Fluxa dark theme.
pub fn fluxa_visuals() -> Visuals {
    let noninteractive = widget(NIGHT_RAISED, Color32::TRANSPARENT, TEXT_MID, 8);
    let inactive = widget(NIGHT_RAISED, Color32::TRANSPARENT, TEXT_HI, 8);
    let hovered = widget(tint(CYAN, 0.16), tint(CYAN, 0.1), TEXT_HI, 8);
    let active = widget(tint(CYAN, 0.24), tint(CYAN, 0.16), TEXT_HI, 8);
    let open = widget(tint(VIOLET, 0.2), tint(VIOLET, 0.12), TEXT_HI, 8);

    Visuals {
        dark_mode: true,
        override_text_color: Some(TEXT_HI),
        weak_text_alpha: 0.62,
        widgets: Widgets {
            noninteractive,
            inactive,
            hovered,
            active,
            open,
        },
        selection: Selection {
            bg_fill: tint(CYAN, 0.5),
            stroke: Stroke::NONE,
        },
        extreme_bg_color: NIGHT,
        text_edit_bg_color: Some(NIGHT_RAISED),
        code_bg_color: tint(VIOLET, 0.12),
        warn_fg_color: AMBER,
        error_fg_color: RED,
        window_corner_radius: CornerRadius::same(14),
        window_fill: NIGHT,
        window_stroke: Stroke::new(1.0, NIGHT_EDGE),
        window_highlight_topmost: true,
        panel_fill: NIGHT,
        ..Visuals::dark()
    }
}
