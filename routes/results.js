const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db/connection');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, 'result-' + Date.now() + '-' + Math.round(Math.random()*1e6) + path.extname(file.originalname))
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype);
    cb(ok ? null : new Error('Solo JPG, PNG, WEBP o GIF'), ok);
  }
});

// Color desde inicial — paleta fija al estilo Discord
const PALETTE = ['#7289da','#43b581','#faa61a','#f04747','#e91e63','#9b59b6','#1abc9c','#3498db','#e67e22','#2ecc71'];
function colorFromName(name) {
  if (!name) return PALETTE[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

// GET — cualquier user autenticado lista los posts
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, avatar_color, content, image_url,
              reaction_fire, reaction_heart, reaction_muscle, posted_at
       FROM result_posts ORDER BY posted_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — solo admin crea posts
router.post('/', authMiddleware, adminOnly, upload.single('image'), async (req, res) => {
  const { username, content, posted_at, reaction_fire, reaction_heart, reaction_muscle } = req.body;
  if (!username || !content) return res.status(400).json({ error: 'Username y contenido son requeridos' });
  const image_url = req.file ? '/uploads/' + req.file.filename : null;
  const color = colorFromName(username);
  try {
    const result = await pool.query(
      `INSERT INTO result_posts (username, avatar_color, content, image_url, reaction_fire, reaction_heart, reaction_muscle, posted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::timestamp, NOW())) RETURNING *`,
      [
        username.trim().slice(0, 80),
        color,
        content.trim(),
        image_url,
        parseInt(reaction_fire) || 0,
        parseInt(reaction_heart) || 0,
        parseInt(reaction_muscle) || 0,
        posted_at || null
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH — solo admin edita
router.patch('/:id', authMiddleware, adminOnly, upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const { username, content, posted_at, reaction_fire, reaction_heart, reaction_muscle, remove_image } = req.body;
  try {
    const existing = await pool.query('SELECT * FROM result_posts WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'No existe' });

    const post = existing.rows[0];
    const newUsername = username?.trim().slice(0, 80) || post.username;
    let image_url = post.image_url;
    if (req.file) image_url = '/uploads/' + req.file.filename;
    if (remove_image === 'true' || remove_image === true) image_url = null;

    const result = await pool.query(
      `UPDATE result_posts
       SET username=$1, avatar_color=$2, content=$3, image_url=$4,
           reaction_fire=$5, reaction_heart=$6, reaction_muscle=$7,
           posted_at = COALESCE($8::timestamp, posted_at)
       WHERE id=$9 RETURNING *`,
      [
        newUsername,
        colorFromName(newUsername),
        content?.trim() || post.content,
        image_url,
        reaction_fire !== undefined ? (parseInt(reaction_fire) || 0) : post.reaction_fire,
        reaction_heart !== undefined ? (parseInt(reaction_heart) || 0) : post.reaction_heart,
        reaction_muscle !== undefined ? (parseInt(reaction_muscle) || 0) : post.reaction_muscle,
        posted_at || null,
        id
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — solo admin borra
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM result_posts WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
