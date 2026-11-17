import { randomUUID } from "crypto";
import { AppError, readJson, writeJson } from "./store";

export type WorkSession = {
  id: string;
  name: string;
  mobile: string;
  date: string;
  checkIn: string;
  checkOut: string | null;
};

export type AttendanceAction = "check-in" | "check-out";

const FILE = "attendance.json";
export const HOLIDAY_WEEKDAYS = ["Sat", "Sun"];

export function resolveTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export function localDay(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday,
    isHoliday: HOLIDAY_WEEKDAYS.includes(weekday),
  };
}

export function readSessions() {
  return readJson<WorkSession[]>(FILE, []);
}

export async function sessionsFor(mobile: string) {
  return (await readSessions())
    .filter((s) => s.mobile === mobile)
    .sort((a, b) => b.checkIn.localeCompare(a.checkIn));
}

/** Decides the next action for a mobile number; throws if it's not allowed right now. Call inside withLock. */
export async function nextAction(mobile: string, timeZone: string): Promise<AttendanceAction> {
  const sessions = await readSessions();
  if (sessions.some((s) => s.mobile === mobile && s.checkOut === null)) return "check-out";
  if (localDay(new Date(), timeZone).isHoliday) {
    throw new AppError("Saturday and Sunday are holidays. Check-in is disabled.", 400);
  }
  return "check-in";
}

/** Performs the action. Call inside withLock. */
export async function applyAction(
  action: AttendanceAction,
  name: string,
  mobile: string,
  timeZone: string,
) {
  const sessions = await readSessions();
  const open = sessions.find((s) => s.mobile === mobile && s.checkOut === null);
  const now = new Date();

  if (action === "check-in") {
    if (open) throw new AppError("You are already checked in.", 409);
    const day = localDay(now, timeZone);
    if (day.isHoliday) {
      throw new AppError("Saturday and Sunday are holidays. Check-in is disabled.", 400);
    }
    sessions.push({
      id: randomUUID(),
      name,
      mobile,
      date: day.date,
      checkIn: now.toISOString(),
      checkOut: null,
    });
  } else {
    if (!open) throw new AppError("You are not checked in.", 409);
    open.checkOut = now.toISOString();
  }
  await writeJson(FILE, sessions);
}
