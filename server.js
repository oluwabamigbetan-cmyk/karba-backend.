const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/leads', (req, res) => {
  const lead = req.body || {};
  res.json({ ok: true, received: lead });
});

app.get('/admin', (req, res) => {
  res.send('<h1 style="font-family: sans-serif">KARBA Admin</h1><p>Backend is running. Full admin UI will be added after MongoDB.</p>');
});

app.listen(PORT, () => console.log(`KARBA backend running on http://localhost:${PORT}`));
