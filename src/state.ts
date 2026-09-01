import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { BotState, Slot } from "./types.js";
import { rootPath, todayYmd } from "./utils.js";

const DEFAULT_STATE: BotState = {
  seenSlotIds: [],
  lastSuccessAt: null,
  consecutiveFailures: 0,
  lastFailureAlertAt: null,
};

export function loadState(path = rootPath("state.json")): BotState {
  if (!existsSync(path)) return { ...DEFAULT_STATE, seenSlotIds: [] };
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<BotState>;
  return {
    seenSlotIds: Array.isArray(raw.seenSlotIds) ? raw.seenSlotIds.map(String) : [],
    lastSuccessAt: raw.lastSuccessAt ?? null,
    consecutiveFailures: Number(raw.consecutiveFailures ?? 0) || 0,
    lastFailureAlertAt: raw.lastFailureAlertAt ?? null,
  };
}

export function saveState(state: BotState, path = rootPath("state.json")): void {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** drop ids whose date is before today (yyyy-mm-dd encoded as prefix when using composite ids) */
export function prunePastSlots(state: BotState, currentSlots: Slot[]): BotState {
  const today = todayYmd();
  const currentIds = new Set(currentSlots.map((s) => s.id));
  const dateById = new Map(currentSlots.map((s) => [s.id, s.date]));

  const kept = state.seenSlotIds.filter((id) => {
    const date = dateById.get(id);
    if (date) return date >= today;
    // id no longer in feed — keep briefly only if it looks like date-prefixed, else drop
    if (/^\d{4}-\d{2}-\d{2}/.test(id)) return id.slice(0, 10) >= today;
    // unknown orphan: drop if not in current feed
    return currentIds.has(id);
  });

  return { ...state, seenSlotIds: kept };
}

export function diffNewSlots(state: BotState, slots: Slot[]): Slot[] {
  const seen = new Set(state.seenSlotIds);
  return slots.filter((s) => !seen.has(s.id));
}

export function markSeen(state: BotState, slots: Slot[]): BotState {
  const set = new Set(state.seenSlotIds);
  for (const s of slots) set.add(s.id);
  return {
    ...state,
    seenSlotIds: [...set],
    lastSuccessAt: new Date().toISOString(),
    consecutiveFailures: 0,
  };
}

export function markFailure(state: BotState): BotState {
  return {
    ...state,
    consecutiveFailures: state.consecutiveFailures + 1,
  };
}

/** true when we should send a failure alert (first failure, then at most once/day) */
export function shouldAlertFailure(state: BotState): boolean {
  if (state.consecutiveFailures < 1) return false;
  if (!state.lastFailureAlertAt) return true;
  const last = Date.parse(state.lastFailureAlertAt);
  if (Number.isNaN(last)) return true;
  return Date.now() - last > 24 * 60 * 60 * 1000;
}

export function markFailureAlertSent(state: BotState): BotState {
  return { ...state, lastFailureAlertAt: new Date().toISOString() };
}
