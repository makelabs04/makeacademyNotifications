require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const scheduler = require('./scheduler');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000');

// Allow all origins (safe since API is protected by ADMIN_SECRET)
app.use(cors({ origin: '*', methods: ['GET','POST','DELETE','OPTIONS'], credentials: false }));
app.use(express.json());

// ── API Routes first ───────────────────────────────────────────────
app.use('/api/subscribe', require('./routes/subscribe'));
app.use('/api/notify',    require('./routes/notify'));
app.use('/api/admin',     require('./routes/admin'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'makeacademy-push', time: new Date().toISOString() });
});

// ── Static admin panel (after API routes) ─────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Global JSON error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[server error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log('[server] MakeAcademy Push Notifier running on port ' + PORT);
  scheduler.start();
});
