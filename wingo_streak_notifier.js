/**
 * WinGo 8x Streak Notifier (30s, 1M, 3M, 5M)
 * 100% Pure Node.js (Zero external npm dependencies needed!)
 * Works 24/7 in Cloud or Local with WhatsApp (CallMeBot) & Telegram Alerts
 */

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

// Try loading .env if file exists (no library required)
try {
  const envPath = path.resolve(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || '').trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        process.env[key] = val;
      }
    }
  }
} catch (e) {}

// ── CONFIGURATION ─────────────────────────────────────────────
const STREAK_TARGET = parseInt(process.env.STREAK_TARGET || '8', 10); // Alert on 8 in a row

// WhatsApp via CallMeBot (100% Free)
// Instructions: Send "I allow callmebot to send me messages" to +34 623 78 64 49 on WhatsApp to get API key!
const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE || ''; // e.g. "+919876543210"
const WHATSAPP_APIKEY = process.env.WHATSAPP_APIKEY || ''; // e.g. "123456"

// Telegram Bot (Optional 100% Free Instant Alert)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// ntfy.sh (100% Free Instant Mobile Notification - No setup, No bot, No registration!)
const NTFY_TOPIC = process.env.NTFY_TOPIC || 'wingo_streak_alerts_80728';

// Games to monitor
const GAMES = {
  'WinGo 30S': {
    url: 'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json',
    intervalMs: 4000 // Check every 4s
  },
  'WinGo 1M': {
    url: 'https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json',
    intervalMs: 8000 // Check every 8s
  },
  'WinGo 3M': {
    url: 'https://draw.ar-lottery01.com/WinGo/WinGo_3M/GetHistoryIssuePage.json',
    intervalMs: 15000 // Check every 15s
  },
  'WinGo 5M': {
    url: 'https://draw.ar-lottery01.com/WinGo/WinGo_5M/GetHistoryIssuePage.json',
    intervalMs: 20000 // Check every 20s
  }
};

// State tracker: prevent duplicate alerts for the same issue
const lastAlerted = {
  'WinGo 30S': null,
  'WinGo 1M': null,
  'WinGo 3M': null,
  'WinGo 5M': null
};

// ── HELPER: PURE NODE HTTPS GET ───────────────────────────────
function fetchJson(targetUrl, params = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    for (const [k, v] of Object.entries(params)) {
      parsed.searchParams.set(k, v);
    }

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'Origin': 'https://pakgames.top',
        'Referer': 'https://pakgames.top/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

// ── SEND NOTIFICATIONS ────────────────────────────────────────
async function sendWhatsAppAlert(message) {
  if (!WHATSAPP_PHONE || !WHATSAPP_APIKEY) {
    console.log('[WhatsApp Skipped] Set WHATSAPP_PHONE and WHATSAPP_APIKEY in .env to receive WhatsApp messages');
    return false;
  }

  try {
    const cleanPhone = encodeURIComponent(WHATSAPP_PHONE.replace(/[^0-9+]/g, ''));
    const cleanText = encodeURIComponent(message);
    const apiUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${cleanText}&apikey=${WHATSAPP_APIKEY}`;
    
    return new Promise((resolve) => {
      https.get(apiUrl, (res) => {
        let resp = '';
        res.on('data', d => resp += d);
        res.on('end', () => {
          console.log(`[WhatsApp Sent to ${WHATSAPP_PHONE}]: ${resp || 'OK'}`);
          resolve(true);
        });
      }).on('error', (e) => {
        console.error(`[WhatsApp Error]: ${e.message}`);
        resolve(false);
      });
    });
  } catch (err) {
    console.error(`[WhatsApp Exception]: ${err.message}`);
    return false;
  }
}

async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return false;
  }

  try {
    const postData = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });

    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 10000
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          console.log('[Telegram Sent] Alert delivered to chat ' + TELEGRAM_CHAT_ID);
          resolve(true);
        });
      });
      req.on('error', (e) => {
        console.error(`[Telegram Error]: ${e.message}`);
        resolve(false);
      });
      req.write(postData);
      req.end();
    });
  } catch (err) {
    console.error(`[Telegram Exception]: ${err.message}`);
    return false;
  }
}

async function sendNtfyAlert(title, message) {
  if (!NTFY_TOPIC) return false;
  try {
    const postData = message;
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'ntfy.sh',
        path: `/${NTFY_TOPIC}`,
        method: 'POST',
        headers: {
          'Title': title,
          'Priority': 'urgent',
          'Tags': 'warning,rotating_light,bell',
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 10000
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          console.log(`[ntfy.sh Sent] Delivered to topic: ${NTFY_TOPIC}`);
          resolve(true);
        });
      });
      req.on('error', (e) => {
        console.error(`[ntfy.sh Error]: ${e.message}`);
        resolve(false);
      });
      req.write(postData);
      req.end();
    });
  } catch (err) {
    console.error(`[ntfy.sh Exception]: ${err.message}`);
    return false;
  }
}

async function broadcastAlert(gameName, streakType, streakCount, latestIssue, recentSizes) {
  const timestamp = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
  const opposite = streakType === 'BIG' ? 'SMALL' : 'BIG';

  const msg = 
`🚨 WINGO ${streakCount}x ${streakType} ALERT! 🚨
━━━━━━━━━━━━━━━━━
🎮 Game: ${gameName}
🔥 Streak: ${streakCount} consecutive ${streakType}s!
🎯 Latest Period: ${latestIssue}
📊 Recent: ${recentSizes.join(' → ')}
⏰ Time: ${timestamp} IST

💡 REVERSAL HINT: High probability for ${opposite} in upcoming round!
━━━━━━━━━━━━━━━━━`;

  console.log('\n' + '='.repeat(55));
  console.log(msg);
  console.log('='.repeat(55) + '\n');

  // Trigger alerts
  await Promise.allSettled([
    sendWhatsAppAlert(msg),
    sendTelegramAlert(msg),
    sendNtfyAlert(`WinGo ${streakCount}x ${streakType} Alert! (${gameName})`, msg)
  ]);
}

// ── CHECK STREAKS ─────────────────────────────────────────────
async function checkGameStreak(gameName, gameConfig) {
  try {
    const parsed = await fetchJson(gameConfig.url, {
      ts: Date.now(),
      pageNo: 1,
      pageSize: 20
    });

    if (!parsed || parsed.code !== 0 || !parsed.data?.list || parsed.data.list.length < STREAK_TARGET) {
      return;
    }

    const list = parsed.data.list;
    list.sort((a, b) => b.issueNumber.localeCompare(a.issueNumber));

    const latestIssue = list[0].issueNumber;

    const items = list.map(item => ({
      issue: item.issueNumber,
      number: parseInt(item.number, 10),
      size: parseInt(item.number, 10) >= 5 ? 'BIG' : 'SMALL'
    }));

    const currentSize = items[0].size;
    let streak = 0;
    const streakItems = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].size === currentSize) {
        streak++;
        streakItems.push(items[i].size);
      } else {
        break;
      }
    }

    const now = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
    process.stdout.write(`\r[${now}] ${gameName}: #${latestIssue.slice(-4)} (${items[0].number} ${currentSize}) | Streak: ${streak}x ${currentSize}     `);

    if (streak >= STREAK_TARGET) {
      if (lastAlerted[gameName] !== latestIssue) {
        lastAlerted[gameName] = latestIssue;
        await broadcastAlert(gameName, currentSize, streak, latestIssue, streakItems.slice(0, 10));
      }
    }
  } catch (err) {
    // Silent retry
  }
}

// ── START MONITORING ALL GAMES ────────────────────────────────
function startBot() {
  console.log('='.repeat(55));
  console.log('🚀 WinGo 8x Consecutive Streak Notifier Started!');
  console.log(`🎯 Target: Alert on ${STREAK_TARGET} or more consecutive BIG / SMALL`);
  console.log(`📱 Monitored: WinGo 30S, 1M, 3M, 5M (All 4 Modes)`);
  console.log(`💬 WhatsApp: ${WHATSAPP_PHONE ? 'CONFIGURED (' + WHATSAPP_PHONE + ')' : 'NOT CONFIGURED'}`);
  console.log(`📢 Telegram: ${TELEGRAM_BOT_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
  console.log('='.repeat(55) + '\n');

  for (const [name, config] of Object.entries(GAMES)) {
    checkGameStreak(name, config);
    setInterval(() => checkGameStreak(name, config), config.intervalMs);
  }
}

// ── MINI WEB SERVER FOR FREE 24/7 CLOUD HOSTING ───────────────
const PORT = process.env.PORT || 3099;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ONLINE',
    service: 'WinGo 8x Streak Notifier',
    monitoredGames: Object.keys(GAMES),
    streakTarget: STREAK_TARGET,
    lastAlerted,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  }));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} busy, starting bot without binding port.`);
    startBot();
  } else {
    console.error('Server error:', err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Cloud Web Server] Listening on port ${PORT}`);
  startBot();
});
