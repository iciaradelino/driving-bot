import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "./types.js";

const ROOT = resolve(import.meta.dirname, "..");

/** load key=value pairs from .env if present (no dependency) */
export function loadEnvFile(path = resolve(ROOT, ".env")): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadConfig(path = resolve(ROOT, "config.json")): AppConfig {
  return JSON.parse(readFileSync(path, "utf8")) as AppConfig;
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

export function rootPath(...parts: string[]): string {
  return resolve(ROOT, ...parts);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10) || 0);
  return h * 60 + m;
}

/** iso weekday 1=mon .. 7=sun for a yyyy-mm-dd date (utc calendar day) */
export function isoWeekday(dateYmd: string): number {
  const [y, mo, d] = dateYmd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, d));
  const day = utc.getUTCDay(); // 0=sun
  return day === 0 ? 7 : day;
}

export function addDaysYmd(dateYmd: string, days: number): string {
  const [y, mo, d] = dateYmd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

export function todayYmd(timeZone = "Europe/Madrid"): string {
  // calendar day in spain, not utc (avoids wrong "yesterday" late at night)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
