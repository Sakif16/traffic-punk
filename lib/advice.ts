// lib/advice.ts
import { heatIndexC } from './climate';

export type AdviceTone = 'info' | 'caution' | 'warning';

export interface Advice {
  tone: AdviceTone;
  icon: string;
  text: string;
}

// Thresholds (tune these for your climate).
export const HOT_TEMP = 32; // °C, shade advice above this
export const DANGEROUS_HEAT_INDEX = 41; // °C "feels like"
export const RAIN_LIKELY_HUMIDITY = 85; // %
export const RAIN_POSSIBLE_HUMIDITY = 75; // %
export const COOL_TEMP = 18; // °C
export const DRY_HUMIDITY = 30; // %

// Maximum number of tips shown at once.
export const MAX_TIPS = 2;

const TONE_PRIORITY: Record<AdviceTone, number> = { warning: 0, caution: 1, info: 2 };

// Rule-based suggestions from temperature and humidity, most serious first.
export function adviceFor(temperature: number, humidity: number): Advice[] {
  const feelsLike = heatIndexC(temperature, humidity);
  const tips: Advice[] = [];

  if (feelsLike >= DANGEROUS_HEAT_INDEX) {
    tips.push({
      tone: 'warning',
      icon: '🥵',
      text: 'Dangerously hot out there. Avoid going outside if you can, and drink plenty of water.',
    });
  } else if (temperature > HOT_TEMP) {
    tips.push({
      tone: 'caution',
      icon: '☀️',
      text: 'You should stay in the shade at these temperatures.',
    });
  }

  if (humidity >= RAIN_LIKELY_HUMIDITY) {
    tips.push({
      tone: 'caution',
      icon: '🌧️',
      text: "Humidity is very high, rain is likely. I'd suggest going out with an umbrella.",
    });
  } else if (humidity >= RAIN_POSSIBLE_HUMIDITY) {
    tips.push({
      tone: 'info',
      icon: '☂️',
      text: "The air is quite humid, a shower is possible. An umbrella wouldn't hurt.",
    });
  }

  if (temperature < COOL_TEMP) {
    tips.push({
      tone: 'info',
      icon: '🧥',
      text: "It's cool out, a light jacket would help.",
    });
  }

  if (humidity < DRY_HUMIDITY) {
    tips.push({
      tone: 'info',
      icon: '💧',
      text: 'The air is dry, remember to drink water.',
    });
  }

  if (tips.length === 0) {
    tips.push({
      tone: 'info',
      icon: '🌤️',
      text: 'Conditions look comfortable for heading out.',
    });
  }

  return tips.sort((a, b) => TONE_PRIORITY[a.tone] - TONE_PRIORITY[b.tone]).slice(0, MAX_TIPS);
}