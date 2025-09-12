// server.js
import express from 'express';
import cors from 'cors';

const PORT = process.env.PORT || 10000;
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET || '';
const ORIGINS = [
  ...(process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : []),
  ...(process.env.CORS_ORIGIN_2 ? [process.env.CORS_ORIGIN_2] : []),
].filter(Boolean);

const app = express();
app.use(express.json());

// CORS: allow your Vercel domain(s)
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);            // allow server-to-server/curl
    if (ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.options('*', cors());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

async function verifyRecaptchaV3(token) {
  if (!RECAPTCHA_SECRET) return { ok: false, reason: 'missing-secret' };
  const url = 'https://www.google.com/recaptcha/api/siteverify';
  const body = new URLSearchParams({ secret: RECAPTCHA_SECRET, response: token || '' });
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const json = await r.json().catch(() => ({}));
  const ok = !!json.success && (json.score ?? 0) >= 0.3;
  return { ok, raw: json };
}

app.post('/api/leads', async (req, res) => {
  try {
    const { fullName = '', email = '', phone = '', service = '', message = '', recaptchaToken = '' } = req.body || {};
    if (!fullName || !email) return res.status(400).json({ ok:false, error:'Missing name or email' });

    const verdict = await verifyRecaptchaV3(recaptchaToken);
    if (!verdict.ok) return res.status(403).json({ ok:false, error:'Failed reCAPTCHA', details: verdict.raw });

    // TODO: persist/notify (email/DB/Sheet). For now echo back:
    return res.json({ ok:true, received: { fullName, email, phone, service, message } });
  } catch (e) {
    console.error('Lead error:', e);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`KARBA backend listening on ${PORT}`);
  console.log('Allowed origins:', ORIGINS);
});
