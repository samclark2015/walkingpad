use btleplug::api::{Central, Manager as _, Peripheral as _, ScanFilter, WriteType};
use btleplug::platform::{Manager, Peripheral};
use futures::StreamExt;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use super::protocol::{parse_notification, PadMessage, MIN_CMD_GAP_MS};

pub const SERVICE_UUID: Uuid = uuid::uuid!("0000fe00-0000-1000-8000-00805f9b34fb");
pub const CHAR_NOTIFY_UUID: Uuid = uuid::uuid!("0000fe01-0000-1000-8000-00805f9b34fb");
pub const CHAR_WRITE_UUID: Uuid = uuid::uuid!("0000fe02-0000-1000-8000-00805f9b34fb");

#[derive(Debug, thiserror::Error)]
pub enum BleError {
    #[error("BLE manager error: {0}")]
    Manager(#[from] btleplug::Error),
    #[error("No BLE adapter found")]
    NoAdapter,
    #[error("Device not found: {0}")]
    DeviceNotFound(String),
    #[error("Not connected")]
    NotConnected,
    #[error("Write characteristic not found")]
    WriteCharNotFound,
    #[error("Notify characteristic not found")]
    NotifyCharNotFound,
    #[error("Send error")]
    SendError,
}

impl serde::Serialize for BleError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
}

#[derive(Clone)]
pub struct CmdSender(pub mpsc::UnboundedSender<Vec<u8>>);

impl CmdSender {
    pub fn send(&self, cmd: Vec<u8>) -> Result<(), BleError> {
        self.0.send(cmd).map_err(|_| BleError::SendError)
    }
}

pub struct PadConnection {
    pub cmd_tx: CmdSender,
    pub peripheral: Peripheral,
}

pub type SharedConnection = Arc<Mutex<Option<PadConnection>>>;

pub fn new_shared_connection() -> SharedConnection {
    Arc::new(Mutex::new(None))
}

pub async fn scan_devices(timeout_secs: f64) -> Result<Vec<DeviceInfo>, BleError> {
    log::info!("scan_devices: scanning for {timeout_secs}s");
    let manager = Manager::new().await?;
    let adapters = manager.adapters().await?;
    let adapter = adapters.into_iter().next().ok_or(BleError::NoAdapter)?;

    adapter.start_scan(ScanFilter { services: vec![SERVICE_UUID] }).await?;
    tokio::time::sleep(Duration::from_secs_f64(timeout_secs)).await;
    adapter.stop_scan().await?;

    let peripherals = adapter.peripherals().await?;
    log::info!("scan_devices: found {} peripheral(s) total", peripherals.len());
    let mut results = Vec::new();
    for p in peripherals {
        if let Some(props) = p.properties().await? {
            let name = props.local_name.clone().unwrap_or_else(|| "Unknown".to_string());
            log::debug!("  peripheral: id={} name={name} services={:?}", p.id(), props.services);
            let has_service = props.services.contains(&SERVICE_UUID);
            let name_matches = name.to_lowercase().contains("walkingpad");
            if has_service || name_matches {
                log::info!("  -> keeping: {name}");
                results.push(DeviceInfo { id: p.id().to_string(), name });
            }
        }
    }
    log::info!("scan_devices: returning {} candidate(s)", results.len());
    Ok(results)
}

pub async fn connect(
    shared: SharedConnection,
    device_id: &str,
    event_tx: mpsc::UnboundedSender<PadMessage>,
) -> Result<(), BleError> {
    log::info!("connect: starting, device_id={device_id}");
    let manager = Manager::new().await?;
    let adapters = manager.adapters().await?;
    let adapter = adapters.into_iter().next().ok_or(BleError::NoAdapter)?;

    log::info!("connect: scanning 3 s to locate device...");
    adapter.start_scan(ScanFilter { services: vec![SERVICE_UUID] }).await?;
    tokio::time::sleep(Duration::from_secs(3)).await;
    adapter.stop_scan().await?;

    let peripherals = adapter.peripherals().await?;
    log::info!("connect: {} peripheral(s) visible", peripherals.len());
    for p in &peripherals {
        log::debug!("  visible: {}", p.id());
    }

    let peripheral = peripherals
        .into_iter()
        .find(|p| p.id().to_string() == device_id)
        .ok_or_else(|| BleError::DeviceNotFound(device_id.to_string()))?;

    log::info!("connect: found peripheral, connecting...");
    peripheral.connect().await?;
    log::info!("connect: connected, discovering services...");
    peripheral.discover_services().await?;

    let chars = peripheral.characteristics();
    log::info!("connect: {} characteristic(s) discovered", chars.len());
    for c in &chars {
        log::debug!("  char: {} props={:?}", c.uuid, c.properties);
    }

    let write_char = chars.iter().find(|c| c.uuid == CHAR_WRITE_UUID).cloned()
        .ok_or(BleError::WriteCharNotFound)?;
    let notify_char = chars.iter().find(|c| c.uuid == CHAR_NOTIFY_UUID).cloned()
        .ok_or(BleError::NotifyCharNotFound)?;

    log::info!("connect: subscribing to notify char {}", notify_char.uuid);
    peripheral.subscribe(&notify_char).await?;
    log::info!("connect: subscribed OK");

    // ── Notification reader ───────────────────────────────────────────────
    let periph_for_notif = peripheral.clone();
    tokio::spawn(async move {
        log::info!("notif_task: started");
        let stream = periph_for_notif.notifications().await;
        match stream {
            Err(e) => { log::error!("notif_task: failed to get stream: {e}"); }
            Ok(mut s) => {
                log::info!("notif_task: stream open, waiting for notifications...");
                while let Some(notif) = s.next().await {
                    log::info!(
                        "notif_task: {} bytes on char {}: {:02x?}",
                        notif.value.len(), notif.uuid, notif.value
                    );
                    match parse_notification(&notif.value) {
                        Some(msg) => {
                            log::info!("notif_task: parsed OK -> sending to event channel");
                            if event_tx.send(msg).is_err() {
                                log::error!("notif_task: event_tx closed, exiting");
                                break;
                            }
                        }
                        None => {
                            log::warn!("notif_task: parse_notification returned None for {:02x?}", notif.value);
                        }
                    }
                }
                log::warn!("notif_task: stream ended (device disconnected?)");
            }
        }
    });

    // ── Rate-limited writer ───────────────────────────────────────────────
    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let periph_for_write = peripheral.clone();
    tokio::spawn(async move {
        log::info!("writer_task: started");
        let gap = Duration::from_millis(MIN_CMD_GAP_MS);
        let mut last_write = Instant::now() - gap * 2;
        while let Some(cmd) = cmd_rx.recv().await {
            let elapsed = last_write.elapsed();
            if elapsed < gap {
                let wait = gap - elapsed;
                log::debug!("writer_task: rate-limiting, sleeping {}ms", wait.as_millis());
                tokio::time::sleep(wait).await;
            }
            log::info!("writer_task: writing {} bytes: {:02x?}", cmd.len(), cmd);
            match periph_for_write.write(&write_char, &cmd, WriteType::WithoutResponse).await {
                Ok(_) => { log::info!("writer_task: write OK"); }
                Err(e) => { log::error!("writer_task: write error: {e}"); break; }
            }
            last_write = Instant::now();
        }
        log::warn!("writer_task: channel closed, exiting");
    });

    *shared.lock().await = Some(PadConnection {
        cmd_tx: CmdSender(cmd_tx),
        peripheral,
    });
    log::info!("connect: done, connection stored");
    Ok(())
}

pub async fn disconnect(shared: SharedConnection) -> Result<(), BleError> {
    log::info!("disconnect: called");
    let mut guard = shared.lock().await;
    if let Some(conn) = guard.take() {
        let _ = conn.peripheral.disconnect().await;
        log::info!("disconnect: done");
    } else {
        log::warn!("disconnect: no active connection");
    }
    Ok(())
}
