const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/connection');

const { loginLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });

    // Check if plan expired (admins never expire)
    if (user.role !== 'admin' && user.expires_at && new Date(user.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Tu plan ha expirado. Contactá al administrador para renovarlo.', expired: true });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ role: user.role, name: user.name, onboarding_completed: user.onboarding_completed });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Check expiry from DB for clients
    if (decoded.role !== 'admin') {
      const result = await pool.query(`
        SELECT u.expires_at, u.onboarding_completed, u.onboarding_step, u.approved, u.rejected,
          u.access_type, COALESCE(p.has_discord, false) as has_discord,
          COALESCE(p.allowed_modules, '[]'::jsonb) as plan_modules
        FROM users u LEFT JOIN plans p ON p.id = u.plan_id
        WHERE u.id = $1`, [decoded.id]);
      const user = result.rows[0];
      if (user && user.expires_at && new Date(user.expires_at) < new Date()) {
        res.clearCookie('token');
        return res.status(403).json({ error: 'Tu plan ha expirado. Contactá al administrador.', expired: true });
      }
      decoded.onboarding_completed = user?.onboarding_completed || false;
      decoded.approved = user?.approved || false;
      decoded.rejected = user?.rejected || false;
      decoded.onboarding_step = user?.onboarding_step || 0;
      decoded.has_discord = user?.has_discord || false;
      decoded.access_type = user?.access_type || 'full';
      decoded.plan_modules = user?.plan_modules || [];
    }
    res.json(decoded);
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});

module.exports = router;
