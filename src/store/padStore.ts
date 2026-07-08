import { create } from "zustand";
import Database from "@tauri-apps/plugin-sql";
import {
  CurStatus,
  LastStatus,
  SessionRow,
  connectDevice as tauriConnect,
  disconnectDevice as tauriDisconnect,
  startBelt as tauriStart,
  stopBelt as tauriStop,
  setSpeed as tauriSetSpeed,
  setPrefStartSpeed as tauriSetPrefStartSpeed,
  switchMode as tauriSwitchMode,
  onStatus,
  onLastStatus,
  BELT_RUNNING,
} from "../lib/tauri";
import { UnitSystem, loadUnits, saveUnits } from "../lib/units";
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

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConnectionState =
  | "disconnected"
  | "scanning"
  | "connecting"
  | "connected";

/** Pending belt command — cleared when status confirms the expected state. */
export type PendingCommand = "start" | "stop" | null;

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

  // Desired speed (km/h) — sent to belt on start and on explicit set
  desiredSpeedKmh: number;

  // Session tracking
  sessionStart: number | null;
  sessionPeakSpeed: number;
  speedSum: number;
  speedSamples: number;

  // Session history
  sessions: SessionRow[];
  lastStatus: LastStatus | null;

  // Internals
  _unlistenStatus: UnlistenFn | null;
  _unlistenLast: UnlistenFn | null;

  // Actions
  connect(address: string): Promise<void>;
  disconnect(): Promise<void>;
  startBelt(): Promise<void>;
  stopBelt(): Promise<void>;
  setSpeed(speedX10: number): Promise<void>;
  setDesiredSpeed(speedX10: number): Promise<void>;
  switchMode(mode: number): Promise<void>;
  loadSessions(): Promise<void>;
  deleteSession(id: number): Promise<void>;
  clearError(): void;
  setUnits(u: UnitSystem): void;
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

const DB_URL = "sqlite:walkingpad.db";

async function getDb(): Promise<Database> {
  return Database.load(DB_URL);
}

// ─── Store implementation ────────────────────────────────────────────────────

export const usePadStore = create<PadStore>((set, get) => ({
  connectionState: "disconnected",
  deviceAddress: null,
  errorMessage: null,

  units: loadUnits(),

  beltState: 5,
  speedKmh: 0,
  distKm: 0,
  steps: 0,
  timeSecs: 0,
  manualMode: false,

  speedHistory: [],
  pendingCommand: null,
  desiredSpeedKmh: loadDesiredSpeed(),

  sessionStart: null,
  sessionPeakSpeed: 0,
  speedSum: 0,
  speedSamples: 0,

  sessions: [],
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
        const now = Date.now();
        const state = get();

        // Detect run start
        const wasRunning = state.beltState === BELT_RUNNING;
        const isNowRunning = s.belt_state === BELT_RUNNING;

        // Clear pending command when belt confirms the transition
        let pendingCommand = state.pendingCommand;
        if (pendingCommand === "start" && isNowRunning) pendingCommand = null;
        if (pendingCommand === "stop" && !isNowRunning) pendingCommand = null;

        let sessionStart = state.sessionStart;
        let sessionPeakSpeed = state.sessionPeakSpeed;
        let speedSum = state.speedSum;
        let speedSamples = state.speedSamples;

        if (isNowRunning && !wasRunning) {
          sessionStart = now;
          sessionPeakSpeed = s.speed_kmh;
          speedSum = s.speed_kmh;
          speedSamples = 1;
        } else if (isNowRunning) {
          sessionPeakSpeed = Math.max(sessionPeakSpeed, s.speed_kmh);
          speedSum += s.speed_kmh;
          speedSamples += 1;
        } else if (!isNowRunning && wasRunning && sessionStart !== null) {
          // Belt just stopped — save session
          const avgSpeed = speedSamples > 0 ? speedSum / speedSamples : 0;
          const durationS = Math.round((now - sessionStart) / 1000);
          const distM = Math.round(s.dist_km * 1000);
          (async () => {
            try {
              const db = await getDb();
              await db.execute(
                `INSERT INTO sessions (started_at, duration_s, dist_m, steps, max_speed, avg_speed)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  Math.floor(sessionStart! / 1000),
                  durationS,
                  distM,
                  s.steps,
                  sessionPeakSpeed,
                  avgSpeed,
                ]
              );
              get().loadSessions();
            } catch (e) {
              console.error("Failed to save session:", e);
            }
          })();
          sessionStart = null;
          sessionPeakSpeed = 0;
          speedSum = 0;
          speedSamples = 0;
        }

        // Rolling speed history (cap at 120 points)
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
          sessionStart,
          sessionPeakSpeed,
          speedSum,
          speedSamples,
        });
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
      sessionStart: null,
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
    set({ pendingCommand: "stop" });
    try {
      await tauriStop();
    } catch (e) {
      set({ errorMessage: String(e), pendingCommand: null });
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

  // ─── Session history ───────────────────────────────────────────────────────

  async loadSessions() {
    try {
      const db = await getDb();
      const rows = await db.select<SessionRow[]>(
        "SELECT * FROM sessions ORDER BY started_at DESC LIMIT 100"
      );
      set({ sessions: rows });
    } catch (e) {
      console.error("loadSessions:", e);
    }
  },

  async deleteSession(id: number) {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM sessions WHERE id = ?", [id]);
      get().loadSessions();
    } catch (e) {
      console.error("deleteSession:", e);
    }
  },

  clearError() {
    set({ errorMessage: null });
  },

  setUnits(u: UnitSystem) {
    saveUnits(u);
    set({ units: u });
  },
}));
