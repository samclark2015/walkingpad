use serde::{Deserialize, Serialize};

/// Data for saving a completed session.
#[derive(Debug, Deserialize)]
pub struct SessionData {
    pub started_at: i64,   // Unix timestamp
    pub duration_s: i64,   // seconds
    pub dist_m: i64,       // metres  (raw dist * 10, since raw unit = 10 m)
    pub steps: i64,
    pub max_speed: f64,    // km/h
    pub avg_speed: f64,    // km/h
}

/// Summary row returned to the frontend.
#[derive(Debug, Serialize)]
pub struct SessionSummary {
    pub id: i64,
    pub started_at: i64,
    pub duration_s: i64,
    pub dist_m: i64,
    pub steps: i64,
    pub max_speed: f64,
    pub avg_speed: f64,
    pub created_at: i64,
}

// The SQL migration is run via tauri-plugin-sql from lib.rs.
// These functions provide typed Tauri commands that call into the plugin.
// Actual DB access is handled by the JS/TS layer using @tauri-apps/plugin-sql.
// These Rust stubs exist so heavier callers can invoke them directly if needed.
