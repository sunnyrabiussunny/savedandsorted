const { getDB } = require('../db/database');
const { analyzePost, checkOllama } = require('./ollama');

let isProcessing = false;
let processingInterval = null;

async function processNextPending() {
  if (isProcessing) return;
  isProcessing = true;

  const db = getDB();
  try {
    const post = db.prepare(`
      SELECT id, content, author_name FROM posts
      WHERE status = 'pending'
      ORDER BY captured_at ASC
      LIMIT 1
    `).get();

    if (!post) {
      isProcessing = false;
      return;
    }

    console.log(`Processing post ${post.id}...`);
    db.prepare(`UPDATE posts SET status = 'processing' WHERE id = ?`).run(post.id);

    const analysis = await analyzePost(post.content, post.author_name);

    // Insert/get tags
    const insertTag = db.prepare(`
      INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING
    `);
    const getTag = db.prepare(`SELECT id FROM tags WHERE name = ?`);
    const insertPostTag = db.prepare(`
      INSERT OR IGNORE INTO post_tags (post_id, tag_id, source) VALUES (?, ?, 'ai')
    `);
    const insertTopic = db.prepare(`
      INSERT INTO topics (post_id, topic) VALUES (?, ?)
    `);
    const insertSummary = db.prepare(`
      INSERT OR REPLACE INTO summaries (post_id, one_liner, key_points, why_saved)
      VALUES (?, ?, ?, ?)
    `);
    const updateTagCount = db.prepare(`
      UPDATE tags SET post_count = (
        SELECT COUNT(*) FROM post_tags WHERE tag_id = tags.id
      ) WHERE name = ?
    `);

    const transaction = db.transaction(() => {
      // Tags
      for (const tagName of analysis.tags) {
        insertTag.run(tagName);
        const tag = getTag.get(tagName);
        if (tag) {
          insertPostTag.run(post.id, tag.id);
          updateTagCount.run(tagName);
        }
      }

      // Topics
      for (const topic of analysis.topics) {
        insertTopic.run(post.id, topic);
      }

      // Summary
      insertSummary.run(
        post.id,
        analysis.one_liner,
        analysis.key_points,
        analysis.why_saved
      );

      // Update post
      db.prepare(`
        UPDATE posts SET
          status = 'done',
          post_type = ?,
          processed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(analysis.post_type, post.id);
    });

    transaction();
    console.log(`Post ${post.id} processed. Tags: ${analysis.tags.join(', ')}`);

  } catch (err) {
    console.error(`Error processing post:`, err.message);
    try {
      const db2 = getDB();
      db2.prepare(`UPDATE posts SET status = 'error' WHERE id = ? AND status = 'processing'`)
        .run(isProcessing);
    } catch (_) {}
  } finally {
    isProcessing = false;
  }
}

async function startQueue() {
  const ollamaAvailable = await checkOllama();
  if (!ollamaAvailable) {
    console.warn('Ollama not available. Posts will be queued and processed when Ollama starts.');
  } else {
    console.log('Ollama connected. Processing queue...');
  }

  // Process every 8 seconds - gentle on the NAS
  processingInterval = setInterval(async () => {
    const available = await checkOllama();
    if (available) await processNextPending();
  }, 8000);

  // Also process immediately on start
  setTimeout(async () => {
    const available = await checkOllama();
    if (available) await processNextPending();
  }, 2000);
}

function stopQueue() {
  if (processingInterval) clearInterval(processingInterval);
}

module.exports = { startQueue, stopQueue, processNextPending };
