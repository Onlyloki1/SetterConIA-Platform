const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db/connection');

const router = express.Router();

// Upload config
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
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

// Create client
router.post('/create', async (req, res) => {
  const { email, name, phone, access_type, notes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });
  if (!phone) return res.status(400).json({ error: 'Telefono requerido' });

  const cleanEmail = email.toLowerCase().trim();
  const password = 'Smart' + Math.floor(100 + Math.random() * 900);
  const isReserve = access_type === 'reserve';

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name, role, access_type, closer_notes, phone) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, name',
      [cleanEmail, hash, name || cleanEmail.split('@')[0], 'client', isReserve ? 'reserve' : 'full', notes || '', phone]
    );

    // Try to send welcome email (non-blocking)
    try {
      const { sendWelcomeEmail } = require('../services/email');
      sendWelcomeEmail(cleanEmail, name || '', password);
    } catch {}

    // Send webhook to Callbell
    try {
      const whRes = await fetch('https://web-production-7aa02e.up.railway.app/webhook/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || cleanEmail.split('@')[0],
          email: cleanEmail,
          phone: phone,
          password: password
        })
      });
      const whData = await whRes.text();
      console.log(`[WELCOME WEBHOOK] Status: ${whRes.status}, Response: ${whData}`);
    } catch (whErr) {
      console.error(`[WELCOME WEBHOOK ERROR]`, whErr.message);
    }

    res.json({ id: result.rows[0].id, email: cleanEmail, password, name: result.rows[0].name, access_type: isReserve ? 'reserve' : 'full' });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Este email ya esta registrado' });
    res.status(500).json({ error: err.message });
  }
});

// Upload proof (public, uses user_id from body)
router.post('/upload-proof', upload.single('proof'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
  const userId = req.body.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id requerido' });
  const url = '/uploads/' + req.file.filename;
  try {
    await pool.query('INSERT INTO payment_proofs (user_id, file_url, original_name) VALUES ($1,$2,$3)', [userId, url, req.file.originalname]);
    res.json({ ok: true, url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
