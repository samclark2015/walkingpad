import { useRef, useEffect, useState } from "react";
import { exit } from "@tauri-apps/plugin-process";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { usePadStore } from "../store/padStore";
import type { MenubarDisplay } from "../store/padStore";

interface PreferencesProps {
  onClose: () => void;
}

export function Preferences({ onClose }: PreferencesProps) {
  const units = usePadStore((s) => s.units);
  const setUnits = usePadStore((s) => s.setUnits);
  const menubarDisplay = usePadStore((s) => s.menubarDisplay);
  const setMenubarDisplay = usePadStore((s) => s.setMenubarDisplay);

  const panelRef = useRef<HTMLDivElement>(null);
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null);

  // Load current autostart state
  useEffect(() => {
    isEnabled().then(setLaunchAtLogin).catch(() => setLaunchAtLogin(false));
  }, []);

  const toggleLaunchAtLogin = async () => {
    try {
      if (launchAtLogin) {
        await disable();
        setLaunchAtLogin(false);
      } else {
        await enable();
        setLaunchAtLogin(true);
      }
    } catch (e) {
      console.error("autostart toggle failed", e);
    }
  };

  // Close when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const menubarOptions: { value: MenubarDisplay; label: string }[] = [
    { value: "none", label: "None" },
    { value: "speed", label: "Speed" },
    { value: "time", label: "Time" },
    { value: "steps", label: "Steps" },
    { value: "distance", label: "Distance" },
  ];

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-1 z-50 w-56 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-gray-800">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Preferences</p>
      </div>

      {/* Units */}
      <div className="px-3 py-3 border-b border-gray-800">
        <p className="text-xs text-gray-500 mb-2">Distance &amp; Speed</p>
        <div className="flex items-center rounded-lg overflow-hidden border border-gray-700 text-xs font-medium">
          <button
            onClick={() => setUnits("metric")}
            className={`flex-1 py-1.5 transition-colors ${
              units === "metric"
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            km
          </button>
          <button
            onClick={() => setUnits("imperial")}
            className={`flex-1 py-1.5 transition-colors ${
              units === "imperial"
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            mi
          </button>
        </div>
      </div>

      {/* Menubar display */}
      <div className="px-3 py-3 border-b border-gray-800">
        <p className="text-xs text-gray-500 mb-2">Show in menubar</p>
        <div className="flex flex-col gap-1">
          {menubarOptions.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setMenubarDisplay(value)}
              className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                menubarDisplay === value
                  ? "bg-indigo-600 text-white"
                  : "text-gray-300 hover:bg-gray-800"
              }`}
            >
              {label}
              {menubarDisplay === value && (
                <span className="text-indigo-300">✓</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Launch at login */}
      <div className="px-3 py-3 border-b border-gray-800">
        <button
          onClick={toggleLaunchAtLogin}
          disabled={launchAtLogin === null}
          className="flex items-center justify-between w-full text-xs text-gray-300 px-2.5 py-1.5 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          <span>Launch at login</span>
          <span className={`w-8 h-4 rounded-full transition-colors relative ${launchAtLogin ? "bg-indigo-600" : "bg-gray-700"}`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${launchAtLogin ? "translate-x-4" : "translate-x-0.5"}`} />
          </span>
        </button>
      </div>

      {/* Quit */}
      <div className="px-3 py-2">
        <button
          onClick={() => exit(0)}
          className="w-full text-left text-xs text-red-400 hover:text-red-300 px-2.5 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
        >
          Quit WalkingPad
        </button>
      </div>
    </div>
  );
}
