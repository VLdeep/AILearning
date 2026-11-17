import { NextRequest, NextResponse } from "next/server";
import { nextAction, resolveTimeZone } from "@/lib/attendance";
import { createChallenge, discardChallenge, normalizeMobile, normalizeName } from "@/lib/otp";
import { isOtpDevMode, sendSms } from "@/lib/sms";
import { AppError, withLock } from "@/lib/store";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const name = normalizeName(body.name);
    const mobile = normalizeMobile(String(body.mobile ?? ""));
    const tz = resolveTimeZone(body.tz);

    const { challenge, code, ttlSeconds, resendSeconds } = await withLock(async () => {
      const action = await nextAction(mobile, tz);
      return createChallenge(name, mobile, action);
    });

    const label = challenge.action === "check-in" ? "check in" : "check out";
    try {
      await sendSms(mobile, `${code} is your OTP to ${label}. Valid for ${ttlSeconds / 60} minutes.`);
    } catch (err) {
      console.error(err);
      await withLock(() => discardChallenge(challenge.id));
      return NextResponse.json({ error: "Could not send OTP. Please try again." }, { status: 502 });
    }

    return NextResponse.json({
      challengeId: challenge.id,
      action: challenge.action,
      mobile,
      ttlSeconds,
      resendSeconds,
      ...(isOtpDevMode() ? { devCode: code } : {}),
    });
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
