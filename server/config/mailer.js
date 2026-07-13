import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
dotenv.config()

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export async function sendOTPEmail(toEmail, toName, otp) {
  await transporter.sendMail({
    from:    process.env.SMTP_FROM,
    to:      `${toName} <${toEmail}>`,
    subject: 'ADSSU – Your Password Change OTP',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="background:#166534;padding:24px 32px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">ADSSU Room Scheduling System</h2>
          <p style="color:#86efac;margin:4px 0 0;font-size:13px;">Agusan del Sur State University</p>
        </div>
        <div style="padding:32px;">
          <p style="color:#374151;font-size:15px;">Hello <strong>${toName}</strong>,</p>
          <p style="color:#6b7280;font-size:14px;">You requested to change your password. Use the OTP below:</p>
          <div style="background:#f0fdf4;border:2px dashed #16a34a;border-radius:10px;padding:24px;text-align:center;margin:24px 0;">
            <p style="margin:0;font-size:13px;color:#15803d;font-weight:600;letter-spacing:1px;">YOUR ONE-TIME PASSWORD</p>
            <p style="margin:8px 0 0;font-size:42px;font-weight:900;color:#14532d;letter-spacing:12px;">${otp}</p>
          </div>
          <p style="color:#6b7280;font-size:13px;">This OTP is valid for <strong>10 minutes</strong>. Do not share it with anyone.</p>
          <p style="color:#6b7280;font-size:13px;">If you did not request this, you can ignore this email.</p>
        </div>
        <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">Sent by ADSSU Room Scheduling System &mdash; Do not reply to this email.</p>
        </div>
      </div>
    `,
  })
}

export default transporter
