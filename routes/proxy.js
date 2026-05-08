const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/connection');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Signed video URL — generates a temporary token that resolves to the real embed URL
// The frontend NEVER sees the actual Loom/YouTube/Vimeo URL
router.get('/video/:lessonId', authMiddleware, async (req, res) => {
  try {
    // Check module access
    const lesson = await pool.query(
      'SELECT l.content_url, l.content_type, l.module_id FROM lessons l WHERE l.id = $1',
      [req.params.lessonId]
    );
    if (lesson.rows.length === 0) return res.status(404).json({ error: 'Lección no encontrada' });
    if (lesson.rows[0].content_type !== 'video') return res.status(400).json({ error: 'No es un video' });

    if (req.user.role !== 'admin') {
      const u = await pool.query('SELECT plan_id FROM users WHERE id=$1', [req.user.id]);
      if (u.rows[0]?.plan_id) {
        const p = await pool.query('SELECT allowed_modules FROM plans WHERE id=$1', [u.rows[0].plan_id]);
        const allowed = p.rows[0]?.allowed_modules || [];
        if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(lesson.rows[0].module_id)) {
          return res.status(403).json({ error: 'No tenes acceso a este contenido' });
        }
      }
    }

    // Generate signed token valid for 30 minutes
    const token = jwt.sign(
      { lessonId: parseInt(req.params.lessonId), userId: req.user.id },
      process.env.JWT_SECRET,
      { expiresIn: '30m' }
    );

    res.json({ token });
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Serve the actual video page via signed token — renders an HTML page with the embed
// This is what the iframe src points to. User sees our domain, not Loom's.
router.get('/embed/:token', async (req, res) => {
  try {
    const decoded = jwt.verify(req.params.token, process.env.JWT_SECRET);
    const lesson = await pool.query(
      'SELECT content_url FROM lessons WHERE id = $1',
      [decoded.lessonId]
    );
    if (lesson.rows.length === 0) return res.status(404).send('Not found');

    const rawUrl = lesson.rows[0].content_url;
    const embedUrl = getSecureEmbedUrl(rawUrl);

    // Return an HTML page that embeds the video — no URL visible in parent frame
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; }
  html, body { width:100%; height:100%; overflow:hidden; background:#000; }
  iframe { width:100%; height:100%; border:none; }
  /* Block right-click */
  body { -webkit-user-select:none; user-select:none; }
</style>
<script>
  document.addEventListener('contextmenu', e => e.preventDefault());
  // Block keyboard shortcuts for save/inspect
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'u' || e.key === 'i')) e.preventDefault();
  });
</script>
</head>
<body>
<iframe src="${embedUrl}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe>
</body></html>`);
  } catch (err) {
    res.status(403).send('Token expirado o inválido. Recargá la página.');
  }
});

function getSecureEmbedUrl(url) {
  // Loom — hide all sharing/download controls
  if (url.includes('loom.com/share/')) {
    const id = url.split('loom.com/share/')[1].split('?')[0];
    return `https://www.loom.com/embed/${id}?hide_owner=true&hide_share=true&hide_title=true&hideEmbedTopBar=true`;
  }
  // YouTube — disable related videos, branding
  if (url.includes('youtube.com/watch')) {
    const id = new URL(url).searchParams.get('v');
    return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&disablekb=0&fs=1`;
  }
  if (url.includes('youtu.be/')) {
    const id = url.split('youtu.be/')[1].split('?')[0];
    return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&disablekb=0&fs=1`;
  }
  // Vimeo
  if (url.includes('vimeo.com/')) {
    const id = url.split('vimeo.com/')[1].split('?')[0];
    return `https://player.vimeo.com/video/${id}?title=0&byline=0&portrait=0`;
  }
  return url;
}

module.exports = router;
