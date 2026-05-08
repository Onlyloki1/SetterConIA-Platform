// Simple in-memory rate limiter (no Redis needed)
const hits = new Map();

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of hits) {
    if (now - data.start > 120000) hits.delete(key);
  }
}, 300000);

function rateLimit({ windowMs = 60000, max = 100, message = 'Demasiadas solicitudes. Intentá de nuevo en un momento.' } = {}) {
  return (req, res, next) => {
    const key = req.ip + ':' + req.path;
    const now = Date.now();
    const record = hits.get(key);

    if (!record || now - record.start > windowMs) {
      hits.set(key, { count: 1, start: now });
      return next();
    }

    record.count++;
    if (record.count > max) {
      return res.status(429).json({ error: message });
    }

    next();
  };
}

// Pre-configured limiters
const loginLimiter = rateLimit({
  windowMs: 60000,
  max: 5,
  message: 'Demasiados intentos de login. Esperá 1 minuto.'
});

const apiLimiter = rateLimit({
  windowMs: 60000,
  max: 100
});

const uploadLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  message: 'Demasiados uploads. Esperá 1 minuto.'
});

module.exports = { rateLimit, loginLimiter, apiLimiter, uploadLimiter };
