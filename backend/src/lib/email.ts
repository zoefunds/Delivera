/**
 * Brevo transactional email. Used for email verification, password reset and
 * contract notifications. Failures are logged, never thrown — email must not
 * break API flows.
 */
import { config } from "../config.js";
import { logger } from "./logger.js";

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

async function send(to: string, subject: string, html: string): Promise<void> {
  try {
    const res = await fetch(BREVO_URL, {
      method: "POST",
      headers: {
        "api-key": config.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { email: config.BREVO_SENDER_EMAIL, name: config.BREVO_SENDER_NAME },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, body: await res.text() }, "brevo send failed");
    }
  } catch (err) {
    logger.warn({ err }, "brevo send error");
  }
}

const layout = (title: string, body: string) => `
<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0f172a">
  <h2 style="margin:0 0 4px;color:#4f46e5">Delivera</h2>
  <h3 style="margin:0 0 16px">${title}</h3>
  <div style="font-size:15px;line-height:1.6">${body}</div>
  <p style="margin-top:32px;font-size:12px;color:#64748b">Performance-based contracting, verified by GenLayer validators.</p>
</div>`;

export const email = {
  verification: (to: string, token: string) =>
    send(to, "Verify your Delivera email", layout("Verify your email",
      `<p>Welcome to Delivera! Confirm your email to activate your account.</p>
       <p><a href="${config.APP_URL}/verify-email?token=${token}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Verify email</a></p>
       <p>This link expires in 24 hours.</p>`)),

  passwordReset: (to: string, token: string) =>
    send(to, "Reset your Delivera password", layout("Reset your password",
      `<p>We received a request to reset your password.</p>
       <p><a href="${config.APP_URL}/reset-password?token=${token}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Reset password</a></p>
       <p>This link expires in 30 minutes. If you didn't ask for this, ignore this email.</p>`)),

  notify: (to: string, subject: string, message: string, ctaPath?: string) =>
    send(to, subject, layout(subject,
      `<p>${message}</p>${ctaPath ? `<p><a href="${config.APP_URL}${ctaPath}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Open Delivera</a></p>` : ""}`)),
};
