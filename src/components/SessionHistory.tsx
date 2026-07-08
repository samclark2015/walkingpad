import { usePadStore } from "../store/padStore";
import { SessionRow } from "../lib/tauri";
import { displaySpeed, displayDist, speedUnit, distUnit } from "../lib/units";

function formatDate(unixSecs: number): string {
  return new Date(unixSecs * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

export function SessionHistory() {
  const sessions = usePadStore((s) => s.sessions);
  const deleteSession = usePadStore((s) => s.deleteSession);
  const units = usePadStore((s) => s.units);

  const spUnit = speedUnit(units);
  const dUnit = distUnit(units);

  if (sessions.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 text-center">
        <p className="text-gray-400 text-sm">No sessions recorded yet</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700">
        <p className="text-xs text-gray-400 uppercase tracking-wider">Session history</p>
      </div>
      <ul className="divide-y divide-gray-700">
        {sessions.map((s: SessionRow) => {
          const distKm = s.dist_m / 1000;
          return (
            <li key={s.id} className="px-4 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{formatDate(s.started_at)}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-400">
                  <span>{formatDuration(s.duration_s)}</span>
                  <span>{displayDist(distKm, units).toFixed(2)} {dUnit}</span>
                  <span>{s.steps.toLocaleString()} steps</span>
                  <span>avg {displaySpeed(s.avg_speed, units).toFixed(1)} {spUnit}</span>
                  <span>max {displaySpeed(s.max_speed, units).toFixed(1)} {spUnit}</span>
                </div>
              </div>
              <button
                onClick={() => deleteSession(s.id)}
                className="text-gray-600 hover:text-red-400 transition-colors text-xs shrink-0 mt-0.5"
                title="Delete session"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
