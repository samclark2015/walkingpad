import { useEffect, useCallback, useState } from "react";
import { usePadStore } from "../store/padStore";
import { MetricsBar } from "./MetricsBar";
import { SpeedChart } from "./SpeedChart";
import { SpeedControl } from "./SpeedControl";
import { ModeControl } from "./ModeControl";
import { Preferences } from "./Preferences";
import { BELT_RUNNING } from "../lib/tauri";

export function Dashboard() {
  const beltState = usePadStore((s) => s.beltState);
  const pendingCommand = usePadStore((s) => s.pendingCommand);
  const startBelt = usePadStore((s) => s.startBelt);
  const stopBelt = usePadStore((s) => s.stopBelt);
  const disconnect = usePadStore((s) => s.disconnect);
  const deviceAddress = usePadStore((s) => s.deviceAddress);
  const errorMessage = usePadStore((s) => s.errorMessage);
  const clearError = usePadStore((s) => s.clearError);

  const [showPrefs, setShowPrefs] = useState(false);

  const isRunning = beltState === BELT_RUNNING;

  const toggleBelt = useCallback(() => {
    if (isRunning) {
      stopBelt();
    } else {
      startBelt();
    }
  }, [isRunning, startBelt, stopBelt]);

  // Close prefs panel if Escape pressed
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowPrefs(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header data-tauri-drag-region className="flex items-center justify-between px-6 py-4 border-b border-gray-800 select-none">
        <div data-tauri-drag-region>
          <h1 className="text-lg font-bold text-white">WalkingPad</h1>
          <p className="text-xs text-gray-500 font-mono">{deviceAddress}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ${
            isRunning ? "bg-green-900/50 text-green-300" : "bg-gray-700 text-gray-400"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-green-400 animate-pulse" : "bg-gray-500"}`} />
            {isRunning ? "Running" : "Standby"}
          </div>

          <button
            onClick={disconnect}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            Disconnect
          </button>

          {/* Preferences */}
          <div className="relative">
            <button
              onClick={() => setShowPrefs((v) => !v)}
              title="Preferences"
              className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                showPrefs
                  ? "border-indigo-500 bg-indigo-600/30 text-indigo-300"
                  : "border-gray-700 bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              ⚙
            </button>
            {showPrefs && (
              <Preferences onClose={() => setShowPrefs(false)} />
            )}
          </div>
        </div>
      </header>

      {/* Error banner */}
      {errorMessage && (
        <div className="mx-4 mt-3 bg-red-900/40 border border-red-700 rounded-xl p-3 text-red-300 text-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={clearError} className="text-red-400 underline ml-3">dismiss</button>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Metrics */}
        <MetricsBar />

        {/* Start / Stop */}
        <button
          onClick={toggleBelt}
          disabled={pendingCommand !== null}
          className={`w-full py-5 rounded-2xl font-bold text-xl transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed ${
            pendingCommand !== null
              ? "bg-gray-600 text-gray-300"
              : isRunning
              ? "bg-red-600 hover:bg-red-500 text-white shadow-red-900/50"
              : "bg-green-600 hover:bg-green-500 text-white shadow-green-900/50"
          }`}
        >
          {pendingCommand === "start"
            ? "Starting…"
            : pendingCommand === "stop"
            ? "Stopping…"
            : isRunning
            ? "Stop"
            : "Start"}
        </button>

        {/* Speed chart */}
        <SpeedChart />

        {/* Controls row */}
        <div className="grid grid-cols-1 gap-4">
          <SpeedControl />
          <ModeControl />
        </div>
      </main>
    </div>
  );
}
