const express = require('express');
const { pool } = require('../db/connection');
const router = express.Router();

// GET /api/public/curso  → modules + lessons (agrupado, info pública)
// Para lessons bloqueadas: NO devuelve content_url (security: previene bypass desde devtools)
router.get('/curso', async (req, res) => {
  try {
    const modulesResult = await pool.query(
      `SELECT id, title, description, icon, cover_image, order_position, is_bonus
       FROM modules
       ORDER BY order_position ASC`
    );
    const lessonsResult = await pool.query(
      `SELECT id, module_id, title, description, content_type, content_url, thumbnail, duration, order_position, is_locked
       FROM lessons
       ORDER BY module_id, order_position ASC`
    );

    const lessonsByModule = {};
    for (const lesson of lessonsResult.rows) {
      const safe = {
        id: lesson.id,
        module_id: lesson.module_id,
        title: lesson.title,
        description: lesson.description,
        thumbnail: lesson.thumbnail,
        duration: lesson.duration,
        order_position: lesson.order_position,
        is_locked: lesson.is_locked,
        content_type: lesson.is_locked ? null : lesson.content_type,
        content_url: lesson.is_locked ? null : lesson.content_url,
      };
      if (!lessonsByModule[lesson.module_id]) lessonsByModule[lesson.module_id] = [];
      lessonsByModule[lesson.module_id].push(safe);
    }

    const modules = modulesResult.rows.map(m => ({
      ...m,
      lessons: lessonsByModule[m.id] || []
    }));

    res.json({ modules });
  } catch (err) {
    console.error('[public/curso]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/checkout-url  → solo el valor del checkout_url
router.get('/checkout-url', async (req, res) => {
  try {
    const result = await pool.query('SELECT value FROM app_settings WHERE key = $1', ['checkout_url']);
    res.json({ url: result.rows[0]?.value || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
