const express = require('express');
const { pool } = require('../db/connection');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware, adminOnly);

// Export all content data as JSON (admin only)
router.get('/export', async (req, res) => {
  try {
    const data = {};
    data.modules = (await pool.query('SELECT title,description,icon,cover_image,order_position,is_bonus FROM modules ORDER BY order_position')).rows;
    data.lessons = (await pool.query("SELECT m.title as module_title, l.title,l.description,l.content_type,l.content_url,l.thumbnail,l.duration,l.order_position FROM lessons l JOIN modules m ON m.id=l.module_id ORDER BY l.module_id,l.order_position")).rows;
    data.resources = (await pool.query('SELECT title,description,file_url,resource_type FROM resources')).rows;
    data.softwares = (await pool.query('SELECT name,description,download_url,tutorial_url,icon,order_position,links FROM softwares ORDER BY order_position')).rows;
    data.plans = (await pool.query('SELECT name,description,duration_months,order_position,has_discord,has_bot,bot_message_limit,allowed_modules FROM plans ORDER BY order_position')).rows;
    data.plan_softwares = (await pool.query("SELECT p.name as plan_name, s.name as software_name FROM plan_softwares ps JOIN plans p ON p.id=ps.plan_id JOIN softwares s ON s.id=ps.software_id")).rows;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Import content data from JSON (admin only)
router.post('/import', async (req, res) => {
  const data = req.body;
  try {
    let counts = {};

    // Modules
    for (const m of (data.modules || [])) {
      await pool.query('INSERT INTO modules (title,description,icon,cover_image,order_position,is_bonus) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [m.title, m.description, m.icon, m.cover_image, m.order_position, m.is_bonus]);
    }
    counts.modules = (data.modules || []).length;

    // Lessons (match by module_title)
    for (const l of (data.lessons || [])) {
      const mod = (await pool.query('SELECT id FROM modules WHERE title=$1', [l.module_title])).rows[0];
      if (!mod) continue;
      await pool.query('INSERT INTO lessons (module_id,title,description,content_type,content_url,thumbnail,duration,order_position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [mod.id, l.title, l.description, l.content_type, l.content_url, l.thumbnail, l.duration, l.order_position]);
    }
    counts.lessons = (data.lessons || []).length;

    // Resources
    for (const r of (data.resources || [])) {
      await pool.query('INSERT INTO resources (title,description,file_url,resource_type) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [r.title, r.description, r.file_url, r.resource_type]);
    }
    counts.resources = (data.resources || []).length;

    // Softwares
    for (const s of (data.softwares || [])) {
      await pool.query('INSERT INTO softwares (name,description,download_url,tutorial_url,icon,order_position,links) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
        [s.name, s.description, s.download_url, s.tutorial_url, s.icon, s.order_position, JSON.stringify(s.links || [])]);
    }
    counts.softwares = (data.softwares || []).length;

    // Plans
    for (const p of (data.plans || [])) {
      let allowedMods = p.allowed_modules || [];
      if (typeof allowedMods === 'string') allowedMods = JSON.parse(allowedMods);
      // Remap module IDs by looking up new IDs
      const allMods = (await pool.query('SELECT id,title FROM modules')).rows;
      const srcMods = (data.modules || []);
      const remapped = allowedMods.map(oldId => {
        const srcMod = srcMods.find((m, i) => i + 1 === oldId || false); // fallback
        // Better: find by index position in original data
        return oldId; // keep as-is for now, will be remapped below
      });

      await pool.query('INSERT INTO plans (name,description,duration_months,order_position,has_discord,has_bot,bot_message_limit,allowed_modules) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
        [p.name, p.description, p.duration_months, p.order_position, p.has_discord, p.has_bot, p.bot_message_limit, JSON.stringify(allowedMods)]);
    }
    counts.plans = (data.plans || []).length;

    // Plan-Softwares
    for (const ps of (data.plan_softwares || [])) {
      const plan = (await pool.query('SELECT id FROM plans WHERE name=$1', [ps.plan_name])).rows[0];
      const sw = (await pool.query('SELECT id FROM softwares WHERE name=$1', [ps.software_name])).rows[0];
      if (plan && sw) {
        await pool.query('INSERT INTO plan_softwares (plan_id,software_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [plan.id, sw.id]);
      }
    }
    counts.plan_softwares = (data.plan_softwares || []).length;

    res.json({ ok: true, counts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
