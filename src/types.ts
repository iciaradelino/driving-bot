export type Slot = {
  id: string;
  date: string; // yyyy-mm-dd
  startTime: string; // hh:mm or hh:mm:ss
  endTime?: string;
  instructorName?: string;
  lessonTypeName?: string;
  startingPointName?: string;
  durationMinutes?: number;
  status?: string;
  raw?: unknown;
};

export type AppConfig = {
  calendarUrl: string;
  lookaheadDays: number;
  weekdays: number[]; // iso 1=mon .. 7=sun
  timeWindow: {
    start: string; // hh:mm
    end: string; // hh:mm
  };
  jitterSecondsMax: number;
  userAgent: string;
};

export type BotState = {
  seenSlotIds: string[];
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  lastFailureAlertAt: string | null;
};

export type CapturedRequest = {
  url: string;
  method: string;
  status: number;
  reqHeaders: Record<string, string>;
  requestBody: string | null;
  responseBody: string;
  capturedAt: string;
};
