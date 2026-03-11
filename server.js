require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const scheduler = require('./scheduler');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000');

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS blocked: ' + origin));
  },
  methods:     ['GET', 'POST', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/subscribe', require('./routes/subscribe'));
app.use('/api/notify',    require('./routes/notify'));
app.use('/api/admin',     require('./routes/admin'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'makeacademy-push', time: new Date().toISOString() });
});

// ── Global error handler — always return JSON, never HTML ─────────
app.use((err, req, res, next) => {
  console.error('[server error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log('[server] MakeAcademy Push Notifier running on port ' + PORT);
  scheduler.start();
});
