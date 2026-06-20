#!/bin/bash
set -e

echo ""
echo "╔════════════════════════════════════╗"
echo "║     SavedAndSorted  Installer      ║"
echo "║  LinkedIn Library + Local AI Tags  ║"
echo "╚════════════════════════════════════╝"
echo ""

INSTALL_DIR="$(pwd)"
PORT=3131

# ── 1. Docker check ────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "📦 Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  echo "✅ Docker installed."
else
  echo "✅ Docker already installed."
fi

if ! command -v docker compose &>/dev/null && ! docker compose version &>/dev/null 2>&1; then
  echo "📦 Installing Docker Compose plugin..."
  sudo apt-get install -y docker-compose-plugin
fi

# ── 2. Ollama check ────────────────────────────────────────────────────────
if ! command -v ollama &>/dev/null; then
  echo ""
  echo "🤖 Installing Ollama (local AI engine)..."
  curl -fsSL https://ollama.ai/install.sh | sh
  echo "✅ Ollama installed."
else
  echo "✅ Ollama already installed."
fi

# ── 3. Pull AI model ───────────────────────────────────────────────────────
MODEL="phi3:mini"
echo ""
echo "🧠 Pulling AI model: $MODEL"
echo "   (This is ~2.3GB, one-time download)"
ollama pull "$MODEL"
echo "✅ AI model ready."

# ── 4. Start Ollama service ────────────────────────────────────────────────
if ! pgrep -x "ollama" > /dev/null; then
  echo "🚀 Starting Ollama service..."
  nohup ollama serve > /tmp/ollama.log 2>&1 &
  sleep 3
fi

# ── 5. Create data directory ───────────────────────────────────────────────
mkdir -p "$INSTALL_DIR/data"
echo "✅ Data directory: $INSTALL_DIR/data"

# ── 6. Build and start containers ─────────────────────────────────────────
echo ""
echo "🏗️  Building SavedAndSorted..."
docker compose down --remove-orphans 2>/dev/null || true
docker compose up -d --build
echo "✅ Containers started."

# ── 7. Systemd service ────────────────────────────────────────────────────
echo ""
echo "⚙️  Installing systemd service..."

sudo tee /etc/systemd/system/savedandsorted.service > /dev/null <<EOF
[Unit]
Description=SavedAndSorted - LinkedIn Library
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStartPre=/bin/bash -c 'pgrep ollama || (ollama serve &) && sleep 2'
ExecStart=/usr/bin/docker compose up
ExecStop=/usr/bin/docker compose down
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable savedandsorted
echo "✅ Systemd service installed (starts on reboot)."

# ── 8. Get local IP ───────────────────────────────────────────────────────
LOCAL_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "════════════════════════════════════════"
echo "  ✅  SavedAndSorted is running!"
echo "════════════════════════════════════════"
echo ""
echo "  🌐 Local:    http://localhost:$PORT"
echo "  🌐 Network:  http://$LOCAL_IP:$PORT"
echo ""
echo "  📎 Chrome Extension:  /extension folder"
echo "     → Load as unpacked in chrome://extensions"
echo "     → Set NAS address to: http://$LOCAL_IP:$PORT"
echo ""
echo "  🤖 AI Model: $MODEL (phi3:mini ~2.3GB)"
echo "     Posts process automatically every 8 seconds"
echo ""
echo "  📁 Data stored at: $INSTALL_DIR/data/"
echo ""
echo "  Service commands:"
echo "    sudo systemctl start savedandsorted"
echo "    sudo systemctl stop savedandsorted"
echo "    sudo systemctl status savedandsorted"
echo "    docker compose logs -f"
echo ""
