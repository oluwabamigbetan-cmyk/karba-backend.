import "dotenv/config";
import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

/** CORS: allow Vercel front-end (and localhost for testing) */
const ALLOWED = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb){
    if (!origin) return cb(null, true); // curl / server-to-server
    const ok = ALLOWED.some(a => origin.endsWith(a) || origin === a);
    return ok ? cb(null, true) : cb(new Error(`CORS blocked for origin ${origin}`));
  }
}));

/** Health */
app.get("/api/health", (req,res) => {
  res.json({ ok:true, time:new Date().toISOString() });
});

/** Mail transport (Gmail SMTP using App Password) */
function buildTransport(){
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error("Missing SMTP env");
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

/** Verify reCAPTCHA v3 server-side */
async function verifyRecaptcha(token){
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) return { ok:false, reason:"missing secret" };
  if (!token)  return { ok:false, reason:"missing token" };

  const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method:"POST",
    headers: { "Content-Type":"application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token })
  });
  const j = await r.json();
  // Accept score >= 0.5
  return { ok: !!(j.success && (j.score ?? 0) >= 0.5), raw: j };
}

/** Lead endpoint */
app.post("/api/leads", async (req,res) => {
  try {
    const { name, email, phone, service, message, recaptchaToken } = req.body || {};
    if (!name || !email || !service) {
      return res.status(400).json({ ok:false, message:"Missing name, email, or service." });
    }

    const v = await verifyRecaptcha(recaptchaToken);
    if (!v.ok) {
      return res.status(400).json({ ok:false, message:"reCAPTCHA failed", details:v.raw || v.reason });
    }

    const EMAIL_FROM = process.env.EMAIL_FROM || `KARBA Leads desk <${process.env.SMTP_USER}>`;
    const EMAIL_TO   = process.env.EMAIL_TO   || process.env.SMTP_USER;

    const transport = buildTransport();
    const subject = `New Lead from ${name}`;
    const html = `
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone || "-"}</p>
      <p><strong>Service:</strong> ${service}</p>
      <p><strong>Message:</strong><br/>${(message || "").replace(/\n/g,"<br/>")}</p>
    `;

    await transport.sendMail({
      from: EMAIL_FROM,
      to: EMAIL_TO,
      subject,
      html,
      replyTo: email
    });

    res.json({ ok:true, message:"Lead sent" });
  } catch (err) {
    console.error("[LEADS_ERROR]", err);
    res.status(500).json({ ok:false, message:"Server error" });
  }
});

/** Start */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`KARBA backend listening on ${PORT}`);
});
