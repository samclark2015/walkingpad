// Unit system preference helpers.
// The belt always communicates in metric (km/h, km).
// Conversion happens only at the display boundary.

export type UnitSystem = "metric" | "imperial";

const KMH_TO_MPH = 0.621371;
const KM_TO_MI   = 0.621371;

// ─── Conversions (from internal metric to display) ───────────────────────────

export function displaySpeed(kmh: number, units: UnitSystem): number {
  return units === "imperial" ? kmh * KMH_TO_MPH : kmh;
}

export function displayDist(km: number, units: UnitSystem): number {
  return units === "imperial" ? km * KM_TO_MI : km;
}

export function speedUnit(units: UnitSystem): string {
  return units === "imperial" ? "mph" : "km/h";
}

export function distUnit(units: UnitSystem): string {
  return units === "imperial" ? "mi" : "km";
}

// ─── Inverse (from display value back to metric for belt commands) ────────────

/** Convert a user-entered display speed back to km/h for the belt. */
export function toKmh(displayValue: number, units: UnitSystem): number {
  return units === "imperial" ? displayValue / KMH_TO_MPH : displayValue;
}

// ─── Speed range in display units ────────────────────────────────────────────

/** Min belt speed in display units (0.5 km/h). */
export function minSpeed(units: UnitSystem): number {
  return parseFloat(displaySpeed(0.5, units).toFixed(2));
}

/** Max belt speed in display units (6.0 km/h). */
export function maxSpeed(units: UnitSystem): number {
  return parseFloat(displaySpeed(6.0, units).toFixed(2));
}

/** Step size for the speed slider in display units (~0.1 km/h equivalent). */
export function speedStep(units: UnitSystem): number {
  return units === "imperial" ? 0.1 : 0.1;
}

// ─── localStorage persistence ─────────────────────────────────────────────────

const LS_KEY = "walkingpad.units";

export function loadUnits(): UnitSystem {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === "metric" || v === "imperial") return v;
  } catch (_) {}
  return "metric";
}

export function saveUnits(u: UnitSystem): void {
  try {
    localStorage.setItem(LS_KEY, u);
  } catch (_) {}
}
