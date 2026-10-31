/**
 * WinGo 7x Streak Notifier (30s, 1M, 3M, 5M)
 * 100% Pure Node.js (Zero external dependencies)
 * Alerts on 7 consecutive BIG or 7 consecutive SMALL to ntfy.sh (and optional WhatsApp / Telegram)
 */

const http = require('http');
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// Try loading .env if file exists
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
const STREAK_TARGET = parseInt(process.env.STREAK_TARGET || '7', 10); // Target: 7 streaks

const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE || '';
const WHATSAPP_APIKEY = process.env.WHATSAPP_APIKEY || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const NTFY_TOPIC = process.env.NTFY_TOPIC || 'wingo_streak_alerts_80728';

// Games configuration
const GAMES = {
  'WinGo 30S': {
    url: 'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json',
    intervalMs: 4000
  },
  'WinGo 1M': {
    url: 'https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json',
    intervalMs: 7000
  },
  'WinGo 3M': {
    url: 'https://draw.ar-lottery01.com/WinGo/WinGo_3M/GetHistoryIssuePage.json',
    intervalMs: 12000
  },
  'WinGo 5M': {
    url: 'https://draw.ar-lottery01.com/WinGo/WinGo_5M/GetHistoryIssuePage.json',
    intervalMs: 15000
  }
};

// Rolling buffer to prevent streaks from breaking across midnight / day change
const gameHistory = {
  'WinGo 30S': [],
  'WinGo 1M': [],
  'WinGo 3M': [],
  'WinGo 5M': []
};

const lastAlerted = {
  'WinGo 30S': null,
  'WinGo 1M': null,
  'WinGo 3M': null,
  'WinGo 5M': null
};

// ── HTTP GET WITH GZIP HANDLING ───────────────────────────────
function fetchJson(targetUrl) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(targetUrl);
      parsed.searchParams.set('ts', String(Date.now()));

      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'Origin': 'https://pakgames.top',
          'Referer': 'https://pakgames.top/',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Encoding': 'gzip, deflate',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 9000
      };

      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const encoding = res.headers['content-encoding'];
          
          let text = '';
          try {
            if (encoding === 'gzip') {
              text = zlib.gunzipSync(buffer).toString('utf8');
            } else if (encoding === 'deflate') {
              text = zlib.inflateSync(buffer).toString('utf8');
            } else {
              text = buffer.toString('utf8');
            }
            const json = JSON.parse(text);
            resolve(json);
          } catch (e) {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    } catch (e) {
      resolve(null);
    }
  });
}

// ── SEND ALERTS ───────────────────────────────────────────────
async function sendNtfyAlert(title, message) {
  if (!NTFY_TOPIC) return false;
  try {
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
          'Content-Length': Buffer.byteLength(message)
        },
        timeout: 10000
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(true));
      });
      req.on('error', () => resolve(false));
      req.write(message);
      req.end();
    });
  } catch (err) {
    return false;
  }
}

async function sendWhatsAppAlert(message) {
  if (!WHATSAPP_PHONE || !WHATSAPP_APIKEY) return false;
  try {
    const cleanPhone = encodeURIComponent(WHATSAPP_PHONE.replace(/[^0-9+]/g, ''));
    const cleanText = encodeURIComponent(message);
    const apiUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${cleanText}&apikey=${WHATSAPP_APIKEY}`;
    return new Promise((resolve) => {
      https.get(apiUrl, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(true));
      }).on('error', () => resolve(false));
    });
  } catch (e) {
    return false;
  }
}

async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
  try {
    const postData = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' });
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        timeout: 10000
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(true));
      });
      req.on('error', () => resolve(false));
      req.write(postData);
      req.end();
    });
  } catch (e) {
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

  await Promise.allSettled([
    sendNtfyAlert(`WinGo ${streakCount}x ${streakType} Alert! (${gameName})`, msg),
    sendWhatsAppAlert(msg),
    sendTelegramAlert(msg)
  ]);
}

// ── CHECK STREAKS ─────────────────────────────────────────────
async function checkGameStreak(gameName, gameConfig) {
  try {
    const parsed = await fetchJson(gameConfig.url);
    if (!parsed || parsed.code !== 0 || !parsed.data?.list || parsed.data.list.length === 0) {
      return;
    }

    const incoming = parsed.data.list;
    const history = gameHistory[gameName];

    for (const raw of incoming) {
      const issue = String(raw.issueNumber);
      const num = parseInt(raw.number, 10);
      if (isNaN(num) || !issue) continue;

      if (!history.some(item => item.issue === issue)) {
        history.push({
          issue,
          number: num,
          size: num >= 5 ? 'BIG' : 'SMALL'
        });
      }
    }

    history.sort((a, b) => b.issue.localeCompare(a.issue));
    if (history.length > 30) history.length = 30; // Keep last 30 in memory

    if (history.length < STREAK_TARGET) return;

    const latestIssue = history[0].issue;
    const currentSize = history[0].size;

    let streak = 0;
    const streakItems = [];

    for (let i = 0; i < history.length; i++) {
      if (history[i].size === currentSize) {
        streak++;
        streakItems.push(history[i].size);
      } else {
        break;
      }
    }

    if (streak >= STREAK_TARGET) {
      if (lastAlerted[gameName] !== latestIssue) {
        lastAlerted[gameName] = latestIssue;
        await broadcastAlert(gameName, currentSize, streak, latestIssue, streakItems.slice(0, 10));
      }
    }
  } catch (err) {}
}

// ── START MONITORING ──────────────────────────────────────────
function startBot() {
  console.log('='.repeat(55));
  console.log(`🚀 WinGo ${STREAK_TARGET}x Streak Alert Bot Running!`);
  console.log(`🎯 Alert Target: ${STREAK_TARGET} consecutive BIG or SMALL`);
  console.log(`📱 Games: WinGo 30S, 1M, 3M, 5M`);
  console.log(`🔔 Notifications: ntfy.sh/${NTFY_TOPIC}`);
  console.log('='.repeat(55));

  for (const [name, config] of Object.entries(GAMES)) {
    checkGameStreak(name, config);
    setInterval(() => checkGameStreak(name, config), config.intervalMs);
  }
}

// ── HEALTHCHECK SERVER (FOR 24/7 CLOUD HOSTING) ───────────────
const PORT = process.env.PORT || 3099;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ONLINE',
    service: 'WinGo 7x Streak Alert Bot',
    streakTarget: STREAK_TARGET,
    uptimeSeconds: Math.floor(process.uptime()),
    monitoredGames: Object.keys(GAMES),
    lastAlerted,
    timestamp: new Date().toISOString()
  }));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    startBot();
  } else {
    console.error('Server error:', err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Alert Bot Server] Running on port ${PORT}`);
  startBot();
});
