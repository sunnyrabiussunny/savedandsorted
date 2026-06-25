const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');

// POST /api/capture - receive a post from bookmarklet/extension
router.post('/', async (req, res) => {
  const { url, content, author_name, author_title, raw_html } = req.body;

  if (!url || !content) {
    return res.status(400).json({ error: 'url and content are required' });
  }

  if (content.trim().length < 20) {
    return res.status(400).json({ error: 'Content too short - is LinkedIn fully loaded?' });
  }

  const db = getDB();

  try {
    const existing = db.prepare(`SELECT id, status FROM posts WHERE url = ?`).get(url);
    if (existing) {
      return res.json({
        success: true,
        duplicate: true,
        id: existing.id,
        message: 'Already in your library'
      });
    }

    const result = db.prepare(`
      INSERT INTO posts (url, content, author_name, author_title, raw_html, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(url, content.trim(), author_name || null, author_title || null, raw_html || null);

    res.json({
      success: true,
      id: result.lastInsertRowid,
      message: 'Saved! AI processing in background...'
    });

  } catch (err) {
    console.error('Capture error:', err);
    res.status(500).json({ error: 'Failed to save post' });
  }
});

// POST /api/capture/fetch-url - try to fetch a LinkedIn URL server-side
router.post('/fetch-url', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.includes('linkedin.com')) {
    return res.status(400).json({ error: 'Invalid LinkedIn URL' });
  }

  try {
    const https = require('https');
    const result = await new Promise((resolve, reject) => {
      const options = {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      };
      const req = https.request(url, options, (r) => {
        let data = '';
        r.on('data', chunk => data += chunk);
        r.on('end', () => resolve({ status: r.statusCode, body: data }));
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });

    // LinkedIn returns 999 or redirect to login for unauthenticated requests
    if (result.status === 999 || result.status === 302 || result.status === 401 ||
        result.body.includes('authwall') || result.body.includes('login')) {
      return res.json({ success: true, fallback: true, message: 'Login required' });
    }

    // Try to extract text content from HTML
    const body = result.body;
    const textContent = body
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);

    if (textContent.length < 50) {
      return res.json({ success: true, fallback: true, message: 'Could not extract content' });
    }

    // Save it
    const db = getDB();
    const existing = db.prepare(`SELECT id FROM posts WHERE url = ?`).get(url);
    if (existing) return res.json({ success: true, duplicate: true, id: existing.id });

    const r2 = db.prepare(`
      INSERT INTO posts (url, content, status) VALUES (?, ?, 'pending')
    `).run(url, textContent);

    res.json({ success: true, id: r2.lastInsertRowid, message: 'Saved! AI processing in background...' });

  } catch (err) {
    // Server-side fetch failed entirely — tell frontend to fall back to manual
    res.json({ success: true, fallback: true, message: err.message });
  }
});


router.post('/bulk', async (req, res) => {
  const { posts } = req.body;
  if (!Array.isArray(posts)) {
    return res.status(400).json({ error: 'posts must be an array' });
  }

  const db = getDB();
  let imported = 0, skipped = 0, errors = 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO posts (url, content, author_name, author_title, status)
    VALUES (?, ?, ?, ?, 'pending')
  `);

  const transaction = db.transaction(() => {
    for (const post of posts) {
      if (!post.url || !post.content) { errors++; continue; }
      const result = insert.run(post.url, post.content, post.author_name || null, post.author_title || null);
      if (result.changes > 0) imported++;
      else skipped++;
    }
  });

  try {
    transaction();
    res.json({ success: true, imported, skipped, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
