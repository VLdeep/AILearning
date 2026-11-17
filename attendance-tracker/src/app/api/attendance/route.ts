import { NextRequest, NextResponse } from "next/server";
import { applyAction, localDay, resolveTimeZone, sessionsFor } from "@/lib/attendance";
import { normalizeMobile, verifyChallenge } from "@/lib/otp";
import { AppError, withLock } from "@/lib/store";

export const dynamic = "force-dynamic";

async function snapshot(timeZone: string, mobile: string | null) {
  return {
    today: localDay(new Date(), timeZone),
    sessions: mobile ? await sessionsFor(mobile) : [],
  };
}

function errorResponse(err: unknown) {
  if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: err.status });
  throw err;
}

export async function GET(req: NextRequest) {
  const tz = resolveTimeZone(req.nextUrl.searchParams.get("tz"));
  const raw = req.nextUrl.searchParams.get("mobile");
  try {
    return NextResponse.json(await snapshot(tz, raw ? normalizeMobile(raw) : null));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tz = resolveTimeZone(body.tz);
  try {
    const challenge = await withLock(async () => {
      const c = await verifyChallenge(body.challengeId, body.otp);
      await applyAction(c.action, c.name, c.mobile, tz);
      return c;
    });
    return NextResponse.json({
      action: challenge.action,
      user: { name: challenge.name, mobile: challenge.mobile },
      ...(await snapshot(tz, challenge.mobile)),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
