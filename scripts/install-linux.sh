#!/bin/bash
# ==============================================
# VelocityPulse Agent Installer (Linux)
# One-liner: curl -sSL https://get.velocitypulse.io/agent.sh | bash
# ==============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

INSTALL_DIR="/opt/velocitypulse-agent"
SERVICE_NAME="velocitypulse-agent"

echo ""
echo -e "${CYAN}  ============================================${NC}"
echo -e "${CYAN}   VelocityPulse Agent Installer (Linux)${NC}"
echo -e "${CYAN}  ============================================${NC}"
echo ""

# ==============================================
# Prerequisites
# ==============================================
echo -e "${YELLOW}[1/6] Checking prerequisites...${NC}"

# Check root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}  ERROR: Please run as root (sudo)${NC}"
    exit 1
fi

# Check Node.js
if ! command -v node &>/dev/null; then
    echo -e "${RED}  ERROR: Node.js is not installed.${NC}"
    echo -e "${RED}  Install Node.js 18+ from https://nodejs.org${NC}"
    exit 1
fi

NODE_VERSION=$(node --version | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}  ERROR: Node.js $(node --version) is too old. Version 18+ required.${NC}"
    exit 1
fi
echo -e "${GREEN}  Node.js $(node --version) OK${NC}"

# ==============================================
# Configuration
# ==============================================
echo ""
echo -e "${YELLOW}[2/6] Configuration${NC}"

if [ -z "$VP_API_KEY" ]; then
    read -rp "  Enter your Agent API Key: " VP_API_KEY
    if [ -z "$VP_API_KEY" ]; then
        echo -e "${RED}  ERROR: API key is required.${NC}"
        exit 1
    fi
fi

DASHBOARD_URL="${VELOCITYPULSE_URL:-https://app.velocitypulse.io}"
read -rp "  Dashboard URL (Enter for $DASHBOARD_URL): " INPUT_URL
if [ -n "$INPUT_URL" ]; then
    DASHBOARD_URL="$INPUT_URL"
fi

AGENT_NAME="${AGENT_NAME:-$(hostname)}"

echo -e "${GREEN}  Dashboard: $DASHBOARD_URL${NC}"
echo -e "${GREEN}  Agent Name: $AGENT_NAME${NC}"

# ==============================================
# Download
# ==============================================
echo ""
echo -e "${YELLOW}[3/6] Downloading latest agent release...${NC}"

TEMP_DIR=$(mktemp -d)
TEMP_ZIP="$TEMP_DIR/agent.tar.gz"

# Try GitHub releases API
RELEASE_URL="https://api.github.com/repos/velocityeu/velocitypulse-agent/releases/latest"
DOWNLOAD_URL=""

if command -v curl &>/dev/null; then
    RELEASE_JSON=$(curl -sL -H "User-Agent: VelocityPulse-Installer" "$RELEASE_URL" 2>/dev/null || echo "")
    if echo "$RELEASE_JSON" | grep -q "tarball_url"; then
        DOWNLOAD_URL=$(echo "$RELEASE_JSON" | grep -o '"tarball_url":[^,]*' | cut -d'"' -f4)
        VERSION=$(echo "$RELEASE_JSON" | grep -o '"tag_name":[^,]*' | cut -d'"' -f4)
        echo -e "${GREEN}  Version: $VERSION${NC}"
    fi
fi

if [ -z "$DOWNLOAD_URL" ]; then
    DOWNLOAD_URL="https://github.com/velocityeu/velocitypulse-agent/archive/refs/heads/main.tar.gz"
    VERSION="latest"
    echo -e "${YELLOW}  Using latest from main branch${NC}"
fi

curl -sL "$DOWNLOAD_URL" -o "$TEMP_ZIP"
echo -e "${GREEN}  Downloaded${NC}"

# ==============================================
# Extract and install
# ==============================================
echo ""
echo -e "${YELLOW}[4/6] Installing to $INSTALL_DIR...${NC}"

mkdir -p "$INSTALL_DIR"
tar -xzf "$TEMP_ZIP" -C "$TEMP_DIR"

# Find extracted directory
SOURCE_DIR=$(find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -1)
if [ -z "$SOURCE_DIR" ]; then
    echo -e "${RED}  ERROR: Could not find extracted directory.${NC}"
    exit 1
fi

# Copy files
cp -rf "$SOURCE_DIR"/* "$INSTALL_DIR/"
echo -e "${GREEN}  Files installed${NC}"

# Install dependencies
echo "  Installing dependencies..."
cd "$INSTALL_DIR"
npm install --production --silent 2>/dev/null
npm run build --silent 2>/dev/null
echo -e "${GREEN}  Dependencies installed${NC}"

# ==============================================
# Configure
# ==============================================
echo ""
echo -e "${YELLOW}[5/6] Configuring agent...${NC}"

cat > "$INSTALL_DIR/.env" << ENVEOF
# VelocityPulse Agent Configuration
VELOCITYPULSE_URL=$DASHBOARD_URL
VP_API_KEY=$VP_API_KEY
AGENT_NAME=$AGENT_NAME
LOG_LEVEL=info
ENABLE_AUTO_SCAN=true
ENABLE_REALTIME=true
ENVEOF

chmod 600 "$INSTALL_DIR/.env"
echo -e "${GREEN}  Configuration written to .env${NC}"

# ==============================================
# Create systemd service
# ==============================================
echo ""
echo -e "${YELLOW}[6/6] Creating systemd service...${NC}"

NODE_PATH=$(which node)

cat > "/etc/systemd/system/$SERVICE_NAME.service" << SERVICEEOF
[Unit]
Description=VelocityPulse Network Monitoring Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_PATH $INSTALL_DIR/dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

# Security hardening
NoNewPrivileges=false
ProtectSystem=false
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

echo -e "${GREEN}  Service created and started${NC}"

# ==============================================
# Cleanup
# ==============================================
rm -rf "$TEMP_DIR"

# ==============================================
# Done
# ==============================================
echo ""
echo -e "${GREEN}  ============================================${NC}"
echo -e "${GREEN}   Installation Complete!${NC}"
echo -e "${GREEN}  ============================================${NC}"
echo ""
echo -e "${CYAN}  Install Dir:  $INSTALL_DIR${NC}"
echo -e "${CYAN}  Service Name: $SERVICE_NAME${NC}"
echo -e "${CYAN}  Dashboard:    $DASHBOARD_URL${NC}"
echo -e "${CYAN}  Agent UI:     http://localhost:3001${NC}"
echo ""
echo -e "${YELLOW}  Commands:${NC}"
echo "    Start:   systemctl start $SERVICE_NAME"
echo "    Stop:    systemctl stop $SERVICE_NAME"
echo "    Status:  systemctl status $SERVICE_NAME"
echo "    Logs:    journalctl -u $SERVICE_NAME -f"
echo ""
