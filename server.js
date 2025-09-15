import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import axios from 'axios';

const app = express();
app.use(express.json());

// ---------- CORS ----------
const ALLOW = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOW.includes(origin)) return cb(null, true);
    cb(new Error('CORS blocked for origin: ' + origin));
  }
}));

// ---------- health ----------
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ---------- helpers ----------
async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) return { success: false, reason: 'missing secret' };

  try {
    const resp = await axios.post(
      'https://www.google.com/recaptcha/api/siteverify',
      new URLSearchParams({ secret, response: token }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const data = resp.data || {};
    if (!data.success || (data.score !== undefined && data.score < 0.3)) {
      return { success: false, reason: 'recaptcha failed', data };
    }
    return { success: true };
  } catch (e) {
    return { success: false, reason: 'recaptcha error', error: String(e) };
  }
}

function buildTransport() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new Error('Missing SMTP env vars');
  return nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass }
  });
}

// ---------- leads ----------
app.post('/api/leads', async (req, res) => {
  const { name, email, phone, service, message, recaptchaToken } = req.body || {};
  if (!name || !email || !service) {
    return res.status(400).json({ ok: false, message: 'Missing name, email, or service.' });
  }

  const vr = await verifyRecaptcha(recaptchaToken);
  if (!vr.success) return res.status(400).json({ ok: false, message: 'reCAPTCHA failed', vr });

  const EMAIL_TO = process.env.EMAIL_TO || process.env.SMTP_USER;
  const EMAIL_FROM = process.env.EMAIL_FROM || `KARBA Website <${process.env.SMTP_USER}>`;
  const subject = `New Lead from ${name}`;

  const html = `
    <h2>New Website Lead</h2>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Phone:</strong> ${phone || '-'}</p>
    <p><strong>Service:</strong> ${service}</p>
    <p><strong>Message:</strong><br/>${(message || '').replace(/\n/g,'<br/>')}</p>
  `;

  try {
    const transport = buildTransport();
    await transport.sendMail({ from: EMAIL_FROM, to: EMAIL_TO, subject, html, replyTo: email });
    res.json({ ok: true, message: 'lead received' });
  } catch (err) {
    console.error('MAIL ERROR', err);
    res.status(500).json({ ok: false, message: 'mail error' });
  }
});

// ---------- start ----------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`KARBA backend listening on ${PORT}`);
});
