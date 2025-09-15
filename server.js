// KARBA backend: Express + Nodemailer + optional reCAPTCHA v3
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

// ---------- ENV ----------
const {
  PORT = 3000,
  EMAIL_FROM,
  EMAIL_TO,
  SMTP_HOST,
  SMTP_PORT = 465,
  SMTP_USER,
  SMTP_PASS,
  RECAPTCHA_SECRET,                // optional (server-side secret)
  CORS_ORIGINS = '*'               // comma-separated list or "*"
} = process.env;

// ---------- CORS ----------
const allowList = CORS_ORIGINS === '*'
  ? null
  : CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: allowList ? (origin, cb) => {
    if (!origin || allowList.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked for origin ${origin}`));
  } : true
}));

app.use(express.json());

// ---------- HEALTH ----------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---------- RECAPTCHA VERIFY (if configured) ----------
async function verifyRecaptcha(token) {
  if (!RECAPTCHA_SECRET) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: 'missing-token' };

  try {
    const params = new URLSearchParams();
    params.set('secret', RECAPTCHA_SECRET);
    params.set('response', token);

    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const data = await r.json();
    if (data.success) return { ok: true, score: data.score ?? null };
    return { ok: false, reason: 'recaptcha-failed', details: data['error-codes'] };
  } catch (e) {
    return { ok: false, reason: 'recaptcha-error', details: e.message };
  }
}

// ---------- MAIL TRANSPORT ----------
function buildTransport() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !EMAIL_TO || !EMAIL_FROM) {
    throw new Error('Missing SMTP_* or EMAIL_* env vars');
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

// ---------- LEAD ENDPOINT ----------
app.post('/api/leads', async (req, res) => {
  const { name, email, phone, service, message, recaptchaToken } = req.body || {};

  if (!name || !email || !service) {
    return res.status(400).json({ ok: false, message: 'name, email, and service are required' });
  }

  const recap = await verifyRecaptcha(recaptchaToken);
  if (!recap.ok) {
    return res.status(400).json({ ok: false, message: 'reCAPTCHA failed', details: recap });
  }

  try {
    const transport = buildTransport();
    const subject = `New Lead: ${name} (${service})`;
    const html = `
      <h2>New Consultation Lead</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone || '-'}</p>
      <p><strong>Service:</strong> ${service}</p>
      <p><strong>Message:</strong></p>
      <p style="white-space:pre-wrap;">${message || '-'}</p>
    `;

    await transport.sendMail({
      from: EMAIL_FROM,
      to: EMAIL_TO,
      replyTo: email,
      subject,
      html
    });

    res.json({ ok: true, message: 'Lead sent' });
  } catch (err) {
    console.error('[MAIL ERROR]', err);
    res.status(500).json({ ok: false, message: 'Server mail error' });
  }
});

// ---------- START ----------
app.listen(PORT, () => {
  console.log(`KARBA backend listening on ${PORT}`);
});
