#!/bin/bash
#
# VelocityPulse Agent - Linux/macOS Installer
# Usage: curl -fsSL https://get.velocitypulse.io/agent.sh | sudo bash
#
# Options:
#   --uninstall       Uninstall the agent
#   --upgrade         Upgrade to latest version
#   --unattended      Run without prompts (requires env vars)
#   --dashboard-url   Dashboard URL (default: https://app.velocitypulse.io)
#   --api-key         API key from dashboard
#   --agent-name      Agent display name
#   --ui-port         Local UI port (default: 3001)
#

set -e

# ============================================
# DEPRECATION NOTICE
# ============================================
echo ""
echo "  WARNING: This installer (v1.0.0) is deprecated."
echo "  Use install-linux.sh instead for improved reliability."
echo "  One-liner: curl -sSL https://get.velocitypulse.io/agent.sh | bash"
echo ""

VERSION="1.0.0"
INSTALL_PATH="/opt/velocitypulse-agent"
SERVICE_NAME="velocitypulse-agent"
DEFAULT_DASHBOARD_URL="https://app.velocitypulse.io"
DEFAULT_UI_PORT="3001"

# Parse command line arguments
UNINSTALL=false
UPGRADE=false
UNATTENDED=false
UI_PORT="$DEFAULT_UI_PORT"

while [[ $# -gt 0 ]]; do
    case $1 in
        --uninstall)
            UNINSTALL=true
            shift
            ;;
        --upgrade)
            UPGRADE=true
            shift
            ;;
        --unattended)
            UNATTENDED=true
            shift
            ;;
        --dashboard-url)
            DASHBOARD_URL="$2"
            shift 2
            ;;
        --api-key)
            API_KEY="$2"
            shift 2
            ;;
        --agent-name)
            AGENT_NAME="$2"
            shift 2
            ;;
        --ui-port)
            UI_PORT="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${CYAN}"
    echo "  __     __   _            _ _         _____       _"
    echo "  \\ \\   / /__| | ___   ___(_) |_ _   _|  __ \\ _   _| |___  ___"
    echo "   \\ \\ / / _ \\ |/ _ \\ / __| | __| | | | |__) | | | | / __|/ _ \\"
    echo "    \\ V /  __/ | (_) | (__| | |_| |_| |  ___/| |_| | \\__ \\  __/"
    echo "     \\_/ \\___|_|\\___/ \\___|_|\\__|\\__, |_|     \\__,_|_|___/\\___|"
    echo "                                  __/ |"
    echo "          Agent Installer        |___/           v${VERSION}"
    echo -e "${NC}"
    echo ""
}

print_step() {
    echo -e "${YELLOW}[$1/$2] $3${NC}"
}

print_success() {
    echo -e "${GREEN}[OK] $1${NC}"
}

print_error() {
    echo -e "${RED}[ERROR] $1${NC}"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "This installer must be run as root (use sudo)"
        exit 1
    fi
}

check_node() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge 18 ]; then
            return 0
        fi
    fi
    return 1
}

install_node() {
    print_step "1" "6" "Installing Node.js..."

    if command -v apt-get &> /dev/null; then
        # Debian/Ubuntu
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    elif command -v yum &> /dev/null; then
        # CentOS/RHEL
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        yum install -y nodejs
    elif command -v brew &> /dev/null; then
        # macOS
        brew install node@20
    else
        print_error "Could not detect package manager. Please install Node.js 18+ manually."
        exit 1
    fi

    print_success "Node.js installed"
}

get_configuration() {
    if [ "$UNATTENDED" = true ]; then
        # Unattended mode - use env vars or parameters
        DASHBOARD_URL=${DASHBOARD_URL:-$DEFAULT_DASHBOARD_URL}
        if [ -z "$API_KEY" ]; then
            print_error "API_KEY is required in unattended mode"
            exit 1
        fi
        AGENT_NAME=${AGENT_NAME:-$(hostname)}
        return
    fi

    echo ""
    echo "Configuration"
    echo "============="

    # Dashboard URL
    read -p "Dashboard URL [$DEFAULT_DASHBOARD_URL]: " input
    DASHBOARD_URL=${input:-$DEFAULT_DASHBOARD_URL}

    # API Key
    while [ -z "$API_KEY" ]; do
        read -p "API Key (from VelocityPulse dashboard): " API_KEY
        if [ -z "$API_KEY" ]; then
            print_error "API Key is required"
        fi
    done

    # Agent Name
    DEFAULT_NAME=$(hostname)
    read -p "Agent Name [$DEFAULT_NAME]: " input
    AGENT_NAME=${input:-$DEFAULT_NAME}

    # UI Port
    read -p "UI Port [$DEFAULT_UI_PORT]: " input
    UI_PORT=${input:-$DEFAULT_UI_PORT}
}

uninstall_agent() {
    echo ""
    print_step "1" "2" "Stopping and removing service..."

    if [ -d "/etc/systemd/system" ]; then
        # systemd
        systemctl stop "$SERVICE_NAME" 2>/dev/null || true
        systemctl disable "$SERVICE_NAME" 2>/dev/null || true
        rm -f "/etc/systemd/system/$SERVICE_NAME.service"
        systemctl daemon-reload
        print_success "Service removed"
    elif [ "$(uname)" == "Darwin" ]; then
        # macOS launchd
        PLIST_PATH="/Library/LaunchDaemons/io.velocitypulse.agent.plist"
        launchctl unload "$PLIST_PATH" 2>/dev/null || true
        rm -f "$PLIST_PATH"
        print_success "Service removed"
    fi

    print_step "2" "2" "Removing installation directory..."
    if [ -d "$INSTALL_PATH" ]; then
        rm -rf "$INSTALL_PATH"
        print_success "Installation directory removed"
    fi

    echo ""
    echo -e "${GREEN}========================================"
    echo "  Uninstallation Complete!"
    echo -e "========================================${NC}"
}

upgrade_agent() {
    echo ""
    print_step "1" "4" "Checking current installation..."

    if [ ! -d "$INSTALL_PATH" ]; then
        print_error "Agent not found at $INSTALL_PATH. Run install first."
        exit 1
    fi

    # Backup .env
    ENV_BACKUP=""
    if [ -f "$INSTALL_PATH/.env" ]; then
        ENV_BACKUP=$(mktemp)
        cp "$INSTALL_PATH/.env" "$ENV_BACKUP"
        print_success "Configuration backed up"
    fi

    print_step "2" "4" "Stopping service..."
    if [ -d "/etc/systemd/system" ]; then
        systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    elif [ "$(uname)" == "Darwin" ]; then
        launchctl unload "/Library/LaunchDaemons/io.velocitypulse.agent.plist" 2>/dev/null || true
    fi

    print_step "3" "4" "Downloading latest version..."
    TEMP_DIR=$(mktemp -d)
    curl -fsSL "https://github.com/velocityeu/velocitypulse/archive/refs/heads/main.tar.gz" -o "$TEMP_DIR/agent.tar.gz"
    tar -xzf "$TEMP_DIR/agent.tar.gz" -C "$TEMP_DIR"

    # Remove old files but keep logs and .env
    find "$INSTALL_PATH" -mindepth 1 -maxdepth 1 ! -name 'logs' ! -name '.env' -exec rm -rf {} +

    # Copy new files
    cp -r "$TEMP_DIR"/velocitypulse-main/velocitypulse-agent/* "$INSTALL_PATH/"
    rm -rf "$TEMP_DIR"

    # Restore .env if it was removed
    if [ -n "$ENV_BACKUP" ] && [ ! -f "$INSTALL_PATH/.env" ]; then
        cp "$ENV_BACKUP" "$INSTALL_PATH/.env"
        rm -f "$ENV_BACKUP"
    fi

    # Rebuild
    cd "$INSTALL_PATH"
    npm install --production > /dev/null 2>&1
    npm run build > /dev/null 2>&1
    print_success "New version installed"

    print_step "4" "4" "Starting service..."
    if [ -d "/etc/systemd/system" ]; then
        systemctl start "$SERVICE_NAME"
    elif [ "$(uname)" == "Darwin" ]; then
        launchctl load "/Library/LaunchDaemons/io.velocitypulse.agent.plist"
    fi
    print_success "Service restarted"

    echo ""
    echo -e "${GREEN}========================================"
    echo "  Upgrade Complete!"
    echo -e "========================================${NC}"
}

install_agent() {
    TOTAL_STEPS=6

    # Check Node.js
    if ! check_node; then
        install_node
    else
        print_step "1" "$TOTAL_STEPS" "Checking prerequisites..."
        print_success "Node.js $(node --version) found"
    fi

    # Create directory
    print_step "2" "$TOTAL_STEPS" "Creating installation directory..."
    mkdir -p "$INSTALL_PATH"
    print_success "Directory: $INSTALL_PATH"

    # Download agent
    print_step "3" "$TOTAL_STEPS" "Downloading agent..."
    TEMP_DIR=$(mktemp -d)
    curl -fsSL "https://github.com/velocityeu/velocitypulse/archive/refs/heads/main.tar.gz" -o "$TEMP_DIR/agent.tar.gz"
    tar -xzf "$TEMP_DIR/agent.tar.gz" -C "$TEMP_DIR"
    cp -r "$TEMP_DIR"/velocitypulse-main/velocitypulse-agent/* "$INSTALL_PATH/"
    rm -rf "$TEMP_DIR"
    print_success "Agent downloaded"

    # Install dependencies
    print_step "4" "$TOTAL_STEPS" "Installing dependencies..."
    cd "$INSTALL_PATH"
    npm install --production > /dev/null 2>&1
    npm run build > /dev/null 2>&1
    print_success "Dependencies installed"

    # Create configuration
    print_step "5" "$TOTAL_STEPS" "Creating configuration..."
    cat > "$INSTALL_PATH/.env" << EOF
# VelocityPulse Agent Configuration
VELOCITYPULSE_URL=$DASHBOARD_URL
VP_API_KEY=$API_KEY
AGENT_NAME=$AGENT_NAME
AGENT_UI_PORT=$UI_PORT
HEARTBEAT_INTERVAL=60
STATUS_CHECK_INTERVAL=30
LOG_LEVEL=info
ENABLE_REALTIME=true
EOF
    print_success "Configuration saved"

    # Create systemd service
    print_step "6" "$TOTAL_STEPS" "Creating systemd service..."

    if [ -d "/etc/systemd/system" ]; then
        cat > "/etc/systemd/system/$SERVICE_NAME.service" << EOF
[Unit]
Description=VelocityPulse Network Monitoring Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_PATH
ExecStart=$(which node) $INSTALL_PATH/dist/index.js
Restart=always
RestartSec=10
StandardOutput=append:$INSTALL_PATH/logs/service.log
StandardError=append:$INSTALL_PATH/logs/service-error.log

[Install]
WantedBy=multi-user.target
EOF

        mkdir -p "$INSTALL_PATH/logs"
        systemctl daemon-reload
        systemctl enable "$SERVICE_NAME"
        systemctl start "$SERVICE_NAME"

        if systemctl is-active --quiet "$SERVICE_NAME"; then
            print_success "Service installed and running"
        else
            echo -e "${YELLOW}Service installed but may not be running. Check logs.${NC}"
        fi
    elif [ "$(uname)" == "Darwin" ]; then
        # macOS launchd
        PLIST_PATH="/Library/LaunchDaemons/io.velocitypulse.agent.plist"
        cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>io.velocitypulse.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>$INSTALL_PATH/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_PATH</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$INSTALL_PATH/logs/service.log</string>
    <key>StandardErrorPath</key>
    <string>$INSTALL_PATH/logs/service-error.log</string>
</dict>
</plist>
EOF
        mkdir -p "$INSTALL_PATH/logs"
        launchctl load "$PLIST_PATH"
        print_success "Service installed and running"
    else
        print_error "Could not detect init system. Please configure service manually."
    fi
}

# Main
print_banner
check_root

if [ "$UNINSTALL" = true ]; then
    uninstall_agent
elif [ "$UPGRADE" = true ]; then
    upgrade_agent
else
    get_configuration
    install_agent

    echo ""
    echo -e "${GREEN}========================================"
    echo "  Installation Complete!"
    echo -e "========================================${NC}"
    echo ""
    echo "Agent installed to: $INSTALL_PATH"
    echo "Service name: $SERVICE_NAME"
    echo "Agent UI: http://localhost:$UI_PORT"
    echo ""
    echo "Useful commands:"
    if [ -d "/etc/systemd/system" ]; then
        echo "  Check status:  systemctl status $SERVICE_NAME"
        echo "  View logs:     journalctl -u $SERVICE_NAME -f"
        echo "  Restart:       systemctl restart $SERVICE_NAME"
    elif [ "$(uname)" == "Darwin" ]; then
        echo "  Check status:  launchctl list | grep velocitypulse"
        echo "  View logs:     tail -f $INSTALL_PATH/logs/*.log"
        echo "  Restart:       launchctl unload /Library/LaunchDaemons/io.velocitypulse.agent.plist && launchctl load /Library/LaunchDaemons/io.velocitypulse.agent.plist"
    fi
    echo ""
    echo "Uninstall:     sudo $0 --uninstall"
    echo "Upgrade:       sudo $0 --upgrade"
    echo ""
fi
