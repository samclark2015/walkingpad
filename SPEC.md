# WalkingPad BLE Protocol Specification

Reverse-engineered from the [ph4-walkingpad](https://github.com/ph4r05/ph4-walkingpad) Python library (v1.0.2, MIT licence).  
Primary source: `ph4_walkingpad/pad.py`.

Tested hardware: **KingSmith WalkingPad A1**, **R1 PRO**. Other KingSmith/WalkingPad models using the same BLE service UUIDs are likely compatible.

---

## 1. Transport Layer

- **Protocol:** Bluetooth Low Energy (BLE) GATT
- **Library used in reference implementation:** [Bleak](https://github.com/hbldh/bleak) ≥ 0.15.1
- **Constraint:** Only one BLE central can be connected at a time. The vendor mobile app and this client cannot co-exist.

---

## 2. GATT Services and Characteristics

### Service UUID
```
0000fe00-0000-1000-8000-00805f9b34fb   (Vendor primary service)
```

### Characteristics

| UUID | Direction | Purpose |
|---|---|---|
| `0000fe01-0000-1000-8000-00805f9b34fb` | Notify (belt → app) | Belt pushes status messages as BLE notifications |
| `0000fe02-0000-1000-8000-00805f9b34fb` | Write (app → belt) | App writes command packets |

Subscribe to notifications on `fe01` immediately after connect. Write commands to `fe02`.

### All UUIDs present on device

```
00001800-0000-1000-8000-00805f9b34fb   Generic Access
0000180a-0000-1000-8000-00805f9b34fb   Device Information
00010203-0405-0607-0809-0a0b0c0d1912   Vendor specific
0000fe00-0000-1000-8000-00805f9b34fb   Vendor service (primary)
0000fe01-0000-1000-8000-00805f9b34fb   Notify characteristic
0000fe02-0000-1000-8000-00805f9b34fb   Write characteristic
00002902-0000-1000-8000-00805f9b34fb   CCCD descriptor
00002901-0000-1000-8000-00805f9b34fb   Characteristic User Description
00002a00-0000-1000-8000-00805f9b34fb   Device Name
00002a01-0000-1000-8000-00805f9b34fb   Appearance
00002a04-0000-1000-8000-00805f9b34fb   Peripheral Preferred Connection Parameters
00002a25-0000-1000-8000-00805f9b34fb   Serial Number String
00002a26-0000-1000-8000-00805f9b34fb   Firmware Revision String
00002a28-0000-1000-8000-00805f9b34fb   Software Revision String
00002a24-0000-1000-8000-00805f9b34fb   Model Number String
00002a29-0000-1000-8000-00805f9b34fb   Manufacturer Name String
00010203-0405-0607-0809-0a0b0c0d2b12   Vendor specific
```

---

## 3. Packet Frame Format

All packets (both directions) share the same frame:

```
[header_byte_1] [header_byte_2] [payload...] [checksum] [0xFD]
```

| Field | Description |
|---|---|
| `header_byte_1` | Always `0xF7` (outgoing) or `0xF8` (incoming) |
| `header_byte_2` | Message type identifier |
| `payload` | Variable-length content |
| `checksum` | `sum(packet[1..-2]) % 256` — sum of all bytes from index 1 up to (not including) the last two bytes, modulo 256 |
| suffix `0xFD` | Fixed frame terminator |

If the checksum is invalid the belt silently ignores the command.

### Multi-byte Integer Encoding

Values wider than 1 byte are encoded as **3-byte big-endian**:

```
value = bytes[0] * 65536 + bytes[1] * 256 + bytes[2]
```

Used for: `time` (seconds), `dist` (10-meter units), `steps`.

---

## 4. Outgoing Commands (App → Belt)

Written to characteristic `0000fe02`.

### Rate Limiting

A minimum gap of **690 ms** must be observed between consecutive writes. Sending faster causes the belt to miss commands. (Reference implementation constant: `minimal_cmd_space = 0.69`.)

---

### 4.1 `ask_stats` — Request Current Status

```
f7 a2 00 00 a2 fd
```

The belt responds asynchronously with a `CurStatus` notification on `fe01` (see §5.1).  
Typical poll interval used in practice: **750 ms**.

---

### 4.2 `ask_hist` — Request Last Stored Session

```
mode=0 (default):  f7 a7 aa ff 50 fd
mode=1:            f7 a7 aa 00 51 fd
```

The belt responds with a `LastStatus` notification (see §5.2).  
**Side effect:** Reading clears the record from the belt's memory.  
The record does not survive a power cut.

---

### 4.3 `change_speed` — Set Belt Speed

```
f7 a2 01 <speed> ff fd
```

| Field | Value |
|---|---|
| `speed` | Integer = desired speed × 10. E.g. `25` = 2.5 km/h |
| Range | `5` (0.5 km/h) to `60` (6.0 km/h) |
| Stop | `speed = 0` stops the belt (equivalent to `stop_belt`) |

Fine-grained 0.1 km/h steps are supported, unlike the stock app which only allows 0.5 km/h steps.

---

### 4.4 `stop_belt` — Stop the Belt

Implemented as `change_speed(0)`:

```
f7 a2 01 00 ff fd
```

---

### 4.5 `start_belt` — Start the Belt

```
f7 a2 04 01 ff fd
```

**Required sequence:**
1. `switch_mode(MODE_MANUAL)` — switch to manual first
2. Sleep ≥ 1.5 s
3. `start_belt()`

---

### 4.6 `switch_mode` — Change Operating Mode

```
f7 a2 02 <mode> ff fd
```

| `mode` | Constant | Meaning |
|---|---|---|
| `0` | `MODE_AUTOMAT` | Automatic — speed controlled by foot-pressure sensor |
| `1` | `MODE_MANUAL` | Manual — speed set by app commands |
| `2` | `MODE_STANDBY` | Standby / idle |

---

### 4.7 `set_pref_arr` — Set Preference (array payload)

```
f7 a6 <key> <arr_bytes...> ac fd
```

Base for all preference commands. `key` selects the preference; `arr_bytes` is the value payload.

---

### 4.8 `set_pref_int` — Set Preference (integer payload)

Calls `set_pref_arr(key, [stype, *int2byte(val)])` where `int2byte` encodes as 3-byte big-endian.

---

### 4.9 Preference Commands

All call `set_pref_arr` / `set_pref_int` internally.

| Method | PREFS key | Value / Notes |
|---|---|---|
| `set_pref_max_speed(speed)` | `3` | Maximum allowed belt speed (×10 units) |
| `set_pref_start_speed(speed)` | `4` | Auto-start speed (×10 units) |
| `set_pref_inteli(enabled)` | `5` | Intelligent (auto) start: `False`→0, `True`→1 |
| `set_pref_sensitivity(sensitivity)` | `6` | Auto-mode sensitivity: `1`=high, `2`=medium, `3`=low |
| `set_pref_display(bit_mask)` | `7` | Display settings bitmask (7 bits) |
| `set_pref_units_miles(enabled)` | `8` | Units: `False`=km, `True`=miles |
| `set_pref_child_lock(enabled)` | `9` | Child lock: `False`=off, `True`=on |
| `set_pref_target(target_type, value)` | `1` | Set workout goal (see Target Types §4.10) |

#### PREFS Key Constants

| Constant | Value |
|---|---|
| `PREFS_TARGET` | `1` |
| `PREFS_MAX_SPEED` | `3` |
| `PREFS_START_SPEED` | `4` |
| `PREFS_START_INTEL` | `5` |
| `PREFS_SENSITIVITY` | `6` |
| `PREFS_DISPLAY` | `7` |
| `PREFS_UNITS` | `8` |
| `PREFS_CHILD_LOCK` | `9` |

---

### 4.10 Target Types

Used with `set_pref_target(target_type, value)`:

| Constant | Value | Meaning |
|---|---|---|
| `TARGET_NONE` | `0` | No goal |
| `TARGET_DIST` | `1` | Distance goal |
| `TARGET_CAL` | `2` | Calorie goal |
| `TARGET_TIME` | `3` | Time goal |

---

### 4.11 `ask_profile` — Query Belt Profile

8 pre-defined payloads (indices 0–7). All begin with `f7 a5 60 4a`. Full payloads:

```
idx 0: f7 a5 60 4a 4d 93 71 29 c9 fd
idx 1: f7 a5 60 4a 4d 93 71 29 c9 fd   (same as idx 0 in reference source)
...
```

(8 entries in the `PAYLOADS_255` list in the source.)

---

### 4.12 `cmd_162_3_7` — Beep / Diagnostic Probe

```
f7 a2 03 07 ac fd
```

Purpose undocumented. Used in the reference implementation as a beep or diagnostic probe.

---

## 5. Incoming Messages (Belt → App)

Delivered as BLE notifications on `0000fe01`.

---

### 5.1 `CurStatus` — Current Running Status

**Magic prefix:** `0xF8 0xA2` (`[248, 162]`)  
**Triggered by:** `ask_stats` command  
**Total length:** 20 bytes

#### Byte Map

| Offset | Field | Encoding | Conversion |
|---|---|---|---|
| `[0]` | Header 1 | `0xF8` | Fixed |
| `[1]` | Header 2 | `0xA2` | Fixed |
| `[2]` | `belt_state` | uint8 | See Belt States §6.1 |
| `[3]` | `speed` | uint8 | ÷ 10 = km/h |
| `[4]` | `manual_mode` | uint8 | `1`=manual, `0`=auto |
| `[5:8]` | `time` | 3-byte big-endian | Seconds elapsed |
| `[8:11]` | `dist` | 3-byte big-endian | ÷ 100 = km (10 m resolution) |
| `[11:14]` | `steps` | 3-byte big-endian | Step count |
| `[14]` | `app_speed` | uint8 | ÷ 30 = km/h (last commanded speed) |
| `[15]` | Unknown | uint8 | Possibly heart rate on supported models |
| `[16]` | `controller_button` | uint8 | See Button Constants §6.3 |
| `[17]` | Unknown | uint8 | Observed `0x00` in all captured packets |
| `[18]` | Checksum | uint8 | `sum(packet[1:18]) % 256` |
| `[19]` | Suffix | `0xFD` | Fixed |

**Note:** The packet is always exactly 20 bytes. The checksum covers bytes `[1]` through `[17]` inclusive (17 bytes), stored at `[18]`, followed by `0xFD` at `[19]`.

#### Example Raw Packet

```
f8 a2 01 1e 01 00 01 3e 00 00 17 00 01 aa 1e 00 03 00 e4 fd
```

Decoded:
- `belt_state` = 1 (running)
- `speed` = 0x1e = 30 → 3.0 km/h
- `manual_mode` = 1 (manual)
- `time` = 0x00013e = 318 seconds
- `dist` = 0x000017 = 23 → 0.23 km
- `steps` = 0x0001aa = 426
- `app_speed` = 0x1e = 30 → 1.0 km/h (÷30)
- `controller_button` = 3
- `unknown[17]` = 0x00
- `checksum[18]` = 0xe4 = `sum([a2,01,1e,01,00,01,3e,00,00,17,00,01,aa,1e,00,03,00]) % 256`

---

### 5.2 `LastStatus` — Last Stored Session Record

**Magic prefix:** `0xF8 0xA7` (`[248, 167]`)  
**Triggered by:** `ask_hist` command

#### Byte Map

| Offset | Field | Encoding | Conversion |
|---|---|---|---|
| `[0]` | Header 1 | `0xF8` | Fixed |
| `[1]` | Header 2 | `0xA7` | Fixed |
| `[2:8]` | Unknown | Various | Undocumented fields |
| `[8:11]` | `time` | 3-byte big-endian | Seconds |
| `[11:14]` | `dist` | 3-byte big-endian | ÷ 100 = km |
| `[14:17]` | `steps` | 3-byte big-endian | Step count |

**Note:** The belt only retains one session record. Reading it a second time clears it. Record is lost on power cut.

---

## 6. Constants and Enumerations

### 6.1 Belt States (`belt_state`)

| Value | Meaning |
|---|---|
| `1` | Running |
| `5` | Standby / Stopped |
| other | Undocumented |

### 6.2 Operating Modes

| Constant | Value | Meaning |
|---|---|---|
| `MODE_AUTOMAT` | `0` | Automatic (sensor-controlled speed) |
| `MODE_MANUAL` | `1` | Manual (app-controlled speed) |
| `MODE_STANDBY` | `2` | Standby / idle |

### 6.3 Button Constants (`controller_button`)

| Constant | Value | Meaning |
|---|---|---|
| `BUTTON_None` | `0` | No button pressed |
| `BUTTON_Up` | `2` | Speed Up |
| `BUTTON_Stop` | `3` | Stop |
| `BUTTON_Down` | `4` | Speed Down |
| `BUTTON_long_mode` | `-6` | Long-press mode button |
| `BUTTON_mode` | `-6` | Mode button (same value) |
| `BUTTON_up` | `-4` | Alternate up (undocumented variant) |

---

## 7. Metrics Reference

### 7.1 Metrics from Belt (BLE notifications)

| Metric | Source field | Raw → Display |
|---|---|---|
| Current speed | `CurStatus.speed` | ÷ 10 → km/h |
| Elapsed time | `CurStatus.time` | seconds (raw) |
| Distance | `CurStatus.dist` | ÷ 100 → km (10 m resolution) |
| Step count | `CurStatus.steps` | integer (raw) |
| Belt state | `CurStatus.belt_state` | see §6.1 |
| Operating mode | `CurStatus.manual_mode` | `0`=auto, `1`=manual |
| Last commanded speed | `CurStatus.app_speed` | ÷ 30 → km/h |
| Last button pressed | `CurStatus.controller_button` | see §6.3 |
| Session time (stored) | `LastStatus.time` | seconds |
| Session distance (stored) | `LastStatus.dist` | ÷ 100 → km |
| Session steps (stored) | `LastStatus.steps` | integer |

### 7.2 Computed Metrics (client-side only)

Calories are **not transmitted by the belt** and must be computed client-side using a user profile.

#### Harris-Benedict BMR

```
BMR (male)   = 13.7516 * weight_kg + 5.0033 * height_cm - 6.755 * age + 66.473
BMR (female) = 9.5634  * weight_kg + 1.8496 * height_cm - 4.6756 * age + 655.0955
```

#### Resting Metabolic Rate per Minute

```
RMR_per_min = BMR * 1.1 / 24 / 60
```

#### Walking Calorie Formula (simple)

```
cal_per_min = speed_kmh * weight_kg * K
```
where K is a constant from the library.

#### Walking Calorie Formula 2 (table-based, preferred)

Valid for 1.0–7.5 km/h. Uses a lookup table of MET values indexed by speed. Supports gradient (incline angle in degrees).

```
cal_gross_per_min = calories_walk2_minute(speed_kmh, weight_kg, incline_deg)
cal_net_per_min   = cal_gross_per_min - RMR_per_min
```

---

## 8. Device Discovery (Scanner)

The reference Python scanner (`ph4_walkingpad.pad.Scanner`) uses Bleak's `BleakScanner` and filters by device name containing `"walkingpad"` (case-insensitive).

On **macOS 12+**, MAC addresses are not exposed by CoreBluetooth. The scanner works around this by passing the vendor service UUID (`0000fe00-...`) as a filter to `BleakScanner`, which returns a platform UUID instead of a MAC address.

Custom `matcher` callables `(name: str) -> bool` are supported for non-standard device names.

---

## 9. Session Data JSON Format

The reference implementation logs one JSON object per line (newline-delimited JSON / NDJSON):

```json
{
  "time": 554,
  "dist": 79,
  "steps": 977,
  "speed": 60,
  "app_speed": 180,
  "belt_state": 1,
  "controller_button": 0,
  "manual_mode": 1,
  "raw": "f8a2013c...",
  "rec_time": 1615644982.59,
  "pid": "user-profile-id",
  "ccal": 23.343,
  "ccal_net": 18.616,
  "ccal_sum": 58.267,
  "ccal_net_sum": 45.644
}
```

| Field | Units / Notes |
|---|---|
| `time` | Elapsed seconds |
| `dist` | Raw (÷ 100 = km) |
| `steps` | Integer |
| `speed` | Raw (÷ 10 = km/h) |
| `app_speed` | Raw (÷ 30 = km/h) |
| `belt_state` | See §6.1 |
| `controller_button` | See §6.3 |
| `manual_mode` | `1`=manual, `0`=auto |
| `raw` | Hex-encoded raw BLE packet |
| `rec_time` | Unix timestamp of receipt |
| `pid` | User profile ID string |
| `ccal` | Gross calories this sample interval (kcal) |
| `ccal_net` | Net calories this sample interval |
| `ccal_sum` | Cumulative gross calories |
| `ccal_net_sum` | Cumulative net calories |

---

## 10. Cloud API (`walkingpad.com`)

Base URL: `https://eu.app.walkingpad.com/user/api/v2/`

Authentication uses MD5-hashed password, returns a JWT stored as a `"user"` cookie.

### Login

```
POST /login
Body: { "email": "...", "password_md5": "<md5_hash>" }
Response: JWT token
```

### Upload Workout Record

```
POST /record/upload
Auth: user cookie (JWT)
Body: {
  "did":      "<device_MAC_address>",
  "cal":      <calories_int>,
  "time":     <unix_timestamp>,
  "dur":      <duration_seconds>,
  "distance": <distance_int>,
  "step":     <step_count>,
  "sid":      null,
  "model":    "A1"
}
```

### Fetch Records

```
GET /record/list?page=1&per_page=10000&timestamp=<unix_ts>
Auth: user cookie (JWT)
```

---

## 11. Connection Lifecycle

Recommended sequence for a full session:

```
1.  Scan for BLE devices (filter by service UUID 0000fe00 or name "walkingpad")
2.  Connect to peripheral
3.  Enumerate GATT services/characteristics
4.  Subscribe to notifications on fe01
5.  (Optional) ask_hist() to retrieve any stored last session
6.  switch_mode(MODE_MANUAL)
7.  Sleep 1.5 s
8.  start_belt()
9.  change_speed(desired_speed)         -- poll / adjust as needed
10. [poll ask_stats() every 750 ms]
11. stop_belt()                         -- change_speed(0)
12. Sleep 1.0 s
13. switch_mode(MODE_STANDBY)
14. (Optional) ask_hist() to retrieve session record before disconnect
15. disconnect()
```

---

## 12. Known Limitations and Notes

- **Single connection:** Only one BLE central allowed at a time. Vendor app must be closed first.
- **No MAC on macOS:** CoreBluetooth exposes a per-central UUID, not the hardware MAC address. Use service UUID filtering for discovery.
- **Calories not on belt:** All calorie figures are computed client-side from speed, weight, height, age, and incline.
- **Distance resolution:** 10 metres. The raw value divided by 100 gives kilometres.
- **app_speed divisor:** The `app_speed` field uses divisor 30, not 10. A raw value of 60 = 2.0 km/h.
- **Last session record is destructive:** Calling `ask_hist()` a second time clears the stored record.
- **Rate limit:** Violating the 690 ms inter-command gap causes silent command loss.
- **Byte `[15]`:** Possibly heart rate on some models; purpose unconfirmed.
- **Button constants with negative values:** `BUTTON_long_mode` = -6 and `BUTTON_up` = -4 appear to be signed integers in the Python source; the underlying wire value is not confirmed.
