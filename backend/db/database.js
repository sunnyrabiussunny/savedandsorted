const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/savedandsorted.db');

let db;

function getDB() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

async function initDB() {
  const database = getDB();

  database.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      author_name TEXT,
      author_title TEXT,
      content TEXT NOT NULL,
      raw_html TEXT,
      post_type TEXT DEFAULT 'post',
      captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME,
      status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#6366f1',
      post_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS post_tags (
      post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
      source TEXT DEFAULT 'ai',
      PRIMARY KEY (post_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      confidence REAL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS summaries (
      post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
      one_liner TEXT,
      key_points TEXT,
      why_saved TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
      content,
      author_name,
      one_liner,
      key_points,
      content='',
      contentless_delete=1
    );

    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_posts_captured ON posts(captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_topics_topic ON topics(topic);

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  console.log('Database initialized at', DB_PATH);
  return database;
}

module.exports = { getDB, initDB };
