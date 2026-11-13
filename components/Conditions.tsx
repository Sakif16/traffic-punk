// components/Conditions.tsx
import type { SensorState } from '@/lib/useSensor';
import { COMFORT_STYLES, comfortFrom, heatIndexC } from '@/lib/climate';
import { adviceFor, type AdviceTone } from '@/lib/advice';

const TIP_STYLES: Record<AdviceTone, string> = {
  warning: 'text-red-400',
  caution: 'text-orange-400',
  info: 'text-neutral-300',
};

// One-line temperature and humidity for stream cards.
export function ConditionsInline({ sensor }: { sensor: SensorState }) {
  if (!sensor.loaded) return <div className="h-4 mb-3" />;

  if (!sensor.online || !sensor.reading) {
    return <p className="text-xs text-neutral-500 mb-3">Sensor offline</p>;
  }

  return (
    <p className="text-xs text-neutral-400 mb-3">
      🌡 {sensor.reading.temperature.toFixed(1)}°C · 💧 {Math.round(sensor.reading.humidity)}%
    </p>
  );
}

// Detailed conditions card for the watch page, with suggestions.
export function ConditionsPanel({ sensor }: { sensor: SensorState }) {
  if (!sensor.loaded) {
    return (
      <div className="mt-3 border border-neutral-800 rounded p-4">
        <p className="text-sm text-neutral-400">Loading conditions…</p>
      </div>
    );
  }

  if (!sensor.online || !sensor.reading) {
    return (
      <div className="mt-3 border border-neutral-800 rounded p-4">
        <p className="text-sm text-neutral-400">Weather sensor offline</p>
      </div>
    );
  }

  const { temperature, humidity } = sensor.reading;
  const feelsLike = heatIndexC(temperature, humidity);
  const comfort = comfortFrom(feelsLike);
  const tips = adviceFor(temperature, humidity);
  const ageSeconds = Math.max(0, Math.round((sensor.ageMs ?? 0) / 1000));

  return (
    <div className="mt-3 border border-neutral-800 rounded p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm">
            🌡 <span className="font-semibold">{temperature.toFixed(1)}°C</span>
            <span className="text-neutral-500"> · </span>
            💧 <span className="font-semibold">{Math.round(humidity)}%</span>
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            Feels like {feelsLike.toFixed(1)}°C · updated {ageSeconds}s ago
          </p>
        </div>
        <span
          className={`text-sm font-medium px-3 py-1 rounded border whitespace-nowrap ${COMFORT_STYLES[comfort]}`}
        >
          {comfort}
        </span>
      </div>

      <ul className="mt-3 pt-3 border-t border-neutral-800 space-y-1.5">
        {tips.map((tip) => (
          <li key={tip.text} className={`text-sm flex gap-2 ${TIP_STYLES[tip.tone]}`}>
            <span>{tip.icon}</span>
            <span>{tip.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}