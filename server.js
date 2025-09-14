// server.js
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

const app = express();
app.use(express.json());

/** CORS: allow your Vercel domains */
const ALLOWED_ORIGINS = [
  'https://karba-site.vercel.app',
  // optional: preview deployments pattern - enable during dev if needed
  // 'https://*.vercel.app'
];
app.use(cors({
  origin(origin, cb) {
    // allow same-origin / curl / servers
    if (!origin) return cb(null, true);
    const ok = ALLOWED_ORIGINS.some(allowed => {
      if (allowed.includes('*')) {
        // simple wildcard support for *.vercel.app
        const re = new RegExp('^https://[^.]+\\.vercel\\.app$');
        return re.test(origin);
      }
      return origin === allowed;
    });
    return ok ? cb(null, true) : cb(new Error(`CORS: ${origin} not allowed`));
  }
}));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/** verify recaptcha v3 */
async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) return { ok: false, reason: 'missing secret' };
  const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token })
  });
  const json = await r.json();
  // pass if success and score >= 0.3 (you can relax to 0.1 if needed)
  return { ok: !!json.success && (json.score ?? 0.9) >= 0.3, details: json };
}

/** nodemailer transport */
function buildTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) throw new Error('Missing SMTP env');
  return nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass }
  });
}

app.post('/api/leads', async (req, res) => {
  try {
    const { name, email, phone, service, message, recaptchaToken } = req.body || {};
    if (!name || !email || !service) {
      return res.status(400).json({ ok: false, message: 'Missing name, email, or service.' });
    }

    const rc = await verifyRecaptcha(recaptchaToken);
    if (!rc.ok) {
      return res.status(400).json({ ok: false, message: 'reCAPTCHA failed', details: rc.details });
    }

    const EMAIL_TO = process.env.EMAIL_TO;
    const EMAIL_FROM = process.env.EMAIL_FROM || process.env.SMTP_USER;
    if (!EMAIL_TO) throw new Error('Missing EMAIL_TO');

    const transport = buildTransport();

    await transport.sendMail({
      from: EMAIL_FROM,
      to: EMAIL_TO,
      replyTo: email,
      subject: `New Lead from ${name}`,
      html: `
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone || '-'}</p>
        <p><strong>Service:</strong> ${service}</p>
        <p><strong>Message:</strong><br/>${(message || '').replace(/\n/g,'<br/>')}</p>
      `
    });

    res.json({ ok: true, message: 'Lead received' });
  } catch (err) {
    console.error('LEADS_ERROR', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Backend listening on', PORT));
