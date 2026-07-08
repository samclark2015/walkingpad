import { useState, useEffect, useRef } from "react";
import { exit } from "@tauri-apps/plugin-process";
import { DeviceInfo, scanDevices } from "../lib/tauri";
import { usePadStore } from "../store/padStore";
import { loadLastAddress } from "../store/padStore";

export function DeviceScanner() {
  const connect = usePadStore((s) => s.connect);
  const connectionState = usePadStore((s) => s.connectionState);
  const errorMessage = usePadStore((s) => s.errorMessage);
  const clearError = usePadStore((s) => s.clearError);

  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [autoConnectFailed, setAutoConnectFailed] = useState(false);
  const didAutoScan = useRef(false);

  const handleScan = async (): Promise<DeviceInfo[]> => {
    setScanning(true);
    setDevices([]);
    clearError();
    try {
      const found = await scanDevices(5.0);
      setDevices(found);
      return found;
    } catch (e) {
      console.error(e);
      return [];
    } finally {
      setScanning(false);
    }
  };

  const handleConnect = async (device: DeviceInfo) => {
    setConnectingId(device.id);
    await connect(device.id);
    setConnectingId(null);
  };

  // Auto-scan on mount; auto-reconnect if last address is found
  useEffect(() => {
    if (didAutoScan.current) return;
    didAutoScan.current = true;

    (async () => {
      const lastAddr = loadLastAddress();
      const found = await handleScan();

      if (lastAddr) {
        const match = found.find((d) => d.id === lastAddr);
        if (match) {
          setConnectingId(match.id);
          await connect(match.id);
          setConnectingId(null);
        } else {
          setAutoConnectFailed(true);
        }
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isConnecting = connectionState === "connecting" || connectingId !== null;

  return (
    <div className="bg-gray-950 text-white flex flex-col">
      {/* Drag region + quit button */}
      <div data-tauri-drag-region className="flex justify-end items-center px-4 pt-3 pb-1 select-none">
        <button
          onClick={() => exit(0)}
          className="text-xs text-gray-600 hover:text-gray-300 transition-colors"
          title="Quit"
        >
          Quit
        </button>
      </div>

      <div className="flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-md">
          <h1 className="text-3xl font-bold text-center mb-2 text-white">WalkingPad</h1>
          <p className="text-center text-gray-400 mb-8 text-sm">Connect via Bluetooth</p>

          {errorMessage && (
            <div className="mb-4 bg-red-900/40 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
              {errorMessage}
              <button onClick={clearError} className="ml-2 underline text-red-400">dismiss</button>
            </div>
          )}

          {autoConnectFailed && !errorMessage && (
            <div className="mb-4 bg-yellow-900/30 border border-yellow-700 rounded-xl p-3 text-yellow-300 text-xs">
              Last device not found — select one below or scan again.
            </div>
          )}

          <button
            onClick={() => { setAutoConnectFailed(false); handleScan(); }}
            disabled={scanning || isConnecting}
            className="w-full py-3 rounded-xl font-semibold text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-6"
          >
            {scanning ? "Scanning…" : "Scan for Devices"}
          </button>

          {devices.length === 0 && !scanning && (
            <p className="text-center text-gray-500 text-sm">
              {autoConnectFailed ? "No devices found." : "Searching…"}
            </p>
          )}

          <ul className="space-y-3">
            {devices.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-3"
              >
                <div>
                  <p className="font-medium text-white">{d.name}</p>
                </div>
                <button
                  onClick={() => handleConnect(d)}
                  disabled={connectingId === d.id || isConnecting}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {connectingId === d.id ? "Connecting…" : "Connect"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
