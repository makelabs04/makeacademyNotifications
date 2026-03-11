require('dotenv').config();
const webpush = require('web-push');
const db      = require('./db');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

let _interval  = null;
let _lastFired = null;

async function getConfig() {
  try {
    const [rows] = await db.execute('SELECT * FROM ma_schedule_config ORDER BY id DESC LIMIT 1');
    if (rows.length > 0 && rows[0].enabled) return rows[0];
    if (rows.length > 0 && !rows[0].enabled) return null; // disabled in DB
  } catch (e) { /* table may not exist yet */ }

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

    try {
      await db.execute(
        `INSERT INTO ma_notification_history (title, body, url, sent_count, failed_count, target_type, sent_at)
         VALUES (?, ?, ?, ?, ?, 'scheduled', NOW())`,
        [config.title, config.body, config.url, sent, failed]
      );
    } catch(e) {}

    console.log(`[scheduler] Weekly update sent — ${sent} delivered, ${failed} failed.`);
  } catch (err) {
    console.error('[scheduler] Error:', err.message);
  }
}

function getISTTime() {
  // IST = UTC+5:30
  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istMs = utcMs + (5.5 * 3600000);
  return new Date(istMs);
}

async function tick() {
  const config = await getConfig();
  if (!config || !config.enabled) return;

  const ist = getISTTime();
  const day    = ist.getDay();
  const hour   = ist.getHours();
  const minute = ist.getMinutes();

  // Log every tick so we can verify IST time in server logs
  process.stdout.write(
    `[scheduler] IST=${ist.toISOString().replace('T',' ').slice(0,16)} ` +
    `(${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]} ${hour}:${String(minute).padStart(2,'0')}) | ` +
    `Target: day=${config.day} hour=${config.hour} min=${config.minute}\n`
  );

  const fireKey = `${ist.getFullYear()}-${ist.getMonth()}-${ist.getDate()}-${hour}-${minute}`;

  if (
    day    === parseInt(config.day)    &&
    hour   === parseInt(config.hour)   &&
    minute === parseInt(config.minute) &&
    _lastFired !== fireKey
  ) {
    _lastFired = fireKey;
    console.log('[scheduler] 🔥 Firing scheduled notification!');
    await sendScheduledNotification(config);
  }
}

function start() {
  console.log('[scheduler] Started. Checking every minute (IST timezone).');
  tick();
  _interval = setInterval(tick, 60 * 1000);
}

function reload() {
  console.log('[scheduler] Reloading schedule config...');
  if (_interval) clearInterval(_interval);
  _lastFired = null;
  start();
}

module.exports = { start, reload };
