const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { TAG_TAXONOMY } = require('../services/ollama');

// GET /api/posts - list with filters
router.get('/', (req, res) => {
  const db = getDB();
  const { tag, topic, type, q, status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = [];
  let joinClause = `LEFT JOIN summaries s ON s.post_id = p.id`;
  let joinParams = [];
  let whereParams = [];

  if (tag) {
    joinClause += ` JOIN post_tags pt ON pt.post_id = p.id JOIN tags t ON t.id = pt.tag_id AND t.name = ?`;
    joinParams.push(tag);
  }

  if (topic) {
    joinClause += ` JOIN topics top ON top.post_id = p.id AND top.topic LIKE ?`;
    joinParams.push(`%${topic}%`);
  }

  if (status) { where.push(`p.status = ?`); whereParams.push(status); }
  if (type)   { where.push(`p.post_type = ?`); whereParams.push(type); }

  if (q) {
    where.push(`(p.content LIKE ? OR p.author_name LIKE ? OR s.one_liner LIKE ? OR s.key_points LIKE ?)`);
    whereParams.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const allParams = [...joinParams, ...whereParams];

  const total = db.prepare(`
    SELECT COUNT(DISTINCT p.id) as count FROM posts p ${joinClause} ${whereSQL}
  `).get(allParams).count;

  const posts = db.prepare(`
    SELECT DISTINCT
      p.id, p.url, p.author_name, p.author_title, p.post_type,
      p.captured_at, p.status,
      SUBSTR(p.content, 1, 300) as preview,
      s.one_liner, s.key_points, s.why_saved
    FROM posts p
    ${joinClause}
    ${whereSQL}
    ORDER BY p.captured_at DESC
    LIMIT ? OFFSET ?
  `).all([...allParams, parseInt(limit), offset]);

  // Attach tags and topics to each post
  const getPostTags = db.prepare(`
    SELECT t.name FROM tags t
    JOIN post_tags pt ON pt.tag_id = t.id
    WHERE pt.post_id = ?
  `);
  const getPostTopics = db.prepare(`SELECT topic FROM topics WHERE post_id = ? LIMIT 3`);

  const enriched = posts.map(post => ({
    ...post,
    tags: getPostTags.all(post.id).map(r => r.name),
    topics: getPostTopics.all(post.id).map(r => r.topic)
  }));

  res.json({ posts: enriched, total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/posts/:id - single post
router.get('/:id', (req, res) => {
  const db = getDB();
  const post = db.prepare(`
    SELECT p.*, s.one_liner, s.key_points, s.why_saved
    FROM posts p
    LEFT JOIN summaries s ON s.post_id = p.id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!post) return res.status(404).json({ error: 'Not found' });

  const tags = db.prepare(`
    SELECT t.name, t.color FROM tags t
    JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ?
  `).all(post.id);

  const topics = db.prepare(`SELECT topic FROM topics WHERE post_id = ?`).all(post.id);

  res.json({ ...post, tags, topics: topics.map(t => t.topic) });
});

// DELETE /api/posts/:id
router.delete('/:id', (req, res) => {
  const db = getDB();
  const result = db.prepare(`DELETE FROM posts WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// PATCH /api/posts/:id/tags - manually add/remove tags
router.patch('/:id/tags', (req, res) => {
  const db = getDB();
  const { add = [], remove = [] } = req.body;
  const postId = parseInt(req.params.id);

  const post = db.prepare(`SELECT id FROM posts WHERE id = ?`).get(postId);
  if (!post) return res.status(404).json({ error: 'Not found' });

  const transaction = db.transaction(() => {
    for (const tagName of add) {
      db.prepare(`INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING`).run(tagName);
      const tag = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(tagName);
      if (tag) db.prepare(`INSERT OR IGNORE INTO post_tags (post_id, tag_id, source) VALUES (?, ?, 'manual')`).run(postId, tag.id);
    }
    for (const tagName of remove) {
      const tag = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(tagName);
      if (tag) db.prepare(`DELETE FROM post_tags WHERE post_id = ? AND tag_id = ?`).run(postId, tag.id);
    }
    // Update counts
    db.prepare(`UPDATE tags SET post_count = (SELECT COUNT(*) FROM post_tags WHERE tag_id = tags.id)`).run();
  });

  transaction();
  res.json({ success: true });
});

// POST /api/posts/:id/reprocess
router.post('/:id/reprocess', (req, res) => {
  const db = getDB();
  db.prepare(`UPDATE posts SET status = 'pending', processed_at = NULL WHERE id = ?`).run(req.params.id);
  res.json({ success: true, message: 'Queued for reprocessing' });
});

// GET /api/posts/meta/tags - all tags with counts
router.get('/meta/tags', (req, res) => {
  const db = getDB();
  const tags = db.prepare(`SELECT name, color, post_count FROM tags WHERE post_count > 0 ORDER BY post_count DESC`).all();
  const taxonomy = TAG_TAXONOMY;
  res.json({ tags, taxonomy });
});

// GET /api/posts/meta/stats
router.get('/meta/stats', (req, res) => {
  const db = getDB();
  const total = db.prepare(`SELECT COUNT(*) as n FROM posts`).get().n;
  const pending = db.prepare(`SELECT COUNT(*) as n FROM posts WHERE status = 'pending'`).get().n;
  const done = db.prepare(`SELECT COUNT(*) as n FROM posts WHERE status = 'done'`).get().n;
  const topTags = db.prepare(`SELECT name, post_count FROM tags ORDER BY post_count DESC LIMIT 8`).all();
  const recentTypes = db.prepare(`SELECT post_type, COUNT(*) as n FROM posts WHERE status = 'done' GROUP BY post_type ORDER BY n DESC`).all();
  res.json({ total, pending, done, topTags, recentTypes });
});

module.exports = router;
