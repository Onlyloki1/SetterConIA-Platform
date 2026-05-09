require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const path = require('path');
const { initDB } = require('./db/connection');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ──
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Prevent MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Referrer policy — don't leak URLs to external embeds
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Permissions policy — restrict features
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // CSP — allow embeds from video platforms
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https: http:; " +
    "frame-src 'self' https://www.loom.com https://www.youtube.com https://player.vimeo.com https://docs.google.com https://*.firebaseapp.com; " +
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com;"
  );
  next();
});

// ── Compression (gzip) ──
app.use(compression());

// ── Body parsing ──
app.use(express.json());
app.use(cookieParser());

// ── Static files — NO cache for HTML/JS/CSS so updates show immediately ──
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
}));

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  etag: true
}));

// ── Discord OAuth callback (public, no auth needed) ──
const discordLib = require('./lib/discord');
const { pool: dbPool } = require('./db/connection');
app.get('/api/client/discord-callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.redirect('/dashboard.html?discord=error&reason=missing_params');
  try {
    const tokenData = await discordLib.exchangeCode(code);
    console.log(`[DISCORD] Token obtained, scopes: ${tokenData.scope}`);
    const discordUser = await discordLib.getUserInfo(tokenData.access_token);
    console.log(`[DISCORD] User: ${discordUser.username} (${discordUser.id})`);
    // Get user name from platform DB for Discord nickname
    const userRow = await dbPool.query('SELECT name FROM users WHERE id = $1', [state]);
    const platformName = userRow.rows?.[0]?.name || null;
    const added = await discordLib.addToGuild(tokenData.access_token, discordUser.id, platformName);
    console.log(`[DISCORD] addToGuild result: ${added}${platformName ? ` (nick: ${platformName})` : ''}`);
    await dbPool.query('UPDATE users SET discord_id = $1, discord_joined_at = NOW(), discord_expired = false WHERE id = $2', [discordUser.id, state]);
    console.log(`[DISCORD] User ${state} connected as ${discordUser.username} (${discordUser.id})`);
    // Redirect to Discord server instead of platform
    res.redirect('https://discord.com/channels/1283114078260301864');
  } catch (err) {
    console.error('[DISCORD CALLBACK ERROR]', JSON.stringify(err.response?.data || err.message));
    res.redirect('/dashboard.html?discord=error&reason=auth_failed');
  }
});

// Test: force set nickname
app.post('/api/admin/discord-setnick', async (req, res) => {
  const { discord_id, nickname } = req.body;
  if (!discord_id || !nickname) return res.status(400).json({ error: 'discord_id and nickname required' });
  try {
    await discordLib.setNickname(discord_id, nickname);
    res.json({ ok: true, discord_id, nickname });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ── Routes ──
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/client', require('./routes/client'));
app.use('/api/proxy', require('./routes/proxy'));
app.use('/api/youtube', require('./routes/youtube'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/bots', require('./routes/bots'));
app.use('/api/closer', require('./routes/closer'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/public', require('./routes/public'));

// Root → curso público (sin login)
app.get('/', (req, res) => {
  res.redirect('/curso.html');
});

async function start() {
  await initDB();
  app.listen(PORT, () => {
    console.log(`Setter con IA Platform running on port ${PORT}`);
    // Start daily expiry check (runs once on startup, then every 24h)
    const { checkExpirations, checkDiscordExpirations } = require('./services/cron');
    checkExpirations().catch(console.error);
    checkDiscordExpirations().catch(console.error);
    setInterval(() => {
      checkExpirations().catch(console.error);
      checkDiscordExpirations().catch(console.error);
    }, 60 * 1000); // TEST: check every 1 minute (change back to 24*60*60*1000 after testing)
  });
}

start().catch(console.error);
