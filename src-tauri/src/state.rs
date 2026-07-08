use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

use crate::ble::connection::SharedConnection;
use crate::ble::protocol::PadMessage;

/// Global application state held by Tauri's managed state system.
pub struct AppState {
    pub connection: SharedConnection,
    /// Receives parsed BLE notifications forwarded from the connection task.
    pub event_rx: Arc<Mutex<mpsc::UnboundedReceiver<PadMessage>>>,
    /// Clone of the sender so new connections can send to the same channel.
    pub event_tx: mpsc::UnboundedSender<PadMessage>,
}

impl AppState {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        Self {
            connection: crate::ble::connection::new_shared_connection(),
            event_rx: Arc::new(Mutex::new(rx)),
            event_tx: tx,
        }
    }
}
