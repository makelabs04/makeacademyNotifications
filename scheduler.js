/**
 * scheduler.js
 * Checks every minute if it's time to send the weekly update notification.
 * Config is read from DB (ma_schedule_config) with .env as fallback.
 * Admin can call scheduler.reload() after updating schedule from admin panel.
 */
require('dotenv').config();
const webpush = require('web-push');
const db      = require('./db');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

let _interval  = null;
let _lastFired = null; // prevent double-fire within same minute

async function getConfig() {
  try {
    const [rows] = await db.execute('SELECT * FROM ma_schedule_config ORDER BY id DESC LIMIT 1');
    if (rows.length > 0 && rows[0].enabled) return rows[0];
  } catch (e) { /* table may not exist yet on first boot */ }

  // Fallback to .env
  return {
    day:     parseInt(process.env.SCHEDULE_DAY    || '6'),
    hour:    parseInt(process.env.SCHEDULE_HOUR   || '10'),
    minute:  parseInt(process.env.SCHEDULE_MINUTE || '0'),
    title:   process.env.SCHEDULE_TITLE || '🚀 MakeAcademy Weekly Update',
    body:    process.env.SCHEDULE_BODY  || 'New features, courses and improvements are now live!',
    url:     process.env.SCHEDULE_URL   || 'https://makeacademy.in/dashcharts.php',
    enabled: true,
  };
}

async function sendScheduledNotification(config) {
  try {
    const [subs] = await db.execute('SELECT endpoint, p256dh, auth_key FROM ma_push_subscriptions');
    if (!subs.length) {
      console.log('[scheduler] No subscribers to notify.');
      return;
    }

    const siteUrl = process.env.SITE_URL || 'https://makeacademy.in';
    const payload = JSON.stringify({
      title: config.title,
      body:  config.body,
      url:   config.url   || `${siteUrl}/dashcharts.php`,
      icon:  `${siteUrl}/Home/assets/makelablogo.png`,
      badge: `${siteUrl}/Home/assets/favicon.png`,
      tag:   'makeacademy-weekly-update',
    });

    let sent = 0, failed = 0;
    for (const sub of subs) {
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

    // Log to history
    await db.execute(
      `INSERT INTO ma_notification_history (title, body, url, sent_count, failed_count, target_type, sent_at)
       VALUES (?, ?, ?, ?, ?, 'scheduled', NOW())`,
      [config.title, config.body, config.url, sent, failed]
    );

    console.log(`[scheduler] Weekly update sent — ${sent} delivered, ${failed} failed.`);
  } catch (err) {
    console.error('[scheduler] Error sending scheduled notification:', err.message);
  }
}

async function tick() {
  const config = await getConfig();
  if (!config || !config.enabled) return;

  // Get current IST time
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const currentDay    = now.getDay();
  const currentHour   = now.getHours();
  const currentMinute = now.getMinutes();

  // Build a fire key so we don't fire twice in the same minute
  const fireKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${currentHour}-${currentMinute}`;

  if (
    currentDay    === parseInt(config.day)    &&
    currentHour   === parseInt(config.hour)   &&
    currentMinute === parseInt(config.minute) &&
    _lastFired    !== fireKey
  ) {
    _lastFired = fireKey;
    console.log('[scheduler] Firing weekly update notification...');
    await sendScheduledNotification(config);
  }
}

function start() {
  console.log('[scheduler] Started — checking every minute for scheduled notifications (IST).');
  tick(); // immediate check on startup
  _interval = setInterval(tick, 60 * 1000);
}

function reload() {
  console.log('[scheduler] Reloading with new schedule config...');
  if (_interval) clearInterval(_interval);
  _lastFired = null;
  start();
}

module.exports = { start, reload };
