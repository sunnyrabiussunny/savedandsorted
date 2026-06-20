# SavedAndSorted

Self-hosted LinkedIn saved posts library with automatic AI tagging. Captures posts via Chrome extension or bookmarklet — then tags, summarizes, and organizes them in the background using a local AI model. No cloud. No subscription. No manual work.

Port: **3131**

---

## How It Works

Like Immich's face recognition — you capture once, the AI works quietly in the background. Come back later and everything is labeled.

```
You click bookmarklet on a LinkedIn post
        ↓
Post saved instantly to local library
        ↓
Background queue picks it up (every 8s)
        ↓
phi3:mini model runs locally via Ollama
        ↓
Tags, topics, summary, and "why saved" appear
        ↓
Fully searchable and filterable library
```

---

## Features

**Capture**
- Chrome extension (one click on any LinkedIn post)
- Bookmarklet (no extension needed, works on all browsers)
- Bulk JSON import for past saves

**AI Organization (automatic, no manual work)**
- Auto-assigns hashtags from a curated taxonomy (50+ tags: prompting, marketing, research, productivity, coding, etc.)
- Identifies 2–4 topics per post
- Writes a one-sentence AI summary
- Extracts 2–3 key points
- Generates a "why you saved this" note
- Classifies post type: article / video / tip / research / tool / motivation / funny / thread

**Library UI**
- Full-text search across content, author, summaries, and key points
- Filter by tag, topic, post type, or processing status
- Sidebar with live tag counts and post type breakdown
- Detail panel: full content + all AI insights
- Processing queue indicator (shows live count of pending posts)
- Manual tag editing, reprocessing, delete

**Infrastructure**
- Runs on Ubuntu NAS via Docker
- SQLite database — no separate DB server needed
- Ollama + phi3:mini — completely free, runs on CPU (no GPU required)
- Starts automatically on reboot via systemd

---

## One-Command Install (Ubuntu/Debian)

```bash
git clone https://github.com/sunnyrabiussunny/savedandsorted.git
cd savedandsorted
sudo bash install.sh
```

The script:
- Installs Docker (if not present)
- Installs Ollama
- Downloads `phi3:mini` model (~2.3GB, one time)
- Builds and starts the Docker container
- Installs a systemd service (auto-start on reboot)

After install, open: **http://localhost:3131**

From other devices on your network: **http://YOUR_NAS_IP:3131**

---

## Manual Docker Setup

```bash
git clone https://github.com/sunnyrabiussunny/savedandsorted.git
cd savedandsorted

# Install Ollama separately (on the host, not in Docker)
curl -fsSL https://ollama.ai/install.sh | sh
ollama serve &
ollama pull phi3:mini

# Build and start
docker compose up -d --build
```

Open: **http://localhost:3131**

---

## Chrome Extension Setup

1. Open Chrome → go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `/extension` folder from this repo
5. Click the extension icon on any LinkedIn post page
6. First time: set your NAS address (e.g. `http://192.168.10.103:3131`)
7. Click **Save This Post to Library**

The extension icon appears in your Chrome toolbar. One click saves the current post.

---

## Bookmarklet Setup (No Extension Needed)

1. Create a new bookmark in Chrome or Firefox
2. Name it: `Save to S&S`
3. Paste this as the URL (replace `YOUR_NAS_IP` with your NAS IP):

```javascript
javascript:(function(){function g(s){var e=document.querySelector(s);return e?e.innerText.trim():''}var url=location.href,content=document.body?document.body.innerText.slice(0,3000):'',author=g('.feed-shared-actor__name,.update-components-actor__name'),title=g('.feed-shared-actor__description,.update-components-actor__description');fetch('http://YOUR_NAS_IP:3131/api/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url,content:content,author_name:author,author_title:title})}).then(function(r){return r.json()}).then(function(d){alert(d.message||'Saved!')}).catch(function(e){alert('Error: '+e.message)})})();
```

4. Navigate to a LinkedIn post → click the bookmarklet → done.

---

## AI Model Details

| Model | Size | RAM needed | Speed |
|-------|------|------------|-------|
| phi3:mini (default) | ~2.3GB | ~4GB | ~8–20s/post |
| tinyllama | ~637MB | ~2GB | ~5–10s/post (lower quality) |
| llama3.2:1b | ~1.3GB | ~3GB | ~6–15s/post |

To switch models:
```bash
ollama pull tinyllama
# Then edit docker-compose.yml: OLLAMA_MODEL=tinyllama
docker compose up -d
```

If Ollama is unreachable, posts are still saved and queued. They process automatically once Ollama comes back online.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/capture` | Save a post (from bookmarklet/extension) |
| POST | `/api/capture/bulk` | Bulk import (JSON array) |
| GET | `/api/posts` | List posts with filters |
| GET | `/api/posts/:id` | Get single post with full details |
| DELETE | `/api/posts/:id` | Delete a post |
| PATCH | `/api/posts/:id/tags` | Add or remove tags manually |
| POST | `/api/posts/:id/reprocess` | Re-queue for AI processing |
| GET | `/api/posts/meta/tags` | All tags with counts |
| GET | `/api/posts/meta/stats` | Library stats |
| GET | `/health` | Health check |

### Capture payload
```json
{
  "url": "https://linkedin.com/posts/...",
  "content": "Post text content here",
  "author_name": "John Doe",
  "author_title": "CTO at Company"
}
```

### Bulk import format
```json
{
  "posts": [
    { "url": "...", "content": "...", "author_name": "..." },
    { "url": "...", "content": "...", "author_name": "..." }
  ]
}
```

---

## Data

All data stored in `./data/`:
```
data/
  savedandsorted.db    # SQLite database (all posts, tags, summaries)
```

To back up:
```bash
cp data/savedandsorted.db data/savedandsorted.db.backup
```

---

## Manage the Service

```bash
# Start
sudo systemctl start savedandsorted

# Stop
sudo systemctl stop savedandsorted

# Restart
sudo systemctl restart savedandsorted

# View logs
docker compose logs -f

# Check status
sudo systemctl status savedandsorted
```

---

## Update to Latest Version

```bash
cd savedandsorted
git pull origin main
docker compose down
docker compose up -d --build
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3131` | Web server port |
| `DB_PATH` | `/app/data/savedandsorted.db` | Database file path |
| `OLLAMA_HOST` | `host-gateway` | Ollama hostname |
| `OLLAMA_PORT` | `11434` | Ollama port |
| `OLLAMA_MODEL` | `phi3:mini` | Model to use for tagging |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS (single file, no build step) |
| Backend | Node.js + Express |
| Database | SQLite via better-sqlite3 |
| AI Engine | Ollama (local, CPU) |
| AI Model | phi3:mini (Microsoft, ~2.3GB) |
| Container | Docker + Docker Compose |

---

## Tag Taxonomy

Posts are auto-tagged from these categories:

`prompting` `ai-tools` `llm` `productivity` `marketing` `content-strategy` `seo` `copywriting` `branding` `research` `data` `case-study` `career` `job-search` `networking` `leadership` `startup` `entrepreneurship` `personal-finance` `coding` `web-dev` `android` `open-source` `design` `ux` `motivation` `mindset` `habits` `video` `tutorial` `infographic` `tool` `anti-consumerism` `sustainability` `funny` `viral` `must-read` + more

---

## License

MIT.

Built by Sunny Rabius Sunny
