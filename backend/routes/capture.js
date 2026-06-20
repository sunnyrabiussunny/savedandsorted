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

// POST /api/capture/bulk - import from JSON export
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
