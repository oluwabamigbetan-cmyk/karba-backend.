import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import "dotenv/config";

const app = express();
app.use(express.json());

// CORS – allow Vercel site + local dev
const allow = (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb){
    if (!origin) return cb(null, true);
    if (allow.length && allow.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked for origin ${origin}`));
  }
}));

// Health
app.get("/api/health", (req,res) => {
  res.json({ ok:true, time: new Date().toISOString() });
});

// Verify reCAPTCHA v3
async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret || !token) return { ok:false, reason:"missing" };
  const resp = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method:"POST",
    headers: { "Content-Type":"application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token })
  });
  const data = await resp.json();
  return { ok: !!data.success, score: data.score ?? 0, data };
}

// Nodemailer transport (Gmail app password)
function mailer() {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = +(process.env.SMTP_PORT || 465);
  if (!user || !pass) throw new Error("Missing SMTP env");
  return nodemailer.createTransport({ host, port, secure:true, auth:{ user, pass } });
}

// Lead endpoint
app.post("/api/leads", async (req,res) => {
  const { name, email, phone, service, message, recaptchaToken } = req.body || {};
  if (!name || !email || !service) return res.status(400).json({ ok:false, message:"Missing name, email, or service." });

  // reCAPTCHA
  const rc = await verifyRecaptcha(recaptchaToken);
  if (!rc.ok || rc.score < 0.3) return res.status(400).json({ ok:false, message:"reCAPTCHA failed", rc });

  try {
    const FROM = process.env.EMAIL_FROM || `KARBA Leads desk <${process.env.SMTP_USER}>`;
    const TO   = process.env.EMAIL_TO   || process.env.SMTP_USER;
    const subject = `New Lead from ${name}`;

    const html = `
      <h2>New Lead</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone||"-"}</p>
      <p><strong>Service:</strong> ${service}</p>
      <p><strong>Message:</strong><br/>${(message||"").replace(/\n/g,"<br/>")}</p>
    `;

    const transport = mailer();
    await transport.sendMail({ from: FROM, to: TO, replyTo: email, subject, html });
    res.json({ ok:true, message:"Lead received" });
  } catch (err) {
    console.error("[MAIL ERROR]", err);
    res.status(500).json({ ok:false, message:"Server error (email)" });
  }
});

// Avoid favicon noise
app.get("/favicon.ico", (req,res) => res.status(204).end());

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`KARBA backend listening on ${PORT}`));
