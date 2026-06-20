const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getDB } = require('../db/database');

const WATCH_DIR = process.env.WATCH_DIR || path.join(__dirname, '../../data/imports');
const DONE_DIR = path.join(WATCH_DIR, 'done');

// Ensure directories exist
if (!fs.existsSync(WATCH_DIR)) fs.mkdirSync(WATCH_DIR, { recursive: true });
if (!fs.existsSync(DONE_DIR)) fs.mkdirSync(DONE_DIR, { recursive: true });

// ── CSV parser (no dependencies) ─────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Parse header row - handle quoted fields
  const headers = parseCSVRow(lines[0]).map(h => h.trim().toLowerCase());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVRow(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

function parseCSVRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Field mapping - handles various exporter formats ─────────────────────
function mapRow(row) {
  // Common field names from LinkedIn Saves Exporter, LinkedIn Saved Posts Exporter, etc.
  const url =
    row['url'] || row['post url'] || row['posturl'] || row['link'] ||
    row['post_url'] || row['linkedin_url'] || row['profile_url'] || '';

  const content =
    row['content'] || row['text'] || row['post text'] || row['post_text'] ||
    row['body'] || row['description'] || row['caption'] || row['commentary'] ||
    row['post content'] || row['postcontent'] || '';

  const author_name =
    row['author'] || row['author name'] || row['author_name'] || row['name'] ||
    row['person'] || row['posted by'] || row['posted_by'] || row['authorname'] || '';

  const author_title =
    row['title'] || row['author title'] || row['author_title'] || row['headline'] ||
    row['job title'] || row['job_title'] || row['position'] || '';

  return { url: url.trim(), content: content.trim(), author_name: author_name.trim(), author_title: author_title.trim() };
}

// ── Core import logic ────────────────────────────────────────────────────
function importPosts(posts) {
  const db = getDB();
  let imported = 0, skipped = 0, errors = 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO posts (url, content, author_name, author_title, status)
    VALUES (?, ?, ?, ?, 'pending')
  `);

  const transaction = db.transaction(() => {
    for (const post of posts) {
      try {
        const mapped = mapRow(post);
        if (!mapped.url && !mapped.content) { errors++; continue; }
        // Use URL as unique key; if no URL, generate one from content hash
        const key = mapped.url || `manual:${Buffer.from(mapped.content.slice(0,100)).toString('base64')}`;
        const result = insert.run(key, mapped.content || '(no content)', mapped.author_name, mapped.author_title);
        if (result.changes > 0) imported++;
        else skipped++;
      } catch (e) {
        errors++;
      }
    }
  });

  transaction();
  return { imported, skipped, errors };
}

function processFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const text = fs.readFileSync(filePath, 'utf8');
  let posts = [];

  if (ext === '.json') {
    const data = JSON.parse(text);
    posts = Array.isArray(data) ? data : data.posts || data.items || data.data || [];
  } else if (ext === '.csv') {
    const rows = parseCSV(text);
    posts = rows;
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  return importPosts(posts);
}

// ── Upload endpoint ───────────────────────────────────────────────────────
// Accept raw body as text (frontend sends it as text/plain or application/json)
router.post('/upload', express.text({ limit: '50mb', type: ['text/plain', 'text/csv', 'application/json', '*/*'] }), async (req, res) => {
  try {
    const { filename } = req.query;
    const ext = (filename || '').split('.').pop().toLowerCase();
    const body = req.body;

    if (!body || body.length < 5) {
      return res.status(400).json({ error: 'Empty file' });
    }

    let posts = [];

    if (ext === 'json' || (body.trim()[0] === '[' || body.trim()[0] === '{')) {
      const data = JSON.parse(body);
      posts = Array.isArray(data) ? data : data.posts || data.items || data.data || [];
    } else {
      posts = parseCSV(body);
    }

    if (posts.length === 0) {
      return res.status(400).json({ error: 'No posts found in file. Check the format.' });
    }

    const result = importPosts(posts);
    res.json({ success: true, ...result, total: posts.length });

  } catch (err) {
    console.error('Import upload error:', err);
    res.status(400).json({ error: err.message });
  }
});

// ── Schedule config endpoints ─────────────────────────────────────────────
router.get('/schedule', (req, res) => {
  const db = getDB();
  try {
    const config = db.prepare(`SELECT value FROM config WHERE key = 'auto_import_schedule'`).get();
    const lastRun = db.prepare(`SELECT value FROM config WHERE key = 'auto_import_last_run'`).get();
    const lastResult = db.prepare(`SELECT value FROM config WHERE key = 'auto_import_last_result'`).get();
    res.json({
      schedule: config ? JSON.parse(config.value) : { enabled: false, hour: 2, minute: 0 },
      last_run: lastRun ? lastRun.value : null,
      last_result: lastResult ? JSON.parse(lastResult.value) : null,
      watch_dir: WATCH_DIR
    });
  } catch (e) {
    res.json({ schedule: { enabled: false, hour: 2, minute: 0 }, watch_dir: WATCH_DIR });
  }
});

router.post('/schedule', express.json(), (req, res) => {
  const db = getDB();
  const { enabled, hour, minute } = req.body;
  db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('auto_import_schedule', ?)`).run(
    JSON.stringify({ enabled: !!enabled, hour: parseInt(hour) || 2, minute: parseInt(minute) || 0 })
  );
  res.json({ success: true });
});

// ── Manual trigger: scan watch folder now ────────────────────────────────
router.post('/scan', (req, res) => {
  const result = scanWatchDir();
  res.json({ success: true, ...result });
});

// ── Watch folder scanner ──────────────────────────────────────────────────
function scanWatchDir() {
  let totalImported = 0, totalSkipped = 0, totalErrors = 0, filesProcessed = 0;

  try {
    const files = fs.readdirSync(WATCH_DIR).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return (ext === '.csv' || ext === '.json') && fs.statSync(path.join(WATCH_DIR, f)).isFile();
    });

    for (const file of files) {
      const filePath = path.join(WATCH_DIR, file);
      try {
        const result = processFile(filePath);
        totalImported += result.imported;
        totalSkipped += result.skipped;
        totalErrors += result.errors;
        filesProcessed++;
        // Move to done folder
        fs.renameSync(filePath, path.join(DONE_DIR, `${Date.now()}_${file}`));
        console.log(`Auto-import: processed ${file} → ${result.imported} new posts`);
      } catch (e) {
        console.error(`Auto-import: failed on ${file}:`, e.message);
        totalErrors++;
      }
    }
  } catch (e) {
    console.error('Scan watch dir error:', e.message);
  }

  return { filesProcessed, imported: totalImported, skipped: totalSkipped, errors: totalErrors };
}

// ── Scheduler ────────────────────────────────────────────────────────────
function startScheduler() {
  // Check every minute if it's time to run
  setInterval(() => {
    try {
      const db = getDB();
      // Ensure config table exists
      db.prepare(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`).run();

      const config = db.prepare(`SELECT value FROM config WHERE key = 'auto_import_schedule'`).get();
      if (!config) return;

      const schedule = JSON.parse(config.value);
      if (!schedule.enabled) return;

      const now = new Date();
      if (now.getHours() === schedule.hour && now.getMinutes() === schedule.minute) {
        // Avoid running twice in the same minute
        const lastRun = db.prepare(`SELECT value FROM config WHERE key = 'auto_import_last_run'`).get();
        const lastRunTime = lastRun ? new Date(lastRun.value) : null;
        if (lastRunTime && (now - lastRunTime) < 60000) return;

        console.log(`Auto-import: scheduled run at ${schedule.hour}:${String(schedule.minute).padStart(2,'0')}`);
        const result = scanWatchDir();
        db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('auto_import_last_run', ?)`).run(now.toISOString());
        db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('auto_import_last_result', ?)`).run(JSON.stringify(result));
      }
    } catch (e) {
      console.error('Scheduler error:', e.message);
    }
  }, 60000);

  console.log('Auto-import scheduler running. Watch folder:', WATCH_DIR);
}

module.exports = { router, startScheduler, scanWatchDir };
