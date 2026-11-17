# Attendance Tracker

Next.js page to check in / check out and record working hours. Each check-in/check-out requires name, mobile number and an SMS OTP. Saturday and Sunday are holidays (check-in is blocked on the server).

- Page: `src/app/page.tsx`
- API: `POST /api/otp {name, mobile, tz}` sends an OTP (action is decided automatically); `POST /api/attendance {challengeId, otp, tz}` verifies it and checks in/out; `GET /api/attendance?tz=&mobile=` returns history
- Logic: `src/lib/attendance.ts`, `src/lib/otp.ts`, `src/lib/sms.ts` (records saved under `data/`)

## SMS / OTP

Copy `.env.example` to `.env.local` and set the Twilio credentials. Without them the app runs in dev mode and shows the OTP on screen (in production, set `OTP_DEV_MODE=true` to allow this).

OTPs: 6 digits, valid 5 minutes, 5 attempts, 30 s resend cooldown.

```bash
npm install
npm run dev   # http://localhost:3000
```
