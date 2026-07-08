import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { usePadStore, SpeedPoint } from "../store/padStore";
import { displaySpeed, speedUnit, maxSpeed } from "../lib/units";

export function SpeedChart() {
  const speedHistory = usePadStore((s) => s.speedHistory);
  const units = usePadStore((s) => s.units);

  const unit = speedUnit(units);
  const yMax = Math.ceil(maxSpeed(units)) + 1; // headroom above belt max

  if (speedHistory.length < 2) {
    return (
      <div className="bg-gray-800 rounded-xl p-4 h-36 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Start the belt to see speed history</p>
      </div>
    );
  }

  // Normalise timestamps to seconds-ago; convert v to display units
  const now = Date.now();
  const data = speedHistory.map((p: SpeedPoint) => ({
    t: -Math.round((now - p.t) / 1000),
    v: displaySpeed(p.v, units),
  }));

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Speed history</p>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="t"
            tick={{ fill: "#9ca3af", fontSize: 10 }}
            tickFormatter={(v) => `${v}s`}
          />
          <YAxis
            domain={[0, yMax]}
            tick={{ fill: "#9ca3af", fontSize: 10 }}
            width={32}
            tickFormatter={(v) => `${v}`}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#1f2937", border: "none", borderRadius: 8 }}
            labelStyle={{ color: "#9ca3af", fontSize: 11 }}
            formatter={(v) => [`${Number(v).toFixed(1)} ${unit}`, "Speed"] as [string, string]}
            labelFormatter={(l) => `${l}s ago`}
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
