import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import "dotenv/config";

const app = express();
app.use(express.json());

// CORS: allow your Vercel site + (optionally) localhost for testing
const allow = (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    // no Origin for server-to-server or curl -> allow
    if (!origin) return cb(null, true);
    if (allow.length && allow.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked for origin ${origin}`));
  }
}));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Verify reCAPTCHA v3
async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) return { ok: false, reason: "missing RECAPTCHA_SECRET" };
  if (!token)  return { ok: false, reason: "missing token" };

  const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`
  });
  const data = await r.json().catch(() => ({}));
  if (!data.success) return { ok: false, reason: "recaptcha failed", details: data };
  // Optional: check score >= 0.3
  if (typeof data.score === "number" && data.score < 0.3) {
    return { ok: false, reason: "low score", details: data };
  }
  return { ok: true };
}

function buildTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error("Missing SMTP env");
  }
  const port = Number(SMTP_PORT);
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // true for Gmail SSL
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

// Lead endpoint
app.post("/api/leads", async (req, res) => {
  try {
    const { name, email, phone, service, message, recaptchaToken } = req.body || {};
    if (!name || !email || !service) {
      return res.status(400).json({ ok: false, message: "Missing name, email, or service." });
    }

    const v = await verifyRecaptcha(recaptchaToken);
    if (!v.ok) return res.status(400).json({ ok: false, message: "reCAPTCHA failed", details: v });

    const EMAIL_FROM = process.env.EMAIL_FROM || process.env.SMTP_USER;
    const EMAIL_TO   = process.env.EMAIL_TO || process.env.SMTP_USER;

    const subject = `New Lead from ${name}`;
    const html = `
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone || "-"}</p>
      <p><strong>Service:</strong> ${service}</p>
      <p><strong>Message:</strong><br/>${(message || "").replace(/\n/g,"<br/>")}</p>
    `;

    const transport = buildTransport();
    await transport.sendMail({
      from: EMAIL_FROM,
      to: EMAIL_TO,
      subject,
      html,
      replyTo: email
    });

    res.json({ ok: true, message: "Lead received" });
  } catch (err) {
    console.error("[LEADS ERROR]", err);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

// Avoid Render 404 noise
app.get("/favicon.ico", (_req, res) => res.status(204).end());

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`KARBA backend listening on ${PORT}`));
