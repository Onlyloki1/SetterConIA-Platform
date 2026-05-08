const express = require('express');
const { google } = require('googleapis');
const { pool } = require('../db/connection');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.PLATFORM_URL + '/api/calendar/callback';

function getOAuth2Client() {
  if (!CLIENT_ID || !CLIENT_SECRET) return null;
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

// Step 1: Admin clicks to connect Google Calendar
router.get('/connect', authMiddleware, adminOnly, (req, res) => {
  const oauth2 = getOAuth2Client();
  if (!oauth2) return res.status(500).json({ error: 'Google Calendar not configured' });

  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  res.redirect(url);
});

// Step 2: Google redirects back with auth code
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code received');

  const oauth2 = getOAuth2Client();
  try {
    const { tokens } = await oauth2.getToken(code);
    // Save tokens in DB (ai_config table as key/value)
    await pool.query(
      `INSERT INTO ai_config (key, value) VALUES ('google_calendar_tokens', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(tokens)]
    );
    res.send('<html><body style="background:#07111f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;"><div style="text-align:center;"><h1>Google Calendar conectado</h1><p>Podes cerrar esta ventana.</p></div></body></html>');
  } catch (err) {
    console.error('Calendar callback error:', err);
    res.status(500).send('Error connecting: ' + err.message);
  }
});

// Helper: get authenticated calendar client
async function getCalendar() {
  const oauth2 = getOAuth2Client();
  if (!oauth2) return null;

  const result = await pool.query("SELECT value FROM ai_config WHERE key = 'google_calendar_tokens'");
  if (!result.rows[0]) return null;

  const tokens = result.rows[0].value;
  oauth2.setCredentials(tokens);

  // Auto-refresh if expired
  oauth2.on('tokens', async (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    await pool.query(
      `UPDATE ai_config SET value = $1, updated_at = NOW() WHERE key = 'google_calendar_tokens'`,
      [JSON.stringify(merged)]
    );
  });

  return google.calendar({ version: 'v3', auth: oauth2 });
}

// Get today's events (admin only)
router.get('/events', authMiddleware, adminOnly, async (req, res) => {
  try {
    const calendar = await getCalendar();
    if (!calendar) return res.status(400).json({ error: 'Google Calendar no conectado. Anda a /api/calendar/connect' });

    const date = req.query.date || new Date().toISOString().split('T')[0];
    const timeMin = new Date(date + 'T00:00:00-03:00').toISOString();
    const timeMax = new Date(date + 'T23:59:59-03:00').toISOString();

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (response.data.items || []).map(e => ({
      id: e.id,
      title: e.summary || 'Sin titulo',
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      meetLink: e.hangoutLink || e.conferenceData?.entryPoints?.[0]?.uri || '',
      attendees: (e.attendees || []).map(a => ({ email: a.email, name: a.displayName, status: a.responseStatus })),
      description: e.description || '',
      status: e.status,
    }));

    res.json(events);
  } catch (err) {
    console.error('Calendar events error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Check connection status
router.get('/status', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM ai_config WHERE key = 'google_calendar_tokens'");
    res.json({ connected: !!result.rows[0] });
  } catch { res.json({ connected: false }); }
});

// ── CALL TRACKING ──
// Save call result after a meeting
router.post('/calls', authMiddleware, async (req, res) => {
  const { event_id, client_name, client_email, client_phone, result, amount, notes, call_date } = req.body;
  try {
    const r = await pool.query(`
      INSERT INTO call_tracking (closer_id, event_id, client_name, client_email, client_phone, result, amount, notes, call_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (event_id) DO UPDATE SET result=$6, amount=$7, notes=$8
      RETURNING *
    `, [req.user.id, event_id || '', client_name || '', client_email || '', client_phone || '', result, amount || 0, notes || '', call_date || new Date()]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all tracked calls
router.get('/calls', authMiddleware, adminOnly, async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const r = await pool.query(`
      SELECT ct.*, u.name as closer_name
      FROM call_tracking ct
      LEFT JOIN users u ON u.id = ct.closer_id
      WHERE ct.call_date::date = $1
      ORDER BY ct.call_date DESC
    `, [date]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get call stats
router.get('/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const r = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE result = 'closed') as closed,
        COUNT(*) FILTER (WHERE result = 'interested') as interested,
        COUNT(*) FILTER (WHERE result = 'not_closed') as not_closed,
        COUNT(*) FILTER (WHERE result = 'no_show') as no_show,
        COUNT(*) FILTER (WHERE result = 'rescheduled') as rescheduled,
        COALESCE(SUM(amount) FILTER (WHERE result = 'closed'), 0) as revenue
      FROM call_tracking WHERE call_date::date = $1
    `, [today]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
