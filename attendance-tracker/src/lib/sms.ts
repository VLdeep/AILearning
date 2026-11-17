export function isOtpDevMode() {
  return process.env.OTP_DEV_MODE === "true" || !process.env.TWILIO_ACCOUNT_SID;
}

export async function sendSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    if (process.env.NODE_ENV === "production" && process.env.OTP_DEV_MODE !== "true") {
      throw new Error("SMS provider is not configured");
    }
    console.log(`[sms:dev] to=${to} body=${body}`);
    return;
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) {
    throw new Error(`Twilio error ${res.status}: ${await res.text()}`);
  }
}
