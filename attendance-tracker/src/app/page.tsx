"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type WorkSession = {
  id: string;
  name: string;
  mobile: string;
  date: string;
  checkIn: string;
  checkOut: string | null;
};

type Snapshot = {
  today: { date: string; weekday: string; isHoliday: boolean };
  sessions: WorkSession[];
};

type Action = "check-in" | "check-out";

type Challenge = {
  challengeId: string;
  action: Action;
  mobile: string;
  devCode?: string;
  resendAt: number;
  expiresAt: number;
};

type User = { name: string; mobile: string };

const USER_KEY = "attendance-user";
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const actionLabel = (a: Action) => (a === "check-in" ? "Check in" : "Check out");

function durationMs(s: WorkSession, now: number) {
  const end = s.checkOut ? new Date(s.checkOut).getTime() : now;
  return Math.max(0, end - new Date(s.checkIn).getTime());
}

function formatDuration(ms: number) {
  const totalMinutes = Math.floor(ms / 60000);
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
}

function formatTimer(ms: number) {
  const total = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function mondayOf(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const inputClass =
  "w-full rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500";

export default function AttendancePage() {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (forMobile?: string) => {
    const params = new URLSearchParams({ tz: timeZone });
    if (forMobile) params.set("mobile", forMobile);
    const res = await fetch(`/api/attendance?${params}`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(USER_KEY);
    const parsed: User | null = saved ? JSON.parse(saved) : null;
    if (parsed) {
      setUser(parsed);
      setName(parsed.name);
      setMobile(parsed.mobile);
    }
    load(parsed?.mobile);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [load]);

  useEffect(() => {
    const refresh = setInterval(() => load(user?.mobile), 60000);
    return () => clearInterval(refresh);
  }, [load, user]);

  async function post<T>(url: string, body: object): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, tz: timeZone }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong");
        return null;
      }
      return json;
    } catch {
      setError("Network error. Please try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function requestOtp(e?: FormEvent) {
    e?.preventDefault();
    setNotice(null);
    const res = await post<{
      challengeId: string;
      action: Action;
      mobile: string;
      ttlSeconds: number;
      resendSeconds: number;
      devCode?: string;
    }>("/api/otp", { name, mobile });
    if (!res) return;
    setOtp("");
    setChallenge({
      challengeId: res.challengeId,
      action: res.action,
      mobile: res.mobile,
      devCode: res.devCode,
      resendAt: Date.now() + res.resendSeconds * 1000,
      expiresAt: Date.now() + res.ttlSeconds * 1000,
    });
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    const res = await post<Snapshot & { action: Action; user: User }>("/api/attendance", {
      challengeId: challenge.challengeId,
      otp,
    });
    if (!res) return;
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
    setName(res.user.name);
    setMobile(res.user.mobile);
    setData({ today: res.today, sessions: res.sessions });
    setChallenge(null);
    setOtp("");
    setNotice(
      `${res.action === "check-in" ? "Checked in" : "Checked out"} successfully at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`,
    );
  }

  function switchUser() {
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setName("");
    setMobile("");
    setChallenge(null);
    setNotice(null);
    setError(null);
    load();
  }

  const sessions = useMemo(() => data?.sessions ?? [], [data]);
  const open = sessions.find((s) => s.checkOut === null) ?? null;
  const today = data?.today;

  const days = useMemo(() => {
    const map = new Map<string, WorkSession[]>();
    for (const s of sessions) map.set(s.date, [...(map.get(s.date) ?? []), s]);
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [sessions]);

  const sumFor = (filter: (date: string) => boolean) =>
    days
      .filter(([d]) => filter(d))
      .flatMap(([, s]) => s)
      .reduce((sum, s) => sum + durationMs(s, now), 0);

  const todayMs = sumFor((d) => d === today?.date);
  const weekStart = today ? mondayOf(today.date) : "";
  const weekMs = sumFor((d) => d >= weekStart && d <= (today?.date ?? ""));

  const holidayBlocked = !!today?.isHoliday && !open;
  const expectedAction: Action | null = user && mobile === user.mobile ? (open ? "check-out" : "check-in") : null;
  const resendIn = challenge ? Math.max(0, Math.ceil((challenge.resendAt - now) / 1000)) : 0;
  const expired = challenge ? now >= challenge.expiresAt : false;

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Attendance</h1>
        <p className="text-sm opacity-70">
          {new Date(now).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          {" · "}
          {new Date(now).toLocaleTimeString()}
        </p>
      </header>

      <section className="rounded-xl border border-black/10 dark:border-white/15 p-6 space-y-5">
        {today?.isHoliday && (
          <div className="rounded-lg bg-amber-100 text-amber-900 p-4">
            <p className="font-semibold">Today is a holiday ({today.weekday === "Sat" ? "Saturday" : "Sunday"}).</p>
            <p className="text-sm">
              Saturday and Sunday are holidays — check-in is disabled.
              {open && " You can still check out of your open session."}
            </p>
          </div>
        )}

        {user && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <p className="text-sm opacity-70">
                {user.name} · {user.mobile}{" "}
                <button onClick={switchUser} className="underline ml-1">
                  Not you?
                </button>
              </p>
              <p className={`text-xl font-semibold ${open ? "text-green-600" : "opacity-80"}`}>
                {open ? `Checked in since ${formatTime(open.checkIn)}` : "Checked out"}
              </p>
            </div>
            {open && <p className="font-mono text-3xl">{formatTimer(durationMs(open, now))}</p>}
          </div>
        )}

        {notice && <p className="rounded-lg bg-green-100 text-green-900 p-3 text-sm">{notice}</p>}

        {!challenge ? (
          <form onSubmit={requestOtp} className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="space-y-1 text-sm">
                <span className="opacity-70">Name</span>
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  autoComplete="name"
                  required
                  minLength={2}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="opacity-70">Mobile number</span>
                <input
                  className={inputClass}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="10-digit mobile number"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={busy || (holidayBlocked && expectedAction === "check-in")}
              className={`rounded-lg px-6 py-3 font-semibold text-white disabled:opacity-50 ${
                expectedAction === "check-out" ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
              }`}
            >
              {busy ? "Sending…" : expectedAction ? `Send OTP to ${actionLabel(expectedAction).toLowerCase()}` : "Send OTP"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-3">
            <p className="text-sm">
              Enter the 6-digit OTP sent to <span className="font-semibold">{challenge.mobile}</span> to{" "}
              <span className="font-semibold">{actionLabel(challenge.action).toLowerCase()}</span>.
            </p>
            {challenge.devCode && (
              <p className="rounded-lg bg-blue-100 text-blue-900 p-3 text-sm">
                Dev mode (no SMS provider configured): your OTP is <span className="font-mono font-bold">{challenge.devCode}</span>
              </p>
            )}
            <input
              className={`${inputClass} font-mono text-2xl tracking-[0.5em] max-w-56`}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              autoFocus
              required
              pattern="\d{6}"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy || otp.length !== 6 || expired}
                className={`rounded-lg px-6 py-3 font-semibold text-white disabled:opacity-50 ${
                  challenge.action === "check-out" ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
                }`}
              >
                {busy ? "Verifying…" : `Verify & ${actionLabel(challenge.action).toLowerCase()}`}
              </button>
              <button
                type="button"
                onClick={() => requestOtp()}
                disabled={busy || resendIn > 0}
                className="text-sm underline disabled:no-underline disabled:opacity-50"
              >
                {resendIn > 0 ? `Resend OTP in ${resendIn}s` : "Resend OTP"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setChallenge(null);
                  setError(null);
                }}
                className="text-sm underline"
              >
                Change details
              </button>
            </div>
            {expired && <p className="text-sm text-red-600">OTP expired. Please resend.</p>}
          </form>
        )}

        {error && <p className="text-red-600 text-sm">{error}</p>}

        {user && (
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="rounded-lg bg-black/5 dark:bg-white/10 p-4">
              <p className="text-sm opacity-70">Worked today</p>
              <p className="text-2xl font-semibold">{formatDuration(todayMs)}</p>
            </div>
            <div className="rounded-lg bg-black/5 dark:bg-white/10 p-4">
              <p className="text-sm opacity-70">This week (Mon–Fri)</p>
              <p className="text-2xl font-semibold">{formatDuration(weekMs)}</p>
            </div>
          </div>
        )}
      </section>

      {user && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">History</h2>
          {days.length === 0 ? (
            <p className="opacity-70 text-sm">No records yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
              <table className="w-full text-sm">
                <thead className="bg-black/5 dark:bg-white/10 text-left">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">Check in</th>
                    <th className="p-3">Check out</th>
                    <th className="p-3 text-right">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map(([date, daySessions]) => {
                    const ordered = [...daySessions].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
                    const total = daySessions.reduce((sum, s) => sum + durationMs(s, now), 0);
                    return ordered.map((s, i) => (
                      <tr key={s.id} className="border-t border-black/10 dark:border-white/15">
                        {i === 0 && (
                          <td className="p-3 align-top font-medium" rowSpan={ordered.length}>
                            {formatDate(date)}
                            <div className="text-xs opacity-70">Total {formatDuration(total)}</div>
                          </td>
                        )}
                        <td className="p-3">{formatTime(s.checkIn)}</td>
                        <td className="p-3">
                          {s.checkOut ? formatTime(s.checkOut) : <span className="text-green-600">In progress</span>}
                        </td>
                        <td className="p-3 text-right font-mono">{formatDuration(durationMs(s, now))}</td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
