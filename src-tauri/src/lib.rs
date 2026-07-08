mod ble;
mod commands;
mod db;
mod state;

use commands::{
    ask_hist, ask_stats, connect_device, disconnect_device, scan_devices, set_pref_start_speed,
    set_speed, start_belt, stop_belt, switch_mode,
};
use state::AppState;
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_positioner::{Position, WindowExt};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(
                    "sqlite:walkingpad.db",
                    vec![tauri_plugin_sql::Migration {
                        version: 1,
                        description: "create sessions table",
                        sql: include_str!("../migrations/001_init.sql"),
                        kind: tauri_plugin_sql::MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            scan_devices,
            connect_device,
            disconnect_device,
            start_belt,
            stop_belt,
            set_speed,
            set_pref_start_speed,
            switch_mode,
            ask_stats,
            ask_hist,
        ])
        .setup(|app| {
            // Build the tray icon (embedded at compile time)
            let icon_bytes = include_bytes!("../icons/tray-icon.png");
            let icon = tauri::image::Image::from_bytes(icon_bytes)
                .expect("tray icon");

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .icon_as_template(true) // macOS: treat as template image (auto dark/light)
                .tooltip("WalkingPad")
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.move_window(Position::TrayBottomCenter);
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        // Intercept window close → hide instead of quit
        .on_window_event(|win, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = win.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
