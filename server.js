// server.js
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

const {
  PORT = 10000,
  CORS_ORIGIN = '',                 // e.g. https://karba-site.vercel.app
  RECAPTCHA_SECRET = '',            // from Google (secret key)
  SMTP_HOST = '',
  SMTP_PORT = '587',
  SMTP_USER = '',
  SMTP_PASS = '',
  EMAIL_FROM = '',                  // e.g. "KARBA Leads <no-reply@yourdomain.com>"
  EMAIL_TO = ''                     // where you receive leads
} = process.env;

if (!RECAPTCHA_SECRET) console.warn('[WARN] RECAPTCHA_SECRET is missing.');
if (!EMAIL_TO)          console.warn('[WARN] EMAIL_TO is missing (emails won’t be sent).');

const app = express();

// CORS
app.use(cors({
  origin: (origin, cb) => {
    if (!CORS_ORIGIN) return cb(null, true);
    const ok = origin ? origin === CORS_ORIGIN : true; // allow server-to-server/no-origin
    cb(ok ? null : new Error('Not allowed by CORS'), ok);
  }
}));
app.use(express.json());

// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Helpers
async function verifyRecaptcha(token, remoteIp) {
  const url = 'https://www.google.com/recaptcha/api/siteverify';
  const params = new URLSearchParams();
  params.append('secret', RECAPTCHA_SECRET);
  params.append('response', token);
  if (remoteIp) params.append('remoteip', remoteIp);

  const r = await fetch(url, { method: 'POST', body: params });
  const j = await r.json().catch(() => ({}));
  return j; // { success, score, action, ... }
}

function buildMailTransport() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM || !EMAIL_TO) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465, // true for 465, false for others
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function leadToHtml(lead) {
  const esc = (s='') => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  return `
    <h2>New Lead</h2>
    <ul>
      <li><b>Name:</b> ${esc(lead.name)}</li>
      <li><b>Email:</b> ${esc(lead.email)}</li>
      <li><b>Phone:</b> ${esc(lead.phone || '')}</li>
      <li><b>Service:</b> ${esc(lead.service)}</li>
      <li><b>Message:</b><br>${esc(lead.message || '').replace(/\n/g,'<br>')}</li>
      <li><b>Submitted:</b> ${new Date().toLocaleString()}</li>
    </ul>
  `;
}

// Save + Notify
app.post('/api/leads', async (req, res) => {
  try {
    const { name, email, phone, service, message, recaptchaToken } = req.body || {};
    if (!name || !email || !service) {
      return res.status(400).json({ ok: false, error: 'Missing required fields.' });
    }
    if (!recaptchaToken) {
      return res.status(400).json({ ok: false, error: 'Missing reCAPTCHA token.' });
    }

    // Verify reCAPTCHA v3
    const remoteIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const verdict = await verifyRecaptcha(recaptchaToken, remoteIp);
    if (!verdict?.success) {
      return res.status(403).json({ ok: false, error: 'Failed reCAPTCHA', details: verdict });
    }
    // Optional scoring policy (tweak threshold if needed)
    if (typeof verdict.score === 'number' && verdict.score < 0.3) {
      return res.status(403).json({ ok: false, error: 'Low reCAPTCHA score', details: verdict });
    }

    // TODO: persist to DB or Google Sheet here if you want

    // Send email (if SMTP env is set)
    const transport = buildMailTransport();
    if (transport) {
      const html = leadToHtml({ name, email, phone, service, message });
      await transport.sendMail({
        from: EMAIL_FROM,
        to: EMAIL_TO,
        subject: `New Lead: ${name} — ${service}`,
        html,
        text: html.replace(/<[^>]+>/g, ''), // simple plaintext
      });
    }

    res.json({ ok: true, message: 'Lead saved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
});

// Start
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
