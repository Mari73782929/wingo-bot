/**
 * WinGo 24/7 Unlimited Analytics & Streak Master
 * 100% Pure Node.js (Zero external dependencies)
 * 
 * Features:
 *  - Unlimited Permanent JSON Storage (Saves EVERY single result forever, NOT just 500!)
 *  - Calculates All-Time Maximum BIG Streaks and Maximum SMALL Streaks for each timeframe
 *  - Full 4 Timeframes: 30 Sec, 1 Min, 3 Min, 5 Min
 *  - Live Interactive Mobile Dashboard on Web URL
 *  - Seamless Date / Midnight Rollover support
 *  - Instant Siren Alerts via ntfy.sh (and optional WhatsApp / Telegram)
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

// ── PERMANENT UNLIMITED STORAGE IN MEMORY & DISK ──────────────
const STORAGE_FILE = path.resolve(__dirname, 'wingo_unlimited_history.json');

const gameHistory = {
  'WinGo 30S': [],
  'WinGo 1M': [],
  'WinGo 3M': [],
  'WinGo 5M': []
};

// Streak Stats (All-time tracking)
const gameStats = {
  'WinGo 30S': { maxBigStreak: 0, maxSmallStreak: 0, currentStreak: '1x BIG', totalDraws: 0 },
  'WinGo 1M':  { maxBigStreak: 0, maxSmallStreak: 0, currentStreak: '1x BIG', totalDraws: 0 },
  'WinGo 3M':  { maxBigStreak: 0, maxSmallStreak: 0, currentStreak: '1x BIG', totalDraws: 0 },
  'WinGo 5M':  { maxBigStreak: 0, maxSmallStreak: 0, currentStreak: '1x BIG', totalDraws: 0 }
};

// Load saved data from disk if exists
try {
  if (fs.existsSync(STORAGE_FILE)) {
    const raw = fs.readFileSync(STORAGE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    for (const name of Object.keys(GAMES)) {
      if (parsed[name] && Array.isArray(parsed[name])) {
        gameHistory[name] = parsed[name];
      }
    }
    console.log(`[Database Loaded] Successfully restored existing history from ${STORAGE_FILE}`);
  }
} catch (e) {
  console.log('[Database Notice] Starting fresh in-memory storage');
}

// Auto-save to disk periodically
function saveStorageToDisk() {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(gameHistory, null, 2), 'utf8');
  } catch (e) {}
}
setInterval(saveStorageToDisk, 30000); // Save to disk every 30s

const lastAlerted = {
  'WinGo 30S': null,
  'WinGo 1M': null,
  'WinGo 3M': null,
  'WinGo 5M': null
};

// ── ROBUST HTTP GET WITH GZIP HANDLING ────────────────────────
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

// ── ALERT BROADCAST ───────────────────────────────────────────
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

// ── STATS CALCULATION ─────────────────────────────────────────
function updateAllTimeStats(gameName) {
  const history = gameHistory[gameName];
  if (!history || history.length === 0) return;

  // Chronological order (oldest to newest) to calculate all-time historical max streaks
  const chrono = [...history].sort((a, b) => a.issue.localeCompare(b.issue));

  let maxBig = 0;
  let maxSmall = 0;
  let curBig = 0;
  let curSmall = 0;

  for (let i = 0; i < chrono.length; i++) {
    if (chrono[i].size === 'BIG') {
      curBig++;
      curSmall = 0;
      if (curBig > maxBig) maxBig = curBig;
    } else {
      curSmall++;
      curBig = 0;
      if (curSmall > maxSmall) maxSmall = curSmall;
    }
  }

  // Calculate current active streak from newest backward
  const currentSize = history[0].size;
  let activeStreak = 0;
  for (let i = 0; i < history.length; i++) {
    if (history[i].size === currentSize) activeStreak++;
    else break;
  }

  gameStats[gameName] = {
    maxBigStreak: Math.max(gameStats[gameName].maxBigStreak || 0, maxBig),
    maxSmallStreak: Math.max(gameStats[gameName].maxSmallStreak || 0, maxSmall),
    currentStreak: `${activeStreak}x ${currentSize}`,
    totalDraws: history.length
  };

  return { activeStreak, currentSize, latestIssue: history[0].issue };
}

// ── ROBUST STREAK DETECTION ENGINE ────────────────────────────
async function checkGameStreak(gameName, gameConfig) {
  try {
    const parsed = await fetchJson(gameConfig.url);
    if (!parsed || parsed.code !== 0 || !parsed.data?.list || parsed.data.list.length === 0) {
      return;
    }

    // Add newly arrived draws into UNLIMITED rolling storage
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
          size: num >= 5 ? 'BIG' : 'SMALL',
          color: raw.color || (num === 0 ? 'red,violet' : num === 5 ? 'green,violet' : num % 2 === 0 ? 'red' : 'green'),
          time: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
        });
      }
    }

    // Sort descending by issueNumber (newest first). Works across midnight rollover!
    history.sort((a, b) => b.issue.localeCompare(a.issue));

    // Calculate all-time max streaks and current streak
    const stats = updateAllTimeStats(gameName);
    if (!stats) return;

    const { activeStreak, currentSize, latestIssue } = stats;

    // Trigger alert when streak reaches target
    if (activeStreak >= STREAK_TARGET) {
      if (lastAlerted[gameName] !== latestIssue) {
        lastAlerted[gameName] = latestIssue;
        const recentSizes = history.slice(0, 10).map(x => x.size);
        await broadcastAlert(gameName, currentSize, activeStreak, latestIssue, recentSizes);
      }
    }
  } catch (err) {}
}

// ── START MONITORING ──────────────────────────────────────────
function startBot() {
  console.log('='.repeat(55));
  console.log(`🚀 WinGo 24/7 Unlimited Analytics & Streak Master Started!`);
  console.log(`🎯 Target Alert: ${STREAK_TARGET} consecutive BIG or SMALL`);
  console.log(`📱 Games: WinGo 30S, 1M, 3M, 5M (Unlimited permanent storage)`);
  console.log(`🔔 Notifications: ntfy.sh/${NTFY_TOPIC}`);
  console.log('='.repeat(55));

  for (const [name, config] of Object.entries(GAMES)) {
    checkGameStreak(name, config);
    setInterval(() => checkGameStreak(name, config), config.intervalMs);
  }
}

// ── LOAD DASHBOARD HTML TEMPLATE ──────────────────────────────
let dashboardHtml = '';
try {
  const htmlPath = path.resolve(__dirname, 'unlimited_dashboard.html');
  if (fs.existsSync(htmlPath)) {
    dashboardHtml = fs.readFileSync(htmlPath, 'utf8');
  }
} catch (e) {}

// ── DASHBOARD & API WEB SERVER ────────────────────────────────
const PORT = process.env.PORT || 3099;
const server = http.createServer((req, res) => {
  const reqUrl = req.url.split('?')[0];

  // 1. API: Analytics Data for Frontend Dashboard
  if (reqUrl === '/api/analytics-data') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({
      status: 'ONLINE',
      streakTarget: STREAK_TARGET,
      timestamp: new Date().toISOString(),
      games: {
        'WinGo 30S': { ...gameStats['WinGo 30S'], history: gameHistory['WinGo 30S'] },
        'WinGo 1M':  { ...gameStats['WinGo 1M'],  history: gameHistory['WinGo 1M'] },
        'WinGo 3M':  { ...gameStats['WinGo 3M'],  history: gameHistory['WinGo 3M'] },
        'WinGo 5M':  { ...gameStats['WinGo 5M'],  history: gameHistory['WinGo 5M'] }
      }
    }));
  }

  // 2. API: Export full unlimited JSON
  if (reqUrl === '/api/export-json') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="wingo_all_time_history.json"'
    });
    return res.end(JSON.stringify(gameHistory, null, 2));
  }

  // 3. API: Status
  if (reqUrl === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ONLINE',
      uptimeSeconds: Math.floor(process.uptime()),
      games: gameStats
    }));
  }

  // 4. Main Web Dashboard (Serve UI)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(dashboardHtml || '<h1>WinGo Analytics Hub is Starting...</h1>');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    startBot();
  } else {
    console.error('Server error:', err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Analytics Dashboard] Running on port ${PORT}`);
  startBot();
});
