import type { AppConfig, Slot } from "./types.js";
import { isoWeekday, toMinutes, todayYmd } from "./utils.js";

export function filterSlots(slots: Slot[], config: AppConfig): Slot[] {
  const startMin = toMinutes(config.timeWindow.start);
  const endMin = toMinutes(config.timeWindow.end);
  const weekdays = new Set(config.weekdays);
  const today = todayYmd();

  return slots.filter((slot) => {
    // never notify about classes on days that already passed
    if (slot.date < today) return false;
    if (!weekdays.has(isoWeekday(slot.date))) return false;
    const t = toMinutes(slot.startTime.slice(0, 5));
    if (t < startMin || t > endMin) return false;
    return true;
  });
}
