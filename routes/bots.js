const express = require('express');
const { pool } = require('../db/connection');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════
// ADMIN ROUTES (require admin auth)
// ═══════════════════════════════════════════
const admin = express.Router();
admin.use(authMiddleware, adminOnly);

// List all bot clients
admin.get('/clients', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT bc.*,
        (SELECT COALESCE(SUM(message_count),0) FROM bot_daily_stats WHERE bot_client_id=bc.id AND date=CURRENT_DATE) as today_sent
      FROM bot_clients bc ORDER BY bc.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create bot client
admin.post('/clients', async (req, res) => {
  const { email, password, name, message_limit, days, notes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  const pw = password || email.split('@')[0] + Math.floor(100 + Math.random() * 900);
  const limit = message_limit || 300;
  const planDays = days || 60;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + planDays);

  try {
    const result = await pool.query(
      `INSERT INTO bot_clients (email, password, name, message_limit, expiry_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [email.toLowerCase().trim(), pw, name || '', limit, expiry, notes || '']
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email ya registrado' });
    res.status(500).json({ error: err.message });
  }
});

// Quick create (just email)
admin.post('/clients/quick', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  const username = email.split('@')[0];
  const pw = username + Math.floor(100 + Math.random() * 900);
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 120);

  try {
    const result = await pool.query(
      `INSERT INTO bot_clients (email, password, name, message_limit, expiry_date, notes)
       VALUES ($1, $2, '', 300, $3, 'Creado con creación rápida') RETURNING *`,
      [email.toLowerCase().trim(), pw, expiry]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email ya registrado' });
    res.status(500).json({ error: err.message });
  }
});

// Update bot client
admin.put('/clients/:id', async (req, res) => {
  const { name, message_limit, expiry_date, notes, is_active } = req.body;
  try {
    await pool.query(
      `UPDATE bot_clients SET name=$1, message_limit=$2, expiry_date=$3, notes=$4, is_active=$5 WHERE id=$6`,
      [name, message_limit, expiry_date, notes, is_active !== false, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Extend plan
admin.put('/clients/:id/extend', async (req, res) => {
  const { days } = req.body;
  if (!days || days < 1) return res.status(400).json({ error: 'Días requeridos' });
  try {
    // If expired, extend from now; if active, extend from current expiry
    await pool.query(`
      UPDATE bot_clients SET
        expiry_date = CASE
          WHEN expiry_date < NOW() THEN NOW() + ($1 || ' days')::interval
          ELSE expiry_date + ($1 || ' days')::interval
        END,
        is_active = true
      WHERE id = $2
    `, [days, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete bot client
admin.delete('/clients/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM bot_clients WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Clean all expired
admin.delete('/clients-expired', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM bot_clients WHERE expiry_date < NOW() RETURNING id');
    res.json({ deleted: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stats
admin.get('/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE expiry_date >= NOW()) as active,
        COUNT(*) FILTER (WHERE expiry_date >= NOW() AND expiry_date < NOW() + interval '7 days') as expiring,
        COUNT(*) FILTER (WHERE expiry_date < NOW()) as expired
      FROM bot_clients
    `);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reset daily messages (call this via cron every midnight)
admin.post('/reset-daily', async (req, res) => {
  try {
    await pool.query('UPDATE bot_clients SET messages_sent = 0, last_reset_date = CURRENT_DATE WHERE last_reset_date < CURRENT_DATE');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.use('/admin', admin);

// ═══════════════════════════════════════════
// PUBLIC BOT API (used by the extension)
// No auth needed — the extension sends email+password
// ═══════════════════════════════════════════

// Validate bot user (extension calls this on login)
router.post('/validate', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y password requeridos' });
  try {
    const result = await pool.query('SELECT * FROM bot_clients WHERE email = $1', [email.toLowerCase().trim()]);
    const client = result.rows[0];
    if (!client) return res.status(401).json({ error: 'Usuario no encontrado', valid: false });
    if (client.password !== password) return res.status(401).json({ error: 'Contraseña incorrecta', valid: false });
    if (!client.is_active) return res.status(403).json({ error: 'Cuenta desactivada', valid: false });
    if (new Date(client.expiry_date) < new Date()) return res.status(403).json({ error: 'Plan expirado', valid: false, expired: true });

    // Reset daily count if new day
    if (client.last_reset_date && new Date(client.last_reset_date).toDateString() !== new Date().toDateString()) {
      await pool.query('UPDATE bot_clients SET messages_sent = 0, last_reset_date = CURRENT_DATE WHERE id = $1', [client.id]);
      client.messages_sent = 0;
    }

    res.json({
      valid: true,
      id: client.id,
      email: client.email,
      name: client.name,
      messageLimit: client.message_limit,
      messagesSent: client.messages_sent,
      expiryDate: client.expiry_date,
      daysLeft: Math.ceil((new Date(client.expiry_date) - new Date()) / (1000*60*60*24))
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Track message sent (extension calls this after each message)
router.post('/track-message', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y password requeridos' });
  try {
    const result = await pool.query('SELECT * FROM bot_clients WHERE email = $1 AND password = $2', [email.toLowerCase().trim(), password]);
    const client = result.rows[0];
    if (!client) return res.status(401).json({ error: 'No autorizado' });
    if (new Date(client.expiry_date) < new Date()) return res.status(403).json({ error: 'Plan expirado', allowed: false });

    // Reset if new day
    if (client.last_reset_date && new Date(client.last_reset_date).toDateString() !== new Date().toDateString()) {
      await pool.query('UPDATE bot_clients SET messages_sent = 0, last_reset_date = CURRENT_DATE WHERE id = $1', [client.id]);
      client.messages_sent = 0;
    }

    // Check limit
    if (client.messages_sent >= client.message_limit) {
      return res.status(429).json({ error: 'Límite diario alcanzado', allowed: false, limit: client.message_limit, sent: client.messages_sent });
    }

    // Increment
    await pool.query('UPDATE bot_clients SET messages_sent = messages_sent + 1 WHERE id = $1', [client.id]);

    // Track daily stat
    const today = new Date().toISOString().split('T')[0];
    await pool.query(`
      INSERT INTO bot_daily_stats (bot_client_id, date, message_count)
      VALUES ($1, $2, 1)
      ON CONFLICT (bot_client_id, date) DO UPDATE SET message_count = bot_daily_stats.message_count + 1
    `, [client.id, today]);

    res.json({ allowed: true, sent: client.messages_sent + 1, limit: client.message_limit });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Check status (quick check without tracking)
router.post('/status', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Credenciales requeridas' });
  try {
    const result = await pool.query('SELECT * FROM bot_clients WHERE email = $1 AND password = $2', [email.toLowerCase().trim(), password]);
    const client = result.rows[0];
    if (!client) return res.status(401).json({ valid: false });

    const expired = new Date(client.expiry_date) < new Date();
    res.json({
      valid: !expired && client.is_active,
      expired,
      messagesSent: client.messages_sent,
      messageLimit: client.message_limit,
      daysLeft: Math.ceil((new Date(client.expiry_date) - new Date()) / (1000*60*60*24))
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
