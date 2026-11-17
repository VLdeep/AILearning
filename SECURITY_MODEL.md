# Security model — VLdeep/AILearning (attendance-tracker)

Facts marked **(user)** were confirmed by the repository owner. Everything else is inferred from the code.

## System overview
`attendance-tracker/` is a Next.js 15 (App Router) app. Users check in and out to record working hours. Each check-in or check-out needs a name, a mobile number and a 6-digit SMS OTP sent through Twilio. There are no accounts or sessions: **the mobile number plus the OTP is the identity**. Saturday and Sunday are holidays, and the server blocks check-ins on those days. Data is stored as JSON files under `attendance-tracker/data/` (`attendance.json`, `otps.json`). Writes go through `src/lib/store.ts`, which serializes them with an in-process promise queue (`withLock`).

Deployment **(user)**: public internet (e.g. Vercel). The user says an infrastructure repository exists, but it is not yet named or accessible, so deployment controls (TLS, WAF, edge rate limiting) are unknown. Note: on serverless hosts such as Vercel, the local `data/` filesystem and the in-process `withLock` do not persist or serialize across instances.

## Components
| Component | Code |
|---|---|
| Web UI | `attendance-tracker/src/app/page.tsx`, `layout.tsx`, `globals.css` (keeps the last user in `localStorage`; shows `devCode` in dev mode) |
| OTP API | `attendance-tracker/src/app/api/otp/route.ts`, `src/lib/otp.ts` |
| Attendance API | `attendance-tracker/src/app/api/attendance/route.ts`, `src/lib/attendance.ts` |
| SMS Provider | `attendance-tracker/src/lib/sms.ts` (Twilio REST, env credentials) |
| Data Store | `attendance-tracker/src/lib/store.ts`, `attendance-tracker/data/` |
| Config | `next.config.ts`, `.env.example`, `package.json` (dependencies) |

## Trust boundaries and entry points
All entry points are unauthenticated and reachable by anyone who can reach the app.
- `POST /api/otp {name, mobile, tz}`: picks the next action and sends an SMS OTP. Returns `devCode` when `isOtpDevMode()` is true (`OTP_DEV_MODE=true`, or `TWILIO_ACCOUNT_SID` unset).
- `POST /api/attendance {challengeId, otp, tz}`: verifies the OTP (5 attempts, 5-minute TTL) and records a check-in or check-out.
- `GET /api/attendance?tz=&mobile=`: returns attendance history for a mobile number. It needs no OTP.
- `tz` comes from the client and decides the "local day" used for the holiday rule.
- Outbound: Twilio API, using `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`.

## Assets
- **Employee personal data (names, mobile numbers, attendance history): the most critical asset (user).**
- Attendance record integrity: who worked when.
- Twilio credentials, plus the SMS balance and sender reputation (SMS pumping/toll fraud).
- App availability, which depends on the single JSON store and the in-process lock.

## Attackers
- **In scope (user): employees faking attendance** for themselves or a colleague (buddy punching), dodging the holiday rule, changing hours, or reading colleagues' data. Employees know colleagues' names and mobile numbers.
- **Not selected (user):** anonymous internet users were not chosen as an attacker that matters, even though the app is public. Issues that only an outside attacker with no employee knowledge could exploit (pure DoS, SMS spam by strangers) are lower priority. Anything an employee can also do stays in scope.

## Existing controls
- OTP: `crypto.randomInt`, SHA-256 hash bound to the challenge id, `timingSafeEqual`, 5 attempts, 5-minute TTL, 30-second resend cooldown per number. A challenge is consumed on success.
- Mobile and name normalization and validation (`normalizeMobile`, `normalizeName`).
- Atomic temp-file-plus-rename writes. Writes are serialized within one process only.
- Server-side holiday check, both when the OTP is issued and when the action is applied.
- `.env*` and `data/*.json` are gitignored.

## Out of scope / accepted risk (user)
- OTP dev mode (`OTP_DEV_MODE=true`, or Twilio not configured, which shows the OTP on screen and in logs) is **for testing only**. Findings that exist only while dev mode is on are accepted risk. Findings where production silently falls into dev mode are not covered by this.

## Open questions
- Name of the infrastructure repository and access to it.
