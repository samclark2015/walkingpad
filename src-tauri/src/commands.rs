use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

use crate::ble::connection::{self, DeviceInfo};
use crate::ble::protocol::{self, PadMessage};
use crate::state::AppState;

// ─── Helper: send a command through the write channel ────────────────────────

/// Clones the sender out of the shared connection (requires only a brief lock)
/// and sends the command. Returns an error string if not connected.
async fn send(state: &AppState, cmd: Vec<u8>) -> Result<(), String> {
    let guard = state.connection.lock().await;
    let conn = guard.as_ref().ok_or("Not connected")?;
    conn.cmd_tx.send(cmd).map_err(|e| e.to_string())
}

// ─── Device commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn scan_devices(timeout_secs: Option<f64>) -> Result<Vec<DeviceInfo>, String> {
    connection::scan_devices(timeout_secs.unwrap_or(5.0))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn connect_device(
    address: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let tx = state.event_tx.clone();

    // Drain the notification channel and forward as Tauri events.
    let app_clone = app.clone();
    let rx = state.event_rx.clone();
    tokio::spawn(async move {
        log::info!("event_emitter: started");
        let mut rx = rx.lock().await;
        while let Some(msg) = rx.recv().await {
            match &msg {
                PadMessage::CurStatus(s) => {
                    log::info!("event_emitter: emitting pad:status speed={:.1} belt_state={}", s.speed_kmh, s.belt_state);
                    let _ = app_clone.emit("pad:status", s);
                }
                PadMessage::LastStatus(s) => {
                    log::info!("event_emitter: emitting pad:last-status dist_km={:.2}", s.dist_km);
                    let _ = app_clone.emit("pad:last-status", s);
                }
            }
        }
        log::warn!("event_emitter: channel closed");
    });

    connection::connect(state.connection.clone(), &address, tx)
        .await
        .map_err(|e| e.to_string())?;

    // Poll ask_stats() every 750 ms.
    let conn_ref = state.connection.clone();
    tokio::spawn(async move {
        log::info!("poller: started");
        let interval = std::time::Duration::from_millis(protocol::POLL_INTERVAL_MS);
        loop {
            tokio::time::sleep(interval).await;
            let guard = conn_ref.lock().await;
            match guard.as_ref() {
                Some(conn) => {
                    log::debug!("poller: sending ask_stats");
                    if conn.cmd_tx.send(protocol::ask_stats()).is_err() {
                        log::warn!("poller: cmd_tx closed, exiting");
                        break;
                    }
                }
                None => {
                    log::warn!("poller: connection gone, exiting");
                    break;
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn disconnect_device(state: State<'_, AppState>) -> Result<(), String> {
    connection::disconnect(state.connection.clone())
        .await
        .map_err(|e| e.to_string())
}

// ─── Control commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_belt(state: State<'_, AppState>) -> Result<(), String> {
    // Enqueue switch_mode then start_belt. The writer task handles the 690 ms
    // gap between them; we add an extra delay via a sleep command to honour
    // the ≥1.5 s required before start_belt.
    send(&state, protocol::switch_mode(protocol::MODE_MANUAL)).await?;
    // Queue a sentinel that tells the writer to pause, then start.
    // Simpler: just send start after a 1.5 s sleep here (non-blocking for the
    // writer because the channel is unbounded and the writer queues them).
    // We spawn so this command returns immediately to the frontend.
    let conn_ref = state.connection.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        let guard = conn_ref.lock().await;
        if let Some(conn) = guard.as_ref() {
            let _ = conn.cmd_tx.send(protocol::start_belt());
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn stop_belt(state: State<'_, AppState>) -> Result<(), String> {
    send(&state, protocol::stop_belt()).await?;
    let conn_ref = state.connection.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        let guard = conn_ref.lock().await;
        if let Some(conn) = guard.as_ref() {
            let _ = conn.cmd_tx.send(protocol::switch_mode(protocol::MODE_STANDBY));
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn set_pref_start_speed(speed_x10: u8, state: State<'_, AppState>) -> Result<(), String> {
    if speed_x10 > protocol::SPEED_MAX {
        return Err(format!("Speed {speed_x10} exceeds max {}", protocol::SPEED_MAX));
    }
    send(&state, protocol::set_pref_start_speed(speed_x10)).await
}

#[tauri::command]
pub async fn set_speed(speed_x10: u8, state: State<'_, AppState>) -> Result<(), String> {
    if speed_x10 > protocol::SPEED_MAX {
        return Err(format!("Speed {speed_x10} exceeds max {}", protocol::SPEED_MAX));
    }
    send(&state, protocol::change_speed(speed_x10)).await
}

#[tauri::command]
pub async fn switch_mode(mode: u8, state: State<'_, AppState>) -> Result<(), String> {
    if mode > 2 {
        return Err(format!("Invalid mode {mode}; must be 0, 1, or 2"));
    }
    send(&state, protocol::switch_mode(mode)).await
}

// ─── Metrics commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ask_stats(state: State<'_, AppState>) -> Result<(), String> {
    send(&state, protocol::ask_stats()).await
}

#[tauri::command]
pub async fn ask_hist(state: State<'_, AppState>) -> Result<(), String> {
    send(&state, protocol::ask_hist(0)).await
}

// ─── Update commands ──────────────────────────────────────────────────────────

/// Manually trigger an update check. If an update is available the built-in
/// dialog (dialog:true in tauri.conf.json) will prompt the user automatically.
/// Returns "up-to-date" or "update-available" so the frontend can show brief
/// feedback when no update is found.
#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<String, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(_) => Ok("update-available".to_string()),
        None => Ok("up-to-date".to_string()),
    }
}

#[tauri::command]
pub fn set_tray_title(title: String, app: AppHandle) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(crate::TRAY_ID) {
        let title_opt: Option<&str> = if title.is_empty() { None } else { Some(&title) };
        tray.set_title(title_opt).map_err(|e| e.to_string())
    } else {
        Err("Tray icon not found".to_string())
    }
}
