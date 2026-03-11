const express = require('express');
const router  = express.Router();
const webpush = require('web-push');
const db      = require('../db');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

router.post('/', async (req, res) => {
  if (req.body.secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { title, body, url, icon, tag, emails } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });

  try {
    let rows;
    if (Array.isArray(emails) && emails.length > 0) {
      const ph = emails.map(() => '?').join(',');
      [rows] = await db.execute(
        'SELECT endpoint, p256dh, auth_key FROM ma_push_subscriptions WHERE user_email IN (' + ph + ')',
        emails
      );
    } else {
      [rows] = await db.execute('SELECT endpoint, p256dh, auth_key FROM ma_push_subscriptions');
    }

    const siteUrl = process.env.SITE_URL || 'https://makeacademy.in';
    const payload = JSON.stringify({
      title,
      body,
      url:   url   || siteUrl + '/dashcharts.php',
      icon:  icon  || siteUrl + '/Home/assets/makelablogo.png',
      badge: siteUrl + '/Home/assets/favicon.png',
      tag:   tag   || 'makeacademy-general',
    });

    let sent = 0, failed = 0;
    for (const sub of rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload
        );
        sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.execute('DELETE FROM ma_push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
        }
        failed++;
      }
    }

    return res.json({ success: true, sent, failed, total: rows.length });
  } catch (err) {
    console.error('[notify POST]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
