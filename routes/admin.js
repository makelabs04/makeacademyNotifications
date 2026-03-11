const express = require('express');
const router  = express.Router();
const webpush = require('web-push');
const db      = require('../db');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret || (req.body && req.body.secret);
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(adminAuth);

// Stats
router.get('/stats', async (req, res) => {
  try {
    const [subRows]  = await db.execute('SELECT COUNT(*) as c FROM ma_push_subscriptions');

    let userCount = 0;
    try {
      const [userRows] = await db.execute('SELECT COUNT(*) as c FROM users WHERE Email IS NOT NULL');
      userCount = userRows[0].c;
    } catch(e) {}

    let histCount = 0, sentTotal = 0;
    try {
      const [histRows] = await db.execute('SELECT COUNT(*) as c FROM ma_notification_history');
      const [sentRows] = await db.execute('SELECT COALESCE(SUM(sent_count),0) as c FROM ma_notification_history');
      histCount = histRows[0].c;
      sentTotal = sentRows[0].c;
    } catch (e) {}

    return res.json({
      total_users:        userCount,
      subscribed:         subRows[0].c,
      not_subscribed:     userCount - subRows[0].c,
      notifications_sent: histCount,
      total_pushes_sent:  sentTotal,
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    return res.status(500).json({ error: 'Server error', detail: err.message, code: err.code });
  }
});

// Subscribers list
router.get('/subscribers', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT s.user_email, s.created_at, s.updated_at, u.Full_name, u.Phone_number FROM ma_push_subscriptions s LEFT JOIN users u ON u.Email = s.user_email ORDER BY s.created_at DESC'
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[admin/subscribers]', err);
    return res.status(500).json({ error: 'Server error', detail: err.message, code: err.code });
  }
});

// Non-subscribers list
router.get('/non-subscribers', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT u.Email, u.Full_name, u.Phone_number, u.created_at FROM users u WHERE u.Email IS NOT NULL AND u.Email NOT IN (SELECT user_email FROM ma_push_subscriptions) ORDER BY u.created_at DESC LIMIT 500'
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[admin/non-subscribers]', err);
    return res.status(500).json({ error: 'Server error', detail: err.message, code: err.code });
  }
});

// Get schedule
router.get('/schedule', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM ma_schedule_config ORDER BY id DESC LIMIT 1');
    if (rows.length === 0) {
      return res.json({
        success: true,
        data: {
          day:     parseInt(process.env.SCHEDULE_DAY    || '6'),
          hour:    parseInt(process.env.SCHEDULE_HOUR   || '10'),
          minute:  parseInt(process.env.SCHEDULE_MINUTE || '0'),
          title:   process.env.SCHEDULE_TITLE || '🚀 MakeAcademy Weekly Update',
          body:    process.env.SCHEDULE_BODY  || 'New features are now live!',
          url:     process.env.SCHEDULE_URL   || 'https://makeacademy.in/dashcharts.php',
          enabled: true,
        }
      });
    }
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    // Table doesn't exist yet — return env defaults
    return res.json({
      success: true,
      data: {
        day: 6, hour: 10, minute: 0,
        title: '🚀 MakeAcademy Weekly Update',
        body:  'New features are now live!',
        url:   'https://makeacademy.in/dashcharts.php',
        enabled: true,
      }
    });
  }
});

// Save schedule
router.post('/schedule', async (req, res) => {
  try {
    const { day, hour, minute, title, body, url, enabled } = req.body;
    if (day === undefined || hour === undefined) {
      return res.status(400).json({ error: 'day and hour are required' });
    }

    const [existing] = await db.execute('SELECT id FROM ma_schedule_config LIMIT 1');
    if (existing.length > 0) {
      await db.execute(
        'UPDATE ma_schedule_config SET day=?, hour=?, minute=?, title=?, body=?, url=?, enabled=?, updated_at=NOW() WHERE id=?',
        [day, hour, minute || 0, title, body, url, enabled ? 1 : 0, existing[0].id]
      );
    } else {
      await db.execute(
        'INSERT INTO ma_schedule_config (day, hour, minute, title, body, url, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
        [day, hour, minute || 0, title, body, url, enabled ? 1 : 0]
      );
    }

    const scheduler = require('../scheduler');
    scheduler.reload();

    return res.json({ success: true, message: 'Schedule updated' });
  } catch (err) {
    console.error('[admin/schedule POST]', err);
    return res.status(500).json({ error: 'Server error', detail: err.message, code: err.code });
  }
});

// Manual send
router.post('/send', async (req, res) => {
  const { title, body, url, icon, tag, emails } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

  try {
    let rows;
    if (Array.isArray(emails) && emails.length > 0) {
      const ph = emails.map(() => '?').join(',');
      [rows] = await db.execute(
        'SELECT endpoint, p256dh, auth_key, user_email FROM ma_push_subscriptions WHERE user_email IN (' + ph + ')',
        emails
      );
    } else {
      [rows] = await db.execute('SELECT endpoint, p256dh, auth_key, user_email FROM ma_push_subscriptions');
    }

    const siteUrl = process.env.SITE_URL || 'https://makeacademy.in';
    const payload = JSON.stringify({
      title,
      body,
      url:   url   || siteUrl + '/dashcharts.php',
      icon:  icon  || siteUrl + '/Home/assets/makelablogo.png',
      badge: siteUrl + '/Home/assets/favicon.png',
      tag:   tag   || 'makeacademy-manual',
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

    try {
      const targetType = (Array.isArray(emails) && emails.length > 0) ? 'selected' : 'all';
      await db.execute(
        'INSERT INTO ma_notification_history (title, body, url, sent_count, failed_count, target_type, sent_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
        [title, body, url || siteUrl + '/dashcharts.php', sent, failed, targetType]
      );
    } catch (e) { /* history table may not exist */ }

    return res.json({ success: true, sent, failed, total: rows.length });
  } catch (err) {
    console.error('[admin/send]', err);
    return res.status(500).json({ error: 'Server error', detail: err.message, code: err.code });
  }
});

// History
router.get('/history', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM ma_notification_history ORDER BY sent_at DESC LIMIT 50');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.json({ success: true, data: [] });
  }
});

module.exports = router;
