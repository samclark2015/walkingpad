import { useState, useEffect } from "react";
import { usePadStore } from "../store/padStore";
import {
  displaySpeed,
  speedUnit,
  toKmh,
  minSpeed,
  maxSpeed,
} from "../lib/units";

function toRaw(kmh: number): number {
  return Math.round(kmh * 10);
}

export function SpeedControl() {
  const setDesiredSpeed = usePadStore((s) => s.setDesiredSpeed);
  const desiredSpeedKmh = usePadStore((s) => s.desiredSpeedKmh);
  const speedKmh = usePadStore((s) => s.speedKmh);
  const units = usePadStore((s) => s.units);

  const min = minSpeed(units);
  const max = maxSpeed(units);
  const step = 0.1;

  // Local desired speed in display units — initialised from store
  const [desired, setDesired] = useState<number>(() => {
    const cur = displaySpeed(desiredSpeedKmh, units);
    return parseFloat(cur.toFixed(1));
  });

  // Re-initialise desired when unit system changes
  useEffect(() => {
    const cur = displaySpeed(desiredSpeedKmh, units);
    setDesired(parseFloat(cur.toFixed(1)));
  }, [units]); // intentionally omit desiredSpeedKmh — only sync on unit change

  const clamp = (v: number) =>
    Math.min(max, Math.max(min, Math.round(v * 10) / 10));

  const apply = async (displayVal: number) => {
    const clamped = clamp(displayVal);
    setDesired(clamped);
    const kmh = toKmh(clamped, units);
    await setDesiredSpeed(toRaw(kmh));
  };

  const increment = () => apply(desired + step);
  const decrement = () => apply(desired - step);

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDesired(parseFloat(e.target.value));
  };

  const handleSliderCommit = async (
    e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>
  ) => {
    await apply(parseFloat((e.target as HTMLInputElement).value));
  };

  const unit = speedUnit(units);

  return (
    <div className="bg-gray-800 rounded-xl p-4 space-y-4">
      <p className="text-xs text-gray-400 uppercase tracking-wider">Speed control</p>

      {/* Current vs desired */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400">Current</p>
          <p className="text-2xl font-bold tabular-nums text-white">
            {displaySpeed(speedKmh, units).toFixed(1)}{" "}
            <span className="text-sm text-gray-400">{unit}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">Target</p>
          <p className="text-2xl font-bold tabular-nums text-indigo-300">
            {desired.toFixed(1)}{" "}
            <span className="text-sm text-gray-400">{unit}</span>
          </p>
        </div>
      </div>

      {/* Slider */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={desired}
        onChange={handleSlider}
        onMouseUp={handleSliderCommit}
        onTouchEnd={handleSliderCommit}
        className="w-full accent-indigo-500 cursor-pointer"
      />
      <div className="flex justify-between text-xs text-gray-500">
        <span>{min.toFixed(1)} {unit}</span>
        <span>{max.toFixed(1)} {unit}</span>
      </div>

      {/* Step buttons */}
      <div className="flex gap-3">
        <button
          onClick={decrement}
          className="flex-1 py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-bold text-xl transition-colors"
        >
          −
        </button>
        <button
          onClick={increment}
          className="flex-1 py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-bold text-xl transition-colors"
        >
          +
        </button>
      </div>
    </div>
  );
}
