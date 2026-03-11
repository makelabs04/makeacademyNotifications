/**
 * server.js — MakeAcademy Push Notification Server
 * Domain: notifications.makeacademy.in
 * Shares the same MySQL DB as makeacademy.in
 */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000');

// ── CORS ──────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

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

// ── Routes ────────────────────────────────────────────────────────
app.use('/api/subscribe', require('./routes/subscribe'));

// Send notification to all or specific users (admin use)
app.post('/api/notify', require('./routes/notify'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'makeacademy-push', time: new Date().toISOString() });
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] MakeAcademy Push Notifier running on port ${PORT}`);
});
