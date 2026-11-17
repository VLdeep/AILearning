import { createHash, randomInt, randomUUID, timingSafeEqual } from "crypto";
import type { AttendanceAction } from "./attendance";
import { AppError, readJson, writeJson } from "./store";

type Challenge = {
  id: string;
  name: string;
  mobile: string;
  action: AttendanceAction;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
};

const FILE = "otps.json";
const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

const hash = (id: string, code: string) => createHash("sha256").update(`${id}:${code}`).digest("hex");

export function normalizeMobile(input: string): string {
  const cleaned = input.replace(/[\s\-()]/g, "");
  const countryCode = process.env.DEFAULT_COUNTRY_CODE ?? "+91";
  const withCode = /^\d{10}$/.test(cleaned) ? `${countryCode}${cleaned}` : cleaned;
  if (!/^\+\d{10,15}$/.test(withCode)) {
    throw new AppError("Enter a valid mobile number (10 digits, or with + country code).", 400);
  }
  return withCode;
}

export function normalizeName(input: unknown): string {
  const name = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 80) throw new AppError("Enter your name.", 400);
  return name;
}

async function liveChallenges() {
  const now = Date.now();
  return (await readJson<Challenge[]>(FILE, [])).filter((c) => c.expiresAt > now);
}

/** Creates a challenge and returns it with the plain code. Call inside withLock. */
export async function createChallenge(name: string, mobile: string, action: AttendanceAction) {
  const challenges = await liveChallenges();
  const recent = challenges.find((c) => c.mobile === mobile && Date.now() - c.createdAt < RESEND_COOLDOWN_MS);
  if (recent) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - recent.createdAt)) / 1000);
    throw new AppError(`Please wait ${wait}s before requesting another OTP.`, 429);
  }
  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const challenge: Challenge = {
    id,
    name,
    mobile,
    action,
    codeHash: hash(id, code),
    createdAt: Date.now(),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  };
  await writeJson(FILE, [...challenges.filter((c) => c.mobile !== mobile), challenge]);
  return { challenge, code, ttlSeconds: OTP_TTL_MS / 1000, resendSeconds: RESEND_COOLDOWN_MS / 1000 };
}

export async function discardChallenge(id: string) {
  await writeJson(FILE, (await liveChallenges()).filter((c) => c.id !== id));
}

/** Verifies and consumes a challenge. Call inside withLock. */
export async function verifyChallenge(id: unknown, code: unknown) {
  const challenges = await liveChallenges();
  const challenge = challenges.find((c) => c.id === id);
  if (!challenge) throw new AppError("OTP expired. Please request a new one.", 400);

  const given = Buffer.from(hash(challenge.id, String(code ?? "").trim()));
  const ok = timingSafeEqual(given, Buffer.from(challenge.codeHash));
  if (!ok) {
    challenge.attempts += 1;
    const remaining = MAX_ATTEMPTS - challenge.attempts;
    await writeJson(FILE, remaining > 0 ? challenges : challenges.filter((c) => c.id !== id));
    throw new AppError(
      remaining > 0 ? `Incorrect OTP. ${remaining} attempt(s) left.` : "Too many attempts. Request a new OTP.",
      400,
    );
  }
  await writeJson(FILE, challenges.filter((c) => c.id !== id));
  return challenge;
}
