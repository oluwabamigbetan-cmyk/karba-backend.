// server.js
// KARBA backend with reCAPTCHA v3 verification

const express = require('express');
const cors = require('cors');

const app = express();

// --- ENV ---
const PORT = process.env.PORT || 10000;
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || '*';
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET; // from Google admin (keep private)

// --- MIDDLEWARE ---
app.use(cors({
  origin: (origin, cb) => {
    // allow server-to-server/no-origin requests (curl, render health checks)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGIN === '*' || origin === ALLOWED_ORIGIN) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
}));
app.use(express.json());

// --- HEALTH ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// --- reCAPTCHA v3 VERIFY ---
async function verifyRecaptchaV3(token) {
  if (!RECAPTCHA_SECRET) return { ok: false, reason: 'Missing RECAPTCHA_SECRET' };
  if (!token)            return { ok: false, reason: 'Missing token' };

  // Build form body Google expects: secret + response
  const params = new URLSearchParams();
  params.append('secret', RECAPTCHA_SECRET);
  params.append('response', token);

  // IMPORTANT: correct URL uses "api" (not "qpi")
  const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  const result = await r.json(); // { success, score, action, ... }

  // Accept if Google says success and score is decent (threshold 0.3)
  const ok = result.success && (result.score ?? 0) >= 0.3;
  return { ok, raw: result };
}

// --- LEADS ---
app.post('/api/leads', async (req, res) => {
  try {
    const { recaptchaToken, fullName, email, phone, service, message } = req.body || {};

    // 1) reCAPTCHA check
    const check = await verifyRecaptchaV3(recaptchaToken);
    if (!check.ok) {
      return res.status(403).json({
        ok: false,
        error: 'Failed reCAPTCHA',
        details: check.raw || check.reason
      });
    }

    // 2) TODO: save to DB / send email — for now just echo back
    return res.json({
      ok: true,
      note: 'reCAPTCHA passed',
      received: { fullName, email, phone, service, message }
    });
  } catch (err) {
    console.error('Lead error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// --- START ---
app.listen(PORT, () => {
  console.log(`KARBA backend listening on ${PORT}`);
});
