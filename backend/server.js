const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./db/database');
const { startQueue } = require('./services/queue');
const postsRouter = require('./routes/posts');
const captureRouter = require('./routes/capture');

const app = express();
const PORT = process.env.PORT || 3737;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/posts', postsRouter);
app.use('/api/capture', captureRouter);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

initDB().then(() => {
  startQueue();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SavedAndSorted running on http://0.0.0.0:${PORT}`);
  });
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
