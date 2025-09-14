import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";

// If running locally, uncomment:
// import dotenv from "dotenv";
// dotenv.config();

const app = express();
app.use(express.json());

// ----- CORS
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
// Always allow Render health checks
app.use(cors({
  origin: ['https://karba-site.vercel.app'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// ----- Health
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ----- reCAPTCHA verify
async function verifyRecaptcha(token, ip) {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret || !token) return { success: false, score: 0, reason: "missing" };
  const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token, remoteip: ip })
  });
  const j = await r.json().catch(() => ({}));
  return j;
}

// ----- Mail transport
function buildTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) throw new Error("Missing SMTP env");
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

// ----- Lead endpoint
app.post("/api/leads", async (req, res) => {
  try {
    const { name, email, phone, service, message, recaptchaToken } = req.body || {};
    if (!name || !email || !service) return res.status(400).json({ ok: false, message: "Missing name, email, or service." });

    // reCAPTCHA
    const rc = await verifyRecaptcha(recaptchaToken, req.ip);
    if (!rc.success || (rc.score ?? 0) < 0.5) {
      return res.status(400).json({ ok: false, message: "reCAPTCHA failed", details: rc });
    }

    // send email
    const EMAIL_FROM = process.env.EMAIL_FROM || process.env.SMTP_USER;
    const EMAIL_TO = process.env.EMAIL_TO || process.env.SMTP_USER;
    const transport = buildTransport();

    const subject = `New Lead from ${name}`;
    const html = `
      <h2>${subject}</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone || ""}</p>
      <p><strong>Service:</strong> ${service}</p>
      <p><strong>Message:</strong> ${message || ""}</p>
    `;

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

// Avoid favicon noise
app.get("/favicon.ico", (req, res) => res.status(204).end());

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("KARBA backend listening on", PORT));
