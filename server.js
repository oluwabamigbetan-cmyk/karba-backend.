// server.js
// Minimal Express backend with CORS + reCAPTCHA v3 verification

import express from "express";
import cors from "cors";

// ---- ENV ----
const PORT = process.env.PORT || 10000;
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET || "";
const ORIGINS = [
  ...(process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : []),
  ...(process.env.CORS_ORIGIN_2 ? [process.env.CORS_ORIGIN_2] : []),
].filter(Boolean);

// ---- APP ----
const app = express();
app.use(express.json());

// CORS (allow exactly your Vercel site)
app.use(
  cors({
    origin: function (origin, cb) {
      // Allow same-origin / server-to-server / curl (no Origin)
      if (!origin) return cb(null, true);
      if (ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error(`CORS blocked: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
  })
);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Verify reCAPTCHA v3 with Google
async function verifyRecaptchaV3(token) {
  if (!RECAPTCHA_SECRET) {
    return { ok: false, reason: "missing-secret" };
  }
  const url = "https://www.google.com/recaptcha/api/siteverify";
  const body = new URLSearchParams({
    secret: RECAPTCHA_SECRET,
    response: token || "",
  });

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await r.json().catch(() => ({}));

  // Accept if success and score ≥ 0.3
  const ok = !!json.success && (json.score ?? 0) >= 0.3;
  return { ok, raw: json };
}

// Leads endpoint
app.post("/api/leads", async (req, res) => {
  try {
    const {
      fullName = "",
      email = "",
      phone = "",
      service = "",
      message = "",
      recaptchaToken = "",
    } = req.body || {};

    // Basic validation
    if (!fullName || !email) {
      return res.status(400).json({ ok: false, error: "Missing name or email" });
    }

    // reCAPTCHA check
    const verdict = await verifyRecaptchaV3(recaptchaToken);
    if (!verdict.ok) {
      return res
        .status(403)
        .json({ ok: false, error: "Failed reCAPTCHA", details: verdict.raw || verdict.reason });
    }

    // TODO: persist or notify (email/Sheet/DB). For now, echo back.
    const received = { fullName, email, phone, service, message };
    return res.json({ ok: true, received });
  } catch (err) {
    console.error("Lead error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ---- START ----
app.listen(PORT, () => {
  console.log(`KARBA backend listening on ${PORT}`);
  console.log("Allowed origins:", ORIGINS);
});
