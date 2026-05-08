const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { pool } = require('../db/connection');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, adminOnly);

// Upload config — uses UPLOAD_DIR env var for Railway volumes
const fs = require('fs');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
// Ensure upload dir exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  }
});
const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (allowedMimes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten PDFs e imágenes'));
  }
});

// ─── USERS ───
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.plan_id, u.expires_at, u.onboarding_completed, u.approved, u.rejected, u.access_type, u.created_at, p.name as plan_name, p.duration_months
       FROM users u LEFT JOIN plans p ON p.id = u.plan_id
       ORDER BY u.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', async (req, res) => {
  let { email, password, name, role, plan_id } = req.body;
  if (!email || !name) return res.status(400).json({ error: 'Campos requeridos: email, name' });
  try {
    // Auto-generate password if not provided
    const plainPassword = password || ('Smart' + Math.floor(100 + Math.random() * 900));

    // Calculate expires_at from plan duration
    let expiresAt = null;
    if (plan_id) {
      const planResult = await pool.query('SELECT duration_months FROM plans WHERE id = $1', [plan_id]);
      if (planResult.rows[0]) {
        const months = planResult.rows[0].duration_months || 1;
        expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + months);
      }
    }
    const hash = await bcrypt.hash(plainPassword, 12);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name, role, plan_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, name, role, plan_id, expires_at, created_at',
      [email.toLowerCase().trim(), hash, name, role || 'client', plan_id || null, expiresAt]
    );
    const user = result.rows[0];
    user.generatedPassword = plainPassword;

    // Send welcome email (non-blocking)
    try {
      const { sendWelcomeEmail } = require('../services/email');
      sendWelcomeEmail(user.email, name, plainPassword);
    } catch (emailErr) { console.error('Email send error:', emailErr); }

    res.json(user);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email ya registrado' });
    res.status(500).json({ error: err.message });
  }
});

// Resend welcome email
router.post('/users/:id/resend-welcome', async (req, res) => {
  try {
    const userResult = await pool.query('SELECT email, name FROM users WHERE id = $1', [req.params.id]);
    if (!userResult.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    const { email, name } = userResult.rows[0];
    // Generate new password
    const plainPassword = 'Smart' + Math.floor(100 + Math.random() * 900);
    const hash = await bcrypt.hash(plainPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1, onboarding_completed = false, onboarding_step = 0 WHERE id = $2', [hash, req.params.id]);
    const { sendWelcomeEmail } = require('../services/email');
    await sendWelcomeEmail(email, name, plainPassword);
    res.json({ ok: true, password: plainPassword });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:id', async (req, res) => {
  const { name, email, password, role, plan_id } = req.body;
  try {
    // Recalculate expires_at if plan changed
    let expiresAt = null;
    if (plan_id) {
      // Check if plan changed
      const currentUser = await pool.query('SELECT plan_id, expires_at FROM users WHERE id = $1', [req.params.id]);
      const oldPlanId = currentUser.rows[0]?.plan_id;
      if (String(plan_id) !== String(oldPlanId)) {
        // Plan changed — reset expiry from now
        const planResult = await pool.query('SELECT duration_months FROM plans WHERE id = $1', [plan_id]);
        if (planResult.rows[0]) {
          expiresAt = new Date();
          expiresAt.setMonth(expiresAt.getMonth() + (planResult.rows[0].duration_months || 1));
        }
      } else {
        expiresAt = currentUser.rows[0]?.expires_at; // Keep existing
      }
    }
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      await pool.query(
        'UPDATE users SET name=$1, email=$2, password_hash=$3, role=$4, plan_id=$5, expires_at=$6 WHERE id=$7',
        [name, email.toLowerCase().trim(), hash, role, plan_id || null, expiresAt, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE users SET name=$1, email=$2, role=$3, plan_id=$4, expires_at=$5 WHERE id=$6',
        [name, email.toLowerCase().trim(), role, plan_id || null, expiresAt, req.params.id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1 AND role != $2', [req.params.id, 'admin']);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MODULES ───
router.get('/modules', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM modules ORDER BY order_position ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/modules', async (req, res) => {
  const { title, description, icon, cover_image, is_bonus } = req.body;
  try {
    const maxOrder = await pool.query('SELECT COALESCE(MAX(order_position), 0) + 1 as next FROM modules');
    const result = await pool.query(
      'INSERT INTO modules (title, description, icon, cover_image, order_position, is_bonus) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [title, description, icon || '📚', cover_image || '', maxOrder.rows[0].next, is_bonus || false]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/modules/:id', async (req, res) => {
  const { title, description, icon, cover_image, order_position, is_bonus } = req.body;
  try {
    await pool.query(
      'UPDATE modules SET title=$1, description=$2, icon=$3, cover_image=$4, order_position=$5, is_bonus=$6 WHERE id=$7',
      [title, description, icon, cover_image, order_position, is_bonus || false, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/modules/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM modules WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MODULES REORDER ───
router.put('/modules/reorder', async (req, res) => {
  const { order } = req.body; // [{ id, order_position }]
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  try {
    for (const item of order) {
      await pool.query('UPDATE modules SET order_position = $1 WHERE id = $2', [item.order_position, item.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── LESSONS ───
router.get('/lessons', async (req, res) => {
  const { module_id } = req.query;
  try {
    let result;
    if (module_id) {
      result = await pool.query('SELECT * FROM lessons WHERE module_id = $1 ORDER BY order_position ASC', [module_id]);
    } else {
      result = await pool.query('SELECT * FROM lessons ORDER BY module_id, order_position ASC');
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lessons', async (req, res) => {
  const { module_id, title, description, content_type, content_url, thumbnail, duration } = req.body;
  try {
    const maxOrder = await pool.query(
      'SELECT COALESCE(MAX(order_position), 0) + 1 as next FROM lessons WHERE module_id = $1', [module_id]
    );
    const result = await pool.query(
      'INSERT INTO lessons (module_id, title, description, content_type, content_url, thumbnail, duration, order_position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [module_id, title, description, content_type, content_url, thumbnail || '', duration || '', maxOrder.rows[0].next]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/lessons/:id', async (req, res) => {
  const { title, description, content_type, content_url, thumbnail, duration, order_position } = req.body;
  try {
    await pool.query(
      'UPDATE lessons SET title=$1, description=$2, content_type=$3, content_url=$4, thumbnail=$5, duration=$6, order_position=$7 WHERE id=$8',
      [title, description, content_type, content_url, thumbnail, duration, order_position, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/lessons/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM lessons WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── LESSONS REORDER ───
router.put('/lessons/reorder', async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  try {
    for (const item of order) {
      await pool.query('UPDATE lessons SET order_position = $1 WHERE id = $2', [item.order_position, item.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── LESSONS BULK IMPORT ───
router.post('/lessons/bulk', async (req, res) => {
  const { module_id, lessons } = req.body;
  if (!module_id || !Array.isArray(lessons) || !lessons.length) {
    return res.status(400).json({ error: 'module_id and lessons array required' });
  }
  try {
    const maxOrder = await pool.query(
      'SELECT COALESCE(MAX(order_position), 0) as max FROM lessons WHERE module_id = $1', [module_id]
    );
    let pos = maxOrder.rows[0].max;
    const created = [];
    for (const l of lessons) {
      pos++;
      const result = await pool.query(
        'INSERT INTO lessons (module_id, title, description, content_type, content_url, thumbnail, duration, order_position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [module_id, l.title, l.description || '', l.content_type || 'video', l.content_url, l.thumbnail || '', l.duration || '', pos]
      );
      created.push(result.rows[0]);
    }
    res.json({ ok: true, created: created.length, lessons: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── RESOURCES ───
router.get('/resources', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM resources ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/resources', async (req, res) => {
  const { title, description, file_url, resource_type } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO resources (title, description, file_url, resource_type) VALUES ($1,$2,$3,$4) RETURNING *',
      [title, description, file_url, resource_type]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/resources/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM resources WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── UPLOAD PDF ───
router.post('/upload', upload.single('pdf'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
  res.json({ url: '/uploads/' + req.file.filename });
});

router.post('/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ninguna imagen' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// ─── PROGRESS (admin view) ───
router.get('/progress', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id as user_id, u.name, u.email,
        COUNT(DISTINCT l.id) as total_lessons,
        COUNT(DISTINCT CASE WHEN up.completed THEN up.lesson_id END) as completed_lessons
      FROM users u
      LEFT JOIN lessons l ON true
      LEFT JOIN user_progress up ON up.user_id = u.id AND up.lesson_id = l.id
      WHERE u.role = 'client'
      GROUP BY u.id, u.name, u.email
      ORDER BY u.name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── NOTIFICATIONS (admin) ───
router.post('/notifications/broadcast', async (req, res) => {
  const { title, message, type } = req.body;
  if (!title) return res.status(400).json({ error: 'Título requerido' });
  try {
    const clients = await pool.query('SELECT id FROM users WHERE role = $1', ['client']);
    for (const client of clients.rows) {
      await pool.query(
        'INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)',
        [client.id, title, message || '', type || 'system']
      );
    }
    res.json({ ok: true, sent: clients.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/notifications/send', async (req, res) => {
  const { user_id, title, message, type } = req.body;
  if (!user_id || !title) return res.status(400).json({ error: 'user_id y title requeridos' });
  try {
    const result = await pool.query(
      'INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4) RETURNING *',
      [user_id, title, message || '', type || 'system']
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PLANS ───
router.get('/plans', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM plans ORDER BY order_position ASC');
    // Get softwares for each plan
    for (const plan of result.rows) {
      const sw = await pool.query(
        'SELECT s.* FROM softwares s JOIN plan_softwares ps ON ps.software_id = s.id WHERE ps.plan_id = $1 ORDER BY s.order_position',
        [plan.id]
      );
      plan.softwares = sw.rows;
    }
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/plans', async (req, res) => {
  const { name, description, duration_months, has_discord, has_bot, bot_message_limit, bot_credential_software_id, allowed_modules, software_ids } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const result = await pool.query(
      'INSERT INTO plans (name, description, duration_months, has_discord, has_bot, bot_message_limit, bot_credential_software_id, allowed_modules) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [name, description || '', duration_months || 1, has_discord || false, has_bot || false, bot_message_limit || 300, bot_credential_software_id || null, JSON.stringify(allowed_modules || [])]
    );
    // Save softwares
    if (Array.isArray(software_ids)) {
      for (const sid of software_ids) {
        await pool.query('INSERT INTO plan_softwares (plan_id, software_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [result.rows[0].id, sid]);
      }
    }
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/plans/:id', async (req, res) => {
  const { name, description, duration_months, has_discord, has_bot, bot_message_limit, bot_credential_software_id, allowed_modules, software_ids } = req.body;
  try {
    await pool.query('UPDATE plans SET name=$1, description=$2, duration_months=$3, has_discord=$4, has_bot=$5, bot_message_limit=$6, bot_credential_software_id=$7, allowed_modules=$8 WHERE id=$9',
      [name, description, duration_months || 1, has_discord || false, has_bot || false, bot_message_limit || 300, bot_credential_software_id || null, JSON.stringify(allowed_modules || []), req.params.id]);
    // Update softwares if provided
    if (Array.isArray(software_ids)) {
      await pool.query('DELETE FROM plan_softwares WHERE plan_id = $1', [req.params.id]);
      for (const sid of software_ids) {
        await pool.query('INSERT INTO plan_softwares (plan_id, software_id) VALUES ($1, $2)', [req.params.id, sid]);
      }
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/plans/:id', async (req, res) => {
  try {
    await pool.query('UPDATE users SET plan_id = NULL WHERE plan_id = $1', [req.params.id]);
    await pool.query('DELETE FROM plans WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/plans/:id/softwares', async (req, res) => {
  const { software_ids } = req.body;
  if (!Array.isArray(software_ids)) return res.status(400).json({ error: 'software_ids array requerido' });
  try {
    await pool.query('DELETE FROM plan_softwares WHERE plan_id = $1', [req.params.id]);
    for (const sid of software_ids) {
      await pool.query('INSERT INTO plan_softwares (plan_id, software_id) VALUES ($1, $2)', [req.params.id, sid]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── SOFTWARES ───
router.get('/softwares', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM softwares ORDER BY order_position ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/softwares', async (req, res) => {
  const { name, description, download_url, tutorial_url, icon, links } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const result = await pool.query(
      'INSERT INTO softwares (name, description, download_url, tutorial_url, icon, links) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [name, description || '', download_url || '', tutorial_url || '', icon || '💻', JSON.stringify(links || [])]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/softwares/reorder', async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array requerido' });
  try {
    for (const item of order) {
      await pool.query('UPDATE softwares SET order_position=$1 WHERE id=$2', [item.order_position, item.id]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/softwares/:id', async (req, res) => {
  const { name, description, download_url, tutorial_url, icon, links } = req.body;
  try {
    await pool.query(
      'UPDATE softwares SET name=$1, description=$2, download_url=$3, tutorial_url=$4, icon=$5, links=$6 WHERE id=$7',
      [name, description, download_url, tutorial_url, icon, JSON.stringify(links || []), req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/softwares/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM softwares WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── CREDENTIALS ───
router.get('/credentials/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT uc.*, s.name as software_name, s.icon as software_icon
       FROM user_credentials uc
       JOIN softwares s ON s.id = uc.software_id
       WHERE uc.user_id = $1
       ORDER BY s.order_position`,
      [req.params.userId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/credentials', async (req, res) => {
  const { user_id, software_id, username, password, extra_info, links } = req.body;
  if (!user_id || !software_id) return res.status(400).json({ error: 'user_id y software_id requeridos' });
  try {
    const result = await pool.query(
      `INSERT INTO user_credentials (user_id, software_id, username, password, extra_info, links)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, software_id) DO UPDATE SET username=$3, password=$4, extra_info=$5, links=$6
       RETURNING *`,
      [user_id, software_id, username || '', password || '', extra_info || '', JSON.stringify(links || [])]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Clear all credentials for a user
router.delete('/credentials/:userId/clear', async (req, res) => {
  try {
    await pool.query('DELETE FROM user_credentials WHERE user_id = $1', [req.params.userId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/credentials/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM user_credentials WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ADMIN: CHECK-INS ───
router.get('/checkins', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT wc.*, u.name as user_name, u.email as user_email
      FROM weekly_checkins wc JOIN users u ON u.id = wc.user_id
      ORDER BY wc.week_start DESC LIMIT 100
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/checkins/:userId', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM weekly_checkins WHERE user_id=$1 ORDER BY week_start DESC', [req.params.userId]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ADMIN: GOALS ───
router.get('/goals', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT mg.*, u.name as user_name, u.email as user_email,
        (SELECT COALESCE(SUM(revenue),0) FROM weekly_checkins WHERE user_id=mg.user_id AND week_start >= mg.month AND week_start < mg.month + interval '1 month') as actual_revenue,
        (SELECT COALESCE(SUM(clients_closed),0) FROM weekly_checkins WHERE user_id=mg.user_id AND week_start >= mg.month AND week_start < mg.month + interval '1 month') as actual_clients
      FROM monthly_goals mg JOIN users u ON u.id = mg.user_id
      WHERE mg.month = date_trunc('month',CURRENT_DATE)::date
      ORDER BY u.name
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ADMIN: ACTION LOGS ───
router.get('/action-logs/:userId', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM action_logs WHERE user_id=$1 ORDER BY date DESC, created_at DESC LIMIT 50', [req.params.userId]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ADMIN: APPROVALS ───
router.get('/pending', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT u.id, u.email, u.name, u.phone, u.onboarding_completed, u.approved, u.rejected, u.access_type, u.closer_notes, u.created_at,
        c.full_name, c.address, c.document_id, c.payment_date, c.currency, c.amount, c.ip_address, c.signed_at,
        p.name as plan_name
      FROM users u
      LEFT JOIN contracts c ON c.user_id = u.id
      LEFT JOIN plans p ON p.id = u.plan_id
      WHERE u.role = 'client' AND u.approved = false AND u.rejected = false
      ORDER BY u.created_at DESC
    `);
    // Get payment proofs for each user
    for (const user of r.rows) {
      const proofs = await pool.query('SELECT * FROM payment_proofs WHERE user_id=$1 ORDER BY uploaded_at', [user.id]);
      user.proofs = proofs.rows;
    }
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/approve/:id', async (req, res) => {
  const { plan_id } = req.body || {};
  try {
    // Set approved + plan + calculate expiry
    let expiresAt = null;
    let plan = null;
    if (plan_id) {
      const planResult = await pool.query('SELECT * FROM plans WHERE id = $1', [plan_id]);
      plan = planResult.rows[0];
      if (plan) {
        expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + (plan.duration_months || 1));
      }
    }
    await pool.query('UPDATE users SET approved=true, rejected=false, plan_id=$2, expires_at=$3 WHERE id=$1', [req.params.id, plan_id || null, expiresAt]);
    await pool.query("INSERT INTO notifications (user_id, title, message, type) VALUES ($1, 'Cuenta aprobada', 'Tu cuenta fue aprobada. Ya podes acceder a todo el contenido.', 'system')", [req.params.id]);

    // Auto-create Firebase bot if plan includes it
    let botResult = null;
    if (plan && plan.has_bot) {
      const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [req.params.id]);
      const userEmail = userResult.rows[0]?.email;
      if (userEmail) {
        const botPassword = userEmail.split('@')[0] + Math.floor(100 + Math.random() * 900);
        const { createFirebaseBot } = require('../services/firebase-admin');
        botResult = await createFirebaseBot(userEmail, botPassword, plan.bot_message_limit || 300, plan.duration_months * 30);
        if (botResult.success) {
          console.log('Auto-created Firebase bot for:', userEmail);
          // Save bot credentials into the designated software's user_credentials
          if (plan.bot_credential_software_id) {
            await pool.query(`
              INSERT INTO user_credentials (user_id, software_id, username, password, extra_info)
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (user_id, software_id) DO UPDATE SET username=$3, password=$4, extra_info=$5
            `, [req.params.id, plan.bot_credential_software_id, userEmail, botPassword, 'Credenciales del bot - creadas automaticamente']);
          }
        } else {
          console.error('Failed to auto-create bot:', botResult.error);
        }
      }
    }

    res.json({ ok: true, bot: botResult });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reject/:id', async (req, res) => {
  try {
    await pool.query('UPDATE users SET rejected=true, approved=false WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
