import { create } from "zustand";
import {
  CurStatus,
  LastStatus,
  connectDevice as tauriConnect,
  disconnectDevice as tauriDisconnect,
  startBelt as tauriStart,
  stopBelt as tauriStop,
  setSpeed as tauriSetSpeed,
  setPrefStartSpeed as tauriSetPrefStartSpeed,
  switchMode as tauriSwitchMode,
  setTrayTitle as tauriSetTrayTitle,
  onStatus,
  onLastStatus,
  BELT_RUNNING,
} from "../lib/tauri";
import { UnitSystem, loadUnits, saveUnits, displaySpeed, speedUnit, displayDist, distUnit } from "../lib/units";
import type { UnlistenFn } from "@tauri-apps/api/event";

// ─── Last-address persistence ─────────────────────────────────────────────────

const LS_LAST_ADDR = "walkingpad.lastAddress";

export function loadLastAddress(): string | null {
  try { return localStorage.getItem(LS_LAST_ADDR); } catch { return null; }
}

function saveLastAddress(addr: string): void {
  try { localStorage.setItem(LS_LAST_ADDR, addr); } catch { /* ignore */ }
}

// ─── Desired speed persistence ────────────────────────────────────────────────

const LS_DESIRED_SPEED = "walkingpad.desiredSpeedKmh";
const DEFAULT_DESIRED_SPEED_KMH = 3.0;

function loadDesiredSpeed(): number {
  try {
    const v = localStorage.getItem(LS_DESIRED_SPEED);
    if (v !== null) {
      const n = parseFloat(v);
      if (isFinite(n) && n >= 0.5 && n <= 6.0) return n;
    }
  } catch { /* ignore */ }
  return DEFAULT_DESIRED_SPEED_KMH;
}

function saveDesiredSpeed(kmh: number): void {
  try { localStorage.setItem(LS_DESIRED_SPEED, String(kmh)); } catch { /* ignore */ }
}

// ─── Menubar display preference persistence ───────────────────────────────────

const LS_MENUBAR_DISPLAY = "walkingpad.menubarDisplay";

export type MenubarDisplay = "none" | "speed" | "time" | "steps" | "distance";

export function loadMenubarDisplay(): MenubarDisplay {
  try {
    const v = localStorage.getItem(LS_MENUBAR_DISPLAY);
    if (v === "none" || v === "speed" || v === "time" || v === "steps" || v === "distance") return v;
  } catch { /* ignore */ }
  return "none";
}

export function saveMenubarDisplay(d: MenubarDisplay): void {
  try { localStorage.setItem(LS_MENUBAR_DISPLAY, d); } catch { /* ignore */ }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConnectionState =
  | "disconnected"
  | "scanning"
  | "connecting"
  | "connected";

/** Pending belt command — cleared when status confirms the expected state. */
export type PendingCommand = "start" | "stop" | "pause" | "resume" | null;

export interface SpeedPoint {
  t: number;  // Unix ms timestamp
  v: number;  // km/h (always stored in metric)
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface PadStore {
  // Connection
  connectionState: ConnectionState;
  deviceAddress: string | null;
  errorMessage: string | null;

  // Unit preference (persisted to localStorage)
  units: UnitSystem;

  // Menubar display preference (persisted to localStorage)
  menubarDisplay: MenubarDisplay;

  // Live metrics (always stored in metric internally)
  beltState: number;
  speedKmh: number;
  distKm: number;
  steps: number;
  timeSecs: number;
  manualMode: boolean;

  // Rolling speed history (last 120 points ≈ 90 s)
  speedHistory: SpeedPoint[];

  // Pending command (cleared when belt confirms new state)
  pendingCommand: PendingCommand;

  // Paused flag — set by user intent, not derived from belt state
  isPaused: boolean;

  // Desired speed (km/h) — sent to belt on start and on explicit set
  desiredSpeedKmh: number;

  lastStatus: LastStatus | null;

  // Internals
  _unlistenStatus: UnlistenFn | null;
  _unlistenLast: UnlistenFn | null;

  // Actions
  connect(address: string): Promise<void>;
  disconnect(): Promise<void>;
  startBelt(): Promise<void>;
  stopBelt(): Promise<void>;
  pauseBelt(): Promise<void>;
  resumeBelt(): Promise<void>;
  setSpeed(speedX10: number): Promise<void>;
  setDesiredSpeed(speedX10: number): Promise<void>;
  switchMode(mode: number): Promise<void>;
  clearError(): void;
  setUnits(u: UnitSystem): void;
  setMenubarDisplay(d: MenubarDisplay): void;
}

// ─── Store implementation ────────────────────────────────────────────────────

export const usePadStore = create<PadStore>((set, get) => ({
  connectionState: "disconnected",
  deviceAddress: null,
  errorMessage: null,

  units: loadUnits(),
  menubarDisplay: loadMenubarDisplay(),

  beltState: 5,
  speedKmh: 0,
  distKm: 0,
  steps: 0,
  timeSecs: 0,
  manualMode: false,

  speedHistory: [],
  pendingCommand: null,
  isPaused: false,
  desiredSpeedKmh: loadDesiredSpeed(),

  lastStatus: null,

  _unlistenStatus: null,
  _unlistenLast: null,

  // ─── Connect ───────────────────────────────────────────────────────────────

  async connect(address: string) {
    set({ connectionState: "connecting", errorMessage: null });
    try {
      // Subscribe to BLE events before calling connect so we don't miss the
      // first notification.
      const unlistenStatus = await onStatus((s: CurStatus) => {
        const state = get();

        // Detect run start
        const isNowRunning = s.belt_state === BELT_RUNNING;

        // Clear pending command when belt confirms the transition
        let pendingCommand = state.pendingCommand;
        if (pendingCommand === "start" && isNowRunning) pendingCommand = null;
        if (pendingCommand === "stop" && !isNowRunning) pendingCommand = null;
        if (pendingCommand === "pause" && s.speed_kmh === 0) pendingCommand = null;
        if (pendingCommand === "resume" && s.speed_kmh > 0) pendingCommand = null;

        // Rolling speed history (cap at 120 points)
        const now = Date.now();
        const newPoint: SpeedPoint = { t: now, v: s.speed_kmh };
        const history = [...state.speedHistory, newPoint].slice(-120);

        set({
          beltState: s.belt_state,
          speedKmh: s.speed_kmh,
          distKm: s.dist_km,
          steps: s.steps,
          timeSecs: s.time_secs,
          manualMode: s.manual_mode,
          speedHistory: history,
          pendingCommand,
        });

        // Update tray title based on menubar display preference
        const { menubarDisplay, units } = get();
        updateTrayTitle(menubarDisplay, s, units);
      });

      const unlistenLast = await onLastStatus((s: LastStatus) => {
        set({ lastStatus: s });
      });

      await tauriConnect(address);

      // Push the stored desired speed as the device's startup-speed preference.
      const speedX10 = Math.round(get().desiredSpeedKmh * 10);
      await tauriSetPrefStartSpeed(speedX10);

      saveLastAddress(address);
      set({
        connectionState: "connected",
        deviceAddress: address,
        _unlistenStatus: unlistenStatus,
        _unlistenLast: unlistenLast,
      });
    } catch (e) {
      set({
        connectionState: "disconnected",
        errorMessage: String(e),
      });
    }
  },

  // ─── Disconnect ────────────────────────────────────────────────────────────

  async disconnect() {
    const state = get();
    state._unlistenStatus?.();
    state._unlistenLast?.();
    try {
      await tauriDisconnect();
    } catch (_) {
      // Ignore disconnect errors
    }
    // Clear tray title on disconnect
    tauriSetTrayTitle("").catch(() => {});
    set({
      connectionState: "disconnected",
      deviceAddress: null,
      _unlistenStatus: null,
      _unlistenLast: null,
      beltState: 5,
      speedKmh: 0,
      distKm: 0,
      steps: 0,
      timeSecs: 0,
      manualMode: false,
      speedHistory: [],
      pendingCommand: null,
      isPaused: false,
    });
  },

  // ─── Controls ──────────────────────────────────────────────────────────────

  async startBelt() {
    set({ pendingCommand: "start" });
    try {
      await tauriStart();
    } catch (e) {
      set({ errorMessage: String(e), pendingCommand: null });
    }
  },

  async stopBelt() {
    set({ pendingCommand: "stop", isPaused: false });
    try {
      await tauriStop();
    } catch (e) {
      set({ errorMessage: String(e), pendingCommand: null });
    }
  },

  async pauseBelt() {
    set({ pendingCommand: "pause", isPaused: true });
    try {
      await tauriSetSpeed(0);
    } catch (e) {
      set({ errorMessage: String(e), pendingCommand: null, isPaused: false });
    }
  },

  async resumeBelt() {
    const { desiredSpeedKmh } = get();
    set({ pendingCommand: "resume", isPaused: false });
    try {
      await tauriSetSpeed(Math.round(desiredSpeedKmh * 10));
    } catch (e) {
      set({ errorMessage: String(e), pendingCommand: null, isPaused: true });
    }
  },

  async setSpeed(speedX10: number) {
    try {
      await tauriSetSpeed(speedX10);
    } catch (e) {
      set({ errorMessage: String(e) });
    }
  },

  async setDesiredSpeed(speedX10: number) {
    const kmh = speedX10 / 10;
    set({ desiredSpeedKmh: kmh });
    saveDesiredSpeed(kmh);
    try {
      const { beltState } = get();
      const isRunning = beltState === BELT_RUNNING;
      await tauriSetSpeed(speedX10);
      // Only sync the startup-speed preference when the belt is not running.
      // When running, the preference is left unchanged; it was already set on
      // connect and will be updated once the user stops and adjusts the speed.
      if (!isRunning) {
        await tauriSetPrefStartSpeed(speedX10);
      }
    } catch (e) {
      set({ errorMessage: String(e) });
    }
  },

  async switchMode(mode: number) {
    try {
      await tauriSwitchMode(mode);
    } catch (e) {
      set({ errorMessage: String(e) });
    }
  },

  clearError() {
    set({ errorMessage: null });
  },

  setUnits(u: UnitSystem) {
    saveUnits(u);
    set({ units: u });
    // Re-render tray title with new units if there's a live status
    const state = get();
    if (state.connectionState === "connected") {
      const fakeStatus = {
        belt_state: state.beltState,
        speed_kmh: state.speedKmh,
        dist_km: state.distKm,
        steps: state.steps,
        time_secs: state.timeSecs,
        manual_mode: state.manualMode,
        app_speed_kmh: state.speedKmh,
        controller_button: 0,
      };
      updateTrayTitle(state.menubarDisplay, fakeStatus, u);
    }
  },

  setMenubarDisplay(d: MenubarDisplay) {
    saveMenubarDisplay(d);
    set({ menubarDisplay: d });
    const state = get();
    if (state.connectionState === "connected") {
      const fakeStatus = {
        belt_state: state.beltState,
        speed_kmh: state.speedKmh,
        dist_km: state.distKm,
        steps: state.steps,
        time_secs: state.timeSecs,
        manual_mode: state.manualMode,
        app_speed_kmh: state.speedKmh,
        controller_button: 0,
      };
      updateTrayTitle(d, fakeStatus, state.units);
    } else {
      tauriSetTrayTitle("").catch(() => {});
    }
  },
}));

// ─── Tray title helper ────────────────────────────────────────────────────────

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function updateTrayTitle(
  display: MenubarDisplay,
  s: CurStatus,
  units: UnitSystem
): void {
  let title = "";
  switch (display) {
    case "speed":
      title = `${displaySpeed(s.speed_kmh, units).toFixed(1)} ${speedUnit(units)}`;
      break;
    case "time":
      title = formatTime(s.time_secs);
      break;
    case "steps":
      title = `${s.steps.toLocaleString()}`;
      break;
    case "distance":
      title = `${displayDist(s.dist_km, units).toFixed(2)} ${distUnit(units)}`;
      break;
    case "none":
    default:
      title = "";
  }
  tauriSetTrayTitle(title).catch(() => {});
}
