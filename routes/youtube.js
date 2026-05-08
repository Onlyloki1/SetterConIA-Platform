const express = require('express');
const https = require('https');
const { pool } = require('../db/connection');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// ─── ADMIN: Manage YouTube channels to monitor ───
router.get('/channels', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM youtube_channels ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/channels', authMiddleware, adminOnly, async (req, res) => {
  const { channel_id, channel_name } = req.body;
  if (!channel_id) return res.status(400).json({ error: 'channel_id requerido' });
  try {
    const result = await pool.query(
      'INSERT INTO youtube_channels (channel_id, channel_name) VALUES ($1, $2) RETURNING *',
      [channel_id, channel_name || 'Canal sin nombre']
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Canal ya registrado' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/channels/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM youtube_channels WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CRON: Check for new YouTube videos ───
// Call this endpoint from Railway cron or external cron service every hour
// GET /api/youtube/check?secret=YOUR_JWT_SECRET
router.get('/check', async (req, res) => {
  // Simple auth via query param (for cron jobs)
  if (req.query.secret !== process.env.JWT_SECRET) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  try {
    const channels = await pool.query('SELECT * FROM youtube_channels');
    let newVideos = 0;

    for (const channel of channels.rows) {
      try {
        const feed = await fetchYouTubeRSS(channel.channel_id);
        if (!feed.videoId) continue;

        // Check if this is a new video
        if (feed.videoId !== channel.last_video_id) {
          // Update the channel with new video ID
          await pool.query(
            'UPDATE youtube_channels SET last_video_id = $1, last_checked_at = NOW() WHERE id = $2',
            [feed.videoId, channel.id]
          );

          // Only notify if we had a previous video (skip first check)
          if (channel.last_video_id) {
            // Send notification to all clients
            const clients = await pool.query('SELECT id FROM users WHERE role = $1', ['client']);
            for (const client of clients.rows) {
              await pool.query(
                `INSERT INTO notifications (user_id, title, message, type, data)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                  client.id,
                  `Nuevo video: ${feed.title}`,
                  `${channel.channel_name} subió un nuevo video`,
                  'youtube',
                  JSON.stringify({ videoId: feed.videoId, videoUrl: feed.videoUrl, channelName: channel.channel_name })
                ]
              );
            }
            newVideos++;
          }
        } else {
          // Just update checked timestamp
          await pool.query(
            'UPDATE youtube_channels SET last_checked_at = NOW() WHERE id = $1',
            [channel.id]
          );
        }
      } catch (err) {
        console.error(`Error checking channel ${channel.channel_id}:`, err.message);
      }
    }

    res.json({ ok: true, checked: channels.rows.length, newVideos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch YouTube RSS feed and extract latest video
function fetchYouTubeRSS(channelId) {
  return new Promise((resolve, reject) => {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    https.get(url, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          // Simple XML parsing — extract first <entry>
          const videoIdMatch = data.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
          const titleMatch = data.match(/<entry>[\s\S]*?<title>([^<]+)<\/title>/);

          if (!videoIdMatch) return resolve({ videoId: null });

          resolve({
            videoId: videoIdMatch[1],
            title: titleMatch ? titleMatch[1] : 'Nuevo video',
            videoUrl: `https://www.youtube.com/watch?v=${videoIdMatch[1]}`
          });
        } catch (err) {
          reject(err);
        }
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}

module.exports = router;
