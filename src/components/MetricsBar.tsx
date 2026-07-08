import { usePadStore } from "../store/padStore";
import { BELT_RUNNING } from "../lib/tauri";
import { displaySpeed, displayDist, speedUnit, distUnit } from "../lib/units";

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface StatProps {
  label: string;
  value: string;
  unit?: string;
  highlight?: boolean;
}

function Stat({ label, value, unit, highlight }: StatProps) {
  return (
    <div className={`@container flex flex-col items-center justify-center rounded-xl p-3 min-w-0 ${highlight ? "bg-indigo-900/30" : "bg-gray-800"}`}>
      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1 truncate w-full text-center">{label}</span>
      <div className="flex items-baseline gap-0.5 min-w-0 w-full justify-center overflow-hidden">
        <span
          className={`font-bold tabular-nums truncate ${highlight ? "text-indigo-300" : "text-white"}`}
          style={{ fontSize: "clamp(0.75rem, 4.5cqi, 1.875rem)" }}
        >
          {value}
        </span>
        {unit && <span className="text-xs text-gray-400 shrink-0">{unit}</span>}
      </div>
    </div>
  );
}

export function MetricsBar() {
  const speedKmh = usePadStore((s) => s.speedKmh);
  const distKm = usePadStore((s) => s.distKm);
  const steps = usePadStore((s) => s.steps);
  const timeSecs = usePadStore((s) => s.timeSecs);
  const beltState = usePadStore((s) => s.beltState);
  const units = usePadStore((s) => s.units);

  const isRunning = beltState === BELT_RUNNING;

  return (
    <div className="grid grid-cols-4 gap-3">
      <Stat
        label="Speed"
        value={displaySpeed(speedKmh, units).toFixed(1)}
        unit={speedUnit(units)}
        highlight={isRunning}
      />
      <Stat
        label="Distance"
        value={displayDist(distKm, units).toFixed(2)}
        unit={distUnit(units)}
      />
      <Stat
        label="Steps"
        value={steps.toLocaleString()}
      />
      <Stat
        label="Time"
        value={formatTime(timeSecs)}
      />
    </div>
  );
}
