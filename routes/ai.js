const express = require('express');
const { pool } = require('../db/connection');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// ─── AI Config (admin) ───
router.get('/config', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ai_config ORDER BY key');
    const config = {};
    for (const row of result.rows) config[row.key] = row.value;
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/config', authMiddleware, adminOnly, async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'Key requerida' });
  try {
    await pool.query(
      `INSERT INTO ai_config (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI Chat placeholder (client) ───
// When you're ready to integrate AI, connect this to Claude/OpenAI API
router.post('/ask', authMiddleware, async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Pregunta requerida' });

  try {
    // Check if AI is enabled
    const config = await pool.query("SELECT value FROM ai_config WHERE key = 'enabled'");
    const enabled = config.rows.length > 0 && config.rows[0].value === true;

    if (!enabled) {
      return res.json({
        answer: 'El asistente de IA aún no está habilitado. Próximamente vas a poder hacer preguntas sobre el contenido del programa.',
        enabled: false
      });
    }

    // TODO: Connect to Claude API or OpenAI
    // const apiKey = await pool.query("SELECT value FROM ai_config WHERE key = 'api_key'");
    // const response = await callAI(apiKey.rows[0].value, question);

    res.json({
      answer: 'Función de IA próximamente disponible.',
      enabled: true
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
