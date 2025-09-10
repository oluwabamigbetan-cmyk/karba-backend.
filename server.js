// server.js
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || '*';
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;

// CORS
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow curl/postman
    if (ALLOWED_ORIGIN === '*' || origin === ALLOWED_ORIGIN) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  methods: ['GET', 'POST', 'OPTIONS']
}));

app.use(express.json());

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ---- reCAPTCHA v3 verifier ----
async function verifyRecaptchaV3(token) {
  if (!RECAPTCHA_SECRET) return { ok: false, reason: 'Missing RECAPTCHA_SECRET' };
  if (!token) return { ok: false, reason: 'Missing token' };

  // Node 18+ has global fetch; this will work on Render
  const params = new URLSearchParams();
  params.append('secret', RECAPTCHA_SECRET);
  params.append('response', token);

  const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  const result = await r.json(); // {success, score, action, ...}

  // Accept if Google says success and score is decent.
  // (We don’t strictly require action=== 'lead' to reduce false negatives.)
  const ok = result.success && (result.score ?? 0) >= 0.3;
  return { ok, raw: result };
}

// Leads
app.post('/api/leads', async (req, res) => {
  try {
    const { recaptchaToken, fullName, email, phone, service, message } = req.body || {};

    // 1) Verify reCAPTCHA
    const check = await verifyRecaptchaV3(recaptchaToken);
    if (!check.ok) {
      return res.status(403).json({ ok: false, error: 'Failed reCAPTCHA', details: check.raw || check.reason });
    }

    // 2) TODO: save to DB / send email here
    // For now, echo back what we received (without the token)
    return res.json({
      ok: true,
      received: { fullName, email, phone, service, message },
      note: 'reCAPTCHA passed'
    });
  } catch (err) {
    console.error('Lead error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`KARBA backend listening on ${PORT}`);
});
