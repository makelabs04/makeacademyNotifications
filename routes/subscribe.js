/**
 * routes/subscribe.js
 * POST   /api/subscribe            — save browser push subscription
 * DELETE /api/subscribe            — remove subscription
 * GET    /api/subscribe/vapid-public-key — return VAPID public key
 */
const express = require('express');
const router  = express.Router();
const db      = require('../db');

// Save / upsert a subscription
router.post('/', async (req, res) => {
  try {
    const { subscription, user_email } = req.body;

    if (!subscription || !subscription.endpoint)
      return res.status(400).json({ error: 'Missing subscription object' });
    if (!user_email)
      return res.status(400).json({ error: 'Missing user_email' });

    const endpoint = subscription.endpoint;
    const p256dh   = subscription.keys?.p256dh   || null;
    const auth_key = subscription.keys?.auth      || null;

    await db.execute(
      `INSERT INTO ma_push_subscriptions
         (user_email, endpoint, p256dh, auth_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         user_email = VALUES(user_email),
         p256dh     = VALUES(p256dh),
         auth_key   = VALUES(auth_key),
         updated_at = NOW()`,
      [user_email, endpoint, p256dh, auth_key]
    );

    return res.json({ success: true, message: 'Subscription saved' });
  } catch (err) {
    console.error('[subscribe POST]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Remove a subscription by endpoint
router.delete('/', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
    await db.execute('DELETE FROM ma_push_subscriptions WHERE endpoint = ?', [endpoint]);
    return res.json({ success: true, message: 'Unsubscribed' });
  } catch (err) {
    console.error('[subscribe DELETE]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Return VAPID public key to client
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

module.exports = router;
