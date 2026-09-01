/**
 * http client for api.autius.com
 * endpoints taken from the public app bundles; discover.ts can confirm/adjust.
 */
import type { Slot } from "./types.js";
import { addDaysYmd, todayYmd } from "./utils.js";

const DEFAULT_API_BASE = "https://api.autius.com/api/v1";
const DEFAULT_AUTH_BASE = "https://api.autius.com";

const UA_DEFAULT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type AutiusSession = {
  cookieHeader: string;
  apiBase: string;
  authBase: string;
  userAgent: string;
};

type LoginOptions = {
  email: string;
  password: string;
  userAgent?: string;
  apiBase?: string;
  authBase?: string;
};

/** minimal cookie jar for set-cookie → cookie header */
class CookieJar {
  private map = new Map<string, string>();

  absorb(res: Response): void {
    // node fetch exposes getSetCookie when available
    const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
    const list =
      typeof anyHeaders.getSetCookie === "function"
        ? anyHeaders.getSetCookie()
        : (() => {
            const single = res.headers.get("set-cookie");
            return single ? [single] : [];
          })();

    for (const raw of list) {
      const pair = raw.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) continue;
      // deletion
      if (value === "" || /^(?:max-age=0)/i.test(raw)) {
        this.map.delete(name);
        continue;
      }
      this.map.set(name, value);
    }
  }

  header(): string {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  loadFromHeader(cookieHeader: string): void {
    if (!cookieHeader.trim()) return;
    for (const part of cookieHeader.split(";")) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (name) this.map.set(name, value);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

async function request(
  jar: CookieJar,
  url: string,
  init: RequestInit & { userAgent: string },
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("user-agent", init.userAgent);
  headers.set("accept", "application/json, text/plain, */*");
  headers.set("origin", "https://app.autius.com");
  headers.set("referer", "https://app.autius.com/");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);

  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  jar.absorb(res);
  return res;
}

/**
 * better-auth (and similar) sign-in paths seen / expected on this stack.
 * first successful 200 with a session cookie wins.
 */
const SIGN_IN_CANDIDATES = [
  "/api/auth/sign-in/email",
  "/api/auth/signin/email",
  "/api/auth/login",
  "/auth/sign-in/email",
];

export async function login(opts: LoginOptions): Promise<AutiusSession> {
  const apiBase = (opts.apiBase || process.env.AUTIUS_API_BASE || DEFAULT_API_BASE).replace(
    /\/$/,
    "",
  );
  const authBase = (opts.authBase || process.env.AUTIUS_AUTH_BASE || DEFAULT_AUTH_BASE).replace(
    /\/$/,
    "",
  );
  const userAgent = opts.userAgent || UA_DEFAULT;
  const jar = new CookieJar();

  let lastError = "no sign-in candidate succeeded";

  for (const path of SIGN_IN_CANDIDATES) {
    const url = `${authBase}${path}`;
    try {
      const res = await request(jar, url, {
        method: "POST",
        userAgent,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: opts.email,
          password: opts.password,
          rememberMe: true,
        }),
      });

      const text = await res.text();
      if (res.status >= 200 && res.status < 300) {
        // session cookie should now be present; verify with /get-session or /auth/me
        const ok = await sessionLooksValid(jar, apiBase, authBase, userAgent);
        if (ok) {
          return { cookieHeader: jar.header(), apiBase, authBase, userAgent };
        }
        lastError = `signed in via ${path} but session check failed: ${text.slice(0, 200)}`;
        continue;
      }

      // 404 = wrong path, try next; other errors may be real auth failures
      if (res.status === 404 || res.status === 405) {
        lastError = `${path} → ${res.status}`;
        continue;
      }
      lastError = `${path} → ${res.status}: ${text.slice(0, 300)}`;
      // wrong credentials usually 400/401 — no point trying more paths with same body shape
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        break;
      }
    } catch (err) {
      lastError = `${path}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  throw new Error(`autius login failed: ${lastError}`);
}

async function sessionLooksValid(
  jar: CookieJar,
  apiBase: string,
  authBase: string,
  userAgent: string,
): Promise<boolean> {
  const probes = [
    `${authBase}/api/auth/get-session`,
    `${authBase}/get-session`,
    `${apiBase}/auth/me`,
  ];

  for (const url of probes) {
    try {
      const res = await request(jar, url, { method: "GET", userAgent });
      if (res.status === 200) {
        const text = await res.text();
        if (!text || text === "null") continue;
        try {
          const json = JSON.parse(text) as Record<string, unknown>;
          if (json && (json.user || json.session || json.id || json.email || json.data)) {
            return true;
          }
        } catch {
          // non-json 200 still counts if we have cookies
          if (jar.size > 0) return true;
        }
      }
    } catch {
      /* try next */
    }
  }

  return jar.size > 0;
}

export type FetchSlotsOptions = {
  session: AutiusSession;
  lookaheadDays: number;
};

/**
 * pull student calendar pages and return only bookable (available) slots.
 */
export async function fetchSlots(opts: FetchSlotsOptions): Promise<Slot[]> {
  const { session, lookaheadDays } = opts;
  const jar = new CookieJar();
  jar.loadFromHeader(session.cookieHeader);

  const startDate = todayYmd();
  const endDate = addDaysYmd(startDate, lookaheadDays);

  const params = new URLSearchParams({
    startDate,
    endDate,
  });

  const url = `${session.apiBase}/student/lessons/calendar?${params}`;
  const res = await request(jar, url, {
    method: "GET",
    userAgent: session.userAgent,
  });

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new Error(`calendar unauthorized (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(`calendar fetch failed (${res.status}): ${text.slice(0, 300)}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`calendar response was not json: ${text.slice(0, 200)}`);
  }

  const rows = extractLessonRows(json);
  return rows
    .map(normalizeSlot)
    .filter((s): s is Slot => s !== null)
    .filter((s) => isAvailable(s));
}

function extractLessonRows(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["data", "items", "lessons", "results", "slots"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
      if (v && typeof v === "object") {
        const nested = v as Record<string, unknown>;
        if (Array.isArray(nested.data)) return nested.data as Record<string, unknown>[];
        if (Array.isArray(nested.items)) return nested.items as Record<string, unknown>[];
      }
    }
  }
  return [];
}

function pickString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

function normalizeSlot(row: Record<string, unknown>): Slot | null {
  const id = pickString(row, ["id", "lessonId", "_id"]);
  const dateRaw = pickString(row, ["date", "startDate", "day", "lessonDate"]);
  if (!id || !dateRaw) return null;

  const date = dateRaw.slice(0, 10);
  const startTime =
    pickString(row, ["startTime", "start", "from", "hour", "time"])?.slice(0, 8) || "00:00";

  const instructor =
    pickString(row, ["instructorName", "teacherName", "professorName"]) ||
    nestedName(row, ["instructor", "teacher", "professor"]);

  const lessonType =
    pickString(row, ["lessonTypeName", "typeName", "lessonType"]) ||
    nestedName(row, ["lessonType", "type"]);

  const startingPoint =
    pickString(row, ["startingPointName", "startPointName", "meetingPointName"]) ||
    nestedName(row, ["startingPoint", "startPoint", "meetingPoint"]);

  const duration = row.duration ?? row.durationMinutes ?? row.length;
  const durationMinutes = typeof duration === "number" ? duration : undefined;

  return {
    id,
    date,
    startTime,
    endTime: pickString(row, ["endTime", "end", "to"])?.slice(0, 8),
    instructorName: instructor,
    lessonTypeName: lessonType,
    startingPointName: startingPoint,
    durationMinutes,
    status: pickString(row, ["status", "state"]),
    raw: row,
  };
}

function nestedName(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const name = pickString(o, ["name", "fullName", "displayName", "label"]);
      if (name) return name;
    }
  }
  return undefined;
}

/**
 * a slot is "available" when it is not already taken by a student.
 * shapes vary; we accept several common signals from the app bundles.
 */
function isAvailable(slot: Slot): boolean {
  const row = (slot.raw ?? {}) as Record<string, unknown>;
  const status = String(slot.status ?? row.status ?? "").toUpperCase();

  if (["CANCELLED", "CANCELED", "BLOCKED", "DISABLED"].includes(status)) return false;
  if (["AVAILABLE", "OPEN", "FREE"].includes(status)) return true;

  if (row.isAvailable === true || row.available === true || row.isFree === true) return true;
  if (row.isAvailable === false || row.available === false || row.isBooked === true) return false;

  // booked by someone → student / studentId / userCenterId present
  const studentId = row.studentId ?? row.studentUserCenterId ?? row.userCenterId ?? row.bookedById;
  if (studentId !== undefined && studentId !== null && studentId !== "") return false;

  const student = row.student ?? row.bookedBy ?? row.reservation;
  if (student !== undefined && student !== null && student !== false) return false;

  // if the api only returns open slots in the student calendar, keep everything else
  return true;
}

export function formatSlotLine(slot: Slot): string {
  const time = slot.startTime.slice(0, 5);
  const bits = [`**${slot.date}** ${time}`];
  if (slot.instructorName) bits.push(slot.instructorName);
  if (slot.startingPointName) bits.push(slot.startingPointName);
  if (slot.lessonTypeName) bits.push(slot.lessonTypeName);
  if (slot.durationMinutes) bits.push(`${slot.durationMinutes} min`);
  return bits.join(" · ");
}
