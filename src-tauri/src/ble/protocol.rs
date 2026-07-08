/// WalkingPad BLE binary protocol — encode commands, decode notifications.
///
/// All packets: [header1] [header2] [payload...] [checksum] [0xFD]
/// Checksum = sum(packet[1..-2]) % 256
/// See SPEC.md for full documentation.

// ─── Constants ───────────────────────────────────────────────────────────────

pub const SUFFIX: u8 = 0xFD;

pub const HEADER_CMD: u8 = 0xF7;
pub const HEADER_NOTIFY: u8 = 0xF8;

pub const MSG_CUR_STATUS: u8 = 0xA2;
pub const MSG_LAST_STATUS: u8 = 0xA7;

pub const MODE_AUTOMAT: u8 = 0;
pub const MODE_MANUAL: u8 = 1;
pub const MODE_STANDBY: u8 = 2;

pub const BELT_STATE_RUNNING: u8 = 1;
pub const BELT_STATE_STANDBY: u8 = 5;

pub const BUTTON_NONE: u8 = 0;
pub const BUTTON_UP: u8 = 2;
pub const BUTTON_STOP: u8 = 3;
pub const BUTTON_DOWN: u8 = 4;

/// Minimum milliseconds between consecutive BLE writes (from reference impl).
pub const MIN_CMD_GAP_MS: u64 = 690;

/// Typical poll interval for ask_stats.
pub const POLL_INTERVAL_MS: u64 = 750;

/// Speed range: 0.5–6.0 km/h as raw ×10 values.
pub const SPEED_MIN: u8 = 5;
pub const SPEED_MAX: u8 = 60;

// ─── Packet builders ─────────────────────────────────────────────────────────

fn checksum(packet: &[u8]) -> u8 {
    // sum of bytes[1..-2] mod 256  (last two bytes are checksum + 0xFD)
    let body = &packet[1..packet.len() - 2];
    body.iter().map(|&b| b as u32).sum::<u32>() as u8
}

fn finalize(mut packet: Vec<u8>) -> Vec<u8> {
    let cs = checksum(&packet);
    let last = packet.len() - 2;
    packet[last] = cs;
    packet
}

/// Request current status (belt replies with CurStatus notification).
pub fn ask_stats() -> Vec<u8> {
    vec![0xF7, 0xA2, 0x00, 0x00, 0xA2, 0xFD]
}

/// Request last stored session (belt replies with LastStatus notification).
/// `mode = 0` is the standard request; `mode = 1` is an alternate.
pub fn ask_hist(mode: u8) -> Vec<u8> {
    match mode {
        1 => vec![0xF7, 0xA7, 0xAA, 0x00, 0x51, 0xFD],
        _ => vec![0xF7, 0xA7, 0xAA, 0xFF, 0x50, 0xFD],
    }
}

/// Set belt speed. `speed` = km/h × 10 (5–60). 0 stops the belt.
pub fn change_speed(speed: u8) -> Vec<u8> {
    finalize(vec![0xF7, 0xA2, 0x01, speed, 0xFF, 0xFD])
}

/// Stop the belt (alias for change_speed(0)).
pub fn stop_belt() -> Vec<u8> {
    change_speed(0)
}

/// Start the belt. Must call switch_mode(MODE_MANUAL) first and wait ≥1.5s.
pub fn start_belt() -> Vec<u8> {
    finalize(vec![0xF7, 0xA2, 0x04, 0x01, 0xFF, 0xFD])
}

/// Switch operating mode (0=auto, 1=manual, 2=standby).
pub fn switch_mode(mode: u8) -> Vec<u8> {
    finalize(vec![0xF7, 0xA2, 0x02, mode, 0xFF, 0xFD])
}

/// Set a preference via array payload.
pub fn set_pref_arr(key: u8, arr: &[u8]) -> Vec<u8> {
    let mut packet = vec![0xF7, 0xA6, key];
    packet.extend_from_slice(arr);
    packet.push(0xAC); // checksum placeholder
    packet.push(0xFD);
    finalize(packet)
}

/// Encode an integer as 3-byte big-endian.
pub fn int_to_3bytes(val: u32) -> [u8; 3] {
    [
        ((val >> 16) & 0xFF) as u8,
        ((val >> 8) & 0xFF) as u8,
        (val & 0xFF) as u8,
    ]
}

/// Set a preference via integer value.
pub fn set_pref_int(key: u8, val: u32, stype: u8) -> Vec<u8> {
    let bytes = int_to_3bytes(val);
    set_pref_arr(key, &[stype, bytes[0], bytes[1], bytes[2]])
}

pub fn set_pref_max_speed(speed: u8) -> Vec<u8> {
    set_pref_int(3, speed as u32, 0)
}

pub fn set_pref_start_speed(speed: u8) -> Vec<u8> {
    set_pref_int(4, speed as u32, 0)
}

pub fn set_pref_inteli(enabled: bool) -> Vec<u8> {
    set_pref_int(5, enabled as u32, 0)
}

pub fn set_pref_sensitivity(sensitivity: u8) -> Vec<u8> {
    set_pref_int(6, sensitivity as u32, 0)
}

pub fn set_pref_display(bit_mask: u32) -> Vec<u8> {
    set_pref_int(7, bit_mask, 0)
}

pub fn set_pref_units_miles(enabled: bool) -> Vec<u8> {
    set_pref_int(8, enabled as u32, 0)
}

pub fn set_pref_child_lock(enabled: bool) -> Vec<u8> {
    set_pref_int(9, enabled as u32, 0)
}

pub fn set_pref_target(target_type: u8, value: u32) -> Vec<u8> {
    let bytes = int_to_3bytes(value);
    set_pref_arr(1, &[target_type, bytes[0], bytes[1], bytes[2]])
}

/// Beep / diagnostic probe command.
pub fn cmd_beep() -> Vec<u8> {
    vec![0xF7, 0xA2, 0x03, 0x07, 0xAC, 0xFD]
}

// ─── Notification parsing ────────────────────────────────────────────────────

fn bytes_to_u32(b: &[u8]) -> u32 {
    (b[0] as u32) * 65536 + (b[1] as u32) * 256 + b[2] as u32
}

/// Current running status decoded from a BLE notification.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CurStatus {
    /// Raw belt state (1=running, 5=standby).
    pub belt_state: u8,
    /// Speed in km/h (raw ÷ 10).
    pub speed_kmh: f32,
    /// True when in manual mode.
    pub manual_mode: bool,
    /// Elapsed seconds this session.
    pub time_secs: u32,
    /// Distance in km (raw ÷ 100).
    pub dist_km: f32,
    /// Step count.
    pub steps: u32,
    /// Last app-commanded speed in km/h (raw ÷ 30).
    pub app_speed_kmh: f32,
    /// Last physical button pressed.
    pub controller_button: u8,
}

/// Last stored session record decoded from a BLE notification.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LastStatus {
    pub time_secs: u32,
    pub dist_km: f32,
    pub steps: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", content = "data")]
pub enum PadMessage {
    CurStatus(CurStatus),
    LastStatus(LastStatus),
}

/// Parse an incoming BLE notification into a `PadMessage`.
/// Returns `None` if the packet is unrecognised or malformed.
pub fn parse_notification(data: &[u8]) -> Option<PadMessage> {
    if data.len() < 4 {
        log::warn!("parse: too short ({} bytes)", data.len());
        return None;
    }
    if data[0] != HEADER_NOTIFY {
        log::warn!("parse: unexpected header byte 0x{:02x}", data[0]);
        return None;
    }
    match data[1] {
        MSG_CUR_STATUS if data.len() >= 20 => {
            // 20-byte packet: checksum = sum(data[1..18]) % 256, stored at data[18], suffix 0xFD at data[19]
            let cs: u8 = data[1..18].iter().map(|&b| b as u32).sum::<u32>() as u8;
            if cs != data[18] {
                log::warn!("parse: CurStatus checksum mismatch: computed 0x{:02x} got 0x{:02x}", cs, data[18]);
                return None;
            }
            Some(PadMessage::CurStatus(CurStatus {
                belt_state: data[2],
                speed_kmh: data[3] as f32 / 10.0,
                manual_mode: data[4] == 1,
                time_secs: bytes_to_u32(&data[5..8]),
                dist_km: bytes_to_u32(&data[8..11]) as f32 / 100.0,
                steps: bytes_to_u32(&data[11..14]),
                app_speed_kmh: data[14] as f32 / 30.0,
                controller_button: data[16],
            }))
        }
        MSG_LAST_STATUS if data.len() >= 17 => {
            Some(PadMessage::LastStatus(LastStatus {
                time_secs: bytes_to_u32(&data[8..11]),
                dist_km: bytes_to_u32(&data[11..14]) as f32 / 100.0,
                steps: bytes_to_u32(&data[14..17]),
            }))
        }
        _ => None,
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ask_stats_known_bytes() {
        assert_eq!(ask_stats(), vec![0xF7, 0xA2, 0x00, 0x00, 0xA2, 0xFD]);
    }

    #[test]
    fn change_speed_25() {
        let cmd = change_speed(25);
        assert_eq!(cmd[3], 25);
        assert_eq!(*cmd.last().unwrap(), 0xFD);
        // checksum: sum(cmd[1..4]) % 256 = (0xA2+0x01+0x19) % 256
        let expected_cs: u8 = (0xA2u32 + 0x01 + 0x19) as u8;
        assert_eq!(cmd[4], expected_cs);
    }

    #[test]
    fn parse_example_notification() {
        // Real packet layout: 20 bytes, checksum at [18], suffix 0xfd at [19]
        let raw = vec![
            0xf8, 0xa2, 0x01, 0x0f, 0x01, 0x00, 0x0f, 0xd1, 0x00, 0x00, 0xab, 0x00, 0x12, 0xae,
            0x3c, 0x00, 0x00, 0x00, 0x00, 0xfd,
        ];
        // Patch in the correct checksum at index 18
        let cs: u8 = raw[1..18].iter().map(|&b| b as u32).sum::<u32>() as u8;
        let mut packet = raw.clone();
        packet[18] = cs;
        let msg = parse_notification(&packet).expect("should parse");
        if let PadMessage::CurStatus(s) = msg {
            assert!((s.speed_kmh - 1.5).abs() < 0.01);
            assert_eq!(s.steps, 4782);
            assert!(s.manual_mode);
        } else {
            panic!("wrong variant");
        }
    }

    #[test]
    fn parse_real_packet() {
        // Actual packet captured from device
        let packet = vec![
            0xf8, 0xa2, 0x01, 0x1e, 0x01, 0x00, 0x01, 0x3e, 0x00, 0x00, 0x17, 0x00, 0x01, 0xaa,
            0x1e, 0x00, 0x03, 0x00, 0xe4, 0xfd,
        ];
        let msg = parse_notification(&packet).expect("real packet should parse");
        if let PadMessage::CurStatus(s) = msg {
            assert!((s.speed_kmh - 3.0).abs() < 0.01); // 0x1e = 30 -> 3.0 km/h
            assert!(s.manual_mode);
            assert_eq!(s.belt_state, 1); // running
        } else {
            panic!("wrong variant");
        }
    }
}
