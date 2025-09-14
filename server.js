// server.js — Express + CORS + reCAPTCHA v3 verify + Nodemailer
import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";

// Node 18+ has global fetch
const app = express();
app.use(express.json());

// ---- CORS (allow your Vercel site) ----
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // allow curl/postman
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked (not in ALLOWED_ORIGINS): ${origin}`));
  }
}));

// ---- Health ----
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---- Helpers ----
async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return { ok: false, reason: "missing secret" };
  try {
    const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token })
    });
    const json = await r.json();
    // json.success === true when valid
    return { ok: !!json.success, raw: json };
  } catch (e) {
    return { ok: false, reason: "recaptcha fetch error" };
  }
}

function buildTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) throw new Error("Missing SMTP env");
  return nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass }
  });
}

// ---- Lead endpoint ----
app.post("/api/leads", async (req, res) => {
  const { name, email, phone, service, message, recaptchaToken } = req.body || {};
  if (!name || !email || !service) {
    return res.status(400).json({ ok: false, message: "Missing name, email, or service." });
  }

  // Verify reCAPTCHA
  const rc = await verifyRecaptcha(recaptchaToken);
  if (!rc.ok) {
    return res.status(400).json({ ok: false, message: "reCAPTCHA failed", details: rc.raw || rc.reason });
  }

  // Send email
  try {
    const EMAIL_FROM = process.env.EMAIL_FROM || process.env.SMTP_USER;
    const EMAIL_TO = process.env.EMAIL_TO || process.env.SMTP_USER;
    const transport = buildTransport();

    const subject = `New Lead from ${name} — ${service}`;
    const html = `
      <h2>New Lead</h2>
      <p><b>Name:</b> ${name}</p>
      <p><b>Email:</b> ${email}</p>
      <p><b>Phone:</b> ${phone || "-"}</p>
      <p><b>Service:</b> ${service}</p>
      <p><b>Message:</b><br>${(message || "").replace(/\n/g,"<br>")}</p>
    `;

    await transport.sendMail({
      from: EMAIL_FROM,
      to: EMAIL_TO,
      replyTo: email,
      subject,
      html
    });

    res.json({ ok: true, message: "Lead received" });
  } catch (err) {
    console.error("[MAIL ERROR]", err);
    res.status(500).json({ ok: false, message: "mail error" });
  }
});

// ---- Start ----
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`KARBA backend listening on ${PORT}`));
