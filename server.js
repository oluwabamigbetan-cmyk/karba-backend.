import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import nodemailer from "nodemailer";

const app = express();
const PORT = process.env.PORT || 10000;

// Load environment variables
const {
  RECAPTCHA_SECRET,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  EMAIL_FROM,
  EMAIL_TO,
  CORS_ORIGIN,
} = process.env;

// Middleware
app.use(express.json());

// CORS
app.use(
  cors({
    origin: CORS_ORIGIN || "*",
  })
);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// --- Helpers ---
async function verifyRecaptcha(token, remoteIp) {
  const url = "https://www.google.com/recaptcha/api/siteverify";
  const params = new URLSearchParams();
  params.append("secret", RECAPTCHA_SECRET);
  params.append("response", token);
  if (remoteIp) params.append("remoteip", remoteIp);

  const r = await fetch(url, { method: "POST", body: params });
  const j = await r.json().catch(() => ({}));
  return j; // { success, score, action, ... }
}

function buildMailTransport() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM || !EMAIL_TO) {
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465, // true for 465, false for others
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

// --- Routes ---
app.post("/api/leads", async (req, res) => {
  try {
    const { name, email, phone, service, message, recaptchaToken } = req.body;

    // Validate reCAPTCHA
    const recap = await verifyRecaptcha(
      recaptchaToken,
      req.headers["x-forwarded-for"] || req.socket.remoteAddress
    );

    if (!recap.success || recap.score < 0.3) {
      return res.status(403).json({ error: "Failed reCAPTCHA", recap });
    }

    // Prepare email
    const transport = buildMailTransport();
    if (transport) {
      const mailOptions = {
        from: EMAIL_FROM,
        to: EMAIL_TO,
        subject: `New Lead from ${name}`,
        text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\nService: ${service}\nMessage: ${message}`,
      };

      await transport.sendMail(mailOptions);
      console.log("[SMTP] Lead email sent");
    }

    res.json({ ok: true, message: "Lead received" });
  } catch (err) {
    console.error("Lead error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// === Verify SMTP at startup ===
const transport = buildMailTransport();
if (transport) {
  transport
    .verify()
    .then(() => console.log("[SMTP] OK: ready to send"))
    .catch((err) => console.error("[SMTP] FAIL", err));
} else {
  console.warn("[SMTP] Missing environment variables, mail disabled");
}
