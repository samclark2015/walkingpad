import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

// ─── Types mirroring Rust structs ────────────────────────────────────────────

export interface DeviceInfo {
  id: string;
  name: string;
}

export interface CurStatus {
  belt_state: number;   // 1=running, 5=standby
  speed_kmh: number;
  manual_mode: boolean;
  time_secs: number;
  dist_km: number;
  steps: number;
  app_speed_kmh: number;
  controller_button: number;
}

export interface LastStatus {
  time_secs: number;
  dist_km: number;
  steps: number;
}

// ─── Mode constants ───────────────────────────────────────────────────────────

export const MODE_AUTO = 0;
export const MODE_MANUAL = 1;
export const MODE_STANDBY = 2;

export const BELT_RUNNING = 1;
export const BELT_STANDBY = 5;

// ─── Tauri command wrappers ───────────────────────────────────────────────────

export const scanDevices = (timeoutSecs = 5.0): Promise<DeviceInfo[]> =>
  invoke("scan_devices", { timeoutSecs });

export const connectDevice = (address: string): Promise<void> =>
  invoke("connect_device", { address });

export const disconnectDevice = (): Promise<void> =>
  invoke("disconnect_device");

export const startBelt = (): Promise<void> => invoke("start_belt");
export const stopBelt = (): Promise<void> => invoke("stop_belt");

/** speed_x10: integer = km/h × 10, range 5–60 */
export const setSpeed = (speedX10: number): Promise<void> =>
  invoke("set_speed", { speedX10 });

/** Set the belt's own start-speed preference (km/h × 10, range 5–60) */
export const setPrefStartSpeed = (speedX10: number): Promise<void> =>
  invoke("set_pref_start_speed", { speedX10 });

/** mode: 0=auto, 1=manual, 2=standby */
export const switchMode = (mode: number): Promise<void> =>
  invoke("switch_mode", { mode });

export const askStats = (): Promise<void> => invoke("ask_stats");
export const askHist = (): Promise<void> => invoke("ask_hist");

/** Set the tray icon title text (shown next to the tray icon in the menubar) */
export const setTrayTitle = (title: string): Promise<void> =>
  invoke("set_tray_title", { title });

// ─── Event listeners ──────────────────────────────────────────────────────────

export const onStatus = (cb: (s: CurStatus) => void): Promise<UnlistenFn> =>
  listen<CurStatus>("pad:status", (e) => cb(e.payload));

export const onLastStatus = (cb: (s: LastStatus) => void): Promise<UnlistenFn> =>
  listen<LastStatus>("pad:last-status", (e) => cb(e.payload));
