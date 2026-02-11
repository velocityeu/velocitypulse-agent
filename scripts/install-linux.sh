#!/bin/bash
# ==============================================
# VelocityPulse Agent Installer (Linux / macOS)
# One-liner: curl -sSL https://get.velocitypulse.io/agent.sh | sudo -E bash
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

# ==============================================
# OS Detection
# ==============================================
OS_TYPE="unknown"
case "$(uname -s)" in
    Linux*)  OS_TYPE="linux" ;;
    Darwin*) OS_TYPE="macos" ;;
    *)       echo -e "${RED}  ERROR: Unsupported OS: $(uname -s)${NC}"; exit 1 ;;
esac

echo ""
echo -e "${CYAN}  ============================================${NC}"
echo -e "${CYAN}   VelocityPulse Agent Installer (${OS_TYPE})${NC}"
echo -e "${CYAN}  ============================================${NC}"
echo ""

# ==============================================
# Node.js auto-installer
# ==============================================
install_node() {
    echo -e "${YELLOW}  Node.js not found. Installing automatically...${NC}"

    if [ "$OS_TYPE" = "linux" ]; then
        if command -v apt-get &>/dev/null; then
            curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
            apt-get install -y nodejs
        elif command -v dnf &>/dev/null; then
            curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
            dnf install -y nodejs
        elif command -v yum &>/dev/null; then
            curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
            yum install -y nodejs
        else
            echo -e "${RED}  ERROR: Could not detect package manager (apt-get, dnf, yum).${NC}"
            echo -e "${RED}  Please install Node.js 18+ manually: https://nodejs.org${NC}"
            exit 1
        fi
    elif [ "$OS_TYPE" = "macos" ]; then
        # Ensure Homebrew PATH is available (Apple Silicon)
        if [ -f /opt/homebrew/bin/brew ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi

        if command -v brew &>/dev/null; then
            echo "  Installing Node.js via Homebrew..."
            brew install node@22
            # Link if not already linked
            brew link --overwrite node@22 2>/dev/null || true
            # Re-evaluate PATH for freshly installed brew packages
            if [ -f /opt/homebrew/bin/brew ]; then
                eval "$(/opt/homebrew/bin/brew shellenv)"
            fi
        else
            echo "  Homebrew not found. Installing Node.js via official pkg installer..."
            ARCH=$(uname -m)
            if [ "$ARCH" = "arm64" ]; then
                NODE_PKG_URL="https://nodejs.org/dist/v22.12.0/node-v22.12.0-darwin-arm64.pkg"
            else
                NODE_PKG_URL="https://nodejs.org/dist/v22.12.0/node-v22.12.0-darwin-x64.pkg"
            fi
            NODE_PKG_TMP=$(mktemp -d)/node.pkg
            curl -fsSL "$NODE_PKG_URL" -o "$NODE_PKG_TMP"
            installer -pkg "$NODE_PKG_TMP" -target /
            rm -f "$NODE_PKG_TMP"
        fi
    fi

    # Refresh PATH and verify
    hash -r 2>/dev/null || true
    if ! command -v node &>/dev/null; then
        echo -e "${RED}  ERROR: Node.js installation failed. Please install manually.${NC}"
        exit 1
    fi
    echo -e "${GREEN}  Node.js $(node --version) installed${NC}"
}

# ==============================================
# Prerequisites
# ==============================================
echo -e "${YELLOW}[1/6] Checking prerequisites...${NC}"

# Check root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}  ERROR: Please run as root (sudo)${NC}"
    exit 1
fi

# Ensure Homebrew PATH is available on macOS (Apple Silicon) before checking node
if [ "$OS_TYPE" = "macos" ] && [ -f /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# Check Node.js — auto-install if missing
if ! command -v node &>/dev/null; then
    install_node
else
    NODE_VERSION=$(node --version | sed 's/^v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo -e "${YELLOW}  Node.js $(node --version) is too old (18+ required). Installing newer version...${NC}"
        install_node
    fi
fi

echo -e "${GREEN}  Node.js $(node --version) OK${NC}"

# ==============================================
# Configuration
# ==============================================
echo ""
echo -e "${YELLOW}[2/6] Configuration${NC}"

if [ -z "$VP_API_KEY" ]; then
    read -rp "  Enter your Agent API Key: " VP_API_KEY < /dev/tty
    if [ -z "$VP_API_KEY" ]; then
        echo -e "${RED}  ERROR: API key is required.${NC}"
        exit 1
    fi
fi

DASHBOARD_URL="${VELOCITYPULSE_URL:-https://app.velocitypulse.io}"
read -rp "  Dashboard URL (Enter for $DASHBOARD_URL): " INPUT_URL < /dev/tty
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

# Try GitHub releases API (monorepo: filter for agent-v* tags)
# Supports both public repos (unauthenticated) and private repos (with GITHUB_TOKEN)
REPO="velocityeu/velocitypulse-agent"
RELEASES_URL="https://api.github.com/repos/$REPO/releases"
DOWNLOAD_URL=""
AUTH_ARGS=""
if [ -n "$GITHUB_TOKEN" ]; then
    AUTH_ARGS="-H Authorization:\ token\ $GITHUB_TOKEN"
fi

if command -v curl &>/dev/null; then
    RELEASES_TMP=$(mktemp)
    if [ -n "$GITHUB_TOKEN" ]; then
        curl -sL -H "User-Agent: VelocityPulse-Installer" -H "Authorization: token $GITHUB_TOKEN" "$RELEASES_URL" -o "$RELEASES_TMP" 2>/dev/null
    else
        curl -sL -H "User-Agent: VelocityPulse-Installer" "$RELEASES_URL" -o "$RELEASES_TMP" 2>/dev/null
    fi
    # Parse JSON using node (already required as a prerequisite)
    PARSED=$(node -e "
      const d=require('fs').readFileSync('$RELEASES_TMP','utf8');
      try {
        const releases=JSON.parse(d);
        const r=releases.find(r=>r.tag_name&&r.tag_name.startsWith('agent-v'));
        if(!r)process.exit(0);
        const a=r.assets.find(a=>a.name.endsWith('.tar.gz'));
        console.log(r.tag_name);
        console.log(a?a.id:'');
        console.log(a?a.browser_download_url:'');
      }catch(e){}
    " 2>/dev/null || echo "")
    rm -f "$RELEASES_TMP"
    AGENT_TAG=$(echo "$PARSED" | sed -n '1p')
    ASSET_ID=$(echo "$PARSED" | sed -n '2p')
    ASSET_BROWSER_URL=$(echo "$PARSED" | sed -n '3p')
    if [ -n "$AGENT_TAG" ]; then
        if [ -n "$ASSET_ID" ] && [ -n "$GITHUB_TOKEN" ]; then
            # Private repo: use API asset endpoint (browser_download_url returns 404)
            DOWNLOAD_URL="https://api.github.com/repos/$REPO/releases/assets/$ASSET_ID"
        elif [ -n "$ASSET_BROWSER_URL" ]; then
            # Public repo: browser_download_url works
            DOWNLOAD_URL="$ASSET_BROWSER_URL"
        fi
        VERSION="$AGENT_TAG"
        echo -e "${GREEN}  Version: $VERSION${NC}"
    fi
fi

if [ -z "$DOWNLOAD_URL" ]; then
    echo -e "${YELLOW}  Could not find a release. Falling back to main branch archive...${NC}"
    if [ -n "$GITHUB_TOKEN" ]; then
        DOWNLOAD_URL="https://api.github.com/repos/$REPO/tarball/main"
    else
        DOWNLOAD_URL="https://github.com/$REPO/archive/refs/heads/main.tar.gz"
    fi
    VERSION="latest"
fi

if [ -n "$GITHUB_TOKEN" ]; then
    curl -sL -H "Authorization: token $GITHUB_TOKEN" -H "Accept: application/octet-stream" "$DOWNLOAD_URL" -o "$TEMP_ZIP"
else
    curl -sL "$DOWNLOAD_URL" -o "$TEMP_ZIP"
fi
if [ ! -s "$TEMP_ZIP" ]; then
    echo -e "${RED}  ERROR: Download failed. Check network or GITHUB_TOKEN.${NC}"
    exit 1
fi
# Verify the download is a valid archive (private repos return HTML without auth)
if ! tar -tzf "$TEMP_ZIP" &>/dev/null; then
    echo -e "${RED}  ERROR: Downloaded file is not a valid archive.${NC}"
    echo -e "${RED}  The repository may be private. Set GITHUB_TOKEN and retry:${NC}"
    echo -e "${RED}    export GITHUB_TOKEN='ghp_your_token_here'${NC}"
    rm -rf "$TEMP_DIR"
    exit 1
fi
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

# Handle monorepo archive (main branch fallback contains full repo)
if [ -d "$SOURCE_DIR/velocitypulse-agent" ]; then
    SOURCE_DIR="$SOURCE_DIR/velocitypulse-agent"
fi

# Copy files
cp -rf "$SOURCE_DIR"/* "$INSTALL_DIR/"
echo -e "${GREEN}  Files installed${NC}"

# Check if this is a pre-built release or source archive
cd "$INSTALL_DIR"
if [ -f "$INSTALL_DIR/dist/index.js" ]; then
    # Pre-built release: install production dependencies only
    echo "  Pre-built dist/ found. Installing production dependencies..."
    npm install --production --silent 2>/dev/null
else
    # Source archive: install all dependencies (including TypeScript) and build
    echo -e "${YELLOW}  No pre-built dist/ found. Building from source...${NC}"
    echo "  Installing dependencies (this may take a minute)..."
    npm install --silent 2>/dev/null
    echo "  Building agent..."
    npm run build 2>/dev/null
    if [ ! -f "$INSTALL_DIR/dist/index.js" ]; then
        echo -e "${RED}  ERROR: Build failed. dist/index.js not found.${NC}"
        exit 1
    fi
    echo -e "${GREEN}  Build completed${NC}"
fi
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
# Create service (platform-aware)
# ==============================================
echo ""

NODE_PATH=$(which node)
mkdir -p "$INSTALL_DIR/logs"

if [ "$OS_TYPE" = "linux" ]; then
    # ==============================================
    # Linux: systemd service
    # ==============================================
    echo -e "${YELLOW}[6/6] Creating systemd service...${NC}"

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

elif [ "$OS_TYPE" = "macos" ]; then
    # ==============================================
    # macOS: launchd plist
    # ==============================================
    echo -e "${YELLOW}[6/6] Creating launchd service...${NC}"

    PLIST_PATH="/Library/LaunchDaemons/io.velocitypulse.agent.plist"

    cat > "$PLIST_PATH" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>io.velocitypulse.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$INSTALL_DIR/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$INSTALL_DIR/logs/service.log</string>
    <key>StandardErrorPath</key>
    <string>$INSTALL_DIR/logs/service-error.log</string>
</dict>
</plist>
PLISTEOF

    launchctl load "$PLIST_PATH"

    echo -e "${GREEN}  Service created and started${NC}"
fi

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

if [ "$OS_TYPE" = "linux" ]; then
    echo -e "${YELLOW}  Commands:${NC}"
    echo "    Start:   systemctl start $SERVICE_NAME"
    echo "    Stop:    systemctl stop $SERVICE_NAME"
    echo "    Status:  systemctl status $SERVICE_NAME"
    echo "    Logs:    journalctl -u $SERVICE_NAME -f"
elif [ "$OS_TYPE" = "macos" ]; then
    echo -e "${YELLOW}  Commands:${NC}"
    echo "    Status:  sudo launchctl list | grep velocitypulse"
    echo "    Stop:    sudo launchctl unload /Library/LaunchDaemons/io.velocitypulse.agent.plist"
    echo "    Start:   sudo launchctl load /Library/LaunchDaemons/io.velocitypulse.agent.plist"
    echo "    Logs:    tail -f $INSTALL_DIR/logs/service.log"
fi
echo ""
