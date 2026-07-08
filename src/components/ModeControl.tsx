import { usePadStore } from "../store/padStore";
import { MODE_AUTO, MODE_MANUAL, MODE_STANDBY } from "../lib/tauri";

const modes = [
  { label: "Auto", value: MODE_AUTO, description: "Sensor speed" },
  { label: "Manual", value: MODE_MANUAL, description: "App speed" },
  { label: "Standby", value: MODE_STANDBY, description: "Idle" },
];

export function ModeControl() {
  const switchMode = usePadStore((s) => s.switchMode);
  const manualMode = usePadStore((s) => s.manualMode);
  const pendingCommand = usePadStore((s) => s.pendingCommand);

  const isPending = pendingCommand !== null;

  // Derive current mode index from manualMode flag
  // (standby is inferred from belt_state, not reported here, so we just show manual vs auto)
  const activeModeValue = manualMode ? MODE_MANUAL : MODE_AUTO;

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Mode</p>
      <div className="grid grid-cols-3 gap-2">
        {modes.map((m) => {
          const isActive = m.value === activeModeValue;
          return (
            <button
              key={m.value}
              onClick={() => switchMode(m.value)}
              disabled={isPending}
              className={`py-3 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isActive
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              <div>{m.label}</div>
              <div className={`text-xs font-normal mt-0.5 ${isActive ? "text-indigo-200" : "text-gray-400"}`}>
                {m.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
