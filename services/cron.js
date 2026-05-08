const { pool } = require('../db/connection');
const { sendExpiryReminder } = require('./email');
let discord;
try { discord = require('../lib/discord'); } catch (e) { console.log('[CRON] Discord lib not loaded'); }

async function checkExpirations() {
  const DAYS = [15, 7, 3];

  for (const days of DAYS) {
    try {
      // Find users expiring in exactly `days` days who haven't been reminded yet
      const result = await pool.query(`
        SELECT u.id, u.email, u.name, u.expires_at
        FROM users u
        WHERE u.role = 'client'
          AND u.expires_at IS NOT NULL
          AND u.expires_at::date = (CURRENT_DATE + ($1 || ' days')::interval)::date
          AND NOT EXISTS (
            SELECT 1 FROM expiry_reminders_sent ers
            WHERE ers.user_id = u.id AND ers.days_before = $1
          )
      `, [days]);

      for (const user of result.rows) {
        // Send email
        await sendExpiryReminder(user.email, user.name, days);

        // Create in-app notification
        await pool.query(
          `INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, 'expiry')`,
          [user.id, `Tu plan vence en ${days} días`, `Recordá renovar tu plan para no perder el acceso a la plataforma.`]
        );

        // Track that we sent this reminder
        await pool.query(
          `INSERT INTO expiry_reminders_sent (user_id, days_before) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [user.id, days]
        );

        console.log(`Expiry reminder sent: ${user.email} (${days} days)`);
      }
    } catch (err) {
      console.error(`Error checking expirations for ${days} days:`, err.message);
    }
  }
}

const ROLE_PRINCIPIANTE = process.env.DISCORD_ROLE_ID;
const ROLE_INTERMEDIO = '1283114078272753783';
const ROLE_INACTIVO = process.env.DISCORD_INACTIVE_ROLE_ID;

// Check Discord role transitions: Principiante -> Intermedio (3 months) -> Inactivo (4 months)
async function checkDiscordExpirations() {
  if (!discord) return;
  try {
    // 1. Users at 4+ months: remove all roles, add Inactivo
    const expired = await pool.query(`
      SELECT id, discord_id, name, email
      FROM users
      WHERE discord_id IS NOT NULL
        AND discord_joined_at IS NOT NULL
        AND discord_joined_at < NOW() - INTERVAL '4 months'
        AND (discord_expired IS NULL OR discord_expired = false)
    `);

    for (const user of expired.rows) {
      try {
        await discord.removeRole(user.discord_id, ROLE_PRINCIPIANTE);
        await discord.removeRole(user.discord_id, ROLE_INTERMEDIO);
        if (ROLE_INACTIVO) await discord.addRole(user.discord_id, ROLE_INACTIVO);
        await pool.query('UPDATE users SET discord_expired = true WHERE id = $1', [user.id]);
        console.log(`[DISCORD] ${user.name} -> INACTIVO (4 meses)`);
      } catch (err) {
        console.error(`[DISCORD EXPIRY ERROR] ${user.name}:`, err.message);
      }
    }

    // 2. Users at 3-4 months: switch from Principiante to Intermedio
    const intermediate = await pool.query(`
      SELECT id, discord_id, name, email
      FROM users
      WHERE discord_id IS NOT NULL
        AND discord_joined_at IS NOT NULL
        AND discord_joined_at < NOW() - INTERVAL '3 months'
        AND discord_joined_at >= NOW() - INTERVAL '4 months'
        AND (discord_expired IS NULL OR discord_expired = false)
        AND (discord_intermediate IS NULL OR discord_intermediate = false)
    `);

    for (const user of intermediate.rows) {
      try {
        await discord.removeRole(user.discord_id, ROLE_PRINCIPIANTE);
        await discord.addRole(user.discord_id, ROLE_INTERMEDIO);
        await pool.query('UPDATE users SET discord_intermediate = true WHERE id = $1', [user.id]);
        console.log(`[DISCORD] ${user.name} -> INTERMEDIO (3 meses)`);
      } catch (err) {
        console.error(`[DISCORD INTERMEDIATE ERROR] ${user.name}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[DISCORD EXPIRY ERROR]', err.message);
  }
}

module.exports = { checkExpirations, checkDiscordExpirations };
