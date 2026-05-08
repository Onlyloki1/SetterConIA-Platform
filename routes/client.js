const express = require('express');
const { pool } = require('../db/connection');
const { authMiddleware } = require('../middleware/auth');
const discord = require('../lib/discord');

const router = express.Router();
router.use(authMiddleware);

// Approval gate — block content for unapproved clients (onboarding routes exempt)
router.use(async (req, res, next) => {
  const onboardingPaths = ['/onboarding', '/onboarding/step', '/onboarding/contract', '/onboarding/proof', '/onboarding/proofs'];
  if (onboardingPaths.some(p => req.path.startsWith(p))) return next();
  if (req.user.role === 'admin') return next();
  try {
    const r = await pool.query('SELECT approved, access_type FROM users WHERE id=$1', [req.user.id]);
    const u = r.rows[0];
    if (!u?.approved) return res.status(403).json({ error: 'Cuenta no aprobada' });
    next();
  } catch { next(); }
});

// Discord OAuth: redirect to Discord authorization
router.get('/discord-auth', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT COALESCE(p.has_discord, false) as has_discord, u.discord_id
      FROM users u LEFT JOIN plans p ON p.id = u.plan_id
      WHERE u.id = $1`, [req.user.id]);
    if (!r.rows[0]?.has_discord) return res.status(403).json({ error: 'No tenes acceso a Discord' });
    // If already connected, check if still in server - if not, allow reconnect
    if (r.rows[0]?.discord_id) {
      try {
        const member = await discord.getMember(r.rows[0].discord_id);
        if (member) return res.json({ url: null, already_connected: true, message: 'Ya estas conectado a Discord' });
        // Not in server anymore, clear and allow reconnect
        await pool.query('UPDATE users SET discord_id = NULL, discord_joined_at = NULL WHERE id = $1', [req.user.id]);
      } catch {
        // Can't check, allow reconnect
        await pool.query('UPDATE users SET discord_id = NULL, discord_joined_at = NULL WHERE id = $1', [req.user.id]);
      }
    }
    // Generate OAuth URL with user ID as state
    const url = discord.getOAuthURL(String(req.user.id));
    res.json({ url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Disconnect Discord
router.post('/discord-disconnect', async (req, res) => {
  try {
    await pool.query('UPDATE users SET discord_id = NULL, discord_joined_at = NULL, discord_expired = false WHERE id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Discord callback is handled in server.js (public route, no auth needed)

// Legacy Discord link (keep for backwards compatibility)
router.get('/discord-link', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT COALESCE(p.has_discord, false) as has_discord
      FROM users u LEFT JOIN plans p ON p.id = u.plan_id
      WHERE u.id = $1`, [req.user.id]);
    if (!r.rows[0]?.has_discord) return res.status(403).json({ error: 'No tenes acceso a Discord' });
    res.json({ url: 'https://discord.gg/5892qzmAr6' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all modules with lesson counts and user progress
router.get('/modules', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*,
        COUNT(DISTINCT l.id) as total_lessons,
        COUNT(DISTINCT CASE WHEN up.completed THEN up.lesson_id END) as completed_lessons
      FROM modules m
      LEFT JOIN lessons l ON l.module_id = m.id
      LEFT JOIN user_progress up ON up.lesson_id = l.id AND up.user_id = $1
      GROUP BY m.id
      ORDER BY m.order_position ASC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get lessons for a module with progress
router.get('/modules/:id/lessons', async (req, res) => {
  try {
    // Check if user has access to this module
    if (req.user.role !== 'admin') {
      const u = await pool.query('SELECT plan_id FROM users WHERE id=$1', [req.user.id]);
      if (u.rows[0]?.plan_id) {
        const p = await pool.query('SELECT allowed_modules FROM plans WHERE id=$1', [u.rows[0].plan_id]);
        const allowed = p.rows[0]?.allowed_modules || [];
        if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(parseInt(req.params.id))) {
          return res.status(403).json({ error: 'No tenes acceso a este modulo' });
        }
      }
    }
    const result = await pool.query(`
      SELECT l.*,
        COALESCE(up.completed, false) as completed
      FROM lessons l
      LEFT JOIN user_progress up ON up.lesson_id = l.id AND up.user_id = $1
      WHERE l.module_id = $2
      ORDER BY l.order_position ASC
    `, [req.user.id, req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all resources
router.get('/resources', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM resources ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get softwares for this user (from plan + personal credentials)
router.get('/softwares', async (req, res) => {
  try {
    // Get user's plan
    const userResult = await pool.query('SELECT plan_id FROM users WHERE id=$1', [req.user.id]);
    const planId = userResult.rows[0]?.plan_id;

    // Get softwares from plan OR from user_credentials
    const result = await pool.query(`
      SELECT DISTINCT s.*,
        uc.username as cred_username, uc.password as cred_password, uc.extra_info as cred_extra, uc.links as user_links
      FROM softwares s
      LEFT JOIN user_credentials uc ON uc.software_id = s.id AND uc.user_id = $1
      WHERE s.id IN (
        SELECT software_id FROM plan_softwares WHERE plan_id = $2
        UNION
        SELECT software_id FROM user_credentials WHERE user_id = $1
      )
      ORDER BY s.order_position ASC
    `, [req.user.id, planId || 0]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle lesson progress
router.post('/progress/:lessonId', async (req, res) => {
  const { lessonId } = req.params;
  try {
    // Check module access for this lesson
    if (req.user.role !== 'admin') {
      const lessonCheck = await pool.query('SELECT module_id FROM lessons WHERE id=$1', [lessonId]);
      if (lessonCheck.rows[0]) {
        const u = await pool.query('SELECT plan_id FROM users WHERE id=$1', [req.user.id]);
        if (u.rows[0]?.plan_id) {
          const p = await pool.query('SELECT allowed_modules FROM plans WHERE id=$1', [u.rows[0].plan_id]);
          const allowed = p.rows[0]?.allowed_modules || [];
          if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(lessonCheck.rows[0].module_id)) {
            return res.status(403).json({ error: 'No tenes acceso' });
          }
        }
      }
    }
    const existing = await pool.query(
      'SELECT * FROM user_progress WHERE user_id = $1 AND lesson_id = $2',
      [req.user.id, lessonId]
    );
    if (existing.rows.length === 0) {
      await pool.query(
        'INSERT INTO user_progress (user_id, lesson_id, completed, completed_at) VALUES ($1, $2, true, NOW())',
        [req.user.id, lessonId]
      );
    } else {
      const newState = !existing.rows[0].completed;
      await pool.query(
        'UPDATE user_progress SET completed = $1, completed_at = $2 WHERE user_id = $3 AND lesson_id = $4',
        [newState, newState ? new Date() : null, req.user.id, lessonId]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Overall progress
router.get('/progress', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(DISTINCT l.id) as total,
        COUNT(DISTINCT CASE WHEN up.completed THEN up.lesson_id END) as completed
      FROM lessons l
      LEFT JOIN user_progress up ON up.lesson_id = l.id AND up.user_id = $1
    `, [req.user.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── NOTIFICATIONS ───
router.get('/notifications', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/notifications/unread-count', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = false',
      [req.user.id]
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/notifications/:id/read', async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/notifications/read-all', async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET read = true WHERE user_id = $1',
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══ ONBOARDING ═══
router.get('/onboarding', async (req, res) => {
  try {
    const r = await pool.query('SELECT onboarding_completed, onboarding_step FROM users WHERE id=$1', [req.user.id]);
    res.json(r.rows[0] || { onboarding_completed: false, onboarding_step: 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/onboarding/step', async (req, res) => {
  const { step } = req.body;
  try {
    console.log(`[ONBOARDING] User ${req.user.id} trying to set step ${step}`);
    const userResult = await pool.query('SELECT id, access_type, onboarding_step FROM users WHERE id=$1', [req.user.id]);
    console.log(`[ONBOARDING] DB result:`, userResult.rows[0]);
    const accessType = userResult.rows[0]?.access_type || 'full';
    const completed = accessType === 'reserve' ? step >= 2 : step >= 5;
    const updateResult = await pool.query('UPDATE users SET onboarding_step=$1, onboarding_completed=$2 WHERE id=$3 RETURNING onboarding_step', [step, completed, req.user.id]);
    console.log(`[ONBOARDING] Update result:`, updateResult.rows[0], 'rowCount:', updateResult.rowCount);
    res.json({ ok: true, completed, updated_step: updateResult.rows[0]?.onboarding_step, rowCount: updateResult.rowCount });
  } catch (err) {
    console.error(`[ONBOARDING ERROR]`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Sign contract
router.post('/onboarding/contract', async (req, res) => {
  const { full_name, address, document_id, payment_date, currency, amount } = req.body;
  if (!full_name || !address || !document_id || !payment_date || !amount) return res.status(400).json({ error: 'Todos los campos son requeridos' });
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  try {
    await pool.query(`
      INSERT INTO contracts (user_id, full_name, address, document_id, payment_date, currency, amount, ip_address)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (user_id) DO UPDATE SET full_name=$2, address=$3, document_id=$4, payment_date=$5, currency=$6, amount=$7, ip_address=$8, signed_at=NOW()
    `, [req.user.id, full_name, address, document_id, payment_date, currency || 'USD', amount, ip]);
    // Advance to step 3
    await pool.query('UPDATE users SET onboarding_step = GREATEST(onboarding_step, 2) WHERE id=$1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload payment proof
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const proofUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, 'proof-' + Date.now() + '-' + Math.round(Math.random()*1e6) + path.extname(file.originalname))
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg','image/png','image/webp','application/pdf'].includes(file.mimetype);
    cb(ok ? null : new Error('Solo JPG, PNG o PDF'), ok);
  }
});

router.post('/onboarding/proof', proofUpload.single('proof'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
  const url = '/uploads/' + req.file.filename;
  try {
    await pool.query('INSERT INTO payment_proofs (user_id, file_url, original_name) VALUES ($1,$2,$3)', [req.user.id, url, req.file.originalname]);
    res.json({ ok: true, url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/onboarding/proofs', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM payment_proofs WHERE user_id=$1 ORDER BY uploaded_at', [req.user.id]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══ WEEKLY CHECK-INS ═══
router.get('/checkins', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM weekly_checkins WHERE user_id=$1 ORDER BY week_start DESC LIMIT 20', [req.user.id]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/checkins/current', async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM weekly_checkins WHERE user_id=$1 AND week_start=date_trunc('week',CURRENT_DATE)::date", [req.user.id]);
    res.json(r.rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/checkins', async (req, res) => {
  const { calls, clients_closed, revenue, notes, week_date } = req.body;
  // Use provided date's week start, or current week
  const dateExpr = week_date ? `date_trunc('week','${week_date}'::date)::date` : "date_trunc('week',CURRENT_DATE)::date";
  try {
    const r = await pool.query(`
      INSERT INTO weekly_checkins (user_id, week_start, calls, clients_closed, revenue, notes)
      VALUES ($1, ${dateExpr}, $2, $3, $4, $5)
      ON CONFLICT (user_id, week_start) DO UPDATE SET calls=$2, clients_closed=$3, revenue=$4, notes=$5
      RETURNING *
    `, [req.user.id, calls||0, clients_closed||0, revenue||0, notes||'']);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══ MONTHLY GOALS ═══
router.get('/goals/current', async (req, res) => {
  try {
    const goal = await pool.query("SELECT * FROM monthly_goals WHERE user_id=$1 AND month=date_trunc('month',CURRENT_DATE)::date", [req.user.id]);
    const progress = await pool.query(`
      SELECT COALESCE(SUM(clients_closed),0) as total_clients, COALESCE(SUM(revenue),0) as total_revenue
      FROM weekly_checkins WHERE user_id=$1 AND week_start >= date_trunc('month',CURRENT_DATE)::date
    `, [req.user.id]);
    res.json({ goal: goal.rows[0] || null, progress: progress.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/goals', async (req, res) => {
  const { revenue_goal, clients_goal, notes } = req.body;
  try {
    const r = await pool.query(`
      INSERT INTO monthly_goals (user_id, month, revenue_goal, clients_goal, notes)
      VALUES ($1, date_trunc('month',CURRENT_DATE)::date, $2, $3, $4)
      ON CONFLICT (user_id, month) DO UPDATE SET revenue_goal=$2, clients_goal=$3, notes=$4
      RETURNING *
    `, [req.user.id, revenue_goal||0, clients_goal||0, notes||'']);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══ ACTION LOGS (DIARIO) ═══
router.get('/action-logs', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM action_logs WHERE user_id=$1 ORDER BY date DESC, created_at DESC LIMIT 50', [req.user.id]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/action-logs', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Contenido requerido' });
  try {
    const r = await pool.query('INSERT INTO action_logs (user_id, content) VALUES ($1, $2) RETURNING *', [req.user.id, content]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
