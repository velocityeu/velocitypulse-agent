# VelocityPulse Agent

Network monitoring agent for the VelocityPulse SaaS platform. Discovers devices on your network and reports their status in real-time to your VelocityPulse dashboard.

## Features

- **Automatic Device Discovery**: Scans network segments using ARP (local) or ICMP ping sweep (remote)
- **Real-time Status Monitoring**: Continuously monitors devices using ping, TCP, or HTTP checks
- **Status Hysteresis**: Prevents flapping by requiring multiple consecutive failures before marking offline
- **Auto-registration**: Automatically detects and registers local network segments
- **Cross-platform**: Runs on Windows, Linux, and macOS
- **Service Mode**: Installs as a system service for automatic startup

## Quick Start

### Windows (One-liner)

```powershell
irm https://get.velocitypulse.io/agent | iex
```

### Linux/macOS

```bash
curl -fsSL https://get.velocitypulse.io/agent.sh | sudo bash
```

## Manual Installation

### Prerequisites

- Node.js 18 or higher
- Network access to VelocityPulse dashboard

### Steps

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the agent:
   ```bash
   npm run build
   ```
4. Create `.env` file with your configuration (see below)
5. Start the agent:
   ```bash
   npm start
   ```

## Configuration

Create a `.env` file in the agent directory:

```env
# Required
VELOCITYPULSE_URL=https://app.velocitypulse.io
VP_API_KEY=vp_yourorg_xxxxxxxxxxxxxxxxxxxx

# Optional
AGENT_NAME=Office Network Agent
HEARTBEAT_INTERVAL=60
STATUS_CHECK_INTERVAL=30
STATUS_FAILURE_THRESHOLD=2
LOG_LEVEL=info
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VELOCITYPULSE_URL` | Yes | - | VelocityPulse dashboard URL |
| `VP_API_KEY` | Yes | - | API key from dashboard (format: `vp_{org}_{key}`) |
| `AGENT_NAME` | No | hostname | Display name for this agent |
| `HEARTBEAT_INTERVAL` | No | 60 | Seconds between heartbeats |
| `STATUS_CHECK_INTERVAL` | No | 30 | Seconds between status checks |
| `STATUS_FAILURE_THRESHOLD` | No | 2 | Consecutive failures before offline |
| `LOG_LEVEL` | No | info | Log level (debug/info/warn/error) |
| `ENABLE_REALTIME` | No | true | Enable WebSocket real-time updates |
| `ENABLE_AUTO_SCAN` | No | true | Auto-detect local network |

## API Key Format

VelocityPulse API keys follow this format:
```
vp_{org_prefix}_{random_24_chars}
```

Example: `vp_acme1234_xK7mN9pQ2rStUvWxYz3456`

Get your API key from the VelocityPulse dashboard under Settings > Agents.

## Running as a Service

### Windows

The installer automatically registers a Windows service named `VelocityPulseAgent`.

Manual service management:
```powershell
# Check status
Get-Service VelocityPulseAgent

# Start/Stop/Restart
Start-Service VelocityPulseAgent
Stop-Service VelocityPulseAgent
Restart-Service VelocityPulseAgent
```

### Linux (systemd)

The installer creates a systemd service named `velocitypulse-agent`.

```bash
# Check status
systemctl status velocitypulse-agent

# Start/Stop/Restart
sudo systemctl start velocitypulse-agent
sudo systemctl stop velocitypulse-agent
sudo systemctl restart velocitypulse-agent

# View logs
journalctl -u velocitypulse-agent -f
```

### macOS (launchd)

The installer creates a launchd plist at `/Library/LaunchDaemons/io.velocitypulse.agent.plist`.

```bash
# Check status
sudo launchctl list | grep velocitypulse

# Start/Stop
sudo launchctl load /Library/LaunchDaemons/io.velocitypulse.agent.plist
sudo launchctl unload /Library/LaunchDaemons/io.velocitypulse.agent.plist
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode (auto-reload)
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VelocityPulse Agent                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Heartbeat  │  │   Scanner   │  │   Status Checker    │  │
│  │    Loop     │  │    Loop     │  │       Loop          │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│         ▼                ▼                     ▼             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   Dashboard Client                       ││
│  │         (REST API + WebSocket Real-time)                ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                ┌─────────────────────────┐
                │  VelocityPulse Dashboard │
                │    (SaaS Platform)       │
                └─────────────────────────┘
```

## Troubleshooting

### Agent won't connect

1. Verify `VELOCITYPULSE_URL` is correct
2. Check API key format starts with `vp_`
3. Ensure firewall allows outbound HTTPS (port 443)
4. Check logs in `./logs/` directory

### Devices not discovered

1. Verify agent has network access to target segments
2. For remote networks, ensure ICMP is allowed through firewalls
3. Check if segments are assigned in the dashboard

### Status always shows offline

1. Check `STATUS_FAILURE_THRESHOLD` setting
2. Verify devices respond to ping/TCP/HTTP checks
3. Review agent logs for check failures

## License

MIT License - See LICENSE file for details.

## Support

- Documentation: https://docs.velocitypulse.io
- Issues: https://github.com/velocityeu/velocitypulse-agent/issues
- Email: support@velocitypulse.io
