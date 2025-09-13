// index.js (CommonJS)
// If you use another filename (e.g., server.js), use that.
// Make sure your Render "Start Command" runs: node index.js

const express = require('express');
const cors = require('cors');

// (Optional) Fallback if Node < 18 and fetch is missing.
// If Render logs show "fetch is not defined", run `npm i node-fetch` and
// then uncomment the next two lines:
// const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();

// ---- Config ----------------------------------------------------
const PORT = process.env.PORT || 10000;
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'https://karba-site.vercel.app';
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET || ''; // <-- set in Render

// ---- Middleware -----------------------------------------------
app.use(express.json());
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
}));

// ---- Health ----------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---- Leads endpoint with full logging --------------------------
app.post('/api/leads', async (req, res) => {
  const t0 = Date.now();
  try {
    const { name, email, phone, service, message, recaptchaToken } = req.body || {};

    // Basic logs (safe; we NEVER print the token itself)
    console.info('────────────────────────────────────────');
    console.info('[LEAD]', new Date().toISOString());
    console.info('[LEAD] from IP:', req.ip);
    console.info('[LEAD] UA:', req.headers['user-agent']);
    console.info('[LEAD] payload:', { name, email, phone, service, message });
    console.info('[LEAD] recaptchaToken length:', recaptchaToken ? recaptchaToken.length : 0);

    // Validate presence
    if (!recaptchaToken) {
      console.warn('[reCAPTCHA] missing token');
      return res.status(400).json({ ok: false, error: 'Missing recaptchaToken' });
    }
    if (!RECAPTCHA_SECRET) {
      console.error('[reCAPTCHA] missing RECAPTCHA_SECRET on server');
      return res.status(500).json({ ok: false, error: 'Server misconfigured: no RECAPTCHA_SECRET' });
    }

    // Verify token with Google
    const verifyUrl = 'https://www.google.com/recaptcha/api/siteverify';
    const params = new URLSearchParams({
      secret: RECAPTCHA_SECRET,
      response: recaptchaToken
    });

    const vr = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const verdict = await vr.json();
    console.info('[reCAPTCHA] verdict:', verdict);

    if (!verdict.success) {
      console.warn('[reCAPTCHA] FAILED');
      return res.status(403).json({ ok: false, error: 'Failed reCAPTCHA', details: verdict });
    }

    // Optional: check score/action for v3 (uncomment if you want stricter control)
    // if (typeof verdict.score === 'number' && verdict.score < 0.5) {
    //   console.warn('[reCAPTCHA] Low score:', verdict.score);
    //   return res.status(403).json({ ok: false, error: 'Low reCAPTCHA score', details: verdict });
    // }

    // TODO: save to DB or send email here.
    console.info('[LEAD] accepted');
    return res.json({ ok: true, received: true });
  } catch (err) {
    console.error('[API /api/leads] ERROR:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  } finally {
    console.info(`[API /api/leads] done in ${Date.now() - t0}ms`);
    console.info('────────────────────────────────────────');
  }
});

// ---- Start -----------------------------------------------------
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
